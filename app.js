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
};

// Sign-up questions, in order. `label` is how the answer shows on the Profile tab.
const STEPS = [
  { id: "name", type: "text", label: "Name", title: "What's your name?",
    hint: "So we know what to call you.", placeholder: "Your full name" },
  { id: "email", type: "email", label: "Email", title: "What's your email?",
    hint: "This is your account email. For now it's saved only on this device.", placeholder: "you@example.com" },
  { id: "grade", type: "choice", label: "Grade", title: "Which grade are you in?",
    options: [["10", "Grade 10"], ["11", "Grade 11"], ["12", "Grade 12"], ["graduated", "Already graduated"]] },
  { id: "mock", type: "choice", label: "Mock tests", title: "Have you ever done an NUET mock test?",
    options: [["several", "Yes, several times"], ["once", "Yes, once"], ["never", "No, not yet"]] },
  { id: "testDate", type: "choice", label: "Taking the NUET", title: "When do you plan to take the NUET?",
    options: [["1m", "Within a month"], ["3m", "In 1–3 months"], ["6m", "In 3–6 months"], ["unsure", "Not sure yet"]] },
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
// targets: { math, ctps } goal scores; examDate: "YYYY-MM-DD"; mistakes: the mistake notebook.
function freshState() {
  return { profile: null, done: [], mocks: [], attempts: [], targets: null, examDate: "", mistakes: [] };
}

function todayISO() {
  const now = new Date(); // local date, not UTC
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, "0")).join("-");
}

function daysUntil(iso) {
  return Math.round((new Date(`${iso}T00:00:00`) - new Date(`${todayISO()}T00:00:00`)) / 86400000);
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
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

function openTab(name) {
  stack = [];
  route = name === "home" || name === "profile" ? { view: name } : { view: "section", sectionId: name };
  haptic("select");
  render();
}

function render() {
  const view = $("#view");
  if (route.view === "section") view.innerHTML = sectionHTML(findSection(route.sectionId));
  else if (route.view === "material") view.innerHTML = materialHTML(findSection(route.sectionId), route.index);
  else if (route.view === "profile") view.innerHTML = profileHTML();
  else if (route.view === "notebook") view.innerHTML = notebookHTML();
  else view.innerHTML = homeHTML();

  const activeTab = route.view === "notebook" ? "home"
    : route.view === "home" || route.view === "profile" ? route.view : route.sectionId;
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === activeTab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  $("#btn-back").hidden = stack.length === 0;
  setTelegramBack(stack.length > 0);
  window.scrollTo(0, 0);
  drawMockChart();
}

// ---------- Views ----------

function homeHTML() {
  const p = state.profile;
  const firstName = p.name.trim().split(/\s+/)[0];
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
      <p class="eyebrow">Hi, ${esc(firstName)}</p>
      <h1>Get ready for the NUET</h1>
      <p class="hint">Study materials and practice for both test sections, all in Telegram.</p>
    </section>
    ${countdownHTML()}
    ${targetsHTML()}
    ${notebookCardHTML()}
    <h2 class="list-title">Sections</h2>
    <div class="section-list">${cards}</div>
    <p class="note">New materials are added regularly. Check back soon.</p>`;
}

// ---------- Home cards: countdown, targets, mistake notebook ----------

function countdownHTML() {
  if (!state.examDate) {
    return `
      <button class="home-card" data-sheet="exam">
        <span class="section-icon">${icon("i-calendar")}</span>
        <span class="section-text">
          <strong>When is your NUET?</strong>
          <span class="hint">Set your exam date to start the countdown.</span>
        </span>
        ${icon("i-next", "icon chevron")}
      </button>`;
  }
  const days = daysUntil(state.examDate);
  let number = String(days);
  let label = `${days === 1 ? "day" : "days"} left until the NUET`;
  if (days === 0) { number = "0"; label = "Exam day. Good luck!"; }
  if (days < 0) { number = "–"; label = "Your exam date has passed"; }
  return `
    <button class="countdown" data-sheet="exam">
      <span class="countdown-num">${number}</span>
      <span class="countdown-text">
        <strong>${label}</strong>
        <span class="hint small">${esc(longDate(state.examDate))} · tap to change</span>
      </span>
    </button>`;
}

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

function doneButton(finished) {
  return finished
    ? `<button class="secondary done-btn" data-toggle-done>${icon("i-check")} Done · tap to undo</button>`
    : `<button class="secondary" data-toggle-done>Mark as done</button>`;
}

function profileHTML() {
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
      <span class="avatar">${esc(initials(p.name))}</span>
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

    <p class="note">Your profile and progress are saved on this device.</p>
    <button class="ghost danger" data-delete-account>Delete my account</button>`;
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
        <h2 class="list-title">Practice quizzes</h2>
        <p class="hint">Finish a practice quiz in Math or CTPS and your scores will show up here.</p>
      </section>`;
  }
  const avg = (list) => Math.round(list.reduce((s, a) => s + pct(a), 0) / list.length);
  const perSection = SECTIONS.map((s) => {
    const list = attempts.filter((a) => a.section === s.id);
    return `
      <div class="info-row">
        <span class="hint">${esc(s.short)}</span>
        <strong>${list.length ? `${avg(list)}% average · ${list.length} ${list.length === 1 ? "quiz" : "quizzes"}` : "No quizzes yet"}</strong>
      </div>`;
  }).join("");

  return `
    <section class="panel stat-panel">
      <h2 class="list-title">Practice quizzes</h2>
      <div class="tiles">
        <div class="tile"><span class="hint">Quizzes finished</span><b>${attempts.length}</b></div>
        <div class="tile"><span class="hint">Average score</span><b>${avg(attempts)}%</b></div>
        <div class="tile"><span class="hint">Best score</span><b>${Math.max(...attempts.map(pct))}%</b></div>
      </div>
      ${perSection}
    </section>`;
}

function timeStatsHTML() {
  const pace = (NUET_MINUTES * 60) / NUET_QUESTIONS;
  const timed = state.attempts.filter((a) => a.seconds);
  const practice = timed.length
    ? timed.reduce((s, a) => s + a.seconds, 0) / timed.reduce((s, a) => s + a.total, 0) : null;
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

function openSheet(title, fieldsHTML, onSubmit) {
  $("#sheet-form").innerHTML = `
    <h2>${esc(title)}</h2>
    ${fieldsHTML}
    <p class="form-error" id="sheet-error" role="alert"></p>
    <button class="primary" type="submit">Save</button>
    <button class="ghost" type="button" data-close-sheet>Cancel</button>`;
  sheetSubmit = onSubmit;
  $("#sheet-modal").hidden = false;
}

function closeSheet() {
  $("#sheet-modal").hidden = true;
  sheetSubmit = null;
}

$("#sheet-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const err = sheetSubmit ? sheetSubmit() : "";
  if (err) {
    $("#sheet-error").textContent = err;
    haptic("error");
    return;
  }
  save();
  haptic("success");
  closeSheet();
  render();
});

$("#sheet-form").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-sheet]")) closeSheet();
});

// Tapping the dark area outside a form closes it.
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
});

function openExamSheet() {
  openSheet("When is your NUET?", `
    <label class="field">Exam date
      <input id="exam-date" type="date" min="${todayISO()}" value="${esc(state.examDate)}">
    </label>
    <p class="hint small">Check the official date in your NUET registration.</p>`,
  () => {
    const value = $("#exam-date").value;
    if (!value) return "Please choose your exam date.";
    state.examDate = value;
    return "";
  });
}

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

$("#view").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.openSection) return go({ view: "section", sectionId: t.dataset.openSection });

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

  if (t.dataset.sheet === "exam") return openExamSheet();
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
    state = freshState();
    done = new Set();
    save();
    return showOnboarding();
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

// ---------- Sign-up wizard ----------

let draft = null;    // profile being created or edited
let stepIndex = 0;
let editing = false; // true: every question on one page; false: one question per screen
let advanceTimer = null;

function newDraft() {
  if (state.profile) return { ...state.profile };
  const tgName = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") : "";
  const draft = { name: tgName };
  STEPS.forEach((s) => { if (!(s.id in draft)) draft[s.id] = ""; });
  return draft;
}

function stepError(step) {
  const value = (draft[step.id] || "").trim();
  if (step.type === "text") return value ? "" : "Please enter your name.";
  if (step.type === "email") {
    if (!value) return "Please enter your email.";
    return EMAIL_RE.test(value) ? "" : "That email doesn't look right.";
  }
  return value ? "" : "Please choose one option.";
}

function stepHTML(step) {
  let field;
  if (step.type === "choice") {
    field = `<div class="choices" data-field="${step.id}">${step.options.map(([value, label]) => `
      <button class="choice${draft[step.id] === value ? " on" : ""}" data-value="${esc(value)}">
        <span>${esc(label)}</span>${icon("i-check")}
      </button>`).join("")}</div>`;
  } else {
    const attrs = step.type === "email"
      ? `type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"`
      : `type="text" autocomplete="name"`;
    field = `<input class="big-input" data-field="${step.id}" ${attrs} maxlength="80"
      placeholder="${esc(step.placeholder)}" value="${esc(draft[step.id] || "")}" enterkeyhint="next">`;
  }
  return `
    <section class="step" data-step="${step.id}">
      <h2>${esc(step.title)}</h2>
      ${step.hint ? `<p class="hint">${esc(step.hint)}</p>` : ""}
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
  next.textContent = stepIndex === STEPS.length - 1 ? "Start preparing" : "Continue";
  next.disabled = !!stepError(STEPS[stepIndex]);
}

function renderWizard(direction) {
  const body = $("#wizard-body");
  $("#onboarding").classList.toggle("editing", editing);
  $("#wiz-cancel").hidden = !editing;
  $("#form-error").textContent = "";

  if (editing) {
    body.innerHTML = `<h1 class="edit-title">Edit profile</h1>` + STEPS.map(stepHTML).join("");
    setTelegramBack(false);
  } else {
    const intro = stepIndex === 0
      ? `<div class="welcome"><span class="logo-mark big">N</span><p class="logo"><span class="logo-name">NUET<span class="logo-ext">.exe</span></span></p></div>` : "";
    body.innerHTML = intro + stepHTML(STEPS[stepIndex]);
    $("#wiz-progress").style.width = `${((stepIndex + 1) / STEPS.length) * 100}%`;
    $("#wiz-count").textContent = `${stepIndex + 1}/${STEPS.length}`;
    $("#wiz-back").style.visibility = stepIndex > 0 ? "visible" : "hidden";
    setTelegramBack(stepIndex > 0);
    if (direction) body.querySelector(".step").classList.add(direction === "back" ? "enter-back" : "enter-forward");
    const input = body.querySelector("input");
    if (input) setTimeout(() => input.focus(), 60);
  }
  body.scrollTop = 0;
  updateNav();
}

function nextStep() {
  clearTimeout(advanceTimer);
  if (editing) return saveDraft();
  const err = stepError(STEPS[stepIndex]);
  if (err) {
    $("#form-error").textContent = err;
    haptic("error");
    return;
  }
  if (stepIndex === STEPS.length - 1) return saveDraft();
  stepIndex++;
  haptic("light");
  renderWizard("forward");
}

function prevStep() {
  clearTimeout(advanceTimer);
  if (editing || stepIndex === 0) return;
  stepIndex--;
  renderWizard("back");
}

function saveDraft() {
  const bad = STEPS.find((s) => stepError(s));
  if (bad) {
    $("#form-error").textContent = stepError(bad);
    const section = document.querySelector(`.step[data-step="${bad.id}"]`);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "center" });
    haptic("error");
    return;
  }
  const profile = {};
  STEPS.forEach((s) => { profile[s.id] = (draft[s.id] || "").trim(); });
  const firstTime = !state.profile;
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

// Single-choice questions: tapping an answer moves on to the next screen.
$("#wizard-body").addEventListener("click", (e) => {
  const choice = e.target.closest(".choice");
  if (!choice) return;
  const box = choice.parentElement;
  draft[box.dataset.field] = choice.dataset.value;
  box.querySelectorAll(".choice").forEach((c) => c.classList.toggle("on", c === choice));
  haptic("select");
  updateNav();
  if (!editing) {
    const from = stepIndex;
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => { if (stepIndex === from) nextStep(); }, 250);
  }
});

$("#wiz-next").addEventListener("click", nextStep);
$("#wiz-back").addEventListener("click", prevStep);
$("#wiz-cancel").addEventListener("click", () => showApp(false));

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
  }
  render();
}

if (tg && tg.BackButton) {
  try {
    tg.BackButton.onClick(() => { if ($("#onboarding").hidden) back(); else prevStep(); });
  } catch (e) {}
}

if (state.profile) showApp(true);
else showOnboarding();
