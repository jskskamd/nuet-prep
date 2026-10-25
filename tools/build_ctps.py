"""Builds the Critical Thinking & Problem Solving tests for NUET.exe from materials/crit:
question images in nuet-prep/tests/<id>/ and the test list in nuet-prep/ctps-tests.js.

usage: build_ctps.py MATERIALS_CRIT_DIR APP_DIR
"""
import json
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).parent))
from extract_questions import extract, read_key  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
crit, app = Path(sys.argv[1]), Path(sys.argv[2])
NUET_PACE = 2  # minutes per question on the real NUET (60 questions, 120 minutes)


def page_index(path, text):
    doc = pymupdf.open(path)
    return next(i for i in range(doc.page_count) if text in doc[i].get_text())


def add(tests, test_id, title, source, minutes, paper, key, first, last, pages, min_options, key_pages=None,
        options=None, **crop):
    """options fixes every question's option count, for papers where letters inside the
    question text (codes, labels) would otherwise be counted as extra options."""
    answers = read_key(key, first, last, pages=key_pages)
    out_dir = app / "tests" / test_id
    for old in out_dir.glob("*.png"):
        old.unlink()  # a rebuild must not leave images from an earlier run behind
    questions = extract(paper, answers, out_dir, first, last, pages=pages, min_options=min_options, **crop)
    if options:
        for q in questions:
            q["options"] = options
    tests.append({
        "id": test_id,
        "type": "test",
        "title": title,
        "source": source,
        "minutes": minutes,
        "questions": [{"image": f"tests/{test_id}/{q['image']}", "options": q["options"], "answer": q["answer"]}
                      for q in questions],
    })
    print(f"{test_id}: {len(questions)} questions")


tests = []

# 1. Thinking-skills practice guides (NUFYPET preparation materials): tasks 1..N, answer key at the end.
GUIDES = [
    ("1. Identifying the Main Conclusion.pdf", "Identifying the main conclusion"),
    ("2. Drawing a Conclusion.pdf", "Drawing a conclusion"),
    ("3. Identifying an Assumption.pdf", "Identifying an assumption"),
    ("4. Assessing the Impact of Additional Evidence.pdf", "Assessing additional evidence"),
    ("5. Detecting Reasoning Errors.pdf", "Detecting reasoning errors"),
    ("6. Matching Arguments.pdf", "Matching arguments"),
    ("7. Applying Principles.pdf", "Applying principles"),
]
for n, (file, name) in enumerate(GUIDES, start=1):
    path = crit / file
    key_page = page_index(path, "Answer Key")
    count = 15 if n == 7 else 20
    add(tests, f"ts-skill-{n}", f"Thinking skills {n} · {name}",
        "NUFYPET preparation materials, Thinking Skills", count * NUET_PACE,
        path, path, 1, count, range(3, key_page), min_options=5, key_pages=[key_page],
        lighten=True, bottom_frac=0.9)  # pale "EDUVATION.KZ" watermarks and a logo footer

# 2. ECAA Section 1, Part A Problem Solving (questions 1-20; Part B is advanced maths, not on the NUET).
ECAA = [
    ("ecaa-specimen", "ECAA Specimen", "ECAA_specimen_question_paper.pdf", "ECAA_specimen_answer_key.pdf"),
    ("ecaa-2016", "ECAA 2016", "ecaa_2016_question_paper.pdf", "ecaa_2016_answer_key.pdf"),
    ("ecaa-2017", "ECAA 2017", "ECAA_2017_question_paper.pdf", "ECAA_2017_answer_key.pdf"),
    ("ecaa-2018", "ECAA 2018", "economics_admissions_assessment_2018.pdf", "ecaa-2018-answers.pdf"),
    ("ecaa-2019", "ECAA 2019", "ecaa-paper-2019.pdf", "ecaa-2019-answers.pdf"),
]
for test_id, name, paper, key in ECAA:
    part_b = page_index(crit / paper, "PART B")
    add(tests, test_id, f"{name} · Problem Solving", f"{name}, Section 1 Part A", 40,
        crit / paper, crit / key, 1, 20, range(0, part_b), min_options=5)

# 3. Cambridge International Thinking Skills 9694, Paper 1 (multiple choice), May/June 2016.
#    One PDF holds all the papers; the mark scheme has each variant's key on its second page.
TSA_PAPER, TSA_KEY = crit / "TSA Cambridge 2016 June.pdf", crit / "TSA Cambridge 2016 June Answers.pdf"
for variant, first_page, key_page in [("11", 0, 1), ("12", 20, 3), ("13", 40, 5)]:
    add(tests, f"tsa-2016-{variant}", f"Cambridge Thinking Skills 2016 · Paper {variant}",
        f"Cambridge International AS & A Level Thinking Skills 9694/{variant}, May/June 2016", 105,
        TSA_PAPER, TSA_KEY, 1, 30, range(first_page, first_page + 20), min_options=4, key_pages=[key_page])

# 4. Oxford Thinking Skills Assessment, Section 1 (50 questions, options A-E), 2008-2020.
for year in range(2008, 2021):
    files = sorted(crit.glob(f"*tsa*oxford*{year}*"))
    paper = next(f for f in files if "answer" not in f.name.lower())
    key = next(f for f in files if "answer" in f.name.lower())
    add(tests, f"tsa-oxford-{year}", f"Oxford TSA {year} · Section 1",
        f"Thinking Skills Assessment (Oxford) {year}, Section 1", 90,
        paper, key, 1, 50, None, min_options=5, key_pages=[0], options=5)

js = (
    "// Generated from the papers in materials/crit by tools/build_ctps.py. Do not edit by hand.\n"
    "// Each question is an image of the original; `answer` is the option index (0 = A).\n"
    f"const CTPS_TESTS = {json.dumps(tests, indent=2, ensure_ascii=False)};\n"
)
(app / "ctps-tests.js").write_text(js, encoding="utf-8")
print(f"wrote {app / 'ctps-tests.js'}: {len(tests)} tests, {sum(len(t['questions']) for t in tests)} questions")
