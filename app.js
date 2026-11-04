const form = document.querySelector("#study-form");
const materialInput = document.querySelector("#material-text");
const fileInput = document.querySelector("#file-input");
const uploadZone = document.querySelector("#upload-zone");
const wordCount = document.querySelector("#word-count");
const formError = document.querySelector("#form-error");
const toast = document.querySelector("#toast");
const fileLabel = document.querySelector("#file-label");
const fileStatus = document.querySelector("#file-status");
const imagePreview = document.querySelector("#image-preview");
const uploadIcon = document.querySelector("#upload-icon");
const submitButton = form.querySelector('button[type="submit"]');
const materialHint = document.querySelector("#material-hint");
const studyDaysInput = document.querySelector("#study-days");
const examDateInput = document.querySelector("#exam-date");
const dailyHoursList = document.querySelector("#daily-hours-list");
const authGate = document.querySelector("#auth-gate");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const FRIENDLY_ERROR = "Something went wrong. Please try again.";
let authMode = "login";
let signedIn = false;
let signedInEmail = "";
let currentView = "home";
let saveTimer;
let progressSaveRevision = 0;
let progressSaveQueue = Promise.resolve();
let progressRevision = Date.now();
const MAX_STUDY_DAYS = 30;
const MAX_PLAN_TOPICS = 500;
const MAX_TOPIC_CHARS = 900;

const memoryStyles = {
  visual: {
    label: "Visual maps & diagrams",
    tip: "Try sketching a quick concept map: put the main idea in the middle, then connect the supporting ideas around it.",
    prompt: "Can you draw or describe how the key ideas connect?",
  },
  examples: {
    label: "Examples & analogies",
    tip: "Connect this idea to a real example or a familiar comparison. Making it concrete helps it feel less abstract.",
    prompt: "What real-life example or comparison could help you remember this?",
  },
  practice: {
    label: "Practice & repetition",
    tip: "Look away from your notes and recall the main idea. A short attempt from memory is a useful practice rep.",
    prompt: "Without looking, what are the two most important things you remember?",
  },
  teaching: {
    label: "Explaining it to someone",
    tip: "Imagine teaching this idea to a friend in a couple of sentences. If you get stuck, that shows you where to focus next.",
    prompt: "How would you explain the main idea to someone who is new to it?",
  },
  mixed: {
    label: "A bit of everything",
    tip: "Try explaining the idea, then sketching how it connects to a familiar example. Pick whichever feels most helpful.",
    prompt: "Which part of this topic would you explain, sketch, or practise once more?",
  },
};

const state = {
  planId: null,
  imageId: null,
  material: "",
  inputMaterial: "",
  inputKind: "text",
  topics: [],
  schedule: [1, 1, 1],
  memoryStyle: "mixed",
  currentLesson: 0,
  masteryCheckPage: false,
  completedLessons: new Set(),
  masteryChecks: {},
  topicAssessment: {},
  lessonFeedback: {},
  examDate: "",
  spacedReviews: {},
  activeSpacedReview: null,
  questions: [],
  quizTopicIndices: [],
  quizTotalQuestions: 0,
  quizSetupOpen: false,
  quizAppliedTopicIndex: null,
  currentQuestion: 0,
  answers: [],
  selectedOption: null,
  problemAnswer: "",
  problemSolutionRevealed: false,
};

function createPlanId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const navLinks = [...document.querySelectorAll("[data-view]")];
const views = [...document.querySelectorAll(".page-view")];
const pageCrumb = document.querySelector("#page-crumb");
const lessonTitles = {
  home: "My study plan",
  learn: "Learning room",
  history: "Study history",
};
let toastTimer;
let imagePreviewUrl = "";
let ocrEnginePromise;
let visionAvailable = false;
let imageStorageAvailable = false;
let imageMaterialReady = false;
let imageLessonMaterial = "";
let preparedStudyImage = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

async function refreshVisionStatus() {
  if (window.location.protocol === "file:") {
    materialHint.textContent = "Open StudyBuddy from its local server to create guided lessons and analyze images.";
    return false;
  }
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`Status check failed (${response.status}).`);
    const status = await response.json();
    visionAvailable = status.aiConfigured === true || status.aiAvailable === true || status.visionAvailable === true;
    imageStorageAvailable = status.imageStorageAvailable === true;
    materialHint.textContent = visionAvailable
      ? "The AI tutor is ready for education questions and study topics. Add notes when you want lessons grounded in your course material."
      : "Guided lessons and quizzes are currently unavailable. Images can still be read with basic text recognition.";
    document.querySelector("#image-retention-note").textContent = imageStorageAvailable
      ? "Images used in a study plan are stored privately for 30 days. You can view and download them from Study history; admins can manage stored images."
      : "Image history is not configured yet. You can still study from images, but they will not be saved for later download.";
    return visionAvailable;
  } catch (error) {
    console.error("Could not check image understanding status.", error);
    visionAvailable = false;
    imageStorageAvailable = false;
    materialHint.textContent = FRIENDLY_ERROR;
    return false;
  }
}

const visionStatusReady = refreshVisionStatus();

function stopLessonSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function printStudyPlan() {
  document.body.classList.add("print-study-plan");
  try {
    window.print();
  } finally {
    document.body.classList.remove("print-study-plan");
  }
}

function showView(name, persist = true) {
  if (name !== "learn") stopLessonSpeech();
  currentView = name;
  views.forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
  navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === name));
  pageCrumb.textContent = lessonTitles[name] || (name === "quiz" ? "Quick check-in" : "Your results");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (persist) saveProgress();
}

function rateLimitMessage(errorMessage = "") {
  const match = errorMessage.match(/try again in\s+([\d.]+)\s*(ms|milliseconds?|s|secs?|seconds?|m|mins?|minutes?)/i);
  if (!match) return "Please wait a moment, then try again.";
  let seconds = Number(match[1]);
  if (/^m/i.test(match[2])) seconds *= 60;
  else if (/^ms/i.test(match[2])) seconds /= 1000;
  const wait = seconds >= 60
    ? `${(seconds / 60).toFixed(1).replace(/\.0$/, "")} minutes`
    : `${seconds.toFixed(1).replace(/\.0$/, "")} seconds`;
  return `Please try again in about ${wait}.`;
}

function progressSnapshot() {
  return {
    version: 1,
    lessonVersion: 20,
    planId: state.planId,
    imageId: state.imageId,
    material: state.material,
    inputMaterial: state.inputMaterial,
    inputKind: state.inputKind,
    duration: state.schedule.reduce((total, hours) => total + hours, 0) * 60,
    schedule: state.schedule,
    memoryStyle: state.memoryStyle,
    lessons: state.topics.map((topic) => topic.lesson || null),
    currentLesson: state.currentLesson,
    masteryCheckPage: state.masteryCheckPage,
    completedLessons: [...state.completedLessons],
    masteryChecks: state.masteryChecks,
    topicAssessment: state.topicAssessment,
    lessonFeedback: state.lessonFeedback,
    examDate: state.examDate,
    spacedReviews: state.spacedReviews,
    activeSpacedReview: state.activeSpacedReview,
    questions: state.questions,
    quizTopicIndices: state.quizTopicIndices,
    quizTotalQuestions: state.quizTotalQuestions,
    quizSetupOpen: state.quizSetupOpen,
    quizAppliedTopicIndex: state.quizAppliedTopicIndex,
    currentQuestion: state.currentQuestion,
    answers: state.answers,
    selectedOption: state.selectedOption,
    problemAnswer: state.problemAnswer,
    problemSolutionRevealed: state.problemSolutionRevealed,
    view: currentView,
    savedAt: ++progressRevision,
  };
}

function resetStudyState() {
  state.planId = null;
  state.imageId = null;
  state.material = "";
  state.inputMaterial = "";
  state.inputKind = "text";
  preparedStudyImage = null;
  state.topics = [];
  state.schedule = [1, 1, 1];
  state.memoryStyle = "mixed";
  state.currentLesson = 0;
  state.masteryCheckPage = false;
  state.completedLessons = new Set();
  state.masteryChecks = {};
  state.topicAssessment = {};
  state.lessonFeedback = {};
  state.examDate = "";
  state.spacedReviews = {};
  state.activeSpacedReview = null;
  examDateInput.value = "";
  state.questions = [];
  state.quizTopicIndices = [];
  state.quizTotalQuestions = 0;
  state.quizSetupOpen = false;
  state.quizAppliedTopicIndex = null;
  state.currentQuestion = 0;
  state.answers = [];
  state.selectedOption = null;
  state.problemAnswer = "";
  state.problemSolutionRevealed = false;
  imageLessonMaterial = "";
  imageMaterialReady = false;
  materialInput.value = "";
  fileInput.value = "";
  setImagePreview(null);
  fileLabel.textContent = "Upload one file, or browse";
  fileStatus.textContent = "Choose an image or text file · up to 10 MB";
  studyDaysInput.value = "3";
  renderDailyHours(3, state.schedule);
  updateWordCount();
  showView("home");
}

function saveProgress(immediate = false) {
  if (!signedIn || !state.material) return;
  clearTimeout(saveTimer);
  const snapshot = progressSnapshot();
  const revision = ++progressSaveRevision;
  try {
    if (signedInEmail) localStorage.setItem(`studybuddy-progress:${signedInEmail}`, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("Could not cache study progress in this browser.", error);
  }
  setProgressSaveStatus("Saving…", "saving");
  const save = () => {
    const queuedSave = progressSaveQueue.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ progress: snapshot }),
          });
          if (!response.ok) {
            const error = new Error(`Progress save failed (${response.status}).`);
            error.status = response.status;
            throw error;
          }
          const result = await response.json();
          if (revision === progressSaveRevision) setProgressSaveStatus("Saved", "saved");
          if (result.archived || result.historyAdded) await loadStudyHistory();
          return;
        } catch (error) {
          const retryable = !Number.isInteger(error.status)
            || error.status === 408
            || error.status === 429
            || error.status >= 500;
          if (retryable && attempt < 2) {
            if (revision === progressSaveRevision) setProgressSaveStatus("Retrying save…", "saving");
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          if (revision === progressSaveRevision) setProgressSaveStatus("Couldn’t save", "error");
          console.error("Could not save study progress.", error);
          return;
        }
      }
    });
    progressSaveQueue = queuedSave.catch((error) => {
      console.error("Could not queue study progress save.", error);
    });
    return queuedSave;
  };
  if (immediate) return save();
  saveTimer = setTimeout(save, 450);
}

function setProgressSaveStatus(message, status) {
  const indicator = document.querySelector("#save-status");
  const retryButton = document.querySelector("#save-retry");
  if (!indicator || !retryButton) return;
  indicator.hidden = !message;
  indicator.textContent = message;
  indicator.dataset.state = status;
  retryButton.hidden = status !== "error";
}

function restoreProgress(saved, persist = true) {
  if (!saved || typeof saved.material !== "string" || !saved.material.trim()) return false;
  const originalMaterial = saved.material;
  state.planId = typeof saved.planId === "string" && saved.planId ? saved.planId : createPlanId();
  state.imageId = Number.isInteger(saved.imageId) && saved.imageId > 0 ? saved.imageId : null;
  const previousTopics = splitIntoTopics(originalMaterial).slice(0, MAX_PLAN_TOPICS);
  state.material = cleanExtractedStudyText(originalMaterial);
  state.topics = splitIntoTopics(state.material).slice(0, MAX_PLAN_TOPICS);
  state.schedule = Array.isArray(saved.schedule)
    ? saved.schedule.filter((hours) => Number.isFinite(hours) && hours >= 0.5 && hours <= 12).slice(0, MAX_STUDY_DAYS)
    : [];
  if (!state.schedule.length) state.schedule = [Math.max(0.5, Math.min(12, (Number(saved.duration) || 30) / 60))];
  state.memoryStyle = memoryStyles[saved.memoryStyle] ? saved.memoryStyle : "mixed";
  const titleToNewIndex = new Map(state.topics.map((topic, index) => [topic.title, index]));
  const previousIndexToNewIndex = new Map();
  previousTopics.forEach((topic, index) => {
    const newIndex = titleToNewIndex.get(topic.title);
    if (newIndex !== undefined) previousIndexToNewIndex.set(index, newIndex);
  });
  if (saved.lessonVersion === 20 && Array.isArray(saved.lessons)) {
    state.topics.forEach((topic) => {
      const oldIndex = previousTopics.findIndex((previousTopic) => previousTopic.title === topic.title);
      const lesson = oldIndex >= 0 ? saved.lessons[oldIndex] : null;
      if (lesson && typeof lesson.content === "string" && lesson.content.trim()) topic.lesson = lesson;
    });
  }
  const oldCurrent = Math.min(Math.max(Number(saved.currentLesson) || 0, 0), Math.max(previousTopics.length - 1, 0));
  state.currentLesson = previousIndexToNewIndex.get(oldCurrent) ?? Math.min(oldCurrent, Math.max(state.topics.length - 1, 0));
  state.completedLessons = new Set((Array.isArray(saved.completedLessons) ? saved.completedLessons : [])
    .map((index) => previousIndexToNewIndex.get(index)).filter((index) => Number.isInteger(index) && index >= 0 && index < state.topics.length));
  state.masteryChecks = saved.masteryChecks && typeof saved.masteryChecks === "object" && !Array.isArray(saved.masteryChecks)
    ? saved.masteryChecks
    : {};
  state.topicAssessment = {};
  if (saved.topicAssessment && typeof saved.topicAssessment === "object" && !Array.isArray(saved.topicAssessment)) {
    Object.entries(saved.topicAssessment).forEach(([index, assessment]) => {
      const topicIndex = Number(index);
      if (
        Number.isInteger(topicIndex)
        && topicIndex >= 0
        && topicIndex < state.topics.length
        && assessment
        && Number.isFinite(assessment.score)
        && assessment.score >= 0
        && assessment.score <= 1
      ) {
        state.topicAssessment[topicIndex] = { score: assessment.score, updatedAt: Number(assessment.updatedAt) || 0 };
      }
    });
  }
  if (!saved.masteryChecks) state.completedLessons.clear();
  state.lessonFeedback = saved.lessonFeedback && typeof saved.lessonFeedback === "object" && !Array.isArray(saved.lessonFeedback)
    ? saved.lessonFeedback
    : {};
  state.examDate = typeof saved.examDate === "string" ? saved.examDate : "";
  examDateInput.value = state.examDate;
  state.spacedReviews = saved.spacedReviews && typeof saved.spacedReviews === "object" && !Array.isArray(saved.spacedReviews)
    ? saved.spacedReviews
    : {};
  state.activeSpacedReview = saved.activeSpacedReview && Number.isInteger(saved.activeSpacedReview.topicIndex)
    ? saved.activeSpacedReview
    : null;
  const nextIncompleteLesson = state.topics.findIndex((_, index) => !state.completedLessons.has(index));
  if (nextIncompleteLesson >= 0) state.currentLesson = nextIncompleteLesson;
  else state.currentLesson = Math.max(state.topics.length - 1, 0);
  state.masteryCheckPage = saved.masteryCheckPage === true && !state.completedLessons.has(state.currentLesson);
  state.questions = Array.isArray(saved.questions) ? saved.questions : [];
  state.quizTopicIndices = Array.isArray(saved.quizTopicIndices)
    ? saved.quizTopicIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < state.topics.length)
    : [...new Set(state.questions.map((question) => question.topicIndex).filter((index) => Number.isInteger(index)))];
  state.quizTotalQuestions = Number.isInteger(saved.quizTotalQuestions) && saved.quizTotalQuestions >= state.questions.length
    ? saved.quizTotalQuestions
    : state.questions.length;
  state.quizSetupOpen = saved.quizSetupOpen === true;
  state.quizAppliedTopicIndex = Number.isInteger(saved.quizAppliedTopicIndex)
    && saved.quizAppliedTopicIndex >= 0 && saved.quizAppliedTopicIndex < state.topics.length
    ? saved.quizAppliedTopicIndex
    : state.quizTopicIndices[state.quizTopicIndices.length - 1] ?? Math.floor(Math.max(state.topics.length - 1, 0) / 2);
  state.currentQuestion = Math.min(Math.max(Number(saved.currentQuestion) || 0, 0), Math.max(state.quizTotalQuestions - 1, 0));
  state.answers = Array.isArray(saved.answers) ? saved.answers : [];
  state.selectedOption = Number.isInteger(saved.selectedOption) ? saved.selectedOption : null;
  state.problemAnswer = typeof saved.problemAnswer === "string" ? saved.problemAnswer : "";
  state.problemSolutionRevealed = saved.problemSolutionRevealed === true;
  const legacyVisualSource = originalMaterial.match(/\n\nVisual explanation for the lesson:\n([\s\S]*)$/);
  const restoredInputMaterial = typeof saved.inputMaterial === "string"
    ? saved.inputMaterial
    : saved.inputKind === "visual-image"
      ? ""
      : legacyVisualSource
        ? originalMaterial.slice(0, legacyVisualSource.index).replace(/^Text extracted from the image:\n/, "")
        : cleanLegacyImageInput(state.material);
  state.inputMaterial = cleanLegacyImageInput(restoredInputMaterial);
  state.inputKind = typeof saved.inputKind === "string" ? saved.inputKind : "text";
  materialInput.value = state.inputMaterial;
  studyDaysInput.value = String(state.schedule.length);
  renderDailyHours(state.schedule.length, state.schedule);
  updateWordCount();
  if ((saved.view === "results" || saved.view === "revision") && state.answers.length) renderResults();
  else if (saved.view === "revision") showView("home");
  else if (saved.view === "results") renderResults();
  else if (saved.view === "quiz" && saved.quizMode === "revision") renderResults();
  else if (saved.view === "quiz" && state.quizSetupOpen) showQuizSetup();
  else if (saved.view === "quiz" && state.quizTotalQuestions) {
    showView("quiz");
    if (state.currentQuestion < state.questions.length) renderQuestion();
    else if (state.currentQuestion < state.quizTotalQuestions) loadNextQuizQuestion();
    else renderResults();
  } else if (saved.view === "learn") {
    renderLearningRoom();
    showView("learn", persist);
  } else showView("home");
  return true;
}

function setAuthMode(mode = "login") {
  const modeChanged = authMode !== mode;
  authMode = mode;
  document.querySelector("#auth-form").hidden = false;
  authError.classList.remove("auth-success");
  const registering = mode === "register";
  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const confirmPassword = document.querySelector("#auth-confirm-password");
  setPasswordVisibility(passwordInput, false);
  setPasswordVisibility(confirmPassword, false);
  if (modeChanged) {
    emailInput.value = "";
    passwordInput.value = "";
    confirmPassword.value = "";
  }
  emailInput.autocomplete = registering ? "email" : "username";
  document.querySelector("#auth-title").innerHTML = registering
    ? 'Create your <span class="serif-accent">account.</span>'
    : 'Welcome <span class="serif-accent">back.</span>';
  document.querySelector("#auth-copy").textContent = registering
    ? "Create an email account instantly without verification. Password recovery by email isn't available."
    : "Sign in with Google or your email and password.";
  document.querySelector("#auth-submit").textContent = registering ? "Create account" : "Sign in";
  document.querySelector("#auth-switch-prompt").textContent = registering ? "Already have an account?" : "New to StudyBuddy?";
  document.querySelector("#auth-toggle").textContent = registering ? "Sign in" : "Create an account";
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  document.querySelector("#auth-password-hint").hidden = !registering;
  passwordInput.minLength = registering ? 8 : 0;
  const confirmPasswordField = document.querySelector("#auth-confirm-password-field");
  confirmPasswordField.hidden = !registering;
  confirmPassword.required = registering;
  confirmPassword.minLength = 8;
  document.querySelector("#auth-password").pattern = registering
    ? "(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9\\s]).{8,256}"
    : "";
  document.querySelector("#auth-password").title = registering
    ? "Use at least 8 characters with uppercase and lowercase letters, a number, and a symbol."
    : "";
  if (!registering) confirmPassword.value = "";
  authError.textContent = "";
}

function setPasswordVisibility(input, visible) {
  const toggle = document.querySelector(`[data-password-toggle="${input.id}"]`);
  if (!toggle) return;
  input.type = visible ? "text" : "password";
  toggle.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  toggle.setAttribute("aria-pressed", String(visible));
  const [eyeOpen, eyeClosed] = toggle.querySelectorAll("svg");
  eyeOpen.hidden = visible;
  eyeClosed.hidden = !visible;
}

async function enterApp(user, progress) {
  signedIn = true;
  authGate.hidden = true;
  appShell.hidden = false;
  signedInEmail = user.email.trim().toLowerCase();
  resetStudyState();
  let browserProgress = null;
  try {
    browserProgress = JSON.parse(localStorage.getItem(`studybuddy-progress:${user.email.trim().toLowerCase()}`) || "null");
  } catch (error) {
    console.warn("Could not read the browser's saved study progress.", error);
  }
  if (browserProgress && typeof browserProgress.material !== "string") browserProgress = null;
  const restoredBrowserCopy = Boolean(browserProgress && Number(browserProgress.savedAt) > Number(progress?.savedAt || 0));
  if (restoredBrowserCopy) {
    progress = browserProgress;
  }
  progressRevision = Math.max(progressRevision, Number(progress?.savedAt) || 0);
  let hasSavedProgress = restoreProgress(progress);
  if (hasSavedProgress) {
    await saveProgress(true);
  }
  if (!hasSavedProgress) {
    try {
      const legacy = JSON.parse(sessionStorage.getItem("studybuddy-session") || "null");
      hasSavedProgress = restoreProgress(legacy);
    } catch (error) {
      console.error("Could not read the older browser session.", error);
    }
    if (hasSavedProgress) await saveProgress(true);
  }
  sessionStorage.removeItem("studybuddy-session");
  await loadStudyHistory();
}

async function loadStudyHistory() {
  const historyList = document.querySelector("#history-list");
  if (!historyList || !signedIn) return;
  try {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) throw new Error("History could not be loaded.");
    const { items = [] } = await response.json();
    document.querySelector("#history-count").textContent = `${items.length} saved ${items.length === 1 ? "plan" : "plans"}`;
    historyList.innerHTML = items.length
      ? items.map((item) => `
        <article class="history-item">
          <button class="history-open" type="button" data-history-id="${Number(item.id)}">
            <span class="history-item-copy"><strong>${escapeHtml(item.title || "Study plan")}</strong><small>${new Date(item.createdAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</small></span>
            <span class="history-item-action">Open lessons <span aria-hidden="true">→</span></span>
          </button>
          ${item.image ? `<div class="history-image"><img src="${escapeHtml(item.image.previewUrl)}" alt="Image saved with this study plan" loading="lazy" /><div><strong>${escapeHtml(item.image.fileName)}</strong><a href="${escapeHtml(item.image.downloadUrl)}">Download image</a></div></div>` : ""}
        </article>`).join("")
      : '<p class="history-empty">Your earlier plans will appear here when you start a new one.</p>';
    historyList.querySelectorAll(".history-open").forEach((button) => {
      button.addEventListener("click", () => openStudyHistory(Number(button.dataset.historyId)));
    });
  } catch (error) {
    console.error("Could not load study history.", error);
    historyList.innerHTML = '<p class="history-empty">Study history is temporarily unavailable.</p>';
  }
}

async function openStudyHistory(historyId) {
  try {
    const response = await fetch(`/api/history/${historyId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("That saved study plan could not be opened.");
    const { progress } = await response.json();
    if (!restoreProgress({ ...progress, view: "learn" }, false)) throw new Error("That saved study plan could not be opened.");
    renderLearningRoom();
    showView("learn", false);
  } catch (error) {
    console.error("Could not open saved study plan.", error);
    showToast(FRIENDLY_ERROR);
  }
}

async function loadSignedInSession() {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.authenticated) await enterApp(result.user, result.progress);
    else if (response.ok) setAuthMode();
    else authError.textContent = result.error || FRIENDLY_ERROR;
    const authErrorCode = new URLSearchParams(location.search).get("auth_error");
    const authErrors = {
      google_not_configured: "Google sign-in is not configured on this server yet.",
      google_cancelled: "Google sign-in was cancelled.",
      google_invalid_state: "This Google sign-in request expired or could not be verified. Please try again.",
      google_email_in_use: "This email already has an email-and-password account. Sign in with that method instead.",
      account_disabled: "This account has been disabled. Contact StudyBuddy support.",
      google_failed: "Google sign-in could not be completed. Please try again.",
    };
    if (authErrorCode && authErrors[authErrorCode]) {
      authError.textContent = authErrors[authErrorCode];
      history.replaceState(null, "", `${location.pathname}${location.hash}`);
    }
  } catch (error) {
    console.error("Could not check the StudyBuddy account session.", error);
    authError.textContent = FRIENDLY_ERROR;
  }
}

function updateWordCount() {
  if (imageLessonMaterial && !materialInput.value.trim()) {
    wordCount.textContent = "Image explanation ready";
    return;
  }
  const count = materialInput.value.trim().split(/\s+/).filter(Boolean).length;
  wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function getStudyMaterial() {
  const visibleText = materialInput.value.trim();
  if (!imageLessonMaterial) return visibleText;
  if (!visibleText) return imageLessonMaterial;
  return `Text extracted from the image:\n${visibleText}\n\nVisual explanation for the lesson:\n${imageLessonMaterial}`;
}

function cleanText(text, fileName = "") {
  if (fileName.toLowerCase().endsWith(".html") || fileName.toLowerCase().endsWith(".htm")) {
    const parsed = new DOMParser().parseFromString(text, "text/html");
    parsed.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
    return parsed.body.textContent || "";
  }
  if (fileName.toLowerCase().endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function setImagePreview(file) {
  if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
  imagePreviewUrl = "";
  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
  uploadIcon.hidden = false;
  if (!file) return;
  imagePreviewUrl = URL.createObjectURL(file);
  imagePreview.src = imagePreviewUrl;
  imagePreview.hidden = false;
  uploadIcon.hidden = true;
}

async function loadOcrEngine() {
  if (window.Tesseract?.recognize) return window.Tesseract;
  if (!ocrEnginePromise) {
    ocrEnginePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.async = true;
      script.onload = () => {
        if (window.Tesseract?.recognize) resolve(window.Tesseract);
        else reject(new Error("The text reader loaded incorrectly. Please try again."));
      };
      script.onerror = () => reject(new Error("The text reader could not download. Check your internet connection and try again."));
      document.head.append(script);
    });
  }
  try {
    return await ocrEnginePromise;
  } catch (error) {
    ocrEnginePromise = null;
    throw error;
  }
}

async function readImageText(imageFile, onProgress) {
  const ocrEngine = await loadOcrEngine();
  const { data } = await ocrEngine.recognize(imageFile, "eng", {
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        onProgress(Math.round(message.progress * 100));
      }
    },
  });
  return cleanExtractedStudyText(data.text);
}

function cleanExtractedStudyText(text) {
  const ignoredLine = /^\s*(?:[-*+•‣▪◦]?\s*)?(?:department\s+of\b.*|(?:loyola\s+)?academy\b.*|.*\b(?:college|university|institute|academy)\b.*|page\s+\d+(?:\s+of\s+\d+)?|\d{1,4})\s*$/i;
  return String(text || "").split(/\r?\n/)
    .filter((line) => !ignoredLine.test(line))
    .filter((line) => {
      const normalized = line.replace(/^\s*(?:[-*+].\s*)?/, "").replace(/\s+/g, " ").trim();
      return !/\bdepartments?\s+of\b/i.test(normalized) &&
        !/^(?:faculty|school|college|university|institute|academy)\b/i.test(normalized) &&
        !/\b(?:street|road|rd\.?|lane|avenue|sector|district|postal|pin\s*code|zip\s*code|old\s+alwal|secunderabad)\b/i.test(normalized) &&
        !/,\s*[^,]+\s*[-–]\s*\d{3,6}\s*$/i.test(normalized) &&
        !/\b(?:email|e-mail|phone|telephone|fax|www\.)\b/i.test(normalized) &&
        !/\b\d{6}\b/.test(normalized) &&
        !/^(?:copyright|all rights reserved|printed (?:on|in)|confidential)\b/i.test(normalized);
    })
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanLegacyImageInput(text) {
  let cleaned = String(text || "").trim();
  const analysisStart = cleaned.search(/(?:^|\s)(?:---\s*)?\*{0,2}Analysis Notes\b/i);
  if (analysisStart >= 0) cleaned = cleaned.slice(0, analysisStart).trim();
  if (/^(?:Based on the visual content|question,\s+likely from\b|the image comprises\b)/i.test(cleaned)) {
    const sourceHeading = cleaned.search(/\*\*(?:Question|Module|Course|Code Snippet)\*\*/i);
    if (sourceHeading >= 0) cleaned = cleaned.slice(sourceHeading);
  }
  cleaned = cleaned.replace(/\*\s*\*\*Format:\*\*[\s\S]*?(?=\s*\*\s*\*\*Main Content|\*\*Question\*\*|\*\*Module\b|$)/i, " ");
  cleaned = cleaned.replace(/\*\s*\*\*Main Content(?:\s*\([^)]*\))?:\*\*\s*/i, " ");
  cleaned = cleaned.replace(/\*\s*\*\*Cropped Section(?:\s*\([^)]*\))?:\*\*[\s\S]*$/i, "");
  cleaned = cleaned.replace(/^\*\*Heading:\s*([^*]+)\*\*\s*/i, "$1\n");
  cleaned = cleaned.replace(/\bThe image (?:presents|shows|displays|contains)\b[^.:\n]*[.:]\s*/gi, " ");
  cleaned = cleaned.replace(/\bThe question is a multiple-choice format with[^.:\n]*[.:]\s*/gi, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

function isMissingVisionSetup(error) {
  return error.message.includes("Groq is not configured") ||
    error.message.includes("Failed to fetch") ||
    error.message.includes("Image analysis needs the local StudyBuddy server");
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The image could not be read by this browser.")));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (supportedTypes.includes(file.type)) return file;
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot convert that image format.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const convertedImage = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("This browser could not convert that image format.")),
        "image/jpeg",
        0.92,
      );
    });
    return new File([convertedImage], "study-image.jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function splitIntoTopics(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const markdownContext = [];
  let moduleContext = "";
  let sectionContext = "";
  const structuredTopics = [];
  let currentStructuredTopic = null;
  const finishStructuredTopic = () => {
    if (!currentStructuredTopic) return;
    const content = currentStructuredTopic.lines.join("\n").trim();
    const parts = splitTopicContent(content, MAX_TOPIC_CHARS);
    parts.forEach((part, partIndex) => {
      structuredTopics.push({
        content: part,
        title: `${currentStructuredTopic.title}${parts.length > 1 ? ` (Part ${partIndex + 1})` : ""}`,
        question: getQuestionSentence(part),
      });
    });
    currentStructuredTopic = null;
  };
  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      finishStructuredTopic();
      const level = heading[1].length;
      markdownContext.length = level;
      markdownContext[level - 1] = heading[2].trim();
      continue;
    }
    const moduleHeading = line.match(/^\s*(?:\*\*)?Module\s+([IVXLCDM]+|\d+)\s*:\s*(.+?)(?:\*\*)?\s*$/i);
    if (moduleHeading) {
      finishStructuredTopic();
      moduleContext = `Module ${moduleHeading[1]}: ${moduleHeading[2].trim()}`;
      sectionContext = "";
      markdownContext.length = 0;
      continue;
    }
    const sectionTitle = line.match(/^\s*(?:\*\*)?([^:*].{1,99}?):(?:\*\*)?\s*$/);
    if (sectionTitle && !/^\s*[-*+]\s+/.test(line)) {
      finishStructuredTopic();
      sectionContext = sectionTitle[1].trim();
      continue;
    }
    const listMarker = /^\s*(?:[-*+•‣▪◦]|\d+[.)])\s+/;
    const boldSubtopic = line.match(/^\s*(?:[-*+•‣▪◦]|\d+[.)])\s+\*\*(.+?):\*\*\s*(.*)$/);
    const bullet = line.match(/^\s*(?:[-*+•‣▪◦]|\d+[.)])\s+(.+?)\s*$/);
    const plainTopicLine = line.trim();
    const isStandaloneTopic = !listMarker.test(line) &&
      !/[.!?]\s+\S/.test(plainTopicLine) &&
      !/[.!?]$/.test(plainTopicLine) &&
      plainTopicLine.length <= 120 &&
      plainTopicLine.split(/\s+/).length <= 14 &&
      (moduleContext || markdownContext.some(Boolean) || sectionContext);
    const isCommaList = !listMarker.test(line) &&
      plainTopicLine.includes(",") &&
      !/[.!?]\s+\S/.test(plainTopicLine);
    if (boldSubtopic || bullet || isStandaloneTopic || isCommaList) {
      finishStructuredTopic();
      const context = [moduleContext, ...markdownContext.filter(Boolean), sectionContext].filter(Boolean);
      const bulletText = boldSubtopic
        ? boldSubtopic[1].trim()
        : bullet
          ? bullet[1].replace(/\*\*/g, "").replace(/:$/, "").trim()
          : plainTopicLine.replace(/[.;]+$/, "").trim();
      const introducesProtection = !boldSubtopic && !isStandaloneTopic && !isCommaList && /\s+Protection Goal\s*$/i.test(bulletText);
      const topicText = introducesProtection ? bulletText.replace(/\s+Protection Goal\s*$/i, "").trim() : bulletText;
      const subtopics = boldSubtopic || isStandaloneTopic
        ? [topicText]
        : topicText.split(/\s*,\s*|\s+and\s+(?=[A-Z0-9])/).map((subtopic) => subtopic.replace(/^and\s+/i, "").replace(/[.;]+$/, "").trim()).filter(Boolean);
      subtopics.forEach((subtopic) => {
        finishStructuredTopic();
        currentStructuredTopic = {
          title: [...context, subtopic].join(" · "),
          lines: [...context, boldSubtopic ? `- ${subtopic}${boldSubtopic[2] ? `: ${boldSubtopic[2]}` : ""}` : `- ${subtopic}`],
        };
      });
      if (introducesProtection) {
        finishStructuredTopic();
        sectionContext = "Protection Goal";
      }
      continue;
    }
    if (currentStructuredTopic && line.trim()) currentStructuredTopic.lines.push(line.trim());
  }
  finishStructuredTopic();
  if (structuredTopics.length) return structuredTopics;

  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 35);
  const sections = paragraphs.length
    ? paragraphs
    : text
        .replace(/\r/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 35)
        .reduce((groups, sentence, index) => {
          if (index % 3 === 0) groups.push([]);
          groups[groups.length - 1].push(sentence);
          return groups;
        }, [])
        .map((group) => group.join(" "));

  const chunks = [];
  for (const section of sections) {
    const sectionChunks = splitTopicContent(section, MAX_TOPIC_CHARS);
    sectionChunks.forEach((content, index) => {
      chunks.push({
        content,
        part: sectionChunks.length > 1 ? index + 1 : null,
      });
    });
  }

  if (!chunks.length && text.trim()) chunks.push({ content: text.trim(), part: null });
  return chunks.map(({ content, part }, index) => ({
    content,
    title: `${getTopicTitle(content, index)}${part ? ` (Part ${part})` : ""}`,
    question: getQuestionSentence(content),
  }));
}

function splitTopicContent(content, maxLength) {
  if (content.length <= maxLength) return [content];
  const chunks = [];
  let current = "";
  const append = (text) => {
    const next = `${current}${current ? "\n" : ""}${text}`.trim();
    if (next.length <= maxLength) {
      current = next;
      return;
    }
    if (current) chunks.push(current);
    current = "";
    if (text.length <= maxLength) {
      current = text;
      return;
    }
    const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      if (trimmed.length > maxLength) {
        const words = trimmed.split(/\s+/);
        let fragment = "";
        for (const word of words) {
          if (`${fragment} ${word}`.trim().length > maxLength && fragment) {
            chunks.push(fragment);
            fragment = word;
          } else {
            fragment = `${fragment} ${word}`.trim();
          }
        }
        current = fragment;
      } else if (`${current} ${trimmed}`.trim().length > maxLength && current) {
        chunks.push(current);
        current = trimmed;
      } else {
        current = `${current} ${trimmed}`.trim();
      }
    }
  };
  for (const line of content.split("\n")) {
    if (line.trim()) append(line.trim());
  }
  if (current) chunks.push(current);
  return chunks;
}

function getTopicTitle(content, index) {
  const firstSentence = (content.match(/^.{1,100}?(?:[.!?](?=\s|$)|$)/) || [content])[0];
  const words = firstSentence
    .replace(/^[\s#\d.*-]+/, "")
    .split(/\s+/)
    .filter(Boolean);
  const title = words.slice(0, 7).join(" ").replace(/[.,:;!?]+$/, "");
  return title.length > 5 ? title : `Topic ${index + 1}`;
}

function getQuestionSentence(content) {
  const candidates = content.match(/[^.!?]+[.!?]+/g) || [content];
  return (
    candidates
      .map((sentence) => sentence.trim())
      .find((sentence) => sentence.split(/\s+/).length >= 7 && sentence.length <= 260) ||
    candidates[0].trim().slice(0, 260)
  );
}

function renderDailyHours(dayCount, previousHours = []) {
  const count = Math.min(MAX_STUDY_DAYS, Math.max(1, Number(dayCount) || 1));
  dailyHoursList.innerHTML = Array.from({ length: count }, (_, index) => {
    const hours = Number(previousHours[index]);
    const value = Number.isFinite(hours) && hours >= 0.5 && hours <= 12 ? hours : 1;
    return `
      <div class="daily-hours-item">
        <label class="field-label" for="day-hours-${index}">Day ${index + 1}</label>
        <div class="hours-input-wrap">
          <input class="number-input day-hours-input" id="day-hours-${index}" type="number" min="0.5" max="12" step="0.5" value="${value}" required />
          <span>hours</span>
        </div>
      </div>`;
  }).join("");
}

function readDailyHours() {
  return [...dailyHoursList.querySelectorAll(".day-hours-input")].map((input) => Number(input.value));
}

function resetDailyHoursForImage() {
  const dayCount = Math.min(MAX_STUDY_DAYS, Math.max(1, Number(studyDaysInput.value) || 1));
  state.schedule = Array(dayCount).fill(1);
  renderDailyHours(dayCount, state.schedule);
}

function buildDailyTopicSchedule(topics, hoursByDay) {
  const days = hoursByDay.map((hours, index) => ({ day: index + 1, hours, topics: [] }));
  const topicCounts = days.map(() => 0);
  if (topics.length < days.length) {
    for (let index = 0; index < topics.length; index += 1) topicCounts[index] = 1;
  } else if (days.length) {
    topicCounts.fill(1);
    const remainingTopics = topics.length - days.length;
    const totalHours = hoursByDay.reduce((total, hours) => total + hours, 0);
    const allocations = hoursByDay.map((hours, index) => {
      const exact = remainingTopics * hours / totalHours;
      const whole = Math.floor(exact);
      topicCounts[index] += whole;
      return { index, remainder: exact - whole };
    });
    const unassigned = topics.length - topicCounts.reduce((total, count) => total + count, 0);
    allocations.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
    for (let index = 0; index < unassigned; index += 1) topicCounts[allocations[index].index] += 1;
  }

  let topicIndex = 0;
  days.forEach((day, dayIndex) => {
    for (let count = 0; count < topicCounts[dayIndex]; count += 1) {
      day.topics.push({ topic: topics[topicIndex], topicIndex });
      topicIndex += 1;
    }
  });
  if (topics.length && days.length > topics.length) {
    for (let dayIndex = topics.length; dayIndex < days.length; dayIndex += 1) {
      const topicIndex = (dayIndex - topics.length) % topics.length;
      days[dayIndex].topics.push({ topic: topics[topicIndex], topicIndex, review: true });
    }
  }
  return days;
}

function formatHours(hours) {
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? "hour" : "hours"}`;
}

function createPlan(material, schedule, topics = splitIntoTopics(material), inputMaterial = material, inputKind = "text", examDate = "", imageId = null) {
  state.planId = createPlanId();
  state.imageId = imageId;
  state.material = material;
  state.inputMaterial = inputMaterial;
  state.inputKind = inputKind;
  state.topics = topics;
  state.schedule = schedule;
  state.examDate = examDate;
  state.memoryStyle = "mixed";
  state.currentLesson = 0;
  state.completedLessons = new Set();
  state.masteryChecks = {};
  state.topicAssessment = {};
  state.lessonFeedback = {};
  state.spacedReviews = {};
  state.activeSpacedReview = null;
  state.answers = [];
  state.questions = [];
  renderLearningRoom();
  showView("learn");
  saveProgress(true);
}

function lessonMinutes(topicIndex = state.currentLesson) {
  const day = buildDailyTopicSchedule(state.topics, state.schedule)
    .find((scheduledDay) => scheduledDay.topics.some((scheduledTopic) => scheduledTopic.topicIndex === topicIndex));
  return Math.max(2, Math.floor(((day?.hours || 0.5) * 60 * 0.72) / Math.max(day?.topics.length || 1, 1)));
}

function isStudyDayLocked(dayNumber) {
  return buildDailyTopicSchedule(state.topics, state.schedule).some((day) =>
    day.day < dayNumber && day.topics.some(({ topicIndex, review }) =>
      !review && !state.completedLessons.has(topicIndex)));
}

function canOpenLesson(topicIndex) {
  return topicIndex === state.currentLesson || state.completedLessons.has(topicIndex);
}

function renderSpacedReviewList() {
  const panel = document.querySelector("#spaced-review-list");
  const dueReviews = Object.entries(state.spacedReviews)
    .filter(([, review]) => Number(review.dueAt) <= Date.now())
    .sort((left, right) => Number(left[1].dueAt) - Number(right[1].dueAt));
  if (!dueReviews.length) {
    panel.innerHTML = "";
    return;
  }
  panel.innerHTML = `<p class="spaced-review-heading">READY TO REVIEW</p>${dueReviews.map(([topicIndex]) => `<button class="spaced-review-item" type="button" data-spaced-review="${topicIndex}">Quick recall · ${escapeHtml(state.topics[Number(topicIndex)]?.title || "Earlier topic")}</button>`).join("")}`;
  panel.querySelectorAll("[data-spaced-review]").forEach((button) => button.addEventListener("click", () => startSpacedReview(Number(button.dataset.spacedReview))));
}

function renderReadinessSummary() {
  const panel = document.querySelector("#readiness-panel");
  if (!panel) return;
  const assessed = Object.entries(state.topicAssessment)
    .map(([index, result]) => ({ index: Number(index), score: result.score }))
    .filter((result) => Number.isInteger(result.index) && result.index >= 0 && result.index < state.topics.length);
  const totalScore = assessed.reduce((total, result) => total + result.score, 0);
  const readiness = state.topics.length ? Math.round(totalScore / state.topics.length * 100) : 0;
  const weakTopics = assessed.filter((result) => result.score < 0.7).sort((left, right) => left.score - right.score);
  const dueReviews = Object.entries(state.spacedReviews)
    .filter(([, review]) => Number(review.dueAt) <= Date.now())
    .map(([index]) => Number(index));
  const focusTopics = [...new Set([...dueReviews, ...weakTopics.map((result) => result.index)])]
    .filter((index) => state.topics[index])
    .slice(0, 3);
  if (!focusTopics.length) {
    const nextTopic = state.topics.findIndex((_, index) => !state.completedLessons.has(index));
    if (nextTopic >= 0) focusTopics.push(nextTopic);
  }
  const focusLabel = dueReviews.length
    ? "Due for spaced recall"
    : weakTopics.length
      ? "Worth another look"
      : assessed.length === state.topics.length
        ? "No weak topics found"
        : "Next topic to learn";
  const noFocusMessage = assessed.length === state.topics.length && assessed.length
    ? "No weak topics right now. Revisit any topic whenever you like."
    : "Complete a lesson check to get a review recommendation.";
  panel.innerHTML = `
    <div class="readiness-heading"><strong>Study readiness</strong><span>${assessed.length ? `${readiness}%` : "Building"}</span></div>
    <p>${assessed.length} of ${state.topics.length} topics checked · estimate changes as you practise</p>
    <div class="readiness-bar" role="progressbar" aria-label="Estimated study readiness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${readiness}"><span style="width:${readiness}%"></span></div>
    <strong class="readiness-focus-label">${escapeHtml(focusLabel)}</strong>
    ${focusTopics.length
      ? `<div class="readiness-focus-list">${focusTopics.map((index) => `
        <button class="readiness-focus-item" type="button" data-readiness-topic="${index}">
          ${escapeHtml(state.topics[index].title)}
          ${Number.isFinite(state.topicAssessment[index]?.score) ? `<span>${Math.round(state.topicAssessment[index].score * 100)}%</span>` : ""}
        </button>`).join("")}</div>`
      : `<p class="readiness-no-focus">${escapeHtml(noFocusMessage)}</p>`}
    <small>Planning estimate from your checks, not an exam guarantee.</small>`;
  panel.querySelectorAll("[data-readiness-topic]").forEach((button) => button.addEventListener("click", () => {
    state.currentLesson = Number(button.dataset.readinessTopic);
    state.masteryCheckPage = false;
    renderLearningRoom();
    saveProgress(true);
  }));
}

function renderSpacedReviewChallenge() {
  const container = document.querySelector("#spaced-review-challenge");
  const active = state.activeSpacedReview;
  if (!container || !active) return;
  container.hidden = false;
  const topic = state.topics[active.topicIndex];
  if (active.loading) {
    container.innerHTML = '<p class="lesson-follow-up-loading" role="status">Preparing a fresh recall question…</p>';
    return;
  }
  if (active.error) {
    container.innerHTML = '<p class="lesson-error" role="alert">Could not prepare this review. Try again.</p><button class="secondary-button" id="retry-spaced-review" type="button">Retry review</button>';
    container.querySelector("#retry-spaced-review").addEventListener("click", () => startSpacedReview(active.topicIndex));
    return;
  }
  const question = active.question;
  if (!question) return;
  if (active.answered) {
    container.innerHTML = `<strong>${active.correct ? "Nice recall!" : "Let’s revisit this again tomorrow."}</strong><p>${escapeHtml(question.explanation)}</p><button class="secondary-button" id="finish-spaced-review" type="button">Finish review</button>`;
    container.querySelector("#finish-spaced-review").addEventListener("click", () => finishSpacedReview(active.topicIndex, active.correct));
    return;
  }
  container.innerHTML = `<strong>Spaced review · ${escapeHtml(topic.title)}</strong><p>${escapeHtml(question.prompt)}</p><div class="mastery-options">${question.options.map((option, index) => `<button class="secondary-button ${active.selected === index ? "selected" : ""}" type="button" data-spaced-option="${index}">${escapeHtml(option)}</button>`).join("")}</div><button class="secondary-button" id="answer-spaced-review" type="button" ${Number.isInteger(active.selected) ? "" : "disabled"}>Check recall</button>`;
  container.querySelectorAll("[data-spaced-option]").forEach((button) => button.addEventListener("click", () => {
    active.selected = Number(button.dataset.spacedOption);
    container.querySelectorAll("[data-spaced-option]").forEach((option) => option.classList.toggle("selected", option === button));
    container.querySelector("#answer-spaced-review").disabled = false;
    saveProgress();
  }));
  container.querySelector("#answer-spaced-review").addEventListener("click", () => {
    active.correct = active.selected === question.answerIndex;
    active.answered = true;
    saveProgress(true);
    renderSpacedReviewChallenge();
  });
}

async function startSpacedReview(topicIndex) {
  const topic = state.topics[topicIndex];
  if (!topic) return;
  state.activeSpacedReview = { topicIndex, loading: true };
  saveProgress(true);
  renderLearningRoom();
  try {
    const response = await fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "single", questionCount: 1, topics: [{ title: topic.title, lesson: topic.lesson, content: topic.content, topicIndex }] }),
    });
    const result = await response.json();
    const question = result.questions?.[0];
    if (!response.ok || !question || question.type !== "mcq" || question.options?.length !== 4) throw new Error(FRIENDLY_ERROR);
    state.activeSpacedReview = { topicIndex, question, selected: null, answered: false };
    await saveProgress(true);
  } catch (error) {
    console.error("Could not prepare spaced review.", error);
    state.activeSpacedReview = { topicIndex, error: true };
  }
  renderLearningRoom();
}

function finishSpacedReview(topicIndex, correct) {
  const review = state.spacedReviews[topicIndex];
  if (!review) return;
  review.reviewsCompleted = (review.reviewsCompleted || 0) + 1;
  review.intervalDays = correct ? Math.min(30, Math.max(1, (review.intervalDays || 1) * 2 + 1)) : 1;
  review.dueAt = Date.now() + review.intervalDays * 86_400_000;
  review.lastResult = correct ? "recalled" : "needs-review";
  state.activeSpacedReview = null;
  saveProgress(true);
  renderLearningRoom();
  showToast(correct ? `Next recall scheduled in ${review.intervalDays} days.` : "This topic is back in tomorrow’s review.");
}

function renderLearningRoom() {
  stopLessonSpeech();
  const list = document.querySelector("#lesson-list");
  list.innerHTML = buildDailyTopicSchedule(state.topics, state.schedule)
    .map((day) => `
      <section class="day-plan">
        <div class="day-plan-heading"><strong>Day ${day.day}</strong><span>${formatHours(day.hours)}</span></div>
        ${day.topics.length
          ? day.topics.map(({ topic, topicIndex, review }) => `
            <button class="lesson-list-item ${topicIndex === state.currentLesson ? "selected" : ""} ${state.completedLessons.has(topicIndex) ? "completed" : ""}" data-lesson="${topicIndex}" type="button" ${!canOpenLesson(topicIndex) || isStudyDayLocked(day.day) ? "disabled title=\"Complete topics in order to unlock this lesson\"" : ""}>
              <span class="lesson-number">${review ? "↻" : state.completedLessons.has(topicIndex) ? "✓" : String(topicIndex + 1).padStart(2, "0")}</span>
              <span class="lesson-item-title">${review ? `Review · ${escapeHtml(topic.title)}` : escapeHtml(topic.title)}</span>
            </button>`).join("")
          : '<p class="day-plan-empty">Review what you learned or take a break.</p>'}
      </section>`)
    .join("");
  list.querySelectorAll("[data-lesson]").forEach((button) =>
    button.addEventListener("click", () => {
      state.currentLesson = Number(button.dataset.lesson);
      state.masteryCheckPage = false;
      renderLearningRoom();
      saveProgress();
    }),
  );

  renderSpacedReviewList();
  renderReadinessSummary();
  const completed = state.completedLessons.size;
  const progressPercent = state.topics.length
    ? Math.round((completed / state.topics.length) * 100)
    : 0;
  document.querySelector("#lesson-progress-count").textContent = `${completed} / ${state.topics.length}`;
  document.querySelector("#lesson-progress-percent").textContent = `${progressPercent}%`;
  document.querySelector("#lesson-progress-track").setAttribute("aria-valuenow", String(progressPercent));
  document.querySelector("#lesson-progress-bar").style.width = `${progressPercent}%`;
  const totalHours = state.schedule.reduce((total, hours) => total + hours, 0);
  document.querySelector("#plan-time-label").textContent = `${state.schedule.length} ${state.schedule.length === 1 ? "day" : "days"} · ${formatHours(totalHours)} total`;
  const examDateLabel = state.examDate
    ? ` · Exam ${new Date(`${state.examDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  document.querySelector("#lesson-subtitle").textContent =
    `${state.topics.length} focused lesson pages across ${state.schedule.length} ${state.schedule.length === 1 ? "day" : "days"}${examDateLabel} · Follow lessons in order`;

  const topic = state.topics[state.currentLesson];
  const lessonContent = document.querySelector("#lesson-content");
  lessonContent.innerHTML = `
    <div class="lesson-meta">LESSON PAGE ${String(state.currentLesson + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
    <h2>${escapeHtml(topic.title)}</h2>
    <p class="lesson-intro">Your allocated study time helps shape the depth of this lesson. Your tutor is preparing connected ideas, a worked example, and a quick self-check.</p>
    <div class="lesson-loading" role="status" aria-live="polite"><span class="lesson-spinner" aria-hidden="true"></span><span>Building your lesson from your study material…</span></div>
  `;
  document.querySelector("#prev-lesson").disabled = state.currentLesson === 0 || state.completedLessons.size > 0;
  document.querySelector("#prev-lesson").style.opacity = document.querySelector("#prev-lesson").disabled ? ".5" : "1";
  const nextButton = document.querySelector("#next-lesson");
  nextButton.disabled = true;
  nextButton.innerHTML =
    state.currentLesson === state.topics.length - 1
      ? 'Start my quick check <span class="button-arrow" aria-hidden="true">→</span>'
      : 'I’ve got this <span class="button-arrow" aria-hidden="true">→</span>';
  if (topic.lesson) {
    showLesson(topic.lesson, topic, lessonContent, nextButton);
  } else {
    loadLesson(topic, state.currentLesson, lessonContent, nextButton);
  }
}

async function loadLesson(topic, topicIndex, lessonContent, nextButton) {
  try {
    const lesson = topic.lesson || await getTopicLesson(topic, true);
    if (state.currentLesson !== topicIndex || state.topics[topicIndex] !== topic) return;
    showLesson(lesson, topic, lessonContent, nextButton);
  } catch (error) {
    if (state.currentLesson !== topicIndex || state.topics[topicIndex] !== topic) return;
    console.error("Could not load lesson.", error);
    const lessonError = error instanceof Error && error.message && error.message !== FRIENDLY_ERROR
      ? error.message
      : FRIENDLY_ERROR;
    lessonContent.innerHTML = `
      <div class="lesson-meta">LESSON PAGE ${String(topicIndex + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
      <h2>${escapeHtml(topic.title)}</h2>
      <p class="lesson-intro">StudyBuddy couldn’t create the teaching lesson, so it hasn’t replaced it with a planner or raw notes.</p>
      <div class="lesson-error" role="alert">${escapeHtml(lessonError)}</div>
      <button class="secondary-button" id="retry-lesson" type="button">Try lesson again</button>`;
    lessonContent.querySelector("#retry-lesson").addEventListener("click", () => {
      lessonContent.innerHTML = '<div class="lesson-loading" role="status"><span class="lesson-spinner" aria-hidden="true"></span><span>Trying again…</span></div>';
      loadLesson(topic, topicIndex, lessonContent, nextButton);
    });
  }
}

function getTopicLesson(topic, retryRateLimit, feedback = "") {
  if (topic.lesson && !feedback) return Promise.resolve(topic.lesson);
  if (topic.lessonPromise) return topic.lessonPromise;
  topic.lessonPromise = (async () => {
    const topicIndex = state.topics.indexOf(topic);
    for (let attempt = 0; attempt < (retryRateLimit ? 2 : 1); attempt += 1) {
      const response = await fetch("/api/generate-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material: topic.content,
          topic: topic.title,
          memoryStyle: "A bit of everything",
          minutes: lessonMinutes(topicIndex >= 0 ? topicIndex : state.currentLesson),
          feedback,
        }),
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error(`The lesson service returned an unreadable response (HTTP ${response.status}).`);
      }
      const requestTooLarge = /request too large|requested output tokens exceed|expected output tokens exceed/i
        .test(result.error || "");
      if (response.status === 429 && attempt === 0 && retryRateLimit && !requestTooLarge) {
        const retryMatch = (result.error || "").match(/try again in\s+([\d.]+)\s*s/i);
        const waitMs = retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) + 500 : 15_000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 90_000)));
        continue;
      }
      if (!response.ok) {
        throw new Error(typeof result.error === "string" && result.error.trim()
          ? result.error
          : `The lesson service could not create this lesson (HTTP ${response.status}).`);
      }
      if (
        !result.lesson ||
        typeof result.lesson.explanation !== "string" ||
        !Array.isArray(result.lesson.detailedSections) ||
        !Array.isArray(result.lesson.keyTerms) ||
        !Array.isArray(result.lesson.keyPoints) ||
        !Array.isArray(result.lesson.commonMistakes) ||
        !Array.isArray(result.lesson.recap)
      ) {
        throw new Error("The lesson service returned an incomplete lesson. Please try again.");
      }
      topic.lesson = result.lesson;
      if (topicIndex >= 0 && !result.lesson.truncated) {
        saveProgress(true);
      }
      return topic.lesson;
    }
    throw new Error(FRIENDLY_ERROR);
  })().finally(() => {
    topic.lessonPromise = null;
  });
  return topic.lessonPromise;
}

function showLesson(lesson, topic, lessonContent, nextButton) {
  const lessonIndex = state.currentLesson;
  lessonContent.innerHTML = `
    <div id="lesson-reading-page">
    <div class="lesson-meta">LESSON PAGE ${String(state.currentLesson + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
    <h2>${escapeHtml(topic.title)}</h2>
    <p class="lesson-intro">A focused lesson page based on your study material.</p>
    <div class="lesson-tools">
      <button class="secondary-button" id="listen-lesson" type="button">Listen</button>
      <button class="secondary-button" id="stop-lesson-speech" type="button" disabled>Stop</button>
      <button class="secondary-button" id="print-study-plan" type="button">Print / save as PDF</button>
      <span class="speech-status" id="speech-status" role="status" aria-live="polite"></span>
    </div>
    ${lesson.truncated ? `<p class="lesson-error" role="status">${FRIENDLY_ERROR}</p><button class="secondary-button" id="retry-short-lesson" type="button">Try lesson again</button>` : ""}
    <section class="lesson-block lesson-detail-section"><h3>Understand this topic</h3>${renderLessonBullets(lesson.content || lesson.explanation)}</section>
    ${renderLessonVisual(lesson.visual, lesson.visualWarning)}
    <section class="spaced-review-challenge" id="spaced-review-challenge" hidden></section>
    ${renderSourceEvidence(topic.content, `${topic.title} ${lesson.content || lesson.explanation}`)}
    <div class="reflection-box"><label for="reflection-input">Which part of this topic would you like explained further?</label><textarea id="reflection-input" rows="2" maxlength="500" placeholder="Name a term, idea, or step you want me to explain…"></textarea><button class="secondary-button" id="explain-part" type="button">Explain this part</button><div class="follow-up-answer" id="follow-up-answer" aria-live="polite"></div></div>
    <section class="lesson-feedback" id="lesson-feedback"><strong>Was this lesson helpful?</strong><button class="secondary-button" type="button" data-lesson-feedback="helpful">Yes</button><button class="secondary-button" type="button" data-lesson-feedback="needs-work">Needs work</button><span class="lesson-feedback-status" aria-live="polite"></span><textarea rows="2" maxlength="300" placeholder="What should be clearer? (optional)" hidden></textarea></section>
    </div>
    <section class="mastery-check" id="mastery-check" aria-live="polite" hidden></section>
  `;
  nextButton.disabled = false;
  const check = state.masteryChecks[state.currentLesson];
  const isOnCheckPage = state.masteryCheckPage;
  lessonContent.querySelector("#lesson-reading-page").hidden = isOnCheckPage;
  nextButton.textContent = isOnCheckPage
    ? check?.passed ? "Continue to next topic" : check?.answered ? "Try another check" : "Check answer"
    : "Continue to mastery check";
  renderMasteryCheck(topic, state.currentLesson, lessonContent, nextButton);
  lessonContent.querySelector("#mastery-check").hidden = !isOnCheckPage;
  renderSpacedReviewChallenge();
  const listenButton = lessonContent.querySelector("#listen-lesson");
  const stopButton = lessonContent.querySelector("#stop-lesson-speech");
  const speechStatus = lessonContent.querySelector("#speech-status");
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    listenButton.disabled = true;
    speechStatus.textContent = "Read-aloud is not available in this browser.";
  } else {
    listenButton.addEventListener("click", () => {
      stopLessonSpeech();
      const utterance = new SpeechSynthesisUtterance(
        `${topic.title}. ${(lesson.content || lesson.explanation).replace(/(^|\n)\s*-\s/g, "$1").replace(/[*_`#]/g, "")}`,
      );
      utterance.lang = "en-US";
      utterance.onstart = () => {
        listenButton.disabled = true;
        stopButton.disabled = false;
        speechStatus.textContent = "Reading this lesson aloud.";
      };
      utterance.onend = () => {
        listenButton.disabled = false;
        stopButton.disabled = true;
        speechStatus.textContent = "";
      };
      utterance.onerror = (event) => {
        listenButton.disabled = false;
        stopButton.disabled = true;
        speechStatus.textContent = event.error === "canceled" ? "" : "Could not read this lesson aloud.";
      };
      window.speechSynthesis.speak(utterance);
    });
    stopButton.addEventListener("click", () => {
      stopLessonSpeech();
      listenButton.disabled = false;
      stopButton.disabled = true;
      speechStatus.textContent = "";
    });
  }
  lessonContent.querySelector("#print-study-plan").addEventListener("click", printStudyPlan);
  lessonContent.querySelector("#explain-part").addEventListener("click", () => explainLessonPart(topic, lessonContent));
  const savedFeedback = state.lessonFeedback[state.currentLesson];
  const feedbackStatus = lessonContent.querySelector(".lesson-feedback-status");
  const feedbackNote = lessonContent.querySelector(".lesson-feedback textarea");
  if (savedFeedback) {
    feedbackStatus.textContent = "Thanks, your feedback is saved.";
    feedbackNote.hidden = savedFeedback.rating !== "needs-work";
    feedbackNote.value = savedFeedback.note || "";
  }
  lessonContent.querySelectorAll("[data-lesson-feedback]").forEach((button) => {
    button.addEventListener("click", () => {
      const rating = button.dataset.lessonFeedback;
      state.lessonFeedback[state.currentLesson] = { rating, note: feedbackNote.value.trim() };
      feedbackNote.hidden = rating !== "needs-work";
      feedbackStatus.textContent = "Thanks, your feedback is saved.";
      saveProgress(true);
      if (rating === "needs-work") {
        lessonContent.querySelectorAll("[data-lesson-feedback]").forEach((feedbackButton) => { feedbackButton.disabled = true; });
        feedbackStatus.textContent = "Updating this lesson based on your feedback…";
        nextButton.disabled = true;
        getTopicLesson(topic, true, feedbackNote.value.trim() || "Explain this more clearly using simpler wording and a concrete example.")
          .then((improvedLesson) => {
            if (state.currentLesson !== lessonIndex || state.topics[lessonIndex] !== topic) return;
            showLesson(improvedLesson, topic, lessonContent, nextButton);
            const status = lessonContent.querySelector(".lesson-feedback-status");
            if (status) status.textContent = "Lesson updated from your feedback.";
          })
          .catch(() => {
            if (state.topics[state.currentLesson] !== topic) return;
            lessonContent.querySelectorAll("[data-lesson-feedback]").forEach((feedbackButton) => { feedbackButton.disabled = false; });
            feedbackStatus.textContent = "Feedback saved, but the lesson could not be updated. Try Needs work again.";
            nextButton.disabled = false;
          });
      }
    });
  });
  feedbackNote.addEventListener("input", () => {
    const feedback = state.lessonFeedback[state.currentLesson];
    if (!feedback) return;
    feedback.note = feedbackNote.value.slice(0, 300);
    saveProgress();
  });
  const retryButton = lessonContent.querySelector("#retry-short-lesson");
  if (retryButton) {
    retryButton.addEventListener("click", () => {
      topic.lesson = null;
      nextButton.disabled = true;
      lessonContent.innerHTML = '<div class="lesson-loading" role="status"><span class="lesson-spinner" aria-hidden="true"></span><span>Retrying this lesson…</span></div>';
      loadLesson(topic, state.currentLesson, lessonContent, nextButton);
    });
  }
}

function renderMasteryCheck(topic, topicIndex, lessonContent, nextButton) {
  const container = lessonContent.querySelector("#mastery-check");
  const check = state.masteryChecks[topicIndex];
  if (!check?.question) {
    container.innerHTML = "<strong>Quick mastery check</strong><p>Answer one question to complete this topic and unlock the next one.</p>";
    return;
  }
  const question = check.question;
  if (check.passed) {
    container.innerHTML = `<strong>Topic mastered ✓</strong><p>${escapeHtml(question.explanation)}</p>`;
    nextButton.textContent = topicIndex === state.topics.length - 1 ? "Continue to final review" : "Continue to next topic";
    nextButton.disabled = false;
    return;
  }
  container.innerHTML = `
    <strong>Quick mastery check</strong><p>${escapeHtml(question.prompt)}</p>
    <div class="mastery-options">${question.options.map((option, index) => `<button class="secondary-button ${check.selected === index ? "selected" : ""} ${check.answered && index === question.answerIndex ? "mastery-correct" : check.answered && index === check.selected ? "mastery-incorrect" : ""}" type="button" data-mastery-option="${index}" ${check.answered ? "disabled" : ""}>${escapeHtml(option)}</button>`).join("")}</div>
    <p class="mastery-feedback" aria-live="polite">${check.answered ? check.passed ? `Correct. ${escapeHtml(question.explanation)}` : `Not yet. Correct answer: ${escapeHtml(question.options[question.answerIndex])}. ${escapeHtml(question.explanation)}` : "Choose an answer, then check it."}</p>
    <button class="secondary-button" id="submit-mastery-check" type="button" ${Number.isInteger(check.selected) && !check.answered ? "" : "disabled"}>Check answer</button>
    ${check.answered ? '<button class="secondary-button" id="retry-mastery-check" type="button">Try another question</button>' : ""}
  `;
  container.querySelectorAll("[data-mastery-option]").forEach((button) => button.addEventListener("click", () => {
    if (check.answered) return;
    check.selected = Number(button.dataset.masteryOption);
    container.querySelectorAll("[data-mastery-option]").forEach((option) => option.classList.toggle("selected", option === button));
    container.querySelector("#submit-mastery-check").disabled = false;
    saveProgress();
  }));
  const submitButton = container.querySelector("#submit-mastery-check");
  if (!check.answered) submitButton.addEventListener("click", () => {
    if (!Number.isInteger(check.selected)) return;
    check.answered = true;
    check.passed = check.selected === question.answerIndex;
    check.attempts = (check.attempts || 0) + 1;
    state.topicAssessment[topicIndex] = { score: check.passed ? 1 : 0, updatedAt: Date.now() };
    if (check.passed) {
      state.completedLessons.add(topicIndex);
      state.spacedReviews[topicIndex] = state.spacedReviews[topicIndex] || {
        intervalDays: 1,
        dueAt: Date.now() + 86_400_000,
        reviewsCompleted: 0,
      };
    }
    saveProgress(true);
    renderLearningRoom();
  });
  const retryButton = container.querySelector("#retry-mastery-check");
  if (retryButton) retryButton.addEventListener("click", () => beginMasteryCheck(topic, topicIndex, lessonContent, nextButton));
  nextButton.textContent = container.hidden
    ? "Continue to mastery check"
    : check.answered ? "Try another check" : "Check answer";
  nextButton.disabled = false;
}

async function beginMasteryCheck(topic, topicIndex, lessonContent, nextButton) {
  const existing = state.masteryChecks[topicIndex];
  nextButton.disabled = true;
  nextButton.textContent = "Preparing check…";
  lessonContent.querySelector("#mastery-check").innerHTML = '<p class="lesson-follow-up-loading" role="status">Preparing a question from this lesson…</p>';
  try {
    const response = await fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "single",
        questionCount: 1,
        topics: [{ title: topic.title, lesson: topic.lesson, content: topic.content, topicIndex }],
      }),
    });
    const result = await response.json();
    const question = result.questions?.[0];
    if (!response.ok || !question || question.type !== "mcq" || question.options?.length !== 4) throw new Error(FRIENDLY_ERROR);
    state.masteryChecks[topicIndex] = { question, attempts: existing?.attempts || 0, selected: null, answered: false, passed: false };
    await saveProgress(true);
    renderMasteryCheck(topic, topicIndex, lessonContent, nextButton);
  } catch (error) {
    console.error("Could not prepare the mastery check.", error);
    lessonContent.querySelector("#mastery-check").innerHTML = `<p class="lesson-error" role="alert">${FRIENDLY_ERROR}</p><button class="secondary-button" id="retry-mastery-check" type="button">Try again</button>`;
    lessonContent.querySelector("#retry-mastery-check").addEventListener("click", () => beginMasteryCheck(topic, topicIndex, lessonContent, nextButton));
    nextButton.disabled = true;
    nextButton.textContent = "Check unavailable";
  }
}

async function explainLessonPart(topic, lessonContent) {
  const questionInput = lessonContent.querySelector("#reflection-input");
  const explainButton = lessonContent.querySelector("#explain-part");
  const answer = lessonContent.querySelector("#follow-up-answer");
  const question = questionInput.value.trim();
  if (!question) {
    questionInput.focus();
    answer.innerHTML = '<p class="lesson-error" role="alert">Tell me which part you want explained first.</p>';
    return;
  }
  explainButton.disabled = true;
  answer.innerHTML = '<p class="lesson-follow-up-loading" role="status">Preparing a focused explanation…</p>';
  try {
    const response = await fetch("/api/explain-part", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: topic.content, topic: topic.title, question }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(FRIENDLY_ERROR);
    }
    if (typeof result.explanation !== "string" || !result.explanation.trim()) {
      throw new Error(FRIENDLY_ERROR);
    }
    answer.innerHTML = `<section class="lesson-follow-up"><h3>Here’s a closer explanation</h3>${splitReadable(result.explanation).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`;
  } catch (error) {
    console.error("Could not prepare follow-up explanation.", error);
    answer.innerHTML = `<p class="lesson-error" role="alert">${FRIENDLY_ERROR}</p>`;
  } finally {
    explainButton.disabled = false;
  }
}

function renderLessonVisual(visual, warning) {
  if (!visual) {
    return warning
      ? `<p class="lesson-intro lesson-visual-warning" role="status">${escapeHtml(warning)}</p>`
      : "";
  }
  if (visual.kind === "flowchart") {
    return `
      <figure class="lesson-visual lesson-flowchart">
        <figcaption><span class="lesson-visual-label">VISUAL GUIDE · PROCESS</span><strong>${escapeHtml(visual.title)}</strong></figcaption>
        <ol>${visual.steps.map((step, index) => `
          <li><span class="flow-step-number">${index + 1}</span><div><strong>${escapeHtml(step.title)}</strong><p>${escapeHtml(step.detail)}</p></div></li>`).join("")}</ol>
      </figure>`;
  }
  if (visual.kind === "concept-map") {
    return `
      <figure class="lesson-visual lesson-concept-map">
        <figcaption><span class="lesson-visual-label">VISUAL GUIDE · CONCEPT MAP</span><strong>${escapeHtml(visual.title)}</strong></figcaption>
        <div class="concept-center"><strong>${escapeHtml(visual.center.title)}</strong><p>${escapeHtml(visual.center.detail)}</p></div>
        <ul>${visual.branches.map((branch) => `
          <li><span class="concept-relation">${escapeHtml(branch.relation)}</span><strong>${escapeHtml(branch.title)}</strong><p>${escapeHtml(branch.detail)}</p></li>`).join("")}
        </ul>
      </figure>`;
  }
  return "";
}

function splitReadable(content) {
  return content
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function findSourceExcerpt(source, query) {
  const stopWords = new Set(["about", "after", "again", "also", "among", "because", "before", "being", "between", "could", "does", "during", "each", "from", "have", "into", "more", "most", "other", "should", "than", "that", "their", "there", "these", "they", "this", "through", "under", "using", "what", "when", "where", "which", "while", "with", "would", "your"]);
  const queryTerms = new Set((query.match(/[a-z0-9]{3,}/gi) || [])
    .map((term) => term.toLowerCase())
    .filter((term) => !stopWords.has(term)));
  if (!source.trim() || !queryTerms.size) return "";
  const passages = source.match(/[^.!?\r\n]+(?:[.!?]+|$)/g) || [source];
  const ranked = passages.map((passage, index) => {
    const text = passage.trim();
    const terms = new Set((text.match(/[a-z0-9]{3,}/gi) || []).map((term) => term.toLowerCase()));
    return { text, index, score: [...queryTerms].filter((term) => terms.has(term)).length };
  }).filter((passage) => passage.text && passage.text.length <= 600 && passage.score > 0);
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked.slice(0, 2).sort((left, right) => left.index - right.index).map((passage) => passage.text).join(" ");
}

function renderSourceEvidence(source, query, savedExcerpt = "") {
  const excerpt = savedExcerpt || findSourceExcerpt(source, query);
  return `
    <details class="source-evidence lesson-source">
      <summary>Check a related passage in your notes</summary>
      ${excerpt
        ? `<p>Matched from your source notes to help you verify the explanation.</p><blockquote>${escapeHtml(excerpt)}</blockquote>`
        : "<p>No short matching passage was found. Compare the explanation with the full topic notes.</p>"}
      <details class="source-evidence-full">
        <summary>View all notes for this topic</summary>
        <p>${splitReadable(source).map(escapeHtml).join("\n\n")}</p>
      </details>
    </details>`;
}

async function buildQuiz() {
  const incompleteIndex = state.topics.findIndex((topic, index) =>
    !state.completedLessons.has(index),
  );
  if (incompleteIndex >= 0) {
    state.currentLesson = incompleteIndex;
    renderLearningRoom();
    showView("learn");
    showToast("Complete each lesson before starting the quiz.");
    return;
  }
  state.questions = [];
  state.quizTopicIndices = state.topics.map((_, index) => index);
  state.quizTotalQuestions = 0;
  state.quizSetupOpen = true;
  state.currentQuestion = 0;
  state.answers = [];
  state.selectedOption = null;
  state.problemAnswer = "";
  state.problemSolutionRevealed = false;
  showQuizSetup();
}

function showQuizSetup() {
  const setup = document.querySelector("#quiz-setup");
  const quizContent = document.querySelector("#quiz-content");
  const sizeInput = document.querySelector("#quiz-size");
  const allCheckbox = document.querySelector("#quiz-all");
  const topicCount = state.topics.length;
  state.quizSetupOpen = true;
  const maxQuestionCount = topicCount + 1;
  sizeInput.max = String(maxQuestionCount);
  sizeInput.value = String(Math.min(10, maxQuestionCount));
  allCheckbox.checked = false;
  sizeInput.disabled = false;
  document.querySelector("#quiz-all-label").textContent = `All lesson questions plus the applied scenario (${maxQuestionCount})`;
  setup.hidden = false;
  quizContent.hidden = true;
  document.querySelector("#quiz-count-chip").textContent = "CHOOSE QUIZ LENGTH";
  document.querySelector("#quiz-intro").textContent = `Choose the total quiz length, or include all ${topicCount} lessons plus the applied scenario.`;
  showView("quiz");
}

async function startSelectedQuiz() {
  const sizeInput = document.querySelector("#quiz-size");
  const useAll = document.querySelector("#quiz-all").checked;
  const count = useAll ? state.topics.length + 1 : Number(sizeInput.value);
  if (!useAll && (!Number.isInteger(count) || count < 1 || count > state.topics.length + 1)) {
    sizeInput.reportValidity();
    return;
  }
  const lessonQuestionCount = Math.min(Math.max(count - 1, 0), state.topics.length);
  const shuffledTopicIndices = shuffleArray(state.topics.map((_, index) => index));
  const selectedIndices = shuffledTopicIndices.slice(0, lessonQuestionCount);
  const remainingTopicIndices = shuffledTopicIndices.slice(lessonQuestionCount);
  state.quizAppliedTopicIndex = remainingTopicIndices.length
    ? remainingTopicIndices[0]
    : shuffledTopicIndices[Math.floor(Math.random() * shuffledTopicIndices.length)];
  await generateQuiz(selectedIndices, state.quizAppliedTopicIndex);
}

function shuffleArray(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
  }
  return shuffled;
}

function renderLessonBullets(content) {
  const rawPoints = String(content || "").replace(/\r/g, "").split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(?:[-*+•‣▪◦]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const points = rawPoints.flatMap(splitLongLessonPoint);
  return `<ul class="lesson-bullet-list">${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`;
}

function splitLongLessonPoint(point) {
  const sentences = point.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [point];
  const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount(point) <= 30) return [point];

  const shortPoints = [];
  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    if (wordCount(sentence) <= 30) {
      shortPoints.push(sentence);
      continue;
    }
    const clauses = sentence.split(/(?<=[,;:])\s+/).map((item) => item.trim()).filter(Boolean);
    if (clauses.length > 1 && clauses.every((item) => wordCount(item) <= 30)) {
      shortPoints.push(...clauses);
      continue;
    }
    const words = sentence.split(/\s+/);
    for (let index = 0; index < words.length; index += 27) {
      shortPoints.push(words.slice(index, index + 27).join(" "));
    }
  }
  return shortPoints.length ? shortPoints : [point];
}

async function generateQuiz(topicIndices, appliedTopicIndex) {
  state.quizSetupOpen = false;
  state.quizTopicIndices = topicIndices;
  if (Number.isInteger(appliedTopicIndex)) state.quizAppliedTopicIndex = appliedTopicIndex;
  state.quizTotalQuestions = state.quizTopicIndices.length + 1;
  state.questions = [];
  state.answers = [];
  state.currentQuestion = 0;
  state.selectedOption = null;
  state.problemAnswer = "";
  state.problemSolutionRevealed = false;
  await saveProgress(true);
  document.querySelector("#quiz-setup").hidden = true;
  document.querySelector("#quiz-content").hidden = false;
  showView("quiz");
  document.querySelector("#quiz-count-chip").textContent = "PREPARING YOUR QUIZ";
  document.querySelector("#quiz-intro").textContent =
    `One question at a time for your ${state.quizTotalQuestions} multiple-choice questions, including an applied scenario.`;
  await loadNextQuizQuestion();
}

async function loadNextQuizQuestion() {
  const quizContent = document.querySelector("#quiz-content");
  document.querySelector("#quiz-setup").hidden = true;
  quizContent.hidden = false;
  const questionIndex = state.questions.length;
  if (questionIndex >= state.quizTotalQuestions) {
    renderResults();
    return;
  }
  const isProblem = questionIndex === state.quizTopicIndices.length;
  const topicIndex = isProblem
    ? state.quizAppliedTopicIndex ?? state.quizTopicIndices[state.quizTopicIndices.length - 1]
    : state.quizTopicIndices[questionIndex];
  const topic = state.topics[topicIndex];
  document.querySelector("#quiz-count-chip").textContent = `LOADING QUESTION ${String(questionIndex + 1).padStart(2, "0")} / ${String(state.quizTotalQuestions).padStart(2, "0")}`;
  quizContent.innerHTML = '<div class="lesson-loading"><span class="lesson-spinner" aria-hidden="true"></span><span>Preparing one question…</span></div>';
  try {
    const response = await fetch("/api/generate-quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: isProblem ? "problem" : "single",
        questionCount: 1,
        topics: [{
          title: topic.title,
          lesson: topic.lesson,
          content: topic.content,
          topicIndex,
        }],
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(FRIENDLY_ERROR);
    }
    if (!Array.isArray(result.questions) || result.questions.length !== 1) {
      throw new Error(FRIENDLY_ERROR);
    }
    state.questions.push(result.questions[0]);
    state.currentQuestion = questionIndex;
    state.selectedOption = null;
    state.problemAnswer = "";
    state.problemSolutionRevealed = false;
    await saveProgress(true);
    renderQuestion();
  } catch (error) {
    console.error("Could not prepare the next quiz question.", error);
    quizContent.innerHTML = `<div class="lesson-error" role="alert">${FRIENDLY_ERROR}</div><button class="primary-button" id="retry-quiz-question" type="button">Try again</button>`;
    document.querySelector("#quiz-count-chip").textContent = `QUESTION ${String(questionIndex + 1).padStart(2, "0")} NOT READY`;
    document.querySelector("#retry-quiz-question").addEventListener("click", loadNextQuizQuestion);
  }
}

function renderQuestion() {
  document.querySelector("#quiz-setup").hidden = true;
  document.querySelector("#quiz-content").hidden = false;
  const index = state.currentQuestion;
  const question = state.questions[index];
  const topicSource = state.topics[question.topicIndex]?.content || "";
  document.querySelector("#quiz-count-chip").textContent = `QUESTION ${String(index + 1).padStart(2, "0")} / ${String(state.quizTotalQuestions).padStart(2, "0")}`;
  const isProblem = question.type === "problem";
  const isAppliedScenario = question.applied === true;
  document.querySelector("#quiz-content").innerHTML = `
    <p class="quiz-topic">${escapeHtml(question.topicTitle)} · ${isProblem ? "APPLIED PROBLEM" : isAppliedScenario ? "APPLIED SCENARIO · MULTIPLE CHOICE" : "MULTIPLE CHOICE"}</p>
    <h2>${escapeHtml(question.prompt)}</h2>
    ${isProblem ? `
      <label class="problem-answer-label" for="problem-answer">Work it out, then reveal the worked solution.</label>
      <textarea id="problem-answer" class="problem-answer" rows="4" maxlength="500" placeholder="Write your answer or working here…"></textarea>
      <button class="secondary-button" id="reveal-solution" type="button">Show worked solution</button>
      <div id="problem-solution" class="problem-solution" hidden>
        <p><strong>Answer:</strong> ${escapeHtml(question.answer)}</p>
        <p><strong>Worked solution:</strong> ${escapeHtml(question.solution)}</p>
        ${renderSourceEvidence(topicSource, `${question.prompt} ${question.solution}`)}
        <p class="problem-self-rate">How did your attempt go?</p>
        <div class="problem-rating">
          <button class="secondary-button" data-self-rating="true" type="button">I got it</button>
          <button class="secondary-button" data-self-rating="false" type="button">I need to review this</button>
        </div>
      </div>` : `
      <div class="quiz-options">${question.options
        .map(
          (option, optionIndex) => `
            <button type="button" class="quiz-option" data-option="${optionIndex}">
              <span class="option-letter">${String.fromCharCode(65 + optionIndex)}</span>
              <span>${escapeHtml(option)}</span>
            </button>`,
        )
        .join("")}</div>
      <p class="quiz-feedback" aria-live="polite"></p>
      <div class="quiz-source-evidence"></div>`}
    <div class="quiz-actions"><span class="quiz-progress">${index + 1} of ${state.quizTotalQuestions} questions</span><button class="primary-button" id="quiz-next" type="button" disabled>${isProblem ? "Continue" : "Check answer"}</button></div>
  `;
  const nextButton = document.querySelector("#quiz-next");
  nextButton.addEventListener("click", async () => {
    if (!isProblem && !nextButton.dataset.answered) {
      const selectedIndex = Number(nextButton.dataset.selectedOption);
      if (!Number.isInteger(selectedIndex)) return;
      checkAnswer(selectedIndex, question, [...document.querySelectorAll(".quiz-option")], nextButton);
      return;
    }
    state.currentQuestion += 1;
    state.selectedOption = null;
    state.problemAnswer = "";
    state.problemSolutionRevealed = false;
    saveProgress(true);
    if (state.currentQuestion < state.quizTotalQuestions) {
      if (state.currentQuestion < state.questions.length) renderQuestion();
      else await loadNextQuizQuestion();
    } else renderResults();
  });
  if (isProblem) {
    const problemInput = document.querySelector("#problem-answer");
    problemInput.value = state.problemAnswer;
    problemInput.addEventListener("input", () => {
      state.problemAnswer = problemInput.value;
      saveProgress();
    });
    if (state.problemSolutionRevealed) {
      document.querySelector("#problem-solution").hidden = false;
      document.querySelector("#reveal-solution").disabled = true;
      problemInput.disabled = true;
    }
    const existingProblemAnswer = state.answers.find((answer) => answer.prompt === question.prompt);
    if (existingProblemAnswer) {
      document.querySelector("#problem-answer").value = existingProblemAnswer.selectedAnswer;
      document.querySelector("#problem-answer").disabled = true;
      document.querySelector("#problem-solution").hidden = false;
      document.querySelector("#reveal-solution").disabled = true;
      document.querySelectorAll("[data-self-rating]").forEach((button) => {
        button.disabled = true;
        button.classList.toggle("selected", (button.dataset.selfRating === "true") === existingProblemAnswer.correct);
      });
      nextButton.disabled = false;
      nextButton.textContent = index === state.quizTotalQuestions - 1 ? "See my results" : "Next question";
    }
    document.querySelector("#reveal-solution").addEventListener("click", (event) => {
      event.currentTarget.disabled = true;
      document.querySelector("#problem-answer").disabled = true;
      document.querySelector("#problem-solution").hidden = false;
      state.problemSolutionRevealed = true;
      saveProgress(true);
    });
    document.querySelectorAll("[data-self-rating]").forEach((button) => {
      button.addEventListener("click", () => {
        const correct = button.dataset.selfRating === "true";
        state.answers.push({
          topicIndex: question.topicIndex,
          correct,
          questionType: "problem",
          prompt: question.prompt,
          selectedAnswer: document.querySelector("#problem-answer").value.trim(),
          correctAnswer: question.answer,
          explanation: question.solution,
          sourceExcerpt: findSourceExcerpt(topicSource, `${question.prompt} ${question.solution}`),
        });
        document.querySelectorAll("[data-self-rating]").forEach((choice) => {
          choice.disabled = true;
        });
        button.classList.add("selected");
        nextButton.disabled = false;
        nextButton.textContent = index === state.quizTotalQuestions - 1 ? "See my results" : "Next question";
        saveProgress(true);
      });
    });
    return;
  }
  const options = [...document.querySelectorAll(".quiz-option")];
  const existingAnswer = state.answers.find((answer) => answer.prompt === question.prompt);
  if (existingAnswer) {
    options.forEach((option) => { option.disabled = true; });
    const selectedIndex = question.options.indexOf(existingAnswer.selectedAnswer);
    if (selectedIndex >= 0) options[selectedIndex].classList.add(existingAnswer.correct ? "correct" : "incorrect");
    if (!existingAnswer.correct) {
      const correctIndex = question.options.indexOf(existingAnswer.correctAnswer);
      if (correctIndex >= 0) options[correctIndex].classList.add("correct");
    }
    const feedback = document.querySelector(".quiz-feedback");
    feedback.textContent = existingAnswer.correct ? `That's right. ${question.explanation}` : "Not quite. You can review this topic after the quiz.";
    feedback.classList.toggle("incorrect", !existingAnswer.correct);
    document.querySelector(".quiz-source-evidence").innerHTML =
      renderSourceEvidence(topicSource, `${question.prompt} ${question.explanation}`, existingAnswer.sourceExcerpt || "");
    nextButton.dataset.answered = "true";
    nextButton.disabled = false;
    nextButton.innerHTML = index === state.quizTotalQuestions - 1
      ? 'See how I did <span class="button-arrow" aria-hidden="true">→</span>'
      : 'Next question <span class="button-arrow" aria-hidden="true">→</span>';
  } else if (state.selectedOption !== null && question.options[state.selectedOption] !== undefined) {
    options[state.selectedOption].classList.add("selected");
    nextButton.dataset.selectedOption = String(state.selectedOption);
    nextButton.disabled = false;
  }
  options.forEach((button) =>
    button.addEventListener("click", () => selectAnswer(button, options, nextButton)),
  );
}

function selectAnswer(button, options, nextButton) {
  const chosenIndex = Number(button.dataset.option);
  options.forEach((option) => {
    option.classList.toggle("selected", option === button);
    option.setAttribute("aria-pressed", String(option === button));
  });
  nextButton.dataset.selectedOption = String(chosenIndex);
  state.selectedOption = chosenIndex;
  nextButton.disabled = false;
  saveProgress();
}

function checkAnswer(chosenIndex, question, options, nextButton) {
  const correct = chosenIndex === question.answerIndex;
  options.forEach((option) => {
    option.disabled = true;
    option.classList.remove("selected");
    if (correct && Number(option.dataset.option) === question.answerIndex) option.classList.add("correct");
  });
  if (!correct) options[chosenIndex].classList.add("incorrect");
  state.answers.push({
    topicIndex: question.topicIndex,
    correct,
    questionType: "mcq",
    prompt: question.prompt,
    selectedAnswer: question.options[chosenIndex],
    correctAnswer: question.options[question.answerIndex],
    explanation: question.explanation,
    sourceExcerpt: findSourceExcerpt(state.topics[question.topicIndex]?.content || "", `${question.prompt} ${question.explanation}`),
  });
  state.selectedOption = null;
  const feedback = document.querySelector(".quiz-feedback");
  feedback.textContent = correct
    ? `That's right. ${question.explanation}`
    : "Not quite. You can review this topic after the quiz.";
  feedback.classList.toggle("incorrect", !correct);
  document.querySelector(".quiz-source-evidence").innerHTML =
    renderSourceEvidence(
      state.topics[question.topicIndex]?.content || "",
      `${question.prompt} ${question.explanation}`,
      state.answers[state.answers.length - 1].sourceExcerpt,
    );
  nextButton.disabled = false;
  nextButton.dataset.answered = "true";
  nextButton.innerHTML =
    state.currentQuestion === state.quizTotalQuestions - 1
      ? 'See how I did <span class="button-arrow" aria-hidden="true">→</span>'
      : 'Next question <span class="button-arrow" aria-hidden="true">→</span>';
  saveProgress(true);
}

function renderResults() {
  const correct = state.answers.filter((answer) => answer.correct).length;
  const score = state.answers.length ? Math.round((correct / state.answers.length) * 100) : null;
  const performance = summarizeTopics();
  performance.forEach((item) => {
    if (item.total) {
      state.topicAssessment[item.index] = {
        score: item.correct / item.total,
        updatedAt: Date.now(),
      };
    }
  });
  const readiness = state.topics.length
    ? Math.round(Object.values(state.topicAssessment).reduce((total, result) => total + result.score, 0) / state.topics.length * 100)
    : 0;
  const assessedTopics = Object.keys(state.topicAssessment).length;
  const incorrectAnswers = state.answers.filter((answer) => !answer.correct);
  const message = score === null
    ? "Take a quick check-in to see how you’re doing."
    : score >= 85
      ? "You’ve got a strong handle on this material."
      : score >= 60
        ? "You’re building a good foundation. Let’s strengthen a few ideas."
        : "You’ve made a start. A focused review will help these ideas settle.";
  const resultsContent = document.querySelector("#results-content");
  resultsContent.innerHTML = `
    <div class="subpage-heading"><div><p class="eyebrow"><span class="eyebrow-line"></span> YOUR PROGRESS, NOT A GRADE</p><h1 id="results-title">${score === null ? "Your " : "Look how far you’ve "}<span class="serif-accent">${score === null ? "results." : "come."}</span></h1><p class="welcome-copy">${score === null ? "Complete a quick check-in to see your results and any answers to review." : "A quick reflection to help make your next study session even more useful."}</p></div></div>
    <div class="results-hero">${score === null ? "" : `<div class="score-circle"><span>${score}%</span></div>`}<div><p class="section-kicker">YOUR CHECK-IN</p><h2>${escapeHtml(message)}</h2><p>${score === null ? "No quiz answers are saved for this session." : `${correct} of ${state.answers.length} multiple-choice answers were correct. ${incorrectAnswers.length ? `${incorrectAnswers.length} ${incorrectAnswers.length === 1 ? "answer needs" : "answers need"} another explanation.` : "No incorrect answers need review right now."}`}</p><p class="readiness-result">Estimated plan readiness: <strong>${readiness}%</strong> · ${assessedTopics} of ${state.topics.length} topics checked</p></div></div>
    <div class="results-grid">
      <section class="results-card card"><h3>How each topic felt</h3>${performance.map((item) => {
        const pct = item.total ? Math.round((item.correct / item.total) * 100) : 0;
        const tested = item.total > 0;
        return `<div class="topic-result"><strong>${escapeHtml(state.topics[item.index].title)}</strong><span class="${!tested ? "" : pct >= 70 ? "result-good" : "result-practice"}">${tested ? `${item.correct}/${item.total} checks understood · ${pct >= 70 ? "feeling good" : "worth another look"}` : "Not tested in this quiz"}</span><p>${!tested ? "This topic was not selected for a question in this short quiz." : pct >= 70 ? "You understood this topic well; it isn’t included in your targeted review." : "Review the key idea and try recalling it once without looking."}</p></div>`;
      }).join("")}</section>
      <aside class="results-next-step"><p class="section-kicker">YOUR NEXT BEST STEP</p><h3>${incorrectAnswers.length ? "Review the missed answers below." : score === null ? "Your lessons are ready when you are." : "No missed answers to review."}</h3><p>${incorrectAnswers.length ? "See your answer, the correct answer, and ask for another explanation if you need one." : score === null ? "Start a quiz after completing your lessons to get a personal check-in." : "Revisit a lesson or keep practising whenever you like."}</p>${incorrectAnswers.length ? '<button class="primary-button" id="jump-to-missed-answers" type="button">Review missed answers <span class="button-arrow" aria-hidden="true">↓</span></button>' : ""}</aside>
    </div>
    ${incorrectAnswers.length ? renderMissedAnswerReview(incorrectAnswers) : ""}`;
  if (incorrectAnswers.length) {
    resultsContent.querySelector("#jump-to-missed-answers").addEventListener("click", () => {
      resultsContent.querySelector("#missed-answer-review").scrollIntoView({ behavior: "smooth" });
    });
    resultsContent.querySelectorAll(".explain-missed-answer").forEach((button) => {
      button.addEventListener("click", () => explainMissedAnswer(
        incorrectAnswers[Number(button.dataset.answerIndex)],
        button,
        resultsContent.querySelector(`#missed-answer-explanation-${button.dataset.answerIndex}`),
      ));
    });
  }
  state.lastScore = score ?? 0;
  state.lastPerformance = performance;
  showView("results");
  saveProgress(true);
}

function summarizeTopics() {
  return state.topics.map((_, index) => {
    const topicAnswers = state.answers.filter((answer) => answer.topicIndex === index);
    return {
      index,
      total: topicAnswers.length,
      correct: topicAnswers.filter((answer) => answer.correct).length,
    };
  });
}

function renderMissedAnswerReview(incorrectAnswers) {
  return `
    <section class="missed-answer-review card" id="missed-answer-review" aria-labelledby="missed-answer-title">
      <div class="missed-answer-heading">
        <div><p class="section-kicker">FOCUSED REVIEW</p><h2 id="missed-answer-title">Missed answers</h2></div>
        <span>${incorrectAnswers.length} ${incorrectAnswers.length === 1 ? "answer" : "answers"} to review</span>
      </div>
      ${incorrectAnswers.map((answer, index) => {
        const topic = state.topics[answer.topicIndex];
        const topicTitle = topic?.title || "Study topic";
        const answerLabel = answer.questionType === "problem" ? "Your attempt:" : "Your answer:";
        return `
          <article class="missed-answer-card">
            <h3>${escapeHtml(topicTitle)} · Question ${index + 1}</h3>
            <p><strong>Question:</strong> ${escapeHtml(answer.prompt)}</p>
            <p><strong>${answerLabel}</strong> ${escapeHtml(answer.selectedAnswer || "You marked this problem as needing review.")}</p>
            <p><strong>Correct answer:</strong> ${escapeHtml(answer.correctAnswer)}</p>
            <p class="missed-answer-reason"><strong>Why:</strong> ${escapeHtml(answer.explanation)}</p>
            ${renderSourceEvidence(topic?.content || "", `${answer.prompt} ${answer.explanation}`, answer.sourceExcerpt || "")}
            <button class="secondary-button explain-missed-answer" data-answer-index="${index}" type="button">Explain this answer again</button>
            <div class="missed-answer-explanation" id="missed-answer-explanation-${index}" aria-live="polite"></div>
          </article>`;
      }).join("")}
    </section>`;
}

async function explainMissedAnswer(answer, button, explanationContainer) {
  button.disabled = true;
  explanationContainer.innerHTML = '<p class="lesson-follow-up-loading" role="status">Preparing a focused explanation…</p>';
  const topic = state.topics[answer.topicIndex];
  const question = [
    `Explain this quiz question: ${answer.prompt}`,
    `My answer: ${answer.selectedAnswer || "I marked that I need to review this problem."}`,
    `Correct answer: ${answer.correctAnswer}`,
    `Quiz explanation: ${answer.explanation}`,
    "Explain why the correct answer is right and clarify the misunderstanding in my answer.",
  ].join("\n");
  try {
    const response = await fetch("/api/explain-part", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: topic.content, topic: topic.title, question }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(FRIENDLY_ERROR);
    }
    if (typeof result.explanation !== "string" || !result.explanation.trim()) {
      throw new Error(FRIENDLY_ERROR);
    }
    explanationContainer.innerHTML = `<section class="lesson-follow-up"><h4>Here’s why</h4>${splitReadable(result.explanation).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</section>`;
    saveProgress(true);
  } catch (error) {
    console.error("Could not explain the quiz answer.", error);
    explanationContainer.innerHTML = `<p class="lesson-error" role="alert">${FRIENDLY_ERROR}</p>`;
  } finally {
    button.disabled = false;
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
  }
  return shuffled;
}

materialInput.addEventListener("input", () => {
  if (fileInput.files?.length) {
    fileInput.value = "";
    preparedStudyImage = null;
    setImagePreview(null);
    imageLessonMaterial = "";
    imageMaterialReady = false;
    fileLabel.textContent = "Upload one file, or browse";
    fileStatus.textContent = "Using pasted text. Choose an image or file instead to switch sources.";
    showToast("Using text only. The uploaded file was cleared.");
  }
  updateWordCount();
  if (formError.textContent) formError.textContent = "";
});
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  preparedStudyImage = null;
  formError.textContent = "";
  if (file.size > 10 * 1024 * 1024) {
    formError.textContent = FRIENDLY_ERROR;
    fileInput.value = "";
    return;
  }
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff?|avif|heic|heif)$/i.test(file.name);
  const isTextFile = /\.(txt|md|markdown|csv|json|html?)$/i.test(file.name);
  if (!isImage && !isTextFile) {
    formError.textContent = FRIENDLY_ERROR;
    fileInput.value = "";
    return;
  }
  const replacingText = Boolean(materialInput.value.trim());
  imageMaterialReady = false;
  imageLessonMaterial = "";
  materialInput.value = "";
  updateWordCount();
  materialInput.disabled = isImage;
  setImagePreview(isImage ? file : null);
  if (replacingText) showToast("Using the uploaded file only. The previous text was cleared.");
  if (isImage) resetDailyHoursForImage();
  submitButton.disabled = true;
  try {
    if (isImage) {
      fileLabel.textContent = file.name;
      fileStatus.textContent = "Preparing image for visual understanding…";
      const preparedImage = await prepareImage(file);
      await visionStatusReady;
      let usedOcr = !visionAvailable;

      if (!usedOcr) {
        try {
          const imageData = await readAsDataUrl(preparedImage);
          fileStatus.textContent = "Understanding the visible text, diagrams, and other image content…";
          const response = await fetch("/api/extract-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageData }),
          });
          const result = await response.json();
          if (!response.ok) {
            if (response.status === 503) {
              visionAvailable = false;
              await refreshVisionStatus();
              usedOcr = true;
            } else {
              throw new Error(FRIENDLY_ERROR);
            }
          }
          if (usedOcr) {
            fileStatus.textContent = "Reading visible text…";
          } else {
            const kind = ["text", "visual", "mixed"].includes(result.kind) ? result.kind : "text";
            const extractedText = cleanExtractedStudyText(String(result.text || "").trim());
            const visualExplanation = String(result.visualExplanation || "").trim();
            const visualContext = [
              kind === "visual" && extractedText ? `Visible labels and captions:\n${extractedText}` : "",
              visualExplanation,
            ].filter(Boolean).join("\n\n");
            imageLessonMaterial = visualContext;
            materialInput.value = kind === "text" || kind === "mixed" ? extractedText : "";
          }
        } catch (error) {
          if (!isMissingVisionSetup(error)) throw error;
          usedOcr = true;
        }
      }

      if (usedOcr) {
        fileStatus.textContent = "Image understanding is unavailable. Reading visible text…";
        materialInput.value = await readImageText(preparedImage, (progress) => {
          fileStatus.textContent = `Reading visible text… ${progress}%`;
        });
      }

      if (!getStudyMaterial()) {
        fileStatus.textContent = "No useful content was found in that image.";
        formError.textContent = FRIENDLY_ERROR;
        updateWordCount();
        return;
      }
      if (usedOcr) {
        fileStatus.textContent = "Text extracted. Some visual details may not be included.";
      } else if (imageLessonMaterial && materialInput.value.trim()) {
        fileStatus.textContent = "Text is in the notes box; visual details will be explained in the lessons.";
      } else if (imageLessonMaterial) {
        fileStatus.textContent = "Image understood. Its explanation will be given in the lessons.";
      } else {
        fileStatus.textContent = "Text extracted from the image. Review it in the notes box below.";
      }
      preparedStudyImage = preparedImage;
      imageMaterialReady = true;
    } else {
      preparedStudyImage = null;
      materialInput.value = cleanText(await file.text(), file.name).trim();
      fileLabel.textContent = file.name;
      fileStatus.textContent = "Text file ready to study.";
    }
    updateWordCount();
    showToast(isImage ? "Study-ready content from your image is ready." : "Your file is ready to study.");
  } catch (error) {
    console.error(isImage ? "Could not analyze uploaded image." : "Could not read uploaded file.", error);
    const message = error instanceof Error && error.message !== "Failed to fetch"
      ? error.message
      : FRIENDLY_ERROR;
    formError.textContent = message;
    fileStatus.textContent = message;
  } finally {
    materialInput.disabled = false;
    submitButton.disabled = false;
  }
});

document.addEventListener("paste", (event) => {
  const imageItem = [...(event.clipboardData?.items || [])].find(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  if (!imageItem) return;
  const imageFile = imageItem.getAsFile();
  if (!imageFile) return;
  event.preventDefault();
  const namedImage = new File([imageFile], imageFile.name || "pasted-image.png", {
    type: imageFile.type || "image/png",
    lastModified: Date.now(),
  });
  const transfer = new DataTransfer();
  transfer.items.add(namedImage);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
});

["dragenter", "dragover"].forEach((eventName) =>
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((eventName) =>
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragging");
  }),
);
uploadZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
});

studyDaysInput.addEventListener("change", () => {
  const days = Number(studyDaysInput.value);
  if (Number.isInteger(days) && days >= 1 && days <= MAX_STUDY_DAYS) {
    renderDailyHours(days, readDailyHours());
  }
  if (formError.textContent) formError.textContent = "";
});
studyDaysInput.addEventListener("input", () => {
  if (formError.textContent) formError.textContent = "";
});
dailyHoursList.addEventListener("input", () => {
  if (formError.textContent) formError.textContent = "";
});
examDateInput.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
examDateInput.addEventListener("change", () => {
  if (!examDateInput.value) return;
  const [year, month, day] = examDateInput.value.split("-").map(Number);
  const examDay = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilExam = Math.floor((examDay - today) / 86_400_000) + 1;
  if (daysUntilExam < 1) {
    formError.textContent = "Choose today or a future exam date.";
    examDateInput.value = "";
    return;
  }
  const planDays = Math.min(daysUntilExam, MAX_STUDY_DAYS);
  studyDaysInput.value = String(planDays);
  renderDailyHours(planDays, readDailyHours());
  if (daysUntilExam > MAX_STUDY_DAYS) showToast("The plan covers the next 30 days before your exam.");
  if (formError.textContent) formError.textContent = "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const material = cleanExtractedStudyText(getStudyMaterial());
  if (!material.trim()) {
    formError.textContent = "Enter an education-related topic, question, or study notes to get started.";
    materialInput.focus();
    return;
  }
  const schedule = readDailyHours();
  if (
    !Number.isInteger(Number(studyDaysInput.value)) ||
    schedule.length !== Number(studyDaysInput.value) ||
    schedule.some((hours) => !Number.isFinite(hours) || hours < 0.5 || hours > 12)
  ) {
    formError.textContent = FRIENDLY_ERROR;
    studyDaysInput.focus();
    return;
  }
  if (examDateInput.value) {
    const [year, month, day] = examDateInput.value.split("-").map(Number);
    if (new Date(year, month - 1, day).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0)) {
      formError.textContent = "Choose today or a future exam date.";
      examDateInput.focus();
      return;
    }
  }
  const topics = splitIntoTopics(material);
  if (topics.length > MAX_PLAN_TOPICS) {
    formError.textContent = FRIENDLY_ERROR;
    materialInput.focus();
    return;
  }
  const inputMaterial = cleanExtractedStudyText(materialInput.value.trim());
  materialInput.value = inputMaterial;
  updateWordCount();
  const inputKind = imageLessonMaterial
    ? inputMaterial ? "mixed-image" : "visual-image"
    : imageMaterialReady ? "image-text" : "text";
  let imageId = null;
  let imageSaveWarning = false;
  if (preparedStudyImage && imageStorageAvailable) {
    submitButton.disabled = true;
    fileStatus.textContent = "Saving your image privately for 30 days…";
    try {
      const imageData = await readAsDataUrl(preparedStudyImage);
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData, fileName: preparedStudyImage.name || "study-image" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || FRIENDLY_ERROR);
      if (!Number.isInteger(result.image?.id) || result.image.id <= 0) {
        throw new Error("The image could not be saved to your history.");
      }
      imageId = result.image.id;
      fileStatus.textContent = "Image saved privately for 30 days and linked to this study plan.";
      preparedStudyImage = null;
    } catch (error) {
      console.error("Could not save uploaded image.", error);
      const reason = error instanceof Error && error.message !== "Failed to fetch"
        ? error.message
        : FRIENDLY_ERROR;
      fileStatus.textContent = `Your study plan will still be created, but the image could not be saved for later. ${reason}`;
      preparedStudyImage = null;
      imageSaveWarning = true;
    }
  } else if (preparedStudyImage) {
    fileStatus.textContent = "Image analyzed. It is not saved for later because private image storage is not configured.";
    preparedStudyImage = null;
  }
  submitButton.disabled = false;
  createPlan(material, schedule, topics, inputMaterial, inputKind, examDateInput.value, imageId);
  if (imageSaveWarning) {
    showToast("Study plan created, but the image was not saved for later.");
  } else if (topics.length === 1) {
    showToast("One topic found. Add blank lines between sections for a more detailed plan.");
  } else {
    showToast(`${topics.length} topics ready. Your learning room is waiting.`);
  }
});

document.querySelector("#prev-lesson").addEventListener("click", () => {
  if (state.currentLesson > 0 && state.completedLessons.size === 0) {
    state.currentLesson -= 1;
    renderLearningRoom();
  }
});
document.querySelector("#next-lesson").addEventListener("click", async () => {
  if (!state.completedLessons.has(state.currentLesson)) {
    const topic = state.topics[state.currentLesson];
    const content = document.querySelector("#lesson-content");
    const button = document.querySelector("#next-lesson");
    const readingPage = content.querySelector("#lesson-reading-page");
    const checkPage = content.querySelector("#mastery-check");
    if (!readingPage || !checkPage) {
      button.disabled = true;
      console.error("Lesson page controls are missing; reload StudyBuddy to restore the lesson view.");
      return;
    }
    if (checkPage.hidden) {
      state.masteryCheckPage = true;
      readingPage.hidden = true;
      checkPage.hidden = false;
      saveProgress(true);
      if (state.masteryChecks[state.currentLesson]?.question) {
        renderMasteryCheck(topic, state.currentLesson, content, button);
      } else {
        await beginMasteryCheck(topic, state.currentLesson, content, button);
      }
      return;
    }
    if (!state.masteryChecks[state.currentLesson]?.question) {
      await beginMasteryCheck(topic, state.currentLesson, content, button);
    }
    return;
  }
  if (state.currentLesson < state.topics.length - 1) {
    state.currentLesson += 1;
    state.masteryCheckPage = false;
    renderLearningRoom();
    saveProgress(true);
  } else {
    saveProgress(true);
    buildQuiz();
  }
});
document.querySelector("#start-selected-quiz").addEventListener("click", startSelectedQuiz);
document.querySelector("#skip-quiz").addEventListener("click", () => {
  state.quizSetupOpen = false;
  saveProgress(true);
  showView("home");
  showToast("Quiz skipped. Your completed lessons are saved.");
});
document.querySelector("#quiz-all").addEventListener("change", (event) => {
  document.querySelector("#quiz-size").disabled = event.target.checked;
});
document.querySelector("#back-to-plan").addEventListener("click", () => showView("home"));
navLinks.forEach((link) =>
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.dataset.view === "learn" && state.topics.length) {
      renderLearningRoom();
      showView("learn");
    } else if (link.dataset.view === "history") {
      showView("history");
      await loadStudyHistory();
    } else {
      showView("home");
    }
  }),
);

const helpDialog = document.querySelector("#help-dialog");
document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
document.querySelector("#close-help").addEventListener("click", () => helpDialog.close());
document.querySelector("#dialog-done").addEventListener("click", () => helpDialog.close());
document.querySelector("#save-retry").addEventListener("click", () => saveProgress(true));
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

const date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
document.querySelector("#today-date").textContent = date;
renderDailyHours(Number(studyDaysInput.value), state.schedule);
authForm.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    if (input) setPasswordVisibility(input, input.type === "password");
  });
});

document.querySelector("#auth-toggle").addEventListener("click", () => {
  setAuthMode(authMode === "login" ? "register" : "login");
});
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  authError.classList.remove("auth-success");
  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !emailInput.validity.valid) {
    authError.textContent = "Enter a valid email address.";
    emailInput.focus();
    return;
  }
  if (authMode === "register" && (
    password.length < 8
    || password.length > 256
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/[0-9]/.test(password)
    || !/[^A-Za-z0-9\s]/.test(password)
  )) {
    authError.textContent = "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";
    passwordInput.focus();
    return;
  }
  if (authMode === "login" && (!password || password.length > 256)) {
    authError.textContent = "Enter your password.";
    passwordInput.focus();
    return;
  }
  if (authMode === "register"
      && password !== document.querySelector("#auth-confirm-password").value) {
    authError.textContent = "Passwords do not match.";
    document.querySelector("#auth-confirm-password").focus();
    return;
  }
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  const originalText = submit.textContent;
  submit.textContent = authMode === "register" ? "Creating account…" : "Signing in…";
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || FRIENDLY_ERROR);
    document.querySelector("#auth-password").value = "";
    document.querySelector("#auth-confirm-password").value = "";
    const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok) throw new Error(session.error || FRIENDLY_ERROR);
    await enterApp(session.user || result.user, session.progress);
  } catch (error) {
    console.error("Could not complete account request.", error);
    authError.textContent = error instanceof Error && error.message !== "Failed to fetch"
      ? error.message
      : FRIENDLY_ERROR;
  } finally {
    submit.disabled = false;
    submit.textContent = originalText;
  }
});
document.querySelector("#sign-out").addEventListener("click", async () => {
  await saveProgress(true);
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  signedIn = false;
  signedInEmail = "";
  setProgressSaveStatus("", "");
  resetStudyState();
  sessionStorage.removeItem("studybuddy-session");
  appShell.hidden = true;
  authGate.hidden = false;
  setAuthMode("login");
  document.querySelector("#auth-password").value = "";
});
window.addEventListener("pagehide", () => {
  if (!signedIn || !state.material) return;
  const snapshot = progressSnapshot();
  const body = JSON.stringify({ progress: snapshot });
  try {
    if (signedInEmail) localStorage.setItem(`studybuddy-progress:${signedInEmail}`, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("Could not cache study progress during refresh.", error);
  }
  fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch((error) => console.error("Could not save study progress while leaving the page.", error));
});
loadSignedInSession();
