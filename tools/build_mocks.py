"""Builds the tests whose answers were worked out by hand (tools/answers/*.json, from the
crops listed in tools/staged.json) plus the mixed mock tests, into nuet-prep/mocks.js.

- MSDC workbook tests 1-8 -> extra Math tests (MSDC_TESTS)
- MOCK 1-3 -> full mocks: 30 Math + 30 CTPS, 120 minutes (MOCK_TESTS)
- 10 mixed mocks: 30 Math + 30 CTPS each, drawn without repeats from every answered
  question in the app (official keys and worked-out answers) (MOCK_TESTS)
- 10 more mixed mocks (11-20) from the MOCK 4-10 papers, topped up with the questions
  mixed mocks 1-10 didn't use, again without repeats (MOCK_TESTS)

Answer files map question number -> [letter, confidence 1-5, explanation] or null when no
option is correct (that question is left out).

usage: build_mocks.py APP_DIR
"""
import json
import random
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
app = Path(sys.argv[1])
tools = Path(__file__).parent
staged = json.loads((tools / "staged.json").read_text(encoding="utf-8"))

# Critical-thinking questions in the MOCK papers that only have options A-D.
FOUR_OPTIONS = {"mock-2/c": {8, 9}, "mock-3/c": {16, 17, 19, 20, 21, 30}}


def load_js_array(path, name):
    text = path.read_text(encoding="utf-8")
    return json.loads(re.search(rf"const {name} = (\[.*\]);", text, re.S).group(1))


def answered(key, counted=False):
    """Staged questions of one section joined with their worked-out answers.
    counted: the answer file gives each question's option count as a 4th value (MOCK 4-10,
    whose questions have anything from 4 to 8 options)."""
    answers = json.loads((tools / "answers" / f"{key.replace('/', '_')}.json").read_text(encoding="utf-8"))
    out = []
    for q in staged[key]:
        a = answers.get(str(q["number"]))
        if q["broken"] or not a:
            continue
        letter, confidence, explain = a[0], a[1], a[2]
        answer = ord(letter) - 65
        if counted:
            options = a[3]
        elif key.endswith("/m"):
            options = 4  # MOCK maths uses a)-d)
        elif key.endswith("/c"):
            options = 4 if q["number"] in FOUR_OPTIONS.get(key, ()) else 5
        else:
            options = max(q["options"], 5)
        out.append({
            "image": q["image"], "options": max(options, answer + 1), "answer": answer,
            "explain": explain, "unofficial": True, "confidence": confidence,
        })
    return out


low = []


def note_low(test_id, questions):
    for i, q in enumerate(questions, start=1):
        if q.get("confidence", 5) <= 3:
            low.append(f"{test_id} Q{i}")


# MSDC workbook: Math tests with unofficial answers.
msdc_tests = []
for t in range(1, 9):
    qs = answered(f"msdc-{t}/q")
    note_low(f"msdc-{t}", qs)
    msdc_tests.append({
        "id": f"msdc-{t}", "type": "test", "title": f"MSDC Math workbook · Test {t}",
        "source": "MSDC NUET Math ID 2022 workbook (unofficial). Answers worked out by NUET.exe.",
        "minutes": 2 * len(qs), "unofficial": True, "questions": qs,
    })

# Original MOCK papers 1-3 as full mocks.
mock_tests = []
for n in (1, 2, 3):
    m, c = answered(f"mock-{n}/m"), answered(f"mock-{n}/c")
    for q in m:
        q["section"] = "math"
    for q in c:
        q["section"] = "ctps"
    note_low(f"mock-{n}", m + c)
    mock_tests.append({
        "id": f"mock-{n}", "type": "test", "title": f"Mock {n}",
        "source": "NUET mock test (Math + Critical Thinking). Answers worked out by NUET.exe.",
        "minutes": 120, "unofficial": True, "questions": m + c,
    })

# Mixed mocks from every answered question.
math_pool, ctps_pool = [], []
for t in load_js_array(app / "tests.js", "MATH_TESTS"):
    math_pool += [{**q, "section": "math", "from": t["title"]} for q in t["questions"]]
for t in msdc_tests:
    math_pool += [{**q, "section": "math", "from": t["title"]} for q in t["questions"]]
# The Oxford TSA papers came later; keeping them out keeps the published mocks unchanged.
for t in load_js_array(app / "ctps-tests.js", "CTPS_TESTS"):
    if t["id"].startswith("tsa-oxford"):
        continue
    ctps_pool += [{**q, "section": "ctps", "from": t["title"]} for q in t["questions"]]
for t in mock_tests:
    for q in t["questions"]:
        (math_pool if q["section"] == "math" else ctps_pool).append({**q, "from": t["title"]})

rng = random.Random(2026)  # fixed seed: rebuilding gives the same mocks
rng.shuffle(math_pool)
rng.shuffle(ctps_pool)
for k in range(10):
    qs = math_pool[k * 30:(k + 1) * 30] + ctps_pool[k * 30:(k + 1) * 30]
    mock_tests.append({
        "id": f"mixed-{k + 1}", "type": "test", "title": f"Mock {k + 4}",
        "source": "Mixed from past papers and mock tests: 30 Math + 30 Critical Thinking & Problem Solving.",
        "minutes": 120, "unofficial": any(q.get("unofficial") for q in qs), "questions": qs,
    })

# Mixed mocks 11-20: every question of MOCK 4-10 plus what mixed mocks 1-10 left over, shuffled
# together. MOCK 10's Critical Thinking repeats MOCK 9's except Q30, so its answer file only
# has Q30. There are fewer CTPS questions than 10 x 30, so they're shared out as evenly as possible.
new_math, new_ctps = math_pool[300:], ctps_pool[300:]
for n in range(4, 11):
    m, c = answered(f"mock-{n}/m", counted=True), answered(f"mock-{n}/c", counted=True)
    note_low(f"mock-{n} (Math)", m)
    note_low(f"mock-{n} (CTPS)", c)
    new_math += [{**q, "section": "math", "from": f"Mock {n}"} for q in m]
    new_ctps += [{**q, "section": "ctps", "from": f"Mock {n}"} for q in c]
rng.shuffle(new_math)
rng.shuffle(new_ctps)
for k in range(10):
    c_from, c_to = len(new_ctps) * k // 10, len(new_ctps) * (k + 1) // 10
    qs = new_math[k * 30:(k + 1) * 30] + new_ctps[c_from:c_to]
    mock_tests.append({
        "id": f"mixed-{k + 11}", "type": "test", "title": f"Mock {k + 14}",
        "source": "Mixed from NUET mock tests 4-10 and past papers: Math + Critical Thinking & Problem Solving.",
        "minutes": 120, "unofficial": any(q.get("unofficial") for q in qs), "questions": qs,
    })

js = (
    "// Generated by tools/build_mocks.py. Do not edit by hand.\n"
    "// `unofficial` answers were worked out by NUET.exe, not taken from an official key.\n"
    f"const MSDC_TESTS = {json.dumps(msdc_tests, ensure_ascii=False)};\n"
    f"const MOCK_TESTS = {json.dumps(mock_tests, ensure_ascii=False)};\n"
)
(app / "mocks.js").write_text(js, encoding="utf-8")
print(f"MSDC: {sum(len(t['questions']) for t in msdc_tests)} questions in 8 tests")
print(f"mocks: {len(mock_tests)} tests; math pool {len(math_pool)}, ctps pool {len(ctps_pool)}")
print("low confidence:", ", ".join(low) or "none")
