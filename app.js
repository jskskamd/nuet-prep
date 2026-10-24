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

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
    const oldDone = JSON.parse(localStorage.getItem(OLD_STORE_KEY) || "[]");
    return { profile: null, done: oldDone };
  } catch (e) {
    return { profile: null, done: [] };
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
  else view.innerHTML = homeHTML();

  const activeTab = route.view === "home" || route.view === "profile" ? route.view : route.sectionId;
  document.querySelectorAll(".tabs button").forEach((b) => {
    if (b.dataset.tab === activeTab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });

  $("#btn-back").hidden = stack.length === 0;
  setTelegramBack(stack.length > 0);
  window.scrollTo(0, 0);
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

    <section class="panel">
      <h2 class="list-title">About you</h2>
      ${rows}
    </section>

    <p class="note">Your profile and progress are saved on this device.</p>
    <button class="ghost danger" data-delete-account>Delete my account</button>`;
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

// ---------- App events ----------

let deleteTimer = null;

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

  if (t.dataset.editProfile !== undefined) return showOnboarding();

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
    state = { profile: null, done: [] };
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
    haptic(oi === m.questions[qi].answer ? "success" : "error");
    // Finishing every question counts the quiz as done.
    if (Object.keys(quizAnswers).length === m.questions.length) {
      done.add(materialKey(s, route.index));
      save();
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
      ? `<div class="welcome"><span class="logo-mark big">N</span><p class="eyebrow">NUET Prep</p></div>` : "";
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
