"""Builds the NSAA Part A tests for NUET.exe: question images in nuet-prep/tests/<id>/
and the test list in nuet-prep/tests.js.

usage: build_tests.py MATERIALS_MATH_DIR APP_DIR
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

materials, app = Path(sys.argv[1]), Path(sys.argv[2])
extract = Path(__file__).with_name("extract_nsaa.py")

# NSAA Section 1 is 80 minutes for 54 questions (Part A plus two other parts),
# so Part A's 18 questions get a third of that.
MINUTES = 27

PAPERS = [
    ("nsaa-specimen", "NSAA Specimen paper", "NSAA Specimen 2016 Section 1.pdf", "NSAA Specimen 2016 Section 1 Answer Key.pdf"),
    ("nsaa-2016", "NSAA 2016", "NSAA-Sec1-2016.pdf", "NSAA 2016 Section 1 Answer Key.pdf"),
    ("nsaa-2017", "NSAA 2017", "NSAA-Sec1-2017.pdf", "NSAA 2017 Section 1 Answer Key.pdf"),
    ("nsaa-2018", "NSAA 2018", "nsaa-2018-sec1.pdf", "NSAA 2018 Section 1 Answer Key.pdf"),
]

tests = []
for test_id, title, paper, key in PAPERS:
    out_dir = app / "tests" / test_id
    result = subprocess.run(
        [sys.executable, "-I", str(extract), str(materials / paper), str(materials / key), str(out_dir), test_id],
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    if result.stderr.strip():
        print(result.stderr, file=sys.stderr)
    data = json.loads(result.stdout.strip().splitlines()[-1])
    tests.append({
        "id": test_id,
        "type": "test",
        "title": f"{title} · Part A Mathematics",
        "source": f"{title}, Section 1 Part A",
        "minutes": MINUTES,
        "questions": [
            {"image": f"tests/{test_id}/{q['image']}", "options": q["options"], "answer": ord(q["answer"]) - 65}
            for q in data["questions"]
        ],
    })
    print(f"{test_id}: {len(data['questions'])} questions")

js = (
    "// Generated from the NSAA past papers in materials/math by build_tests.py. Do not edit by hand.\n"
    "// Each question is an image of the original; `answer` is the option index (0 = A).\n"
    f"const MATH_TESTS = {json.dumps(tests, indent=2, ensure_ascii=False)};\n"
)
(app / "tests.js").write_text(js, encoding="utf-8")
print(f"wrote {app / 'tests.js'}")
