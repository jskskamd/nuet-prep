"""Crops multiple-choice questions out of a past-paper PDF, one image per question, and reads
the correct answers from an answer key.

Used by build_tests.py. Handles questions that continue onto the next page by stacking the
pieces, and skips page headers/footers (page numbers, copyright lines, "Turn over").
"""
import re
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops

SCALE = 2.5           # render resolution (1 = 72 dpi)
PAD = 6               # pt of space kept above a question
LEFT_MARGIN_MAX = 95  # question numbers sit at the left margin, x < this (pt)
NOISE = re.compile(r"UCLES|Turn over|BLANK PAGE|NUFYPET PREP|^\s*\d{1,3}\s*$|9694/\d\d/|Cambridge International")
# Cyrillic letters that look like Latin answer letters (some keys were typed with them).
LOOKALIKES = str.maketrans("АВСЕНАВСЕН", "ABCEHABCEH")


def read_key(path, first, last, pages=None):
    """Returns {question number: letter} for questions first..last from an answer-key PDF."""
    doc = pymupdf.open(path)
    page_list = pages if pages is not None else range(doc.page_count)
    text = " ".join(doc[i].get_text() for i in page_list).replace("|", " ").replace("\xa0", " ")
    text = text.translate(LOOKALIKES)
    answers = {}
    for n, letter in re.findall(r"(?<![\d.])(\d{1,2})\s+([A-H])(?![A-Za-z])", text):
        n = int(n)
        if first <= n <= last and n not in answers:
            answers[n] = letter
    missing = [n for n in range(first, last + 1) if n not in answers]
    if missing:
        raise SystemExit(f"{path}: no answer for questions {missing}")
    return answers


def readable(text):
    """Undoes the shifted font encoding some PDFs use (e.g. "7KH\\x03" for "The "):
    every character is stored 29 code points too low. Short number lines mix shifted
    and plain digits, so only their control characters are shifted."""
    if not any(ord(c) < 32 for c in text):
        return text
    if re.fullmatch(r"[\x00-\x1f\d\s]+", text):
        return "".join(chr(ord(c) + 29) if ord(c) < 32 else c for c in text)
    return "".join(chr(ord(c) + 29) if ord(c) <= 93 else c for c in text)


def lines(page):
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = readable("".join(span["text"] for span in line["spans"])).strip()
            if text:
                yield text, pymupdf.Rect(line["bbox"])


def find_starts(doc, pages, first, last):
    """Finds (page index, y) where each question number first..last appears at the left margin."""
    starts = {}
    expected = first
    # Question numbers sit at the left edge. Lookalikes inside a question (an option such as
    # "14 hours", a table row starting with a number) are indented further right, so on the
    # same page a number may not be more than a little to the right of the previous question's
    # number. (Layouts can shift between pages, so a new page starts fresh.)
    number_x = None
    number_page = None
    for pi in pages:
        page_lines = sorted(lines(doc[pi]), key=lambda t: (round(t[1].y0), t[1].x0))
        for text, box in page_lines:
            if expected > last:
                return starts
            m = re.match(r"(\d{1,2})(?:\s|\.|$)", text)
            aligned = box.x0 < LEFT_MARGIN_MAX and (number_page != pi or box.x0 <= number_x + 10)
            if m and int(m.group(1)) == expected and aligned:
                # A bare number in the header/footer band with nothing beside it is a page
                # number. (Questions can start high on a page, or start with a diagram.)
                in_band = box.y0 < 50 or box.y0 > doc[pi].rect.height - 50
                if in_band and text.strip() == str(expected) and not any(
                    abs(b.y0 - box.y0) < 8 and b.x0 > box.x1 and not NOISE.search(t)
                    for t, b in page_lines
                ):
                    continue
                starts[expected] = (pi, box.y0)
                number_x, number_page = box.x0, pi
                expected += 1
    return starts


def content_band(page, bottom_frac=None):
    """(top, bottom) of the page area below the header and above the footer.
    bottom_frac cuts off a footer that isn't text (e.g. a logo image)."""
    h = page.rect.height
    top, bottom = 0, h * bottom_frac if bottom_frac else h
    for text, box in lines(page):
        if NOISE.search(text):
            if box.y1 < h * 0.12:
                top = max(top, box.y1 + 2)
            elif box.y0 > h * 0.85:
                bottom = min(bottom, box.y0 - 2)
    return top, bottom


def render(page, clip, lighten=False):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=clip)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if lighten:
        # Turns pale background watermarks white; text and lines are much darker.
        img = img.convert("L").point(lambda v: 255 if v > 200 else v).convert("RGB")
    return img


def trim(img, margin=14):
    """Crops the white border; returns None for an empty (blank) image."""
    bg = Image.new(img.mode, img.size, (255, 255, 255))
    diff = ImageChops.difference(img, bg).convert("L").point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
    if not box:
        return None
    return img.crop((max(box[0] - margin, 0), max(box[1] - margin, 0),
                     min(box[2] + margin, img.width), min(box[3] + margin, img.height)))


def stack(images, gap=24):
    width = max(i.width for i in images)
    out = Image.new("RGB", (width, sum(i.height for i in images) + gap * (len(images) - 1)), "white")
    y = 0
    for i in images:
        out.paste(i, (0, y))
        y += i.height + gap
    return out


def count_options(doc, pieces):
    """Highest option letter (A-H) found at the start of a line inside the question's area."""
    letters = set()
    for pi, clip in pieces:
        for text, box in lines(doc[pi]):
            if box.y0 >= clip.y0 - 1 and box.y1 <= clip.y1 + 2 and box.x0 < doc[pi].rect.width * 0.6:
                for m in re.finditer(r"(?:^|\s)([A-H])(?=\s|$)", text):
                    letters.add(m.group(1))
    # Only trust a run of letters that starts at A (A, B, C... without gaps).
    n = 0
    while chr(65 + n) in letters:
        n += 1
    return n


def extract(paper, key, out_dir, first, last, pages=None, min_options=4, number_from=1,
            lighten=False, bottom_frac=None, debug=False):
    """Crops questions first..last of `paper` into out_dir/qNN.png (renumbered from number_from).
    lighten removes pale watermarks (don't use it on papers with grey shading in diagrams);
    bottom_frac cuts off an image footer. Returns a list of {"image", "options", "answer"}."""
    doc = pymupdf.open(paper)
    pages = list(pages if pages is not None else range(doc.page_count))
    starts = find_starts(doc, pages, first, last)
    if len(starts) != last - first + 1:
        found = sorted(starts)
        raise SystemExit(f"{paper}: found questions {found}, expected {first}-{last}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    result = []
    for n in range(first, last + 1):
        pi, y0 = starts[n]
        if n < last:
            end_page, end_y = starts[n + 1]
        else:
            end_page, end_y = pi, None  # last question: to the end of its page
        pieces = []
        for p in range(pi, end_page + 1):
            if p not in pages:
                continue
            top, bottom = content_band(doc[p], bottom_frac)
            y_from = y0 - PAD if p == pi else top
            y_to = (end_y - PAD) if (p == end_page and end_y is not None) else bottom
            if y_to - y_from > 4:
                pieces.append((p, pymupdf.Rect(0, y_from, doc[p].rect.width, y_to)))
        images = [im for im in (trim(render(doc[p], clip, lighten)) for p, clip in pieces) if im is not None]
        img = stack(images) if len(images) > 1 else images[0]
        num = number_from + (n - first)
        name = f"q{num:02d}.png"
        img.convert("L").save(out / name, optimize=True)

        answer = ord(key[n]) - 65
        options = max(count_options(doc, pieces), min_options, answer + 1)
        result.append({"image": name, "options": options, "answer": answer})
        if debug:
            print(f"  q{n}: pages {[p + 1 for p, _ in pieces]}, options {options}, answer {key[n]}")
    return result
