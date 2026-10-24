"""Crops NSAA Section 1 Part A (Mathematics, questions 1-18) into one image per question
and reads the answers from the answer key.

usage: extract_nsaa.py PAPER.pdf KEY.pdf OUT_DIR ID [--debug]
Writes OUT_DIR/q01.png ... q18.png and prints a JSON summary:
  {"id": ..., "questions": [{"n": 1, "image": "q01.png", "options": 8, "answer": "G"}, ...]}
"""
import json
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops

sys.stdout.reconfigure(encoding="utf-8")

PART_A_COUNT = 18
SCALE = 2.5          # render resolution (1 = 72 dpi)
PAD = 8              # pt of space kept above a question
LEFT_MARGIN_MAX = 90  # question numbers sit at the left margin, x < this (pt)

paper_path, key_path, out_dir, paper_id = sys.argv[1:5]
debug = "--debug" in sys.argv
out = Path(out_dir)
out.mkdir(parents=True, exist_ok=True)


def read_key(path):
    doc = pymupdf.open(path)
    text = " ".join(page.get_text() for page in doc).replace("|", " ")
    answers = {}
    for n, letter in re.findall(r"(?<![\d.])(\d{1,2})\s+([A-H])(?![A-Za-z])", text):
        n = int(n)
        if 1 <= n <= PART_A_COUNT and n not in answers:
            answers[n] = letter
    missing = [n for n in range(1, PART_A_COUNT + 1) if n not in answers]
    if missing:
        raise SystemExit(f"answer key {path}: no answer found for questions {missing}")
    return answers


def lines(page):
    """Yields (text, bbox) for each text line on the page."""
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if text:
                yield text, pymupdf.Rect(line["bbox"])


doc = pymupdf.open(paper_path)

# Find where each question starts: a line at the left margin that is just the number.
starts = {}  # n -> (page index, y)
part_b_page = None
expected = 1
for pi, page in enumerate(doc):
    page_text = page.get_text()
    if "PART B" in page_text and expected > PART_A_COUNT:
        part_b_page = pi
        break
    if "PART A" not in page_text:
        continue
    for text, box in sorted(lines(page), key=lambda t: (t[1].y0, t[1].x0)):
        if expected > PART_A_COUNT:
            break
        if box.x0 < LEFT_MARGIN_MAX and re.fullmatch(rf"{expected}\b.*", text) and re.match(r"\d+", text).group() == str(expected):
            starts[expected] = (pi, box.y0)
            if debug:
                print(f"q{expected}: page {pi + 1}, y={box.y0:.0f}, line={text[:50]!r}")
            expected += 1

if len(starts) != PART_A_COUNT:
    raise SystemExit(f"{paper_path}: found only questions {sorted(starts)}")


def footer_top(page):
    """Top of the footer area (page number, '[Turn over', copyright), so crops stop above it."""
    limit = page.rect.height - 30
    for text, box in lines(page):
        if box.y0 > page.rect.height * 0.75 and ("Turn over" in text or "UCLES" in text or "BLANK PAGE" in text):
            limit = min(limit, box.y0)
    return limit


def trim(img):
    """Crops away the white border, keeping a small margin."""
    bg = Image.new(img.mode, img.size, (255, 255, 255))
    diff = ImageChops.difference(img, bg).convert("L").point(lambda v: 255 if v > 24 else 0)
    box = diff.getbbox()
    if not box:
        return img
    m = 14
    return img.crop((max(box[0] - m, 0), max(box[1] - m, 0), min(box[2] + m, img.width), min(box[3] + m, img.height)))


answers = read_key(key_path)
summary = []
for n in range(1, PART_A_COUNT + 1):
    pi, y0 = starts[n]
    page = doc[pi]
    nxt = starts.get(n + 1)
    y1 = nxt[1] - PAD if nxt and nxt[0] == pi else footer_top(page)
    clip = pymupdf.Rect(0, y0 - PAD, page.rect.width, y1)

    # Options are lines starting with a lone capital letter A-H at the left of the clip.
    letters = set()
    for text, box in lines(page):
        if box.y0 >= clip.y0 and box.y1 <= clip.y1 + 2:
            mt = re.match(r"([A-H])(\s|$)", text)
            if mt and box.x0 < page.rect.width * 0.5:
                letters.add(mt.group(1))
    options = max((ord(c) - 64 for c in letters), default=0)

    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=clip)
    img = trim(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    name = f"q{n:02d}.png"
    img.convert("L").save(out / name, optimize=True)  # greyscale: the papers are black and white

    answer_index = ord(answers[n]) - 65
    if options < answer_index + 1:
        print(f"WARNING q{n}: detected {options} options but answer is {answers[n]}", file=sys.stderr)
        options = max(options, answer_index + 1)
    summary.append({"n": n, "image": name, "options": options, "answer": answers[n], "page": pi + 1})

print(json.dumps({"id": paper_id, "questions": summary}))
