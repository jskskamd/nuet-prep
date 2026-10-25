"""Crops the papers that came without answer keys (MSDC workbook, MOCK tests) into
nuet-prep/tests/<id>/ and writes tools/staged.json: every question with its image, detected
option count and whether its picture is broken. The answers are then worked out by hand into
tools/unofficial_answers.json, and build_mocks.py combines the two.

usage: stage_unsolved.py MATERIALS_DIR APP_DIR
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).parent))
from extract_questions import extract, lines  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
materials, app = Path(sys.argv[1]), Path(sys.argv[2])
staged = {}


def stage(test_id, paper, first, last, prefix="q", **kw):
    out_dir = app / "tests" / test_id
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{prefix}*.png"):
        old.unlink()
    qs = extract(paper, None, out_dir, first, last, prefix=prefix, **kw)
    for q in qs:
        q["image"] = f"tests/{test_id}/{q['image']}"
    staged[f"{test_id}/{prefix}"] = qs
    broken = sum(q["broken"] for q in qs)
    print(f"{test_id}/{prefix}: {len(qs)} questions, {broken} broken")


# MSDC "NUET Math ID 2022" workbook: 8 tests of 30, each after an instructions page.
msdc = materials / "math" / "MSDC MATH WORKBOOK.pdf"
doc = pymupdf.open(msdc)
instr = [i for i in range(doc.page_count) if "Instructions" in doc[i].get_text()]
# Question numbers that aren't readable as text: {test: {number: (page index, y)}}.
MSDC_MANUAL = {8: {25: (54, 397)}}
# MSDC numbers questions "7." or "7 "; "1)" is a numbered statement inside a question.
MSDC_NUMBER = re.compile(r"(\d{1,2})(?:\.|\s|$)")
for t, start in enumerate(instr, start=1):
    end = instr[t] if t < len(instr) else doc.page_count
    # Questions are packed tightly (an option row can end just above the next number): pad=1.
    stage(f"msdc-{t}", msdc, 1, 30, pages=range(start + 1, end), min_options=5, manual=MSDC_MANUAL.get(t),
          pad=1, number=MSDC_NUMBER)

def stage_pictures(test_id, path, start_at, prefix="c", expected=30, joins=()):
    """For sections where each question is a single picture with its number drawn inside it:
    crops every picture after start_at, in page order, as one question. joins lists picture
    numbers (1-based) that continue the picture before them, e.g. a question split over pages."""
    from extract_questions import SCALE, is_broken, stack, trim
    from PIL import Image
    doc = pymupdf.open(path)
    out_dir = app / "tests" / test_id
    for old in out_dir.glob(f"{prefix}*.png"):
        old.unlink()
    boxes = []
    for pi in range(start_at[0], doc.page_count):
        for info in sorted(doc[pi].get_image_info(), key=lambda i: (i["bbox"][1], i["bbox"][0])):
            if (pi, info["bbox"][1]) > start_at:
                boxes.append((pi, pymupdf.Rect(info["bbox"])))
    groups = []
    for k, box in enumerate(boxes, start=1):
        if k in joins and groups:
            groups[-1].append(box)
        else:
            groups.append([box])
    if len(groups) != expected:
        raise SystemExit(f"{path}: {len(groups)} questions from {len(boxes)} pictures, expected {expected}")
    qs = []
    for n, group in enumerate(groups, start=1):
        parts = []
        for pi, rect in group:
            pix = doc[pi].get_pixmap(matrix=pymupdf.Matrix(SCALE, SCALE), clip=rect + (-4, -4, 4, 4))
            parts.append(trim(Image.frombytes("RGB", (pix.width, pix.height), pix.samples)))
        img = stack(parts) if len(parts) > 1 else parts[0]
        name = f"{prefix}{n:02d}.png"
        img.convert("L").save(out_dir / name, optimize=True)
        qs.append({"image": f"tests/{test_id}/{name}", "options": 4, "answer": None, "number": n, "broken": is_broken(img)})
    staged[f"{test_id}/{prefix}"] = qs
    print(f"{test_id}/{prefix}: {len(qs)} questions (one picture each), {sum(q['broken'] for q in qs)} broken")


# MOCK tests: a Math section (1) ... 30)) then a Critical Thinking section (1. ... 30.).
for path in sorted((materials / "docs").glob("MOCK *.pdf"), key=lambda p: int(p.stem.split()[1])):
    num = int(path.stem.split()[1])
    doc = pymupdf.open(path)
    ct = next((pi, box.y0) for pi in range(doc.page_count) for text, box in lines(doc[pi])
              if "Critical Thinking" in text)
    stage(f"mock-{num}", path, 1, 30, prefix="m", stop_at=ct, min_options=4)
    if num == 1:
        stage_pictures(f"mock-{num}", path, ct, joins=(8,))  # numbers drawn inside pictures; Q7 spans 2
    else:
        # From MOCK 4 on, the picture for the last question can sit on the page after its number,
        # so let it run to the end of the paper.
        end = {"stop_at": (doc.page_count, 0)} if num >= 4 else {}
        stage(f"mock-{num}", path, 1, 30, prefix="c", start_at=ct, min_options=4, **end)

(Path(__file__).parent / "staged.json").write_text(json.dumps(staged, indent=1), encoding="utf-8")
print("total", sum(len(v) for v in staged.values()), "questions,",
      sum(q["broken"] for v in staged.values() for q in v), "broken")
