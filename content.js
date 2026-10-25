// Study material for NUET.exe. To publish something, add it to a section's `materials` list.
// See README.md for examples of each type: "lesson", "link" and "quiz".
const SECTIONS = [
  {
    id: "math",
    title: "Mathematics",
    short: "Math",
    icon: "i-math",
    description: "Lessons and practice problems for the Mathematics section.",
    // Timed tests built from the NSAA past papers (tests.js), then anything added by hand below.
    materials: [
      ...MATH_TESTS,
    ],
  },
  {
    id: "ctps",
    title: "Critical Thinking & Problem Solving",
    short: "CTPS",
    icon: "i-bulb",
    description: "Lessons and practice for the Critical Thinking and Problem Solving section.",
    // Thinking-skills practice and timed past papers (ctps-tests.js), then anything added by hand below.
    materials: [
      ...CTPS_TESTS,
    ],
  },
];
