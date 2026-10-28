const tg = window.Telegram ? window.Telegram.WebApp : null;
const PAGE_BG = "#05070d";
const BAR_BG = "#0a1020";

if (tg) {
  tg.ready();
  tg.expand();
  try {
    if (tg.isVersionAtLeast("6.1")) {
      tg.setHeaderColor(PAGE_BG);
      tg.setBackgroundColor(PAGE_BG);
    }
    if (tg.isVersionAtLeast("7.10")) tg.setBottomBarColor(BAR_BG);
  } catch (e) {}
}

const STORE_KEY = "nuetprep:v2";
const OLD_STORE_KEY = "nuetprep:v1"; // progress only, from before sign-up existed
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// From NU's admissions page (cps.nu.edu.kz/admissions): a state grant needs
// at least 50 in each section and 120 in total.
const SECTION_MIN = 50;
const GRANT_TOTAL = 120;
const SCORE_INPUT_MAX = 200; // sanity limit for typed-in scores; NU doesn't publish a maximum
// Same page: 60 questions in 120 minutes, so the exam pace is 2 minutes per question.
const NUET_QUESTIONS = 60;
const NUET_MINUTES = 120;
const QUESTION_TIME_CAP = 600; // seconds; longer gaps are breaks, not thinking time
const TYPE_INFO = {
  lesson: { label: "Lesson", icon: "i-book" },
  link: { label: "Resource", icon: "i-link" },
  quiz: { label: "Practice", icon: "i-quiz" },
  test: { label: "Timed test", icon: "i-clock" },
};
const letter = (i) => String.fromCharCode(65 + i); // 0 -> "A"

// Sign-up questions, in order. `label` is how the answer shows on the Profile tab.
const STEPS = [
  { id: "name", type: "text", label: "Name", title: "What's your name?",
    hint: "So we know what to call you.", placeholder: "Your full name" },
  { id: "email", type: "email", label: "Email", title: "What's your email?",
    hint: "You'll use it to log in to your account.", placeholder: "you@example.com" },
  // Only asked when creating an account; never stored in the profile.
  { id: "password", type: "password", label: "Password", title: "Create a password",
    hint: "At least 8 characters. Use it with your email to log in on another device.", placeholder: "Password",
    signupOnly: true },
  { id: "grade", type: "choice", label: "Grade", title: "Which grade are you in?",
    options: [["10", "Grade 10"], ["11", "Grade 11"], ["12", "Grade 12"], ["graduated", "Already graduated"]] },
  { id: "mock", type: "choice", label: "Mock tests", title: "Have you ever done an NUET mock test?",
    options: [["several", "Yes, several times"], ["once", "Yes, once"], ["never", "No, not yet"]] },
  { id: "city", type: "choice", label: "City", title: "Which city are you from?",
    options: ["Astana", "Almaty", "Shymkent", "Aktau", "Aktobe", "Atyrau", "Karaganda", "Kokshetau", "Konaev",
      "Kostanay", "Kyzylorda", "Oral", "Oskemen", "Pavlodar", "Petropavl", "Semey", "Taldykorgan", "Taraz",
      "Turkistan", "Zhezkazgan"].map((c) => [c, c]).concat([["other", "Another city"]]) },
  { id: "focus", type: "choice", label: "Focus", title: "Which section do you want to focus on?",
    options: [["math", "Mathematics"], ["ctps", "Critical Thinking & Problem Solving"], ["both", "Both equally"]] },
];

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (id, cls = "icon") => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const tgUser = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;

// ---------- State (saved in this device's browser storage) ----------

// mocks: mock test results the student typed in; attempts: finished in-app practice quizzes;
// targets: { math, ctps } goal scores; mistakes: the mistake notebook.
function freshState() {
  return { profile: null, done: [], mocks: [], attempts: [], targets: null, mistakes: [] };
}

function todayISO() {
  const now = new Date(); // local date, not UTC
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, "0")).join("-");
}

// 84 -> "1:24"
function formatSeconds(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
    const oldDone = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || "[]");
    return { ...freshState(), done: oldDone };
  } catch (e) {
    return freshState();
  }
}

let state = loadState();
let done = new Set(state.done);

function save() {
  state.done = [...done];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

function haptic(kind) {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (kind === "success" || kind === "error") tg.HapticFeedback.notificationOccurred(kind);
    else if (kind === "select") tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.impactOccurred(kind);
  } catch (e) {}
}

function setTelegramBack(visible) {
  if (!tg || !tg.BackButton) return;
  try { visible ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
}

function findSection(id) {
  return SECTIONS.find((s) => s.id === id);
}

// An item's own `id` wins, so progress survives reordering the list.
function materialKey(section, index) {
  return section.materials[index].id || `${section.id}-${index}`;
}

function sectionProgress(section) {
  const total = section.materials.length;
  const finished = section.materials.filter((_, i) => done.has(materialKey(section, i))).length;
  return { total, finished, pct: total ? Math.round((finished / total) * 100) : 0 };
}

function materialMeta(m) {
  const type = TYPE_INFO[m.type] || TYPE_INFO.lesson;
  if (m.type === "quiz") return `${type.label} · ${(m.questions || []).length} questions`;
  if (m.type === "test") return `${type.label} · ${m.questions.length} questions · ${m.minutes} min`;
  if (m.type === "link") return m.note ? `${type.label} · ${m.note}` : type.label;
  return m.minutes ? `${type.label} · ${m.minutes} min` : type.label;
}

function answerLabel(stepId, value) {
  const step = STEPS.find((s) => s.id === stepId);
  const option = step.options && step.options.find(([v]) => v === value);
  return option ? option[1] : value || "Not set";
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
}

// A round avatar: the photo on top of the initials. `photo` is this device's own picture;
// otherwise `userId` loads the account's uploaded one, and when there is none the image
// fails to load, removes itself and the initials show.
function avatarHTML(name, { photo = "", userId = "", cls = "" } = {}) {
  const src = photo || (userId && accountsReady ? photoURL(userId) : "");
  return `<span class="avatar ${cls}">${esc(initials(name))}${src
    ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ""}</span>`;
}

// ---------- Navigation ----------

let route = { view: "home" };
let stack = [];

function go(next) {
  stack.push(route);
  route = next;
  render();
}

function back() {
  route = stack.pop() || { view: "home" };
  render();
}

// Materials need an account: a guest opening Math or CTPS gets the sign-up questions first,
// then lands where they were going.
let afterSignup = null;

function startSignup(next) {
  afterSignup = next || null;
  showOnboarding();
}

function needsSignup(next) {
  if (state.profile) return false;
  startSignup(next);
  return true;
}

function openTab(name) {
  const isSection = !["home", "profile", "forum"].includes(name);
  if (isSection && needsSignup({ view: "section", sectionId: name })) return;
  stack = [];
  route = isSection ? { view: "section", sectionId: name } : { view: name };
  if (name === "forum") {
    forum.tag = null;
    forum.stale = true;
  }
  haptic("select");
  render();
}

function render() {
  const view = $("#view");
  if (route.view === "section") view.innerHTML = sectionHTML(findSection(route.sectionId));
  else if (route.view === "material") view.innerHTML = materialHTML(findSection(route.sectionId), route.index);
  else if (route.view === "profile") view.innerHTML = profileHTML();
  else if (route.view === "notebook") view.innerHTML = notebookHTML();
  else if (route.view === "forum") view.innerHTML = forumHTML();
  else if (route.view === "thread") view.innerHTML = threadHTML();
  else view.innerHTML = homeHTML();

  const activeTab = route.view === "notebook" ? "home"
    : route.view === "thread" ? "forum"
    : ["home", "profile", "forum"].includes(route.view) ? route.view : route.sectionId;
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === activeTab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  renderProfileButton();

  $("#btn-back").hidden = stack.length === 0;
  setTelegramBack(stack.length > 0);
  window.scrollTo(0, 0);
  drawMockChart();
}

// The round photo in the top bar that opens the profile (before sign-up, a person icon).
function renderProfileButton() {
  const btn = $("#btn-profile");
  btn.innerHTML = state.profile ? avatarHTML(state.profile.name, { ...myPhoto(), cls: "xs" })
    : `<span class="avatar xs">${icon("i-user")}</span>`;
  if (route.view === "profile") btn.setAttribute("aria-current", "page");
  else btn.removeAttribute("aria-current");
}

// ---------- Views ----------

function signupCardHTML(text) {
  return `
    <section class="home-panel signup-card">
      <h2>Start practicing for free</h2>
      <p class="hint">${esc(text)}</p>
      <button class="primary" data-start-signup>Sign up</button>
      ${accountsReady ? `<button class="ghost" data-open-login>I already have an account</button>` : ""}
    </section>`;
}

function homeHTML() {
  const p = state.profile || {};
  const firstName = state.profile ? p.name.trim().split(/\s+/)[0] : "";
  const cards = SECTIONS.map((s) => {
    const prog = sectionProgress(s);
    const status = prog.total
      ? `<div class="meter"><div class="meter-fill" style="width:${prog.pct}%"></div></div>
         <span class="hint small">${prog.finished} of ${prog.total} done</span>`
      : `<span class="badge">Coming soon</span>`;
    const focus = p.focus === s.id ? `<span class="badge focus">Your focus</span>` : "";
    return `
      <button class="section-card${p.focus === s.id ? " focused" : ""}" data-open-section="${s.id}">
        <span class="section-icon">${icon(s.icon)}</span>
        <span class="section-text">
          ${focus}
          <strong>${esc(s.title)}</strong>
          <span class="hint">${esc(s.description)}</span>
          ${status}
        </span>
        ${icon("i-next", "icon chevron")}
      </button>`;
  }).join("");

  return `
    <section class="hero">
      <p class="eyebrow">${firstName ? `Hi, ${esc(firstName)}` : "Nazarbayev University Entrance Test"}</p>
      <h1>Get ready for the NUET</h1>
      <p class="hint">Study materials and practice for both test sections, all in Telegram.</p>
    </section>
    ${state.profile
      ? targetsHTML() + notebookCardHTML()
      : signupCardHTML("Sign up to open the Math and CTPS materials, take timed tests and track your scores.")}
    <h2 class="list-title">Sections</h2>
    <div class="section-list">${cards}</div>
    <p class="note">New materials are added regularly. Check back soon.</p>
    <p class="credit">Made by <button class="link-btn channel-link" data-channel>${icon("i-telegram", "icon tg-icon")}@chalkaandetc</button></p>`;
}

// ---------- Home cards: targets, mistake notebook ----------

function latestMock() {
  const mocks = sortedMocks();
  return mocks.length ? mocks[mocks.length - 1] : null;
}

function targetsHTML() {
  const t = state.targets;
  if (!t) {
    return `
      <button class="home-card" data-sheet="targets">
        <span class="section-icon">${icon("i-target")}</span>
        <span class="section-text">
          <strong>Set your target scores</strong>
          <span class="hint">Choose the Math and CTPS scores you're aiming for.</span>
        </span>
        ${icon("i-next", "icon chevron")}
      </button>`;
  }
  const latest = latestMock();
  const row = (name, target, score) => {
    const pct = score === null ? 0 : Math.min(100, Math.round((score / target) * 100));
    const note = score === null ? "Log a mock test to compare"
      : score >= target ? `Reached with ${score}` : `Latest ${score} · ${target - score} to go`;
    return `
      <div class="target-row">
        <div class="target-head"><span>${name}</span><b>${target}</b></div>
        <div class="meter"><div class="meter-fill" style="width:${pct}%"></div></div>
        <span class="hint small">${esc(note)}</span>
      </div>`;
  };
  const targetTotal = t.math + t.ctps;
  const grant = targetTotal >= GRANT_TOTAL && t.math >= SECTION_MIN && t.ctps >= SECTION_MIN
    ? statusRow(true, `Total target ${targetTotal} meets the grant thresholds`)
    : statusRow(false, `Aim for at least ${SECTION_MIN} per section and ${GRANT_TOTAL} in total for a state grant`);
  return `
    <section class="home-panel">
      <div class="panel-head">
        <h2 class="list-title">${icon("i-target", "icon tiny")} Target scores</h2>
        <button class="link-btn" data-sheet="targets">Edit</button>
      </div>
      ${row("Math", t.math, latest ? latest.math : null)}
      ${row("CTPS", t.ctps, latest ? latest.ctps : null)}
      ${grant}
    </section>`;
}

function notebookCardHTML() {
  const open = state.mistakes.filter((m) => !m.mastered).length;
  const text = open ? `${open} ${open === 1 ? "mistake" : "mistakes"} to review`
    : state.mistakes.length ? "Everything mastered. Nice work!"
    : "Write down your mistakes and learn from them.";
  return `
    <button class="home-card" data-open-notebook>
      <span class="section-icon">${icon("i-notebook")}</span>
      <span class="section-text">
        <strong>Mistake notebook</strong>
        <span class="hint">${esc(text)}</span>
      </span>
      ${open ? `<span class="count">${open}</span>` : ""}
      ${icon("i-next", "icon chevron")}
    </button>`;
}

// ---------- Mistake notebook ----------

const NOTEBOOK_FILTERS = [["open", "To review"], ["math", "Math"], ["ctps", "CTPS"], ["mastered", "Mastered"]];
let notebookFilter = "open";

function notebookHTML() {
  const list = state.mistakes.filter((m) =>
    notebookFilter === "mastered" ? m.mastered
      : !m.mastered && (notebookFilter === "open" || m.section === notebookFilter));

  const chips = NOTEBOOK_FILTERS.map(([id, label]) =>
    `<button class="filter${notebookFilter === id ? " on" : ""}" data-filter="${id}">${label}</button>`).join("");

  const items = list.map((m) => {
    const section = findSection(m.section);
    return `
      <article class="mistake${m.mastered ? " mastered" : ""}">
        <div class="mistake-top">
          <span class="tag">${esc(section ? section.short : m.section)}</span>
          <span class="hint small">${esc(m.source || "My note")} · ${esc(shortDate(m.date))}</span>
        </div>
        <p class="mistake-q">${esc(m.question)}</p>
        ${m.image ? `<figure class="q-figure" data-zoom><img class="q-img" src="${esc(m.image)}" alt="${esc(m.question)}" loading="lazy"></figure>` : ""}
        ${m.yourAnswer ? `<p class="answer-line"><span class="hint">Your answer</span> ${esc(m.yourAnswer)}</p>` : ""}
        ${m.correctAnswer ? `<p class="answer-line"><span class="hint">Correct</span> ${esc(m.correctAnswer)}</p>` : ""}
        ${m.note ? `<p class="mistake-note">${esc(m.note)}</p>` : ""}
        <div class="mistake-actions">
          <button class="secondary small-btn" data-master="${m.id}">
            ${m.mastered ? "Review again" : `${icon("i-check")} Mastered`}
          </button>
          <button class="row-delete" data-delete-mistake="${m.id}" aria-label="Delete">${icon("i-x")}</button>
        </div>
      </article>`;
  }).join("");

  const emptyText = notebookFilter === "mastered"
    ? "Mistakes you've mastered will move here."
    : "Nothing to review here. Wrong answers in practice quizzes are added automatically, and you can add your own from mock tests.";

  return `
    <section class="section-head">
      <span class="section-icon big">${icon("i-notebook")}</span>
      <h1>Mistake notebook</h1>
      <p class="hint">Write down each mistake and what you learned. Review them until they stick.</p>
    </section>
    <button class="primary" data-sheet="mistake">${icon("i-plus")} Add a mistake</button>
    <div class="filters">${chips}</div>
    ${list.length ? `<div class="mistake-list">${items}</div>` : `<div class="empty"><p class="hint">${emptyText}</p></div>`}`;
}

function sectionHTML(s) {
  const p = sectionProgress(s);
  const items = s.materials.map((m, i) => {
    const type = TYPE_INFO[m.type] || TYPE_INFO.lesson;
    const finished = done.has(materialKey(s, i));
    return `
      <li>
        <button class="material-row${finished ? " done" : ""}" data-open-material="${i}">
          <span class="material-icon">${icon(finished ? "i-check" : type.icon)}</span>
          <span class="material-text">
            <strong>${esc(m.title)}</strong>
            <span class="hint small">${esc(materialMeta(m))}</span>
          </span>
          ${icon("i-next", "icon chevron")}
        </button>
      </li>`;
  }).join("");

  const body = s.materials.length
    ? `<ul class="material-list">${items}</ul>`
    : `<div class="empty">
         <span class="empty-icon">${icon("i-clock")}</span>
         <h3>Materials coming soon</h3>
         <p class="hint">We're preparing lessons and practice for this section. Check back soon.</p>
       </div>`;

  return `
    <section class="section-head">
      <span class="section-icon big">${icon(s.icon)}</span>
      <h1>${esc(s.title)}</h1>
      <p class="hint">${esc(s.description)}</p>
      ${p.total ? `<div class="progress-line">
          <div class="meter"><div class="meter-fill" style="width:${p.pct}%"></div></div>
          <span class="hint small">${p.finished}/${p.total}</span>
        </div>` : ""}
    </section>
    ${body}`;
}

function materialHTML(s, index) {
  const m = s.materials[index];
  if (m.type === "test") return testHTML(s, index, m);
  const finished = done.has(materialKey(s, index));
  const head = `
    <p class="eyebrow">${esc(s.short)} · ${esc(materialMeta(m))}</p>
    <h1 class="material-title">${esc(m.title)}</h1>`;

  if (m.type === "quiz") return head + quizHTML(m);

  if (m.type === "link") {
    return `${head}
      ${m.description ? `<p class="lesson-text">${esc(m.description)}</p>` : ""}
      <button class="primary" data-open-link="${esc(m.url)}">${icon("i-link")} Open ${esc(m.note || "resource")}</button>
      ${doneButton(finished)}`;
  }

  const paragraphs = Array.isArray(m.body) ? m.body : [m.body || ""];
  return `${head}
    <article class="lesson">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</article>
    ${doneButton(finished)}`;
}

// ---------- Timed tests ----------
// A run lives in memory while the app is open, so leaving a test and coming back resumes it
// with the clock still running. Finished runs are saved to state.attempts.

const testRuns = {}; // material key -> { key, sectionId, index, deadline, answers, current, finished, ... }
let testTicker = null;

function remainingSeconds(run) {
  return Math.max(0, Math.round((run.deadline - Date.now()) / 1000));
}

function timestampDate(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function startTest(s, index) {
  const m = s.materials[index];
  const key = materialKey(s, index);
  const now = Date.now();
  testRuns[key] = {
    key, sectionId: s.id, index,
    startedAt: now, deadline: now + m.minutes * 60000,
    answers: {}, current: 0, finished: false, review: null,
  };
  if (!testTicker) testTicker = setInterval(tickTests, 1000);
}

function tickTests() {
  const active = Object.values(testRuns).filter((r) => !r.finished);
  if (!active.length) {
    clearInterval(testTicker);
    testTicker = null;
    return;
  }
  active.forEach((run) => { if (remainingSeconds(run) === 0) finishTest(run, true); });
  const timer = $("#test-timer");
  const shown = currentTestRun();
  if (timer && shown && !shown.finished) {
    const left = remainingSeconds(shown);
    timer.textContent = formatSeconds(left);
    timer.classList.toggle("low", left <= 300);
  }
}

function currentTestRun() {
  if (route.view !== "material") return null;
  return testRuns[materialKey(findSection(route.sectionId), route.index)] || null;
}

function finishTest(run, timeUp) {
  const s = findSection(run.sectionId);
  const m = s.materials[run.index];
  const answered = Object.keys(run.answers).length;
  run.finished = true;
  run.timeUp = timeUp;
  run.seconds = Math.min(Math.round((Date.now() - run.startedAt) / 1000), m.minutes * 60);
  run.correct = m.questions.filter((q, i) => run.answers[i] === q.answer).length;
  state.attempts.push({
    key: run.key, section: s.id, kind: "test",
    correct: run.correct, total: m.questions.length, answered, seconds: run.seconds, at: Date.now(),
  });
  m.questions.forEach((q, i) => {
    if (run.answers[i] !== undefined && run.answers[i] !== q.answer) addTestMistake(s, m, run, i);
  });
  done.add(run.key);
  save();
  haptic(timeUp ? "error" : "success");
  if (currentTestRun() === run) render();
}

function addTestMistake(s, m, run, i) {
  const q = m.questions[i];
  const ref = `${run.key}:${i}`;
  const entry = {
    section: s.id,
    source: m.title,
    question: `Question ${i + 1}`,
    image: q.image,
    yourAnswer: letter(run.answers[i]),
    correctAnswer: letter(q.answer),
    note: "",
    date: todayISO(),
    mastered: false,
    quizRef: ref,
  };
  const existing = state.mistakes.find((x) => x.quizRef === ref);
  if (existing) Object.assign(existing, entry);
  else state.mistakes.unshift({ id: Date.now() + i, ...entry });
}

function testHTML(s, index, m) {
  const run = testRuns[materialKey(s, index)];
  if (!run) return testIntroHTML(s, index, m);
  if (run.finished) return testResultHTML(s, m, run);
  return testQuestionHTML(m, run);
}

function testIntroHTML(s, index, m) {
  const past = state.attempts.filter((a) => a.key === materialKey(s, index));
  const best = past.length ? Math.max(...past.map((a) => a.correct)) : null;
  const last = past[past.length - 1];
  return `
    <p class="eyebrow">${esc(s.short)} · Timed test</p>
    <h1 class="material-title">${esc(m.title)}</h1>
    <div class="tiles">
      <div class="tile"><span class="hint">Questions</span><b>${m.questions.length}</b></div>
      <div class="tile"><span class="hint">Time</span><b>${m.minutes} min</b></div>
      <div class="tile"><span class="hint">Best score</span><b>${best === null ? "–" : `${best}/${m.questions.length}`}</b></div>
    </div>
    <ul class="rules">
      <li>One question at a time. You can skip questions and come back to them.</li>
      <li>The test is submitted automatically when the time runs out.</li>
      <li>Wrong answers are added to your mistake notebook.</li>
    </ul>
    ${last ? `<p class="hint small">Last attempt: ${last.correct}/${last.total} on ${esc(timestampDate(last.at))}</p>` : ""}
    <button class="primary" data-start-test>Start test</button>
    <p class="hint small source">Source: ${esc(m.source)}</p>`;
}

function questionFigure(q, alt) {
  return `<figure class="q-figure" data-zoom><img class="q-img" src="${esc(q.image)}" alt="${esc(alt)}"></figure>`;
}

function testQuestionHTML(m, run) {
  const qi = run.current;
  const q = m.questions[qi];
  const chosen = run.answers[qi];
  const answered = Object.keys(run.answers).length;
  const left = remainingSeconds(run);
  const next = m.questions[qi + 1];
  if (next) new Image().src = next.image; // preload

  const answers = Array.from({ length: q.options }, (_, i) =>
    `<button class="answer${chosen === i ? " on" : ""}" data-answer="${i}">${letter(i)}</button>`).join("");
  const map = m.questions.map((_, i) =>
    `<button class="map-cell${i === qi ? " current" : ""}${run.answers[i] !== undefined ? " answered" : ""}" data-goto="${i}">${i + 1}</button>`
  ).join("");
  const unanswered = m.questions.length - answered;

  return `
    <div class="test-bar">
      <span>Question <b>${qi + 1}</b> of ${m.questions.length}</span>
      <span class="test-timer${left <= 300 ? " low" : ""}" id="test-timer">${formatSeconds(left)}</span>
    </div>
    ${questionFigure(q, `Question ${qi + 1}`)}
    <p class="hint small center">Tap the question to zoom in</p>
    <div class="answer-grid">${answers}</div>
    <div class="test-nav">
      <button class="secondary" data-test-step="-1" ${qi === 0 ? "disabled" : ""}>${icon("i-back")} Previous</button>
      <button class="secondary" data-test-step="1" ${qi === m.questions.length - 1 ? "disabled" : ""}>Next ${icon("i-next")}</button>
    </div>
    <h2 class="list-title">Questions · ${answered}/${m.questions.length} answered</h2>
    <div class="q-map">${map}</div>
    <button class="primary" data-finish-test data-unanswered="${unanswered}">Finish test</button>`;
}

function testResultHTML(s, m, run) {
  const total = m.questions.length;
  const answered = Object.keys(run.answers).length;
  const rows = m.questions.map((q, i) => {
    const a = run.answers[i];
    const status = a === undefined ? "skipped" : a === q.answer ? "right" : "wrong";
    const text = a === undefined ? `Not answered · correct ${letter(q.answer)}`
      : status === "right" ? `Your answer ${letter(a)}` : `Your answer ${letter(a)} · correct ${letter(q.answer)}`;
    const detail = run.review === i ? `
      <div class="review-detail">
        ${questionFigure(q, `Question ${i + 1}`)}
        <p class="status good">${icon("i-check")}<span>Correct answer: ${letter(q.answer)}</span></p>
        ${forumReady ? `<div class="discuss-row">
          <button class="secondary small-btn" data-discuss="${esc(m.id)}:${i + 1}">${icon("i-forum")} See discussion</button>
          <button class="secondary small-btn" data-ask-about="${esc(m.id)}:${i + 1}">Ask about it</button>
        </div>` : ""}
      </div>` : "";
    return `
      <button class="review-row ${status}" data-review="${i}">
        <span class="review-num">${i + 1}</span>
        <span class="review-text">${text}</span>
        ${icon(status === "right" ? "i-check" : status === "wrong" ? "i-x" : "i-alert")}
      </button>${detail}`;
  }).join("");

  return `
    <p class="eyebrow">${esc(s.short)} · Results</p>
    <h1 class="material-title">${esc(m.title)}</h1>
    ${run.timeUp ? `<p class="status warn">${icon("i-clock")}<span>Time ran out, so the test was submitted automatically.</span></p>` : ""}
    <div class="score">
      <strong>${run.correct} / ${total}</strong>
      <span class="hint">${Math.round((run.correct / total) * 100)}% correct</span>
    </div>
    <div class="tiles">
      <div class="tile"><span class="hint">Answered</span><b>${answered}/${total}</b></div>
      <div class="tile"><span class="hint">Time used</span><b>${formatSeconds(run.seconds)}</b></div>
      <div class="tile"><span class="hint">Per question</span><b>${answered ? formatSeconds(run.seconds / answered) : "–"}</b></div>
    </div>
    <h2 class="list-title">Review · tap a question to see it</h2>
    <div class="review-list">${rows}</div>
    <button class="primary" data-retake-test>Retake test</button>
    <button class="secondary" data-close-test>Done</button>`;
}

// ---------- Zoom viewer ----------
// Pinch (two fingers) or mouse wheel to zoom, double-tap to toggle zoom at that spot,
// drag with one finger to move around a zoomed image.

const VIEWER_MAX = 5;
const view = { scale: 1, x: 0, y: 0, pointers: new Map(), pinch: null, pan: null, lastTap: 0 };

function viewerOpen() {
  return !$("#viewer").hidden;
}

function openViewer(src, alt) {
  const img = $("#viewer-img");
  img.src = src;
  img.alt = alt || "";
  Object.assign(view, { scale: 1, x: 0, y: 0, pinch: null, pan: null });
  view.pointers.clear();
  applyViewer();
  $("#viewer").hidden = false;
  setTelegramBack(true);
  // A downward drag would otherwise close the whole Mini App.
  try { if (tg && tg.isVersionAtLeast("7.7")) tg.disableVerticalSwipes(); } catch (e) {}
}

function closeViewer() {
  $("#viewer").hidden = true;
  try { if (tg && tg.isVersionAtLeast("7.7")) tg.enableVerticalSwipes(); } catch (e) {}
  setTelegramBack(!$("#onboarding").hidden ? stepIndex > 0 : stack.length > 0);
}

// Lets any part of a zoomed image be moved to the middle of the screen, but no further,
// so the image can't be dragged away entirely.
function clampViewer() {
  const img = $("#viewer-img");
  const maxX = (img.offsetWidth * view.scale) / 2;
  const maxY = (img.offsetHeight * view.scale) / 2;
  view.x = Math.max(-maxX, Math.min(maxX, view.x));
  view.y = Math.max(-maxY, Math.min(maxY, view.y));
}

function applyViewer() {
  if (view.scale <= 1.01) { view.scale = 1; view.x = 0; view.y = 0; }
  clampViewer();
  $("#viewer-img").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

// Zooms to `scale` while keeping the point (px, py) of the screen under the finger.
function zoomAt(scale, px, py) {
  const s = Math.max(1, Math.min(VIEWER_MAX, scale));
  const cx = window.innerWidth / 2 + view.x;
  const cy = window.innerHeight / 2 + view.y;
  view.x += (px - cx) * (1 - s / view.scale);
  view.y += (py - cy) * (1 - s / view.scale);
  view.scale = s;
  applyViewer();
}

const stage = $("#viewer-stage");
const pointerDistance = () => {
  const [a, b] = [...view.pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
const pointerMiddle = () => {
  const [a, b] = [...view.pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

stage.addEventListener("pointerdown", (e) => {
  stage.setPointerCapture(e.pointerId);
  view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (view.pointers.size === 2) {
    view.pinch = { dist: pointerDistance(), scale: view.scale };
    view.pan = null;
  } else if (view.pointers.size === 1) {
    view.pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
  }
});

stage.addEventListener("pointermove", (e) => {
  if (!view.pointers.has(e.pointerId)) return;
  view.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (view.pinch && view.pointers.size === 2) {
    const mid = pointerMiddle();
    zoomAt(view.pinch.scale * (pointerDistance() / view.pinch.dist), mid.x, mid.y);
  } else if (view.pan) {
    const dx = e.clientX - view.pan.x;
    const dy = e.clientY - view.pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) view.pan.moved = true;
    if (view.scale > 1) {
      view.x = view.pan.ox + dx;
      view.y = view.pan.oy + dy;
      applyViewer();
    }
  }
});

function endPointer(e) {
  if (!view.pointers.has(e.pointerId)) return;
  const tapped = view.pan && !view.pan.moved && view.pointers.size === 1 && !view.pinch;
  view.pointers.delete(e.pointerId);
  if (view.pointers.size < 2) view.pinch = null;
  if (view.pointers.size === 1) {
    const [p] = [...view.pointers.values()];
    view.pan = { x: p.x, y: p.y, ox: view.x, oy: view.y, moved: true };
  } else if (view.pointers.size === 0) {
    view.pan = null;
  }
  if (!tapped) return;

  const now = Date.now();
  if (now - view.lastTap < 300) {
    view.lastTap = 0;
    if (view.scale > 1) { view.scale = 1; applyViewer(); }
    else zoomAt(2.5, e.clientX, e.clientY);
  } else {
    view.lastTap = now;
  }
}
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomAt(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
}, { passive: false });

$("#viewer-close").addEventListener("click", closeViewer);

// Buttons for mouse users: zoom around the middle of the screen.
$("#viewer").addEventListener("click", (e) => {
  const b = e.target.closest("[data-zoom-step]");
  if (!b) return;
  const step = b.dataset.zoomStep;
  if (step === "reset") { view.scale = 1; applyViewer(); return; }
  zoomAt(view.scale * (step === "in" ? 1.5 : 1 / 1.5), window.innerWidth / 2, window.innerHeight / 2);
});

// Returns true when the click belonged to a timed test.
function handleTestClick(t) {
  if (route.view !== "material") return false;
  const s = findSection(route.sectionId);
  const m = s.materials[route.index];
  if (m.type !== "test") return false;
  const key = materialKey(s, route.index);
  const run = testRuns[key];
  const ds = t.dataset;

  if (ds.startTest !== undefined || ds.retakeTest !== undefined) {
    startTest(s, route.index);
    haptic("light");
    render();
    return true;
  }
  if (ds.closeTest !== undefined) {
    delete testRuns[key];
    render();
    return true;
  }
  if (!run) return false;

  if (ds.review !== undefined) {
    const i = Number(ds.review);
    run.review = run.review === i ? null : i;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return true;
  }
  if (run.finished) return false;

  const show = (i) => {
    run.current = Math.max(0, Math.min(m.questions.length - 1, i));
    render();
  };
  if (ds.answer !== undefined) {
    const from = run.current;
    run.answers[from] = Number(ds.answer);
    haptic("select");
    render();
    // Move on after a moment, unless the student already moved somewhere else.
    if (from < m.questions.length - 1) {
      setTimeout(() => { if (!run.finished && run.current === from && currentTestRun() === run) show(from + 1); }, 350);
    }
    return true;
  }
  if (ds.testStep !== undefined) { show(run.current + Number(ds.testStep)); return true; }
  if (ds.goto !== undefined) { show(Number(ds.goto)); return true; }

  // Finishing with unanswered questions needs a second tap within 3 seconds.
  if (ds.finishTest !== undefined) {
    const unanswered = Number(ds.unanswered);
    if (unanswered > 0 && !t.classList.contains("armed")) {
      t.classList.add("armed");
      t.textContent = `${unanswered} unanswered. Tap again to finish`;
      haptic("rigid");
      setTimeout(() => {
        if (!t.isConnected) return;
        t.classList.remove("armed");
        t.textContent = "Finish test";
      }, 3000);
      return true;
    }
    finishTest(run, false);
    return true;
  }
  return false;
}

function doneButton(finished) {
  return finished
    ? `<button class="secondary done-btn" data-toggle-done>${icon("i-check")} Done · tap to undo</button>`
    : `<button class="secondary" data-toggle-done>Mark as done</button>`;
}

function profileHTML() {
  if (!state.profile) {
    return `
      <section class="profile-hero">
        <span class="avatar">${icon("i-user")}</span>
        <h1>Your profile</h1>
        <p class="hint">Sign up to keep track of your scores, mock tests and mistakes.</p>
      </section>
      ${signupCardHTML("It takes a minute: a few questions about you and your NUET plans.")}`;
  }
  const p = state.profile;
  const math = sectionProgress(findSection("math"));
  const ctps = sectionProgress(findSection("ctps"));
  const rows = STEPS.filter((s) => s.type === "choice").map((s) => `
    <div class="info-row">
      <span class="hint">${esc(s.label)}</span>
      <strong>${esc(answerLabel(s.id, p[s.id]))}</strong>
    </div>`).join("");

  return `
    <section class="profile-hero">
      <label class="avatar-edit" aria-label="Change profile photo">
        ${avatarHTML(p.name, myPhoto())}
        <span class="avatar-badge">${icon("i-camera")}</span>
        <input type="file" accept="image/*" data-photo hidden>
      </label>
      ${p.photo ? `<button class="link-btn small" data-remove-photo>Remove photo</button>` : ""}
      ${photoError ? `<p class="form-error">${esc(photoError)}</p>` : ""}
      <h1>${esc(p.name)}</h1>
      <p class="hint">${esc(p.email)}</p>
      <button class="pill-btn" data-edit-profile>Edit profile</button>
    </section>

    <section class="stats">
      <div><b>${math.finished + ctps.finished}</b><span>Completed</span></div>
      <div><b>${math.finished}</b><span>Math</span></div>
      <div><b>${ctps.finished}</b><span>CTPS</span></div>
    </section>

    ${mockStatsHTML()}
    ${practiceStatsHTML()}
    ${timeStatsHTML()}

    <section class="panel">
      <h2 class="list-title">About you</h2>
      ${rows}
    </section>

    ${accountPanelHTML()}

    <p class="note">Your progress and scores are saved on this device.</p>
    <button class="ghost danger" data-delete-account>Delete my account</button>`;
}

function accountPanelHTML() {
  if (!accountsReady) return "";
  if (account.user) {
    return `
      <section class="panel account-panel">
        <h2 class="list-title">Account</h2>
        <div class="info-row"><span class="hint">Signed in as</span><strong>${esc(account.user.email)}</strong></div>
        <button class="secondary" data-log-out>Log out</button>
      </section>`;
  }
  return `
    <section class="panel account-panel">
      <h2 class="list-title">Account</h2>
      <p class="hint">Create an account to post in the forum and keep your profile when you switch devices.</p>
      <button class="primary" data-create-account>Create account</button>
      <button class="ghost" data-open-login>I already have an account</button>
    </section>`;
}

// ---------- Statistics ----------

const total = (r) => r.math + r.ctps;

function sortedMocks() {
  return [...state.mocks].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function statusRow(ok, text) {
  return `<div class="status ${ok ? "good" : "warn"}">${icon(ok ? "i-check" : "i-alert")}<span>${esc(text)}</span></div>`;
}

function mockStatsHTML() {
  const mocks = sortedMocks();
  if (!mocks.length) {
    return `
      <section class="panel stat-panel">
        <h2 class="list-title">Mock test scores</h2>
        <p class="hint">Log your NUET mock test scores to track your progress toward the grant threshold:
          at least ${SECTION_MIN} in each section and ${GRANT_TOTAL} in total.</p>
        <button class="primary" data-add-mock>${icon("i-plus")} Add mock test result</button>
      </section>`;
  }

  const latest = mocks[mocks.length - 1];
  const best = Math.max(...mocks.map(total));
  const gap = GRANT_TOTAL - total(latest);
  const sectionStatus = (name, score) => score >= SECTION_MIN
    ? statusRow(true, `${name}: ${score}, above the ${SECTION_MIN} minimum`)
    : statusRow(false, `${name}: ${score}, ${SECTION_MIN - score} below the ${SECTION_MIN} minimum`);

  const rows = [...mocks].reverse().map((r) => `
    <tr>
      <td><span>${esc(shortDate(r.date))}</span>${r.name ? `<small>${esc(r.name)}</small>` : ""}</td>
      <td class="num">${r.math}</td>
      <td class="num">${r.ctps}</td>
      <td class="num"><b>${total(r)}</b></td>
      <td><button class="row-delete" data-delete-mock="${r.id}" aria-label="Delete result">${icon("i-x")}</button></td>
    </tr>`).join("");

  return `
    <section class="panel stat-panel">
      <h2 class="list-title">Mock test scores</h2>
      <div class="tiles">
        <div class="tile"><span class="hint">Latest total</span><b>${total(latest)}</b></div>
        <div class="tile"><span class="hint">Best total</span><b>${best}</b></div>
        <div class="tile"><span class="hint">Tests logged</span><b>${mocks.length}</b></div>
      </div>

      <div class="statuses">
        ${gap <= 0
          ? statusRow(true, `Latest total meets the ${GRANT_TOTAL}-point grant threshold`)
          : statusRow(false, `Latest total is ${gap} points below the ${GRANT_TOTAL}-point grant threshold`)}
        ${sectionStatus("Math", latest.math)}
        ${sectionStatus("CTPS", latest.ctps)}
      </div>

      <h3 class="chart-title">Total score over time</h3>
      <p class="hint small chart-sub">The line marks the ${GRANT_TOTAL}-point grant threshold.</p>
      <div class="chart" id="mock-chart"></div>

      <div class="table-wrap">
        <table class="results">
          <thead><tr><th>Date</th><th class="num">Math</th><th class="num">CTPS</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="secondary" data-add-mock>${icon("i-plus")} Add result</button>
    </section>`;
}

function practiceStatsHTML() {
  const attempts = state.attempts;
  const pct = (a) => Math.round((a.correct / a.total) * 100);
  if (!attempts.length) {
    return `
      <section class="panel stat-panel">
        <h2 class="list-title">Practice tests</h2>
        <p class="hint">Finish a test or quiz in Math or CTPS and your scores will show up here.</p>
      </section>`;
  }
  const avg = (list) => Math.round(list.reduce((s, a) => s + pct(a), 0) / list.length);
  const perSection = SECTIONS.map((s) => {
    const list = attempts.filter((a) => a.section === s.id);
    return `
      <div class="info-row">
        <span class="hint">${esc(s.short)}</span>
        <strong>${list.length ? `${avg(list)}% average · ${list.length} done` : "Nothing yet"}</strong>
      </div>`;
  }).join("");

  return `
    <section class="panel stat-panel">
      <h2 class="list-title">Practice tests</h2>
      <div class="tiles">
        <div class="tile"><span class="hint">Finished</span><b>${attempts.length}</b></div>
        <div class="tile"><span class="hint">Average score</span><b>${avg(attempts)}%</b></div>
        <div class="tile"><span class="hint">Best score</span><b>${Math.max(...attempts.map(pct))}%</b></div>
      </div>
      ${perSection}
    </section>`;
}

function timeStatsHTML() {
  const pace = (NUET_MINUTES * 60) / NUET_QUESTIONS;
  // Timed tests can be submitted with questions skipped, so divide by the questions answered.
  const answeredIn = (a) => (a.answered === undefined ? a.total : a.answered);
  const timed = state.attempts.filter((a) => a.seconds && answeredIn(a));
  const practice = timed.length
    ? timed.reduce((s, a) => s + a.seconds, 0) / timed.reduce((s, a) => s + answeredIn(a), 0) : null;
  // A full mock is 60 questions, so minutes used / 60 is the time per question.
  const mocksTimed = state.mocks.filter((r) => r.minutes);
  const mock = mocksTimed.length
    ? (mocksTimed.reduce((s, r) => s + r.minutes, 0) * 60) / (mocksTimed.length * NUET_QUESTIONS) : null;

  const verdict = (label, sec) => sec === null ? "" : sec <= pace
    ? statusRow(true, `${label}: ${formatSeconds(sec)} is within the NUET pace`)
    : statusRow(false, `${label}: ${formatSeconds(sec - pace)} slower than the NUET pace`);

  return `
    <section class="panel stat-panel">
      <h2 class="list-title">Time per question</h2>
      <div class="tiles">
        <div class="tile"><span class="hint">Practice</span><b>${practice === null ? "–" : formatSeconds(practice)}</b></div>
        <div class="tile"><span class="hint">Mock tests</span><b>${mock === null ? "–" : formatSeconds(mock)}</b></div>
        <div class="tile"><span class="hint">NUET pace</span><b>${formatSeconds(pace)}</b></div>
      </div>
      <div class="statuses">
        ${verdict("Practice", practice)}
        ${verdict("Mock tests", mock)}
      </div>
      <p class="hint small">The NUET has ${NUET_QUESTIONS} questions in ${NUET_MINUTES} minutes.
        Practice time is measured automatically; for mock tests, add the minutes you used when you log a result.</p>
    </section>`;
}

// Line chart of total mock score over time, with the grant threshold as a reference line.
function drawMockChart() {
  const el = $("#mock-chart");
  if (!el) return;
  const mocks = sortedMocks();
  const W = el.clientWidth || 320;
  const H = 190;
  const m = { l: 34, r: 20, t: 18, b: 26 };
  const totals = mocks.map(total);
  const step = 40;
  const yMax = Math.ceil((Math.max(...totals, GRANT_TOTAL) * 1.12) / step) * step;
  const x = (i) => mocks.length === 1 ? (m.l + W - m.r) / 2 : m.l + (i * (W - m.l - m.r)) / (mocks.length - 1);
  const y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);
  const base = y(0);

  let grid = "";
  for (let v = 0; v <= yMax; v += step) {
    grid += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>
             <text class="tick" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }

  const pts = totals.map((t, i) => [x(i), y(t)]);
  const linePath = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
  const area = pts.length > 1
    ? `<path class="area" d="${linePath} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z"/>` : "";
  const dots = pts.map(([px, py]) => `<circle class="dot" cx="${px}" cy="${py}" r="4"/>`).join("");
  const [lx, ly] = pts[pts.length - 1];
  const xLabels = (mocks.length > 1 ? [0, mocks.length - 1] : [0]).map((i) =>
    `<text class="tick" x="${x(i)}" y="${H - 6}" text-anchor="${mocks.length > 1 ? (i ? "end" : "start") : "middle"}">${esc(shortDate(mocks[i].date))}</text>`
  ).join("");

  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Total mock test score over time. The table below lists every result.">
      ${grid}
      <line class="threshold" x1="${m.l}" x2="${W - m.r}" y1="${y(GRANT_TOTAL)}" y2="${y(GRANT_TOTAL)}"/>
      <text class="threshold-label" x="${m.l + 4}" y="${y(GRANT_TOTAL) - 6}">Grant ${GRANT_TOTAL}</text>
      ${area}
      ${pts.length > 1 ? `<path class="line" d="${linePath}"/>` : ""}
      ${dots}
      <text class="end-label" x="${lx}" y="${ly - 12}" text-anchor="${mocks.length > 1 ? "end" : "middle"}">${totals[totals.length - 1]}</text>
      ${xLabels}
      <line class="crosshair" y1="${m.t}" y2="${base}" visibility="hidden"/>
      <circle class="dot focus" r="6" visibility="hidden"/>
      <rect class="hit" x="0" y="0" width="${W}" height="${H}"/>
    </svg>
    <div class="tooltip" hidden></div>`;

  const svg = el.querySelector("svg");
  const cross = el.querySelector(".crosshair");
  const focus = el.querySelector(".dot.focus");
  const tip = el.querySelector(".tooltip");

  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const px = e.clientX - box.left;
    let i = 0;
    pts.forEach(([ptx], j) => { if (Math.abs(ptx - px) < Math.abs(pts[i][0] - px)) i = j; });
    const r = mocks[i];
    cross.setAttribute("x1", pts[i][0]);
    cross.setAttribute("x2", pts[i][0]);
    cross.setAttribute("visibility", "visible");
    focus.setAttribute("cx", pts[i][0]);
    focus.setAttribute("cy", pts[i][1]);
    focus.setAttribute("visibility", "visible");

    // Built with textContent: test names are typed in by the student.
    tip.replaceChildren();
    const head = document.createElement("div");
    head.className = "tip-head";
    head.textContent = r.name ? `${shortDate(r.date)} · ${r.name}` : shortDate(r.date);
    const value = document.createElement("div");
    value.className = "tip-value";
    value.textContent = `${total(r)} total`;
    const detail = document.createElement("div");
    detail.className = "tip-detail";
    detail.textContent = `Math ${r.math} · CTPS ${r.ctps}`;
    tip.append(head, value, detail);
    tip.hidden = false;
    const left = Math.min(Math.max(pts[i][0] - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(pts[i][1] - tip.offsetHeight - 14, 0)}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    focus.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  const hit = el.querySelector(".hit");
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerdown", show);
  hit.addEventListener("pointerleave", hide);
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawMockChart, 150);
});

// ---------- Mock result form ----------

function openMockForm() {
  $("#mock-name").value = "";
  $("#mock-date").value = todayISO();
  $("#mock-math").value = "";
  $("#mock-ctps").value = "";
  $("#mock-minutes").value = "";
  $("#mock-error").textContent = "";
  updateMockTotal();
  $("#mock-modal").hidden = false;
}

function readScore(input) {
  const raw = input.value.trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= SCORE_INPUT_MAX ? n : NaN;
}

function updateMockTotal() {
  const math = readScore($("#mock-math"));
  const ctps = readScore($("#mock-ctps"));
  $("#mock-total").textContent = Number.isInteger(math) && Number.isInteger(ctps)
    ? `Total: ${math + ctps}` : "Total: –";
}

$("#mock-math").addEventListener("input", updateMockTotal);
$("#mock-ctps").addEventListener("input", updateMockTotal);
$("#mock-cancel").addEventListener("click", () => { $("#mock-modal").hidden = true; });

$("#mock-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const date = $("#mock-date").value;
  const math = readScore($("#mock-math"));
  const ctps = readScore($("#mock-ctps"));
  const error = (msg) => { $("#mock-error").textContent = msg; haptic("error"); };
  if (!date) return error("Please choose the date of the test.");
  if (math === null || ctps === null) return error("Please enter both section scores.");
  if (Number.isNaN(math) || Number.isNaN(ctps)) return error(`Scores must be whole numbers from 0 to ${SCORE_INPUT_MAX}.`);
  const minutesRaw = $("#mock-minutes").value.trim();
  const minutes = minutesRaw === "" ? null : Number(minutesRaw);
  if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 300)) {
    return error("Time used must be a whole number of minutes, from 1 to 300.");
  }

  state.mocks.push({ id: Date.now(), name: $("#mock-name").value.trim(), date, math, ctps, minutes });
  save();
  haptic("success");
  $("#mock-modal").hidden = true;
  render();
});

// ---------- Sheet forms: exam date, targets, notebook entries ----------

let sheetSubmit = null; // returns an error message, or "" when the form saved

function openSheet(title, fieldsHTML, onSubmit, submitLabel = "Save") {
  $("#sheet-form").innerHTML = `
    <h2>${esc(title)}</h2>
    ${fieldsHTML}
    <p class="form-error" id="sheet-error" role="alert"></p>
    <button class="primary" type="submit">${esc(submitLabel)}</button>
    <button class="ghost" type="button" data-close-sheet>Cancel</button>`;
  sheetSubmit = onSubmit;
  $("#sheet-modal").hidden = false;
}

function closeSheet() {
  $("#sheet-modal").hidden = true;
  sheetSubmit = null;
}

// onSubmit may also return a Promise (forum posts are saved over the network).
$("#sheet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  let err;
  try {
    err = sheetSubmit ? await sheetSubmit() : "";
  } catch (error) {
    err = "Something went wrong. Check your connection and try again.";
  }
  button.disabled = false;
  if (err) {
    $("#sheet-error").textContent = err;
    haptic("error");
    return;
  }
  save();
  haptic("success");
  closeSheet();
  // Logging in from the sign-up screens happens before there's a profile to show.
  if (!$("#app").hidden) render();
});

$("#sheet-form").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-sheet]")) closeSheet();
  else if (e.target.closest("[data-open-login]")) openLoginSheet();
  else if (e.target.closest("[data-open-signup]")) openSignupSheet();
});

// Tapping the dark area outside a form closes it.
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
});

function openTargetsSheet() {
  const t = state.targets || { math: "", ctps: "" };
  openSheet("Target scores", `
    <div class="field-row">
      <label class="field">Math target
        <input id="target-math" type="number" inputmode="numeric" min="0" max="${SCORE_INPUT_MAX}" value="${t.math}">
      </label>
      <label class="field">CTPS target
        <input id="target-ctps" type="number" inputmode="numeric" min="0" max="${SCORE_INPUT_MAX}" value="${t.ctps}">
      </label>
    </div>
    <p class="hint small">A state grant needs at least ${SECTION_MIN} in each section and ${GRANT_TOTAL} in total.</p>`,
  () => {
    const math = readScore($("#target-math"));
    const ctps = readScore($("#target-ctps"));
    if (math === null || ctps === null) return "Please enter both targets.";
    if (Number.isNaN(math) || Number.isNaN(ctps)) return `Targets must be whole numbers from 0 to ${SCORE_INPUT_MAX}.`;
    state.targets = { math, ctps };
    return "";
  });
}

function openMistakeSheet() {
  const preset = notebookFilter === "ctps" || (notebookFilter !== "math" && state.profile.focus === "ctps") ? "ctps" : "math";
  const options = SECTIONS.map((s) =>
    `<option value="${s.id}"${s.id === preset ? " selected" : ""}>${esc(s.title)}</option>`).join("");
  openSheet("Add a mistake", `
    <label class="field">Section
      <select id="mistake-section">${options}</select>
    </label>
    <label class="field">The question, or what went wrong
      <textarea id="mistake-question" rows="3" maxlength="600" placeholder="For example, mixed up the formula for the area of a trapezoid"></textarea>
    </label>
    <label class="field">What to remember <span class="hint">(optional)</span>
      <textarea id="mistake-note" rows="3" maxlength="600" placeholder="The right method, or a tip for next time"></textarea>
    </label>
    <label class="field">Where it came from <span class="hint">(optional)</span>
      <input id="mistake-source" maxlength="40" placeholder="For example, Mock test 2">
    </label>`,
  () => {
    const question = $("#mistake-question").value.trim();
    if (!question) return "Please describe the mistake.";
    state.mistakes.unshift({
      id: Date.now(),
      section: $("#mistake-section").value,
      question,
      note: $("#mistake-note").value.trim(),
      source: $("#mistake-source").value.trim(),
      date: todayISO(),
      mastered: false,
    });
    return "";
  });
}

// A wrong practice answer goes into the notebook; answering the same question wrong
// again reopens the existing entry instead of adding a duplicate.
function addQuizMistake(section, material, qi, chosen) {
  const q = material.questions[qi];
  const ref = `${materialKey(section, route.index)}:${qi}`;
  const entry = {
    section: section.id,
    source: material.title,
    question: q.q,
    yourAnswer: q.options[chosen],
    correctAnswer: q.options[q.answer],
    note: q.explain || "",
    date: todayISO(),
    mastered: false,
    quizRef: ref,
  };
  const existing = state.mistakes.find((m) => m.quizRef === ref);
  if (existing) Object.assign(existing, entry);
  else state.mistakes.unshift({ id: Date.now(), ...entry });
}

// ---------- Accounts ----------
// Students register with email and password (Supabase Auth). The profile answers are
// stored with the account, so logging in on another device brings them back.
// The session itself is kept by the Supabase library in this device's storage.

const accountsReady = typeof FORUM_CONFIG !== "undefined" && !!FORUM_CONFIG.url && !!FORUM_CONFIG.anonKey && !!window.supabase;
const PASSWORD_MIN = 8;
const account = { user: null };
let supabaseClient = null;

function supa() {
  if (!supabaseClient) supabaseClient = window.supabase.createClient(FORUM_CONFIG.url, FORUM_CONFIG.anonKey);
  return supabaseClient;
}

function myId() {
  return account.user ? account.user.id : null;
}

// What goes into the account: the profile minus the email, which the account already has,
// and the photo, which is uploaded to storage instead (account data travels with every request).
function cloudProfile(profile) {
  const { email, photo, ...rest } = profile;
  return rest;
}

// ---------- Profile photo ----------
// Kept in the profile on this device as a small JPEG, and with an account also uploaded to
// the public "avatars" bucket as <account id>.jpg so forum posts can show it
// (bucket and access rules: supabase/avatars.sql).

const PHOTO_SIZE = 256;
let photoError = "";

function photoURL(userId) {
  return `${FORUM_CONFIG.url}/storage/v1/object/public/avatars/${userId}.jpg`;
}

// avatarHTML options for this student. Once a photo was picked or removed on this device
// (photo is a picture or null), that wins over the uploaded copy, which the browser may
// still have cached; before that (a new device), the uploaded one is shown.
function myPhoto() {
  const p = state.profile;
  if (p && p.photo !== undefined) return { photo: p.photo || "" };
  return { userId: myId() };
}

// Crops the picked image to a centred square and shrinks it.
async function photoDataURL(file) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    img.src = url;
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PHOTO_SIZE;
  canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
    side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function uploadPhoto(dataURL) {
  if (!account.user || !dataURL) return;
  try {
    const blob = await (await fetch(dataURL)).blob();
    const { error } = await supa().storage.from("avatars")
      .upload(`${myId()}.jpg`, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" });
    if (error) console.error(error);
  } catch (e) {
    console.error(e);
  }
}

async function removeUploadedPhoto() {
  if (!account.user) return;
  try {
    const { error } = await supa().storage.from("avatars").remove([`${myId()}.jpg`]);
    if (error) console.error(error);
  } catch (e) {
    console.error(e);
  }
}

async function setPhoto(file) {
  try {
    state.profile.photo = await photoDataURL(file);
    photoError = "";
  } catch (e) {
    console.error(e);
    photoError = "Couldn't open that picture. Try another one.";
    haptic("error");
    rerenderInPlace();
    return;
  }
  save();
  haptic("success");
  rerenderInPlace();
  uploadPhoto(state.profile.photo);
}

if (accountsReady) {
  supa().auth.onAuthStateChange((_event, session) => {
    const before = myId();
    account.user = session ? session.user : null;
    if (myId() !== before && !$("#app").hidden) rerenderInPlace();
  });
}

function authError(error, fallback) {
  const msg = (error && error.message) || "";
  if (/already (registered|exists)/i.test(msg)) return "This email already has an account. Log in instead.";
  if (/invalid login credentials/i.test(msg)) return "Wrong email or password.";
  if (/email not confirmed/i.test(msg)) return "This account still needs its email confirmed.";
  if (/password/i.test(msg)) return `Please use a stronger password (at least ${PASSWORD_MIN} characters).`;
  if (/rate limit|too many/i.test(msg)) return "Too many attempts. Please wait a few minutes and try again.";
  return fallback;
}

// Returns an error message, or "" when the account was created and signed in.
async function createAccount(email, password, profile) {
  const { data, error } = await supa().auth.signUp({ email, password, options: { data: { profile: cloudProfile(profile) } } });
  if (error) return authError(error, "Couldn't create your account. Check your connection and try again.");
  if (!data.session) return "Your account was created but needs email confirmation before you can log in.";
  account.user = data.user;
  uploadPhoto(profile.photo);
  return "";
}

function syncProfile(profile) {
  if (!account.user) return;
  supa().auth.updateUser({ data: { profile: cloudProfile(profile) } }).catch((e) => console.error(e));
}

function accountFields(email) {
  return `
    <label class="field">Email
      <input id="acc-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(email || "")}">
    </label>
    <label class="field">Password
      <input id="acc-password" type="password" autocomplete="current-password" placeholder="At least ${PASSWORD_MIN} characters">
    </label>`;
}

function openLoginSheet() {
  openSheet("Log in", `
    ${accountFields(state.profile ? state.profile.email : "")}
    <p class="hint small">Don't have an account? ${state.profile
      ? `<button type="button" class="link-btn" data-open-signup>Create one</button>`
      : "Close this and answer the sign-up questions."}</p>`,
  async () => {
    const email = $("#acc-email").value.trim();
    const password = $("#acc-password").value;
    if (!EMAIL_RE.test(email) || !password) return "Enter your email and password.";
    const { data, error } = await supa().auth.signInWithPassword({ email, password });
    if (error) return authError(error, "Couldn't log in. Check your connection and try again.");
    account.user = data.user;
    const cloud = data.user.user_metadata && data.user.user_metadata.profile;
    const fromSignUp = !state.profile;
    if (cloud) state.profile = { ...cloud, email: data.user.email };
    if (fromSignUp && !cloud) {
      // An account without saved answers: finish the sign-up questions instead.
      setTimeout(() => { draft.email = data.user.email; stepIndex = 0; renderWizard(); });
      return "";
    }
    setTimeout(() => showApp(fromSignUp));
    return "";
  }, "Log in");
}

function openSignupSheet() {
  openSheet("Create your account", `
    <p class="hint">With an account you can post in the forum and log in on other devices.</p>
    ${accountFields(state.profile.email)}
    <p class="hint small">Already have an account? <button type="button" class="link-btn" data-open-login>Log in</button></p>`,
  async () => {
    const email = $("#acc-email").value.trim();
    const password = $("#acc-password").value;
    if (!EMAIL_RE.test(email)) return "That email doesn't look right.";
    if (password.length < PASSWORD_MIN) return `Your password needs at least ${PASSWORD_MIN} characters.`;
    const err = await createAccount(email, password, state.profile);
    if (err) return err;
    state.profile.email = email;
    return "";
  }, "Create account");
}

async function logOut() {
  try { await supa().auth.signOut(); } catch (e) { console.error(e); }
  account.user = null;
  rerenderInPlace();
}

// Deletes the online account (and, through the database, the student's forum posts).
async function deleteOnlineAccount() {
  if (!account.user) return;
  await removeUploadedPhoto();
  try {
    const { error } = await supa().rpc("delete_my_account");
    if (error) console.error(error);
    await supa().auth.signOut();
  } catch (e) {
    console.error(e);
  }
  account.user = null;
}

// ---------- Forum ----------
// Threads and answers live in Supabase (tables and access rules: supabase/forum.sql).
// Anyone can read; posting needs an account. Posts show the student's profile name.

const forumReady = accountsReady;
const FORUM_FILTERS = [["all", "All"], ["math", "Math"], ["ctps", "CTPS"], ["mine", "My questions"]];
const forum = {
  filter: "all", tag: null,
  threads: null, stale: true, loading: false, error: "",
  thread: null, answers: [], threadStale: true, threadLoading: false, threadError: "",
};

async function forumClient() {
  return supa();
}

// Posting needs an account; without one, offer to create it (or log in) first.
function requireAccount() {
  if (account.user) return true;
  if (state.profile) openSignupSheet();
  else startSignup({ ...route });
  return false;
}

// "Rip van Winkle" -> "Rip V."
function forumName() {
  const parts = (state.profile ? state.profile.name : "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Student";
  return (parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0]).slice(0, 40);
}

// Every timed test in every section, with the section it belongs to.
function allTests() {
  return SECTIONS.flatMap((s) => s.materials.filter((m) => m.type === "test").map((test) => ({ test, section: s.id })));
}

// Short but unique name for a test, e.g. "NSAA 2016" or "Cambridge Thinking Skills 2016 · Paper 11".
function testLabel(test) {
  return test.title.replace(/ · (Part A Mathematics|Problem Solving)$/, "");
}

// A tag points at one test question, e.g. "nsaa-2016:5" is question 5 of NSAA 2016.
function tagInfo(tag) {
  if (!tag) return null;
  const [testId, n] = tag.split(":");
  const found = allTests().find((x) => x.test.id === testId);
  const q = found && found.test.questions[Number(n) - 1];
  return q ? { label: `${testLabel(found.test)} · Q${n}`, image: q.image, num: Number(n), section: found.section } : null;
}

function relTime(iso) {
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} d ago`;
  return timestampDate(new Date(iso).getTime());
}

function rerenderInPlace() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

async function loadThreads() {
  forum.stale = false;
  forum.loading = true;
  forum.error = "";
  try {
    const client = await forumClient();
    let query = client.from("threads")
      .select("id, created_at, author_id, author_name, section, tag, title, answers(count)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (forum.tag) query = query.eq("tag", forum.tag);
    else if (forum.filter === "mine") query = query.eq("author_id", myId() || "00000000-0000-0000-0000-000000000000");
    else if (forum.filter !== "all") query = query.eq("section", forum.filter);
    const { data, error } = await query;
    if (error) throw error;
    forum.threads = data;
  } catch (e) {
    console.error(e);
    forum.error = "Couldn't load the forum. Check your connection and try again.";
  }
  forum.loading = false;
  if (route.view === "forum") rerenderInPlace();
}

async function loadThread() {
  forum.threadStale = false;
  forum.threadLoading = true;
  forum.threadError = "";
  const id = route.threadId;
  try {
    const client = await forumClient();
    const [t, a] = await Promise.all([
      client.from("threads").select("*").eq("id", id).maybeSingle(),
      client.from("answers").select("*").eq("thread_id", id).order("created_at"),
    ]);
    if (t.error || a.error) throw t.error || a.error;
    forum.thread = t.data;
    forum.answers = a.data;
  } catch (e) {
    console.error(e);
    forum.threadError = "Couldn't load this question. Check your connection and try again.";
  }
  forum.threadLoading = false;
  if (route.view === "thread" && route.threadId === id) rerenderInPlace();
}

function openThread(id) {
  forum.thread = null;
  forum.answers = [];
  forum.threadStale = true;
  go({ view: "thread", threadId: id });
}

function forumHTML() {
  const head = `
    <section class="section-head">
      <span class="section-icon big">${icon("i-forum")}</span>
      <h1>Forum</h1>
      <p class="hint">Stuck on a question? Ask here, and help others with theirs.</p>
    </section>`;
  if (!forumReady) {
    return `${head}
      <div class="empty">
        <span class="empty-icon">${icon("i-clock")}</span>
        <h3>The forum is coming soon</h3>
        <p class="hint">It opens as soon as its database is connected.</p>
      </div>`;
  }
  if (forum.stale && !forum.loading) setTimeout(loadThreads, 0);

  const info = tagInfo(forum.tag);
  const chips = forum.tag
    ? `<button class="filter on" data-forum-clear-tag>${esc(info ? info.label : forum.tag)} ${icon("i-x", "icon tiny")}</button>`
    : FORUM_FILTERS.map(([id, label]) =>
        `<button class="filter${forum.filter === id ? " on" : ""}" data-forum-filter="${id}">${label}</button>`).join("");

  let list;
  if (forum.error) {
    list = `<div class="empty"><p class="hint">${esc(forum.error)}</p><button class="secondary" data-forum-retry>Try again</button></div>`;
  } else if (!forum.threads || (forum.loading && !forum.threads.length)) {
    list = `<p class="hint center loading">Loading…</p>`;
  } else if (!forum.threads.length) {
    list = `<div class="empty"><p class="hint">${forum.tag ? "No one has asked about this question yet." : "No questions here yet. Be the first to ask!"}</p></div>`;
  } else {
    list = forum.threads.map((t) => {
      const count = t.answers && t.answers[0] ? t.answers[0].count : 0;
      const ti = tagInfo(t.tag);
      const section = findSection(t.section);
      return `
        <button class="thread-card" data-open-thread="${esc(t.id)}">
          <span class="thread-tags">
            <span class="tag">${esc(section ? section.short : t.section)}</span>
            ${ti ? `<span class="tag q">${esc(ti.label)}</span>` : ""}
          </span>
          <strong>${esc(t.title)}</strong>
          <span class="hint small">${esc(t.author_name)} · ${esc(relTime(t.created_at))} · ${count} ${count === 1 ? "answer" : "answers"}</span>
        </button>`;
    }).join("");
  }

  const tagFigure = info
    ? `<figure class="q-figure" data-zoom><img class="q-img" src="${esc(info.image)}" alt="${esc(info.label)}" loading="lazy"></figure>` : "";

  return `${head}
    <button class="primary" data-forum-ask="${esc(forum.tag || "")}">${icon("i-plus")} Ask a question</button>
    <div class="filters">${chips}</div>
    ${tagFigure}
    <div class="thread-list">${list}</div>`;
}

function threadHTML() {
  if (forum.threadStale && !forum.threadLoading) setTimeout(loadThread, 0);
  if (forum.threadError) {
    return `<div class="empty"><p class="hint">${esc(forum.threadError)}</p><button class="secondary" data-thread-retry>Try again</button></div>`;
  }
  const t = forum.thread;
  if (!t) {
    return forum.threadLoading || forum.threadStale
      ? `<p class="hint center loading">Loading…</p>`
      : `<div class="empty"><p class="hint">This question was deleted.</p></div>`;
  }
  const info = tagInfo(t.tag);
  const section = findSection(t.section);
  const mine = (authorId) => !!myId() && authorId === myId();
  // Your own posts show the photo on this device, so a new one appears straight away.
  const authorAvatar = (name, authorId) => avatarHTML(name,
    { ...(mine(authorId) ? myPhoto() : { userId: authorId }), cls: "sm" });

  const answers = forum.answers.map((a) => `
    <article class="answer-post${a.pending ? " pending" : ""}">
      <div class="post-meta">
        ${authorAvatar(a.author_name, a.author_id)}
        <span><strong>${esc(a.author_name)}</strong><span class="hint small"> · ${a.pending ? "Posting…" : esc(relTime(a.created_at))}</span></span>
        ${mine(a.author_id) && !a.pending ? `<button class="row-delete" data-forum-delete-answer="${esc(a.id)}" aria-label="Delete answer">${icon("i-x")}</button>` : ""}
      </div>
      <p class="post-body">${esc(a.body)}</p>
    </article>`).join("");

  return `
    <article class="thread-post">
      <span class="thread-tags">
        <span class="tag">${esc(section ? section.short : t.section)}</span>
        ${info ? `<span class="tag q">${esc(info.label)}</span>` : ""}
      </span>
      <h1 class="material-title">${esc(t.title)}</h1>
      <div class="post-meta">
        ${authorAvatar(t.author_name, t.author_id)}
        <span><strong>${esc(t.author_name)}</strong><span class="hint small"> · ${esc(relTime(t.created_at))}</span></span>
        ${mine(t.author_id) ? `<button class="row-delete" data-forum-delete-thread="${esc(t.id)}" aria-label="Delete question">${icon("i-x")}</button>` : ""}
      </div>
      ${t.body ? `<p class="post-body">${esc(t.body)}</p>` : ""}
      ${info ? `<figure class="q-figure" data-zoom><img class="q-img" src="${esc(info.image)}" alt="${esc(info.label)}"></figure>` : ""}
    </article>

    <h2 class="list-title">${forum.answers.length} ${forum.answers.length === 1 ? "answer" : "answers"}</h2>
    <div class="answer-list">${answers || `<p class="hint">No answers yet. Know how to solve it?</p>`}</div>

    ${account.user ? `
    <form class="reply-form" id="reply-form" novalidate>
      <textarea id="reply-body" rows="3" maxlength="3000" placeholder="Write an answer…"></textarea>
      <p class="form-error" id="reply-error" role="alert"></p>
      <button class="primary" type="submit">Post answer</button>
    </form>` : `
    <div class="account-cta">
      <p class="hint">Create an account to answer questions.</p>
      <button class="primary" data-need-account>Create account or log in</button>
    </div>`}`;
}

function openAskSheet(tag) {
  const info = tagInfo(tag);
  const tests = allTests();
  const sectionDefault = info ? info.section : forum.filter === "ctps" ? "ctps" : forum.filter === "math" ? "math"
    : state.profile && state.profile.focus === "ctps" ? "ctps" : "math";
  const sectionOptions = SECTIONS.map((s) =>
    `<option value="${s.id}"${s.id === sectionDefault ? " selected" : ""}>${esc(s.title)}</option>`).join("");
  const testOptions = SECTIONS.map((s) => {
    const list = tests.filter((x) => x.section === s.id);
    return list.length ? `<optgroup label="${esc(s.short)}">${list.map(({ test }) =>
      `<option value="${esc(test.id)}">${esc(testLabel(test))}</option>`).join("")}</optgroup>` : "";
  }).join("");
  const tagField = info
    ? `<p class="tagged">${icon("i-check", "icon tiny")} About <b>${esc(info.label)}</b></p>`
    : `<div class="field-row">
        <label class="field">Tag a test <span class="hint">(optional)</span>
          <select id="ask-test"><option value="">None</option>${testOptions}</select>
        </label>
        <label class="field">Question
          <select id="ask-question" disabled><option value="">–</option></select>
        </label>
      </div>`;

  openSheet("Ask a question", `
    <label class="field">Your question
      <input id="ask-title" maxlength="150" placeholder="For example, how do you solve question 5?">
    </label>
    <label class="field">Details <span class="hint">(optional)</span>
      <textarea id="ask-body" rows="4" maxlength="3000" placeholder="What did you try? Where did you get stuck?"></textarea>
    </label>
    <label class="field">Section
      <select id="ask-section">${sectionOptions}</select>
    </label>
    ${tagField}
    <p class="hint small">Posted as ${esc(forumName())}. Everyone using the app can see it.</p>`,
  async () => {
    const title = $("#ask-title").value.trim();
    if (title.length < 3) return "Please write your question (at least 3 characters).";
    let postTag = tag || null;
    if (!info && $("#ask-test").value) {
      if (!$("#ask-question").value) return "Choose which question of the test, or set the test back to None.";
      postTag = `${$("#ask-test").value}:${$("#ask-question").value}`;
    }
    const tagged = tagInfo(postTag);
    const client = await forumClient();
    const { error } = await client.from("threads").insert({
      author_name: forumName(),
      section: tagged ? tagged.section : $("#ask-section").value,
      tag: postTag,
      title,
      body: $("#ask-body").value.trim(),
    });
    if (error) {
      console.error(error);
      return "Couldn't post your question. Please try again.";
    }
    forum.stale = true;
    return "";
  }, "Post question");

  if (!info) {
    $("#ask-test").addEventListener("change", (e) => {
      const found = tests.find((x) => x.test.id === e.target.value);
      const test = found && found.test;
      const select = $("#ask-question");
      select.disabled = !test;
      select.innerHTML = test
        ? `<option value="">Choose…</option>` + test.questions.map((_, i) => `<option value="${i + 1}">Q${i + 1}</option>`).join("")
        : `<option value="">–</option>`;
    });
  }
}

// Two-tap delete for forum posts; returns true once the second tap arrives.
function confirmTap(t) {
  if (t.classList.contains("armed")) return true;
  t.classList.add("armed");
  haptic("rigid");
  setTimeout(() => t.classList.remove("armed"), 3000);
  return false;
}

async function deleteForumRow(table, id) {
  try {
    const client = await forumClient();
    const { error } = await client.from(table).delete().eq("id", id);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Returns true when the click belonged to the forum.
function handleForumClick(t) {
  const ds = t.dataset;
  if (ds.forumFilter) {
    forum.filter = ds.forumFilter;
    forum.stale = true;
    haptic("select");
    rerenderInPlace();
    return true;
  }
  if (ds.forumClearTag !== undefined) {
    forum.tag = null;
    forum.stale = true;
    rerenderInPlace();
    return true;
  }
  if (ds.forumRetry !== undefined) { forum.stale = true; render(); return true; }
  if (ds.threadRetry !== undefined) { forum.threadStale = true; render(); return true; }
  if (ds.forumAsk !== undefined) {
    if (forumReady && requireAccount()) openAskSheet(ds.forumAsk || null);
    return true;
  }
  if (ds.needAccount !== undefined) { requireAccount(); return true; }
  if (ds.createAccount !== undefined) { openSignupSheet(); return true; }
  if (ds.openLogin !== undefined) { openLoginSheet(); return true; }
  if (ds.logOut !== undefined) { logOut(); return true; }
  if (ds.openThread) { openThread(ds.openThread); return true; }
  if (ds.discuss) {
    forum.tag = ds.discuss;
    forum.stale = true;
    go({ view: "forum" });
    return true;
  }
  if (ds.askAbout) {
    if (forumReady && requireAccount()) openAskSheet(ds.askAbout);
    return true;
  }
  if (ds.forumDeleteThread) {
    if (!confirmTap(t)) return true;
    deleteForumRow("threads", ds.forumDeleteThread).then((ok) => {
      if (!ok) return;
      forum.stale = true;
      back();
    });
    return true;
  }
  if (ds.forumDeleteAnswer) {
    if (!confirmTap(t)) return true;
    deleteForumRow("answers", ds.forumDeleteAnswer).then((ok) => {
      if (!ok) return;
      forum.threadStale = true;
      forum.stale = true;
      rerenderInPlace();
    });
    return true;
  }
  return false;
}

$("#view").addEventListener("submit", async (e) => {
  if (e.target.id !== "reply-form") return;
  e.preventDefault();
  const button = e.target.querySelector('[type="submit"]');
  const body = $("#reply-body").value.trim();
  if (!body) {
    $("#reply-error").textContent = "Write your answer first.";
    return;
  }
  // Show the answer straight away and save it in the background; the saved row then
  // replaces it, or on failure it's taken out again and the text goes back in the box.
  const threadId = route.threadId;
  const list = forum.answers;
  const pending = {
    id: `pending-${Date.now()}`, created_at: new Date().toISOString(), thread_id: threadId,
    author_id: myId(), author_name: forumName(), body, pending: true,
  };
  list.push(pending);
  forum.stale = true; // the answer count in the question list
  haptic("success");
  rerenderInPlace();
  const stillHere = () => route.view === "thread" && route.threadId === threadId;
  try {
    const client = await forumClient();
    const { data, error } = await client.from("answers")
      .insert({ thread_id: threadId, author_name: forumName(), body })
      .select().single();
    if (error) throw error;
    list[list.indexOf(pending)] = data;
    if (stillHere()) rerenderInPlace();
  } catch (err) {
    console.error(err);
    list.splice(list.indexOf(pending), 1);
    haptic("error");
    if (!stillHere()) return;
    rerenderInPlace();
    $("#reply-body").value = body;
    $("#reply-error").textContent = "Couldn't post your answer. Please try again.";
  }
});

// ---------- Practice quizzes ----------

let quizAnswers = {}; // question index -> chosen option index, for the open quiz
let quizTimes = {};   // question index -> seconds spent before answering it
let quizClock = 0;    // when the quiz opened, or when the last question was answered

function resetQuiz() {
  quizAnswers = {};
  quizTimes = {};
  quizClock = Date.now();
}

function quizHTML(m) {
  const questions = m.questions || [];
  const answered = Object.keys(quizAnswers).length;
  const correct = questions.filter((q, i) => quizAnswers[i] === q.answer).length;

  const list = questions.map((q, qi) => {
    const chosen = quizAnswers[qi];
    const options = q.options.map((opt, oi) => {
      let cls = "";
      if (chosen !== undefined) {
        if (oi === q.answer) cls = " correct";
        else if (oi === chosen) cls = " wrong";
      }
      return `<button class="option${cls}" data-q="${qi}" data-o="${oi}" ${chosen !== undefined ? "disabled" : ""}>
          <span class="option-letter">${String.fromCharCode(65 + oi)}</span>
          <span>${esc(opt)}</span>
        </button>`;
    }).join("");
    const explain = chosen !== undefined && q.explain
      ? `<p class="explain">${esc(q.explain)}</p>` : "";
    return `
      <section class="question">
        <p class="q-number">Question ${qi + 1} of ${questions.length}</p>
        <p class="q-text">${esc(q.q)}</p>
        <div class="options">${options}</div>
        ${explain}
      </section>`;
  }).join("");

  const score = answered === questions.length && questions.length
    ? `<div class="score">
         <strong>${correct} / ${questions.length}</strong>
         <span class="hint">${correct === questions.length ? "Perfect score!" : "Review the explanations above, then try again."}</span>
         <button class="secondary" data-retry>Try again</button>
       </div>`
    : "";

  return list + score;
}

// ---------- App events ----------

let deleteTimer = null;

$("#view").addEventListener("change", (e) => {
  if (e.target.matches("[data-photo]") && e.target.files[0]) setPhoto(e.target.files[0]);
});

$("#view").addEventListener("click", (e) => {
  // Tapping a question image opens it in the full-screen zoom viewer.
  const figure = e.target.closest("[data-zoom]");
  if (figure) {
    const img = figure.querySelector("img");
    openViewer(img.src, img.alt);
    return;
  }

  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.openSection) {
    const next = { view: "section", sectionId: t.dataset.openSection };
    if (!needsSignup(next)) go(next);
    return;
  }
  if (t.dataset.startSignup !== undefined) return startSignup();

  if (handleForumClick(t)) return;
  if (handleTestClick(t)) return;

  if (t.dataset.openMaterial !== undefined) {
    resetQuiz();
    haptic("light");
    return go({ view: "material", sectionId: route.sectionId, index: Number(t.dataset.openMaterial) });
  }

  if (t.dataset.openLink) {
    const url = t.dataset.openLink;
    if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, "_blank");
    return;
  }

  if (t.dataset.editProfile !== undefined) return showOnboarding();

  if (t.dataset.addMock !== undefined) return openMockForm();

  if (t.dataset.sheet === "targets") return openTargetsSheet();
  if (t.dataset.sheet === "mistake") return openMistakeSheet();

  if (t.dataset.openNotebook !== undefined) {
    notebookFilter = "open";
    return go({ view: "notebook" });
  }

  if (t.dataset.filter) {
    notebookFilter = t.dataset.filter;
    haptic("select");
    return render();
  }

  if (t.dataset.master) {
    const entry = state.mistakes.find((m) => m.id === Number(t.dataset.master));
    entry.mastered = !entry.mastered;
    save();
    haptic(entry.mastered ? "success" : "light");
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }

  // Deleting a notebook entry needs a second tap within 3 seconds.
  if (t.dataset.deleteMistake) {
    if (!t.classList.contains("armed")) {
      t.classList.add("armed");
      haptic("rigid");
      setTimeout(() => t.classList.remove("armed"), 3000);
      return;
    }
    state.mistakes = state.mistakes.filter((m) => m.id !== Number(t.dataset.deleteMistake));
    save();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }

  // Deleting a mock result needs a second tap within 3 seconds.
  if (t.dataset.deleteMock) {
    if (!t.classList.contains("armed")) {
      t.classList.add("armed");
      t.setAttribute("aria-label", "Tap again to delete");
      haptic("rigid");
      setTimeout(() => t.classList.remove("armed"), 3000);
      return;
    }
    const id = Number(t.dataset.deleteMock);
    state.mocks = state.mocks.filter((r) => r.id !== id);
    save();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }

  // Delete needs a second tap within 3 seconds.
  if (t.dataset.deleteAccount !== undefined) {
    if (!deleteTimer) {
      t.textContent = "Tap again to delete your account";
      haptic("rigid");
      deleteTimer = setTimeout(() => { t.textContent = "Delete my account"; deleteTimer = null; }, 3000);
      return;
    }
    clearTimeout(deleteTimer);
    deleteTimer = null;
    t.disabled = true;
    deleteOnlineAccount().finally(() => {
      state = freshState();
      done = new Set();
      save();
      showApp(true);
    });
    return;
  }

  if (t.dataset.removePhoto !== undefined) {
    state.profile.photo = null;
    photoError = "";
    save();
    rerenderInPlace();
    removeUploadedPhoto();
    return;
  }

  const s = findSection(route.sectionId);

  if (t.dataset.toggleDone !== undefined) {
    const key = materialKey(s, route.index);
    if (done.has(key)) done.delete(key);
    else { done.add(key); haptic("success"); }
    save();
    return render();
  }

  if (t.dataset.q !== undefined) {
    const m = s.materials[route.index];
    const qi = Number(t.dataset.q);
    const oi = Number(t.dataset.o);
    quizAnswers[qi] = oi;
    const now = Date.now();
    quizTimes[qi] = Math.min((now - quizClock) / 1000, QUESTION_TIME_CAP);
    quizClock = now;

    const right = oi === m.questions[qi].answer;
    haptic(right ? "success" : "error");
    if (!right) addQuizMistake(s, m, qi, oi);

    // Finishing every question counts the quiz as done and records the score and time.
    if (Object.keys(quizAnswers).length === m.questions.length) {
      const correct = m.questions.filter((q, i) => quizAnswers[i] === q.answer).length;
      const seconds = Math.round(Object.values(quizTimes).reduce((sum, v) => sum + v, 0));
      state.attempts.push({ key: materialKey(s, route.index), section: s.id, correct, total: m.questions.length, seconds, at: now });
      done.add(materialKey(s, route.index));
    }
    save();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }

  if (t.dataset.retry !== undefined) {
    resetQuiz();
    render();
  }
});

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) openTab(b.dataset.tab);
});

$("#btn-back").addEventListener("click", back);
$("#btn-profile").addEventListener("click", () => openTab("profile"));

// The creator's channel, shown as a small label in the top bar and a credit on Home.
const CHANNEL_URL = "https://t.me/chalkaandetc";
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-channel]")) return;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(CHANNEL_URL);
  else window.open(CHANNEL_URL, "_blank");
});

// ---------- Sign-up wizard ----------

let draft = null;    // profile being created or edited
let stepIndex = 0;
let editing = false; // true: every question on one page; false: one question per screen

function newDraft() {
  if (state.profile) return { ...state.profile, password: "" };
  const tgName = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") : "";
  const draft = { name: tgName };
  STEPS.forEach((s) => { if (!(s.id in draft)) draft[s.id] = ""; });
  return draft;
}

// The password step only appears when sign-up will create a new account.
function activeSteps() {
  return STEPS.filter((s) => !s.signupOnly || (!editing && accountsReady && !account.user));
}

function stepError(step) {
  const value = (draft[step.id] || "").trim();
  if (step.type === "text") return value ? "" : "Please enter your name.";
  if (step.type === "email") {
    if (!value) return "Please enter your email.";
    return EMAIL_RE.test(value) ? "" : "That email doesn't look right.";
  }
  if (step.type === "password") {
    return (draft.password || "").length >= PASSWORD_MIN ? "" : `Your password needs at least ${PASSWORD_MIN} characters.`;
  }
  return value ? "" : "Please choose one option.";
}

function stepHTML(step) {
  let field;
  let hint = step.hint;
  if (step.type === "choice") {
    field = `<div class="choices" data-field="${step.id}">${step.options.map(([value, label]) => `
      <button class="choice${draft[step.id] === value ? " on" : ""}" data-value="${esc(value)}">
        <span>${esc(label)}</span>${icon("i-check")}
      </button>`).join("")}</div>`;
  } else {
    let attrs = `type="text" autocomplete="name"`;
    if (step.type === "email") {
      attrs = `type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"`;
      // The email is the login, so it can't be changed from the profile editor.
      if (editing && accountsReady) {
        attrs += " disabled";
        hint = "This is your login email, so it can't be changed here.";
      }
    }
    if (step.type === "password") attrs = `type="password" autocomplete="new-password"`;
    field = `<input class="big-input" data-field="${step.id}" ${attrs} maxlength="80"
      placeholder="${esc(step.placeholder)}" value="${esc(draft[step.id] || "")}" enterkeyhint="next">`;
  }
  return `
    <section class="step" data-step="${step.id}">
      <h2>${esc(step.title)}</h2>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
      ${field}
    </section>`;
}

function updateNav() {
  const next = $("#wiz-next");
  if (editing) {
    next.textContent = "Save";
    next.disabled = false;
    return;
  }
  const steps = activeSteps();
  next.textContent = stepIndex === steps.length - 1 ? "Start preparing" : "Continue";
  next.disabled = !!stepError(steps[stepIndex]);
}

function renderWizard(direction) {
  const body = $("#wizard-body");
  $("#onboarding").classList.toggle("editing", editing);
  $("#wiz-cancel").hidden = !editing;
  $("#form-error").textContent = "";

  const steps = activeSteps();
  // Sign-up is optional until materials are opened, so there's always a way back to the app.
  $("#wiz-cancel").textContent = editing ? "Cancel" : "Not now";
  $("#wiz-cancel").hidden = false;
  setTelegramBack(true);
  if (editing) {
    body.innerHTML = `<h1 class="edit-title">Edit profile</h1>` + steps.map(stepHTML).join("");
  } else {
    const intro = stepIndex === 0
      ? `<div class="welcome"><span class="logo-mark big"><img src="logo.png?v=25" alt=""></span><p class="logo"><span class="logo-name">NUET<span class="logo-ext">.exe</span></span></p></div>` : "";
    const login = stepIndex === 0 && accountsReady && !account.user
      ? `<p class="hint login-line">Already have an account? <button type="button" class="link-btn" data-open-login>Log in</button></p>` : "";
    body.innerHTML = intro + stepHTML(steps[stepIndex]) + login;
    $("#wiz-progress").style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
    $("#wiz-count").textContent = `${stepIndex + 1}/${steps.length}`;
    $("#wiz-back").style.visibility = stepIndex > 0 ? "visible" : "hidden";
    if (direction) body.querySelector(".step").classList.add(direction === "back" ? "enter-back" : "enter-forward");
    const input = body.querySelector("input");
    if (input) setTimeout(() => input.focus(), 60);
  }
  body.scrollTop = 0;
  updateNav();
}

function nextStep() {
  if (editing) return saveDraft();
  const steps = activeSteps();
  const err = stepError(steps[stepIndex]);
  if (err) {
    $("#form-error").textContent = err;
    haptic("error");
    return;
  }
  if (stepIndex === steps.length - 1) return saveDraft();
  stepIndex++;
  haptic("light");
  renderWizard("forward");
}

function prevStep() {
  // Going back from the first question (or out of the editor) returns to the app.
  if (editing || stepIndex === 0) {
    afterSignup = null;
    showApp(false);
    return;
  }
  stepIndex--;
  renderWizard("back");
}

let saving = false;

async function saveDraft() {
  if (saving) return;
  const bad = activeSteps().find((s) => stepError(s));
  if (bad) {
    $("#form-error").textContent = stepError(bad);
    const section = document.querySelector(`.step[data-step="${bad.id}"]`);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "center" });
    haptic("error");
    return;
  }
  const profile = {};
  STEPS.filter((s) => s.type !== "password").forEach((s) => { profile[s.id] = (draft[s.id] || "").trim(); });
  if (editing && accountsReady) profile.email = state.profile.email;
  if (editing && state.profile.photo !== undefined) profile.photo = state.profile.photo;
  const firstTime = !state.profile;

  // Finishing sign-up creates the account (or, after logging in, saves the answers to it).
  if (firstTime && accountsReady) {
    const next = $("#wiz-next");
    saving = true;
    next.disabled = true;
    next.textContent = "Creating your account…";
    const err = account.user ? (syncProfile(profile), "") : await createAccount(profile.email, draft.password, profile);
    saving = false;
    updateNav();
    if (err) {
      $("#form-error").textContent = err;
      haptic("error");
      return;
    }
  } else if (account.user) {
    syncProfile(profile);
  }

  draft.password = "";
  state.profile = profile;
  save();
  haptic("success");
  showApp(firstTime);
}

$("#wizard-body").addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  draft[field] = e.target.value;
  $("#form-error").textContent = "";
  updateNav();
});

// Point out a mistyped email when the student leaves the field.
$("#wizard-body").addEventListener("focusout", (e) => {
  if (e.target.dataset.field !== "email" || !e.target.value.trim()) return;
  const step = STEPS.find((s) => s.id === "email");
  $("#form-error").textContent = stepError(step);
});

$("#wizard-body").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset.field) {
    e.preventDefault();
    nextStep();
  }
});

// Single-choice questions: tapping an answer selects it; Continue moves on.
$("#wizard-body").addEventListener("click", (e) => {
  if (e.target.closest("[data-open-login]")) {
    openLoginSheet();
    return;
  }
  const choice = e.target.closest(".choice");
  if (!choice) return;
  const box = choice.parentElement;
  draft[box.dataset.field] = choice.dataset.value;
  box.querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c === choice));
  haptic("select");
  updateNav();
});

$("#wiz-next").addEventListener("click", nextStep);
$("#wiz-back").addEventListener("click", prevStep);
$("#wiz-cancel").addEventListener("click", () => {
  afterSignup = null;
  showApp(false);
});

// ---------- Screens ----------

function showOnboarding() {
  editing = !!state.profile;
  draft = newDraft();
  stepIndex = 0;
  $("#app").hidden = true;
  $("#onboarding").hidden = false;
  renderWizard();
}

function showApp(firstTime) {
  $("#onboarding").hidden = true;
  $("#app").hidden = false;
  if (firstTime) {
    stack = [];
    route = { view: "home" };
    // Just signed up on the way to something: go there, with Home behind it.
    if (afterSignup && state.profile) {
      stack = [{ view: "home" }];
      route = afterSignup;
    }
    afterSignup = null;
  }
  render();
}

if (tg && tg.BackButton) {
  try {
    tg.BackButton.onClick(() => {
      if (viewerOpen()) closeViewer();
      else if ($("#onboarding").hidden) back();
      else prevStep();
    });
  } catch (e) {}
}

// ---------- Feedback ----------
// Students who have used the app for at least a day are asked once whether it's useful.
// Answers go to the Supabase "feedback" table (supabase/feedback.sql); one that couldn't be
// sent (offline, table not set up yet) is kept on this device and sent next time.

const DAY_MS = 24 * 60 * 60 * 1000;
const FEEDBACK_CHOICES = [["yes", "Yes, very useful"], ["somewhat", "Somewhat"], ["no", "Not really"]];

function firstUse() {
  if (!state.firstSeen) {
    // For people from before this was recorded, their first finished quiz or test is close enough.
    const first = Math.min(...state.attempts.map((a) => a.at).filter(Boolean));
    state.firstSeen = Number.isFinite(first) ? first : Date.now();
    save();
  }
  return state.firstSeen;
}

function shouldAskFeedback() {
  const f = state.feedback;
  if (!state.profile || (f && f.answered)) return false;
  if (f && f.later && Date.now() - f.later < 3 * DAY_MS) return false; // "Later": ask again in 3 days
  const usedIt = state.attempts.length > 0 || done.size > 0;
  return usedIt && Date.now() - firstUse() >= DAY_MS;
}

async function sendFeedback(entry) {
  if (!accountsReady) return false;
  try {
    const { error } = await supa().from("feedback").insert(entry);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function openFeedbackSheet() {
  let answer = "";
  openSheet("Is this app useful for you?", `
    <p class="hint">Your answer helps us make NUET.exe better.</p>
    <div class="choices" id="feedback-choices">${FEEDBACK_CHOICES.map(([value, label]) => `
      <button type="button" class="choice" data-feedback="${value}"><span>${esc(label)}</span>${icon("i-check")}</button>`).join("")}
    </div>
    <label class="field">What should we add or change? (optional)
      <textarea id="feedback-comment" rows="3" maxlength="1000" placeholder="More tests, explanations, a topic you need…"></textarea>
    </label>`,
  async () => {
    if (!answer) return "Choose an answer first.";
    const entry = {
      answer, comment: $("#feedback-comment").value.trim(),
      tg_user_id: tgUser ? tgUser.id : null, name: state.profile ? state.profile.name.slice(0, 80) : null,
    };
    state.feedback = { answered: Date.now(), pending: (await sendFeedback(entry)) ? null : entry };
    return "";
  }, "Send");
  // "Cancel" means "ask me later".
  $("#sheet-form [data-close-sheet]").textContent = "Later";
  state.feedback = { ...state.feedback, later: Date.now() };
  save();
  $("#feedback-choices").addEventListener("click", (e) => {
    const b = e.target.closest("[data-feedback]");
    if (!b) return;
    answer = b.dataset.feedback;
    $("#feedback-choices").querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c === b));
    $("#sheet-error").textContent = "";
    haptic("select");
  });
}

function maybeAskFeedback() {
  const f = state.feedback;
  if (f && f.pending) {
    sendFeedback(f.pending).then((ok) => { if (ok) { state.feedback = { ...state.feedback, pending: null }; save(); } });
  }
  firstUse();
  // Opening the app's address with #feedback shows the window straight away, to try it out.
  if (location.hash === "#feedback") {
    setTimeout(openFeedbackSheet, 500);
    return;
  }
  if (!shouldAskFeedback()) return;
  // A moment after the app opens, and only on Home, never in the middle of a test.
  setTimeout(() => {
    if (route.view === "home" && $("#sheet-modal").hidden && $("#onboarding").hidden) openFeedbackSheet();
  }, 1500);
}

// The app opens for everyone; sign-up happens when a guest opens the materials.
showApp(true);
maybeAskFeedback();
