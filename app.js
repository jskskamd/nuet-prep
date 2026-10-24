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

const STORE_KEY = "nuetprep:v1";
const TYPE_INFO = {
  lesson: { label: "Lesson", icon: "i-book" },
  link: { label: "Resource", icon: "i-link" },
  quiz: { label: "Practice", icon: "i-quiz" },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (id, cls = "icon") => `<svg class="${cls}"><use href="#${id}"/></svg>`;

// ---------- Progress (saved in this device's browser storage) ----------

function loadDone() {
  try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); } catch (e) { return new Set(); }
}

const done = loadDone();

function saveDone() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...done])); } catch (e) {}
}

function haptic(kind) {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (kind === "success" || kind === "error") tg.HapticFeedback.notificationOccurred(kind);
    else tg.HapticFeedback.impactOccurred(kind);
  } catch (e) {}
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
  route = name === "home" ? { view: "home" } : { view: "section", sectionId: name };
  haptic("light");
  render();
}

function render() {
  const view = $("#view");
  if (route.view === "section") view.innerHTML = sectionHTML(findSection(route.sectionId));
  else if (route.view === "material") view.innerHTML = materialHTML(findSection(route.sectionId), route.index);
  else view.innerHTML = homeHTML();

  const activeTab = route.view === "home" ? "home" : route.sectionId;
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === activeTab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  const canGoBack = stack.length > 0;
  $("#btn-back").hidden = !canGoBack;
  if (tg && tg.BackButton) {
    try { canGoBack ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
  }
  window.scrollTo(0, 0);
}

// ---------- Views ----------

function homeHTML() {
  const cards = SECTIONS.map((s) => {
    const p = sectionProgress(s);
    const status = p.total
      ? `<div class="meter"><div class="meter-fill" style="width:${p.pct}%"></div></div>
         <span class="hint small">${p.finished} of ${p.total} done</span>`
      : `<span class="badge">Coming soon</span>`;
    return `
      <button class="section-card" data-open-section="${s.id}">
        <span class="section-icon">${icon(s.icon)}</span>
        <span class="section-text">
          <strong>${esc(s.title)}</strong>
          <span class="hint">${esc(s.description)}</span>
          ${status}
        </span>
        ${icon("i-next", "icon chevron")}
      </button>`;
  }).join("");

  return `
    <section class="hero">
      <p class="eyebrow">Nazarbayev University Entrance Test</p>
      <h1>Get ready for the NUET</h1>
      <p class="hint">Study materials and practice for both test sections, all in Telegram.</p>
    </section>
    <h2 class="list-title">Sections</h2>
    <div class="section-list">${cards}</div>
    <p class="note">New materials are added regularly. Check back soon.</p>`;
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

// ---------- Practice quizzes ----------

let quizAnswers = {}; // question index -> chosen option index, for the open quiz

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

// ---------- Events ----------

$("#view").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;

  if (t.dataset.openSection) return go({ view: "section", sectionId: t.dataset.openSection });

  if (t.dataset.openMaterial !== undefined) {
    quizAnswers = {};
    haptic("light");
    return go({ view: "material", sectionId: route.sectionId, index: Number(t.dataset.openMaterial) });
  }

  if (t.dataset.openLink) {
    const url = t.dataset.openLink;
    if (tg && tg.openLink) tg.openLink(url);
    else window.open(url, "_blank");
    return;
  }

  const s = findSection(route.sectionId);

  if (t.dataset.toggleDone !== undefined) {
    const key = materialKey(s, route.index);
    if (done.has(key)) done.delete(key);
    else { done.add(key); haptic("success"); }
    saveDone();
    return render();
  }

  if (t.dataset.q !== undefined) {
    const m = s.materials[route.index];
    const qi = Number(t.dataset.q);
    const oi = Number(t.dataset.o);
    quizAnswers[qi] = oi;
    haptic(oi === m.questions[qi].answer ? "success" : "error");
    // Finishing every question counts the quiz as done.
    if (Object.keys(quizAnswers).length === m.questions.length) {
      done.add(materialKey(s, route.index));
      saveDone();
    }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }

  if (t.dataset.retry !== undefined) {
    quizAnswers = {};
    render();
  }
});

document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) openTab(b.dataset.tab);
});

$("#btn-back").addEventListener("click", back);
if (tg && tg.BackButton) {
  try { tg.BackButton.onClick(back); } catch (e) {}
}

render();
