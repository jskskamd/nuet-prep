# NUET Prep

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

## Publishing changes

After editing, bump the `?v=` number on the `<link>` and `<script>` tags in `index.html`
(for example `?v=1` to `?v=2`), then commit and push. GitHub Pages updates in about a minute.
