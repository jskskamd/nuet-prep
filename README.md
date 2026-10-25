# NUET.exe

A Telegram Mini App with study materials for the Nazarbayev University Entrance Test (NUET):
**Mathematics** and **Critical Thinking & Problem Solving**.

Live at https://jskskamd.github.io/nuet-prep/ and opened from the Telegram bot.

## Adding material

All material lives in [`content.js`](content.js). Add items to a section's `materials` list.
Items show up in the order you list them. Each item can have an optional `id`: give one if you might
reorder items later, so students' "done" progress stays attached to the right item.

### Lesson (text)

```js
{
  id: "math-fractions",
  type: "lesson",
  title: "Fractions and ratios",
  minutes: 10, // optional reading time
  body: [
    "First paragraph.",
    "Second paragraph.",
  ],
},
```

### Link (PDF, video or website)

```js
{
  id: "math-formula-sheet",
  type: "link",
  title: "Formula sheet",
  note: "PDF", // shown as "Resource · PDF" and on the button
  url: "https://example.com/formulas.pdf",
  description: "Optional short description.",
},
```

### Practice quiz

`answer` is the index of the correct option: 0 = A, 1 = B, 2 = C, 3 = D.

```js
{
  id: "ctps-practice-1",
  type: "quiz",
  title: "Logic practice 1",
  questions: [
    {
      q: "If all A are B, and all B are C, which must be true?",
      options: ["All C are A", "All A are C", "No A are C", "Some C are not B"],
      answer: 1,
      explain: "A is inside B, and B is inside C, so A is inside C.",
    },
  ],
},
```

## Timed tests from past papers

The Math section's timed tests come from the NSAA past papers in `../materials/math`
(Section 1, **Part A Mathematics only**, questions 1-18). Each question is cropped from the
PDF as an image into `tests/<paper>/`, and the answers come from the paper's answer key.
The generated list is `tests.js`; don't edit it by hand.

To rebuild after changing papers (needs Python with `pymupdf` and `pillow`):

```
python tools/build_tests.py ../materials/math .
```

To add another paper, add a line to `PAPERS` in `tools/build_tests.py`.
The same script also builds the 12 NUFYPET Math practice tests (`math_1.pdf`..`math_12.pdf`, answer key on each last page).

The CTPS section's tests come from `../materials/crit` and are built the same way into
`ctps-tests.js` (don't edit it by hand):

```
python tools/build_ctps.py ../materials/crit .
```

- Thinking skills 1-7: NUFYPET preparation guides (tasks plus the answer key at the end)
- ECAA Specimen, 2016-2019: Section 1 **Part A Problem Solving** only (Part B is advanced maths, not on the NUET)
- Cambridge Thinking Skills 9694 Paper 1, May/June 2016, variants 11-13 (the other papers need written answers)
- Oxford TSA Section 1, 2008-2020 (50 questions each, 90 minutes)

`tools/extract_questions.py` does the cropping for these; it joins questions that run onto
the next page and can remove pale watermarks.

## Publishing changes

After editing, bump the `?v=` number on the `<link>` and `<script>` tags in `index.html`
(for example `?v=1` to `?v=2`), then commit and push. GitHub Pages updates in about a minute.
