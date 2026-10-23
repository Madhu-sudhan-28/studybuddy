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
const dailyHoursList = document.querySelector("#daily-hours-list");
const authGate = document.querySelector("#auth-gate");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const FRIENDLY_ERROR = "Something went wrong. Please try again.";
let authMode = "login";
let signedIn = false;
let currentView = "home";
let saveTimer;
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
  material: "",
  inputMaterial: "",
  inputKind: "text",
  topics: [],
  schedule: [1, 1, 1],
  memoryStyle: "mixed",
  currentLesson: 0,
  completedLessons: new Set(),
  questions: [],
  quizTopicIndices: [],
  quizTotalQuestions: 0,
  quizSetupOpen: false,
  quizAppliedTopicIndex: null,
  currentQuestion: 0,
  answers: [],
  quizMode: "initial",
  explainedTopicIndices: new Set(),
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
  revision: "Revision room",
  history: "Study history",
};
let toastTimer;
let imagePreviewUrl = "";
let ocrEnginePromise;
let visionAvailable = false;
let imageMaterialReady = false;
let imageLessonMaterial = "";

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
    materialHint.textContent = visionAvailable
      ? "Guided lessons, quizzes, and image understanding are ready. Separate long notes with section headings for detailed lessons one part at a time."
      : "Guided lessons and quizzes are currently unavailable. Images can still be read with basic text recognition.";
    return visionAvailable;
  } catch (error) {
    console.error("Could not check image understanding status.", error);
    visionAvailable = false;
    materialHint.textContent = FRIENDLY_ERROR;
    return false;
  }
}

const visionStatusReady = refreshVisionStatus();

function showView(name, persist = true) {
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
    material: state.material,
    inputMaterial: state.inputMaterial,
    inputKind: state.inputKind,
    duration: state.schedule.reduce((total, hours) => total + hours, 0) * 60,
    schedule: state.schedule,
    memoryStyle: state.memoryStyle,
    lessons: state.topics.map((topic) => topic.lesson || null),
    currentLesson: state.currentLesson,
    completedLessons: [...state.completedLessons],
    questions: state.questions,
    quizTopicIndices: state.quizTopicIndices,
    quizTotalQuestions: state.quizTotalQuestions,
    quizSetupOpen: state.quizSetupOpen,
    quizAppliedTopicIndex: state.quizAppliedTopicIndex,
    currentQuestion: state.currentQuestion,
    answers: state.answers,
    quizMode: state.quizMode,
    explainedTopicIndices: [...state.explainedTopicIndices],
    selectedOption: state.selectedOption,
    problemAnswer: state.problemAnswer,
    problemSolutionRevealed: state.problemSolutionRevealed,
    view: currentView,
    savedAt: ++progressRevision,
  };
}

function resetStudyState() {
  state.planId = null;
  state.material = "";
  state.inputMaterial = "";
  state.inputKind = "text";
  state.topics = [];
  state.schedule = [1, 1, 1];
  state.memoryStyle = "mixed";
  state.currentLesson = 0;
  state.completedLessons = new Set();
  state.questions = [];
  state.quizTopicIndices = [];
  state.quizTotalQuestions = 0;
  state.quizSetupOpen = false;
  state.quizAppliedTopicIndex = null;
  state.currentQuestion = 0;
  state.answers = [];
  state.quizMode = "initial";
  state.explainedTopicIndices = new Set();
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
  const save = () => fetch("/api/progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ progress: progressSnapshot() }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Progress save failed (${response.status}).`);
    const result = await response.json();
    if (result.archived) await loadStudyHistory();
  }).catch((error) => console.error("Could not save study progress.", error));
  if (immediate) return save();
  saveTimer = setTimeout(save, 450);
}

function restoreProgress(saved, persist = true) {
  if (!saved || typeof saved.material !== "string" || !saved.material.trim()) return false;
  const originalMaterial = saved.material;
  state.planId = typeof saved.planId === "string" && saved.planId ? saved.planId : createPlanId();
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
  state.quizMode = saved.quizMode === "revision" ? "revision" : "initial";
  state.explainedTopicIndices = new Set((Array.isArray(saved.explainedTopicIndices) ? saved.explainedTopicIndices : []).filter(Number.isInteger));
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
  if (saved.view === "results" && state.answers.length) renderResults();
  else if (saved.view === "revision" && state.answers.length) renderRevision();
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

function setAuthMode(mode) {
  authMode = mode;
  const creating = mode === "register";
  document.querySelector("#auth-title").innerHTML = creating
    ? 'Create your <span class="serif-accent">account.</span>'
    : 'Welcome <span class="serif-accent">back.</span>';
  document.querySelector("#auth-copy").textContent = creating
    ? "Create an account to save your study progress and continue on any device."
    : "Sign in to continue your study plan from any device.";
  document.querySelector("#auth-submit").textContent = creating ? "Create account" : "Sign in";
  document.querySelector("#auth-switch-prompt").textContent = creating ? "Already have an account?" : "New to StudyBuddy?";
  document.querySelector("#auth-toggle").textContent = creating ? "Sign in" : "Create an account";
  document.querySelector("#auth-password").autocomplete = creating ? "new-password" : "current-password";
  authError.textContent = "";
}

async function enterApp(user, progress) {
  signedIn = true;
  authGate.hidden = true;
  appShell.hidden = false;
  document.querySelector("#profile-email").textContent = user.email;
  resetStudyState();
  progressRevision = Math.max(progressRevision, Number(progress?.savedAt) || 0);
  let hasSavedProgress = restoreProgress(progress);
  if (hasSavedProgress && (progress?.material !== state.material || progress?.lessonVersion !== 20 || typeof progress?.inputMaterial !== "string" || cleanExtractedStudyText(cleanLegacyImageInput(progress.inputMaterial)) !== progress.inputMaterial)) {
    saveProgress(true);
  }
  if (!hasSavedProgress) {
    try {
      const legacy = JSON.parse(sessionStorage.getItem("studybuddy-session") || "null");
      hasSavedProgress = restoreProgress(legacy);
    } catch (error) {
      console.error("Could not read the older browser session.", error);
    }
    if (hasSavedProgress) saveProgress(true);
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
        <button class="history-item" type="button" data-history-id="${Number(item.id)}">
          <span class="history-item-copy"><strong>${escapeHtml(item.title || "Study plan")}</strong><small>${new Date(item.createdAt * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</small></span>
          <span class="history-item-action">Open lessons <span aria-hidden="true">→</span></span>
        </button>`).join("")
      : '<p class="history-empty">Your earlier plans will appear here when you start a new one.</p>';
    historyList.querySelectorAll("[data-history-id]").forEach((button) => {
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
    const result = await response.json();
    if (response.ok && result.authenticated) await enterApp(result.user, result.progress);
    else if (response.ok) setAuthMode(result.hasAccounts ? "login" : "register");
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
  const usedHours = hoursByDay.map(() => 0);
  topics.forEach((topic, topicIndex) => {
    const dayIndex = hoursByDay.reduce((bestIndex, hours, index) => {
      const currentLoad = usedHours[index] / hours;
      const bestLoad = usedHours[bestIndex] / hoursByDay[bestIndex];
      return currentLoad < bestLoad ? index : bestIndex;
    }, 0);
    days[dayIndex].topics.push({ topic, topicIndex });
    usedHours[dayIndex] += 1;
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

function createPlan(material, schedule, topics = splitIntoTopics(material), inputMaterial = material, inputKind = "text") {
  state.planId = createPlanId();
  state.material = material;
  state.inputMaterial = inputMaterial;
  state.inputKind = inputKind;
  state.topics = topics;
  state.schedule = schedule;
  state.memoryStyle = "mixed";
  state.currentLesson = 0;
  state.completedLessons = new Set();
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

function renderLearningRoom() {
  const list = document.querySelector("#lesson-list");
  list.innerHTML = buildDailyTopicSchedule(state.topics, state.schedule)
    .map((day) => `
      <section class="day-plan">
        <div class="day-plan-heading"><strong>Day ${day.day}</strong><span>${formatHours(day.hours)}</span></div>
        ${day.topics.length
          ? day.topics.map(({ topic, topicIndex, review }) => `
            <button class="lesson-list-item ${topicIndex === state.currentLesson ? "selected" : ""} ${state.completedLessons.has(topicIndex) ? "completed" : ""}" data-lesson="${topicIndex}" type="button">
              <span class="lesson-number">${review ? "↻" : state.completedLessons.has(topicIndex) ? "✓" : String(topicIndex + 1).padStart(2, "0")}</span>
              <span class="lesson-item-title">${review ? `Review · ${escapeHtml(topic.title)}` : escapeHtml(topic.title)}</span>
            </button>`).join("")
          : '<p class="day-plan-empty">Review what you learned or take a break.</p>'}
      </section>`)
    .join("");
  list.querySelectorAll("[data-lesson]").forEach((button) =>
    button.addEventListener("click", () => {
      state.currentLesson = Number(button.dataset.lesson);
      renderLearningRoom();
      saveProgress();
    }),
  );

  const completed = state.completedLessons.size;
  document.querySelector("#lesson-progress-count").textContent = `${completed} / ${state.topics.length}`;
  document.querySelector("#lesson-progress-bar").style.width =
    `${(completed / Math.max(state.topics.length, 1)) * 100}%`;
  const totalHours = state.schedule.reduce((total, hours) => total + hours, 0);
  document.querySelector("#plan-time-label").textContent = `${state.schedule.length} ${state.schedule.length === 1 ? "day" : "days"} · ${formatHours(totalHours)} total`;
  document.querySelector("#lesson-subtitle").textContent =
    `${state.topics.length} focused lesson pages across ${state.schedule.length} ${state.schedule.length === 1 ? "day" : "days"} · Each page loads when selected`;

  const topic = state.topics[state.currentLesson];
  const lessonContent = document.querySelector("#lesson-content");
  lessonContent.innerHTML = `
    <div class="lesson-meta">LESSON PAGE ${String(state.currentLesson + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
    <h2>${escapeHtml(topic.title)}</h2>
    <p class="lesson-intro">Your allocated study time helps shape the depth of this lesson. Your tutor is preparing connected ideas, a worked example, and a quick self-check.</p>
    <div class="lesson-loading" role="status" aria-live="polite"><span class="lesson-spinner" aria-hidden="true"></span><span>Building your lesson from your study material…</span></div>
  `;
  document.querySelector("#prev-lesson").disabled = state.currentLesson === 0;
  document.querySelector("#prev-lesson").style.opacity = state.currentLesson === 0 ? ".5" : "1";
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
    lessonContent.innerHTML = `
      <div class="lesson-meta">LESSON PAGE ${String(topicIndex + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
      <h2>${escapeHtml(topic.title)}</h2>
      <p class="lesson-intro">StudyBuddy couldn’t create the teaching lesson, so it hasn’t replaced it with a planner or raw notes.</p>
      <div class="lesson-error" role="alert">${FRIENDLY_ERROR}</div>
      <button class="secondary-button" id="retry-lesson" type="button">Try lesson again</button>`;
    lessonContent.querySelector("#retry-lesson").addEventListener("click", () => {
      lessonContent.innerHTML = '<div class="lesson-loading" role="status"><span class="lesson-spinner" aria-hidden="true"></span><span>Trying again…</span></div>';
      loadLesson(topic, topicIndex, lessonContent, nextButton);
    });
  }
}

function getTopicLesson(topic, retryRateLimit) {
  if (topic.lesson) return Promise.resolve(topic.lesson);
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
        }),
      });
      const result = await response.json();
      const requestTooLarge = /request too large|requested output tokens exceed|expected output tokens exceed/i
        .test(result.error || "");
      if (response.status === 429 && attempt === 0 && retryRateLimit && !requestTooLarge) {
        const retryMatch = (result.error || "").match(/try again in\s+([\d.]+)\s*s/i);
        const waitMs = retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) + 500 : 15_000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 90_000)));
        continue;
      }
      if (!response.ok) {
        throw new Error(FRIENDLY_ERROR);
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
        throw new Error(FRIENDLY_ERROR);
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
  lessonContent.innerHTML = `
    <div class="lesson-meta">LESSON PAGE ${String(state.currentLesson + 1).padStart(2, "0")} / ${String(state.topics.length).padStart(2, "0")} <span class="lesson-duration">about ${lessonMinutes()} min</span></div>
    <h2>${escapeHtml(topic.title)}</h2>
    <p class="lesson-intro">A focused lesson page based on your study material.</p>
    ${lesson.truncated ? `<p class="lesson-error" role="status">${FRIENDLY_ERROR}</p><button class="secondary-button" id="retry-short-lesson" type="button">Try lesson again</button>` : ""}
    <section class="lesson-block lesson-detail-section"><h3>Understand this topic</h3>${renderLessonBullets(lesson.content || lesson.explanation)}</section>
    ${renderLessonVisual(lesson.visual, lesson.visualWarning)}
    <details class="lesson-source"><summary>Review the notes this lesson is based on</summary><p>${splitReadable(topic.content).map(escapeHtml).join("\n\n")}</p></details>
    <div class="reflection-box"><label for="reflection-input">Which part of this topic would you like explained further?</label><textarea id="reflection-input" rows="2" maxlength="500" placeholder="Name a term, idea, or step you want me to explain…"></textarea><button class="secondary-button" id="explain-part" type="button">Explain this part</button><div class="follow-up-answer" id="follow-up-answer" aria-live="polite"></div></div>
  `;
  nextButton.disabled = false;
  lessonContent.querySelector("#explain-part").addEventListener("click", () => explainLessonPart(topic, lessonContent));
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
  state.quizMode = "initial";
  state.explainedTopicIndices = new Set();
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
  await generateQuiz(selectedIndices, "initial", state.quizAppliedTopicIndex);
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

async function buildRevisionQuiz() {
  const topicIndices = shuffleArray([...state.explainedTopicIndices]);
  if (!topicIndices.length) return;
  state.quizMode = "revision";
  state.questions = [];
  state.quizTopicIndices = topicIndices;
  state.quizTotalQuestions = topicIndices.length;
  state.currentQuestion = 0;
  state.answers = [];
  await saveProgress(true);
  await generateQuiz(topicIndices, "revision");
}

async function generateQuiz(topicIndices = null, mode = Array.isArray(topicIndices) ? "revision" : "initial", appliedTopicIndex = null) {
  const isRevisionQuiz = mode === "revision";
  state.quizMode = mode;
  state.quizSetupOpen = false;
  state.quizTopicIndices = Array.isArray(topicIndices) ? topicIndices : state.topics.map((_, index) => index);
  if (Number.isInteger(appliedTopicIndex)) state.quizAppliedTopicIndex = appliedTopicIndex;
  state.quizTotalQuestions = state.quizTopicIndices.length + (isRevisionQuiz ? 0 : 1);
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
  document.querySelector("#quiz-count-chip").textContent = isRevisionQuiz ? "PREPARING YOUR FOLLOW-UP QUIZ" : "PREPARING YOUR QUIZ";
  document.querySelector("#quiz-intro").textContent = isRevisionQuiz
    ? `One question at a time for the ${state.quizTopicIndices.length} topic${state.quizTopicIndices.length === 1 ? "" : "s"} you reviewed.`
    : `One question at a time for your ${state.quizTotalQuestions} multiple-choice questions, including an applied scenario.`;
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
  const isRevisionQuiz = state.quizMode === "revision";
  const isProblem = !isRevisionQuiz && questionIndex === state.quizTopicIndices.length;
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
        mode: isProblem ? "problem" : isRevisionQuiz ? "revision" : "single",
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
      <p class="quiz-feedback" aria-live="polite"></p>`}
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
  });
  state.selectedOption = null;
  const feedback = document.querySelector(".quiz-feedback");
  feedback.textContent = correct
    ? `That's right. ${question.explanation}`
    : "Not quite. You can review this topic after the quiz.";
  feedback.classList.toggle("incorrect", !correct);
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
  const score = Math.round((correct / state.answers.length) * 100);
  const performance = summarizeTopics();
  const incorrectAnswers = state.answers.filter((answer) => !answer.correct);
  const message =
    score >= 85
      ? "You’ve got a strong handle on this material."
      : score >= 60
        ? "You’re building a good foundation. Let’s strengthen a few ideas."
        : "You’ve made a start. A focused review will help these ideas settle.";
  const resultsContent = document.querySelector("#results-content");
  resultsContent.innerHTML = `
    <div class="subpage-heading"><div><p class="eyebrow"><span class="eyebrow-line"></span> YOUR PROGRESS, NOT A GRADE</p><h1 id="results-title">${state.quizMode === "revision" ? "Your follow-up " : "Look how far you’ve "}<span class="serif-accent">${state.quizMode === "revision" ? "check-in." : "come."}</span></h1><p class="welcome-copy">${state.quizMode === "revision" ? "Here’s how you did on the topics you just reviewed." : "A quick reflection to help make your next study session even more useful."}</p></div></div>
    <div class="results-hero"><div class="score-circle"><span>${score}%</span></div><div><p class="section-kicker">${state.quizMode === "revision" ? "AFTER REVISION" : "YOUR CHECK-IN"}</p><h2>${escapeHtml(message)}</h2><p>${correct} of ${state.answers.length} multiple-choice answers were correct. ${incorrectAnswers.length ? `${incorrectAnswers.length} ${incorrectAnswers.length === 1 ? "answer needs" : "answers need"} another explanation.` : "No incorrect answers need revision right now."}</p></div></div>
    <div class="results-grid">
      <section class="results-card card"><h3>${state.quizMode === "revision" ? "Follow-up by topic" : "How each topic felt"}</h3>${performance.filter((item) => state.quizMode !== "revision" || state.questions.some((question) => question.topicIndex === item.index)).map((item) => {
        const pct = item.total ? Math.round((item.correct / item.total) * 100) : 0;
        const tested = item.total > 0;
        return `<div class="topic-result"><strong>${escapeHtml(state.topics[item.index].title)}</strong><span class="${!tested ? "" : pct >= 70 ? "result-good" : "result-practice"}">${tested ? `${item.correct}/${item.total} checks understood · ${pct >= 70 ? "feeling good" : "worth another look"}` : "Not tested in this quiz"}</span><p>${!tested ? "This topic was not selected for a question in this short quiz." : pct >= 70 ? (state.quizMode === "revision" ? "You answered the follow-up check correctly. Keep using recall to retain it." : "You understood this topic well; it isn’t included in your targeted revision plan.") : "Review the key idea and try recalling it once without looking."}</p></div>`;
      }).join("")}</section>
      <aside class="revision-callout"><p class="section-kicker">YOUR NEXT BEST STEP</p><h3>${incorrectAnswers.length ? "Let's work through the missed answers." : state.quizMode === "revision" ? "You strengthened those topics." : "No missed answers to revise."}</h3><p>${incorrectAnswers.length ? "Your revision plan will show only the questions you answered incorrectly or marked as needing review, with a focused explanation for each." : state.quizMode === "revision" ? "Your follow-up answers show how well the explanations helped. Revisit any lesson whenever you want more practice." : "You answered or self-rated every check correctly, so there’s nothing to add to your revision plan right now."}</p>${incorrectAnswers.length ? '<button class="primary-button" id="open-revision">Explain my missed answers <span class="button-arrow" aria-hidden="true">→</span></button>' : ""}</aside>
    </div>`;
  if (incorrectAnswers.length) {
    document.querySelector("#open-revision").addEventListener("click", renderRevision);
  }
  state.lastScore = score;
  state.lastPerformance = performance;
  showView("results");
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

function renderRevision() {
  const incorrectAnswers = state.answers.filter((answer) => !answer.correct);
  const revisionContent = document.querySelector("#revision-content");
  revisionContent.innerHTML = `
    <div class="revision-heading"><div><p class="eyebrow"><span class="eyebrow-line"></span> YOUR MISSED QUESTIONS</p><h1 id="revision-title">Let’s explain it <span class="serif-accent">again.</span></h1><p class="welcome-copy">${incorrectAnswers.length ? "Review just the answers you missed. Each one includes the correct answer and a focused explanation." : "There are no incorrect or self-rated weak answers to revise from this check-in."}</p></div><span class="revision-summary">${incorrectAnswers.length} ${incorrectAnswers.length === 1 ? "answer" : "answers"} to revisit</span></div>
    <section class="revision-content-card card">
      <p class="section-kicker">FOCUSED REVISION · MISSED ANSWERS ONLY</p>
      ${incorrectAnswers.length ? incorrectAnswers.map((answer, index) => `
        <article class="revision-topic-card">
          <h3>${escapeHtml(state.topics[answer.topicIndex].title)} · Question ${index + 1}</h3>
          <p class="revision-question"><strong>Question:</strong> ${escapeHtml(answer.prompt)}</p>
          <p class="revision-your-answer"><strong>${answer.questionType === "problem" ? "Your attempt:" : "Your answer:"}</strong> ${escapeHtml(answer.selectedAnswer || "You marked this problem as needing review.")}</p>
          <p class="revision-correct-answer"><strong>Correct answer:</strong> ${escapeHtml(answer.correctAnswer)}</p>
          <p class="revision-prompt"><strong>Why:</strong> ${escapeHtml(answer.explanation)}</p>
          <button class="secondary-button explain-missed-answer" data-answer-index="${index}" type="button">Explain this answer again</button>
          <div class="missed-answer-explanation" id="missed-answer-explanation-${index}" aria-live="polite"></div>
        </article>`).join("") : '<p class="revision-empty">No incorrect or self-rated weak answers need revision.</p>'}
      <div class="revision-footer"><button class="secondary-button" id="revision-back">← Back to results</button>${incorrectAnswers.length ? '<button class="primary-button" id="revision-quiz" type="button" disabled>Explain a weak topic first</button>' : ""}</div>
    </section>`;
  document.querySelector("#revision-back").addEventListener("click", () => showView("results"));
  const revisionQuizButton = document.querySelector("#revision-quiz");
  if (revisionQuizButton) {
    revisionQuizButton.addEventListener("click", buildRevisionQuiz);
  }
  revisionContent.querySelectorAll(".explain-missed-answer").forEach((button) => {
    button.addEventListener("click", () => explainMissedAnswer(
      incorrectAnswers[Number(button.dataset.answerIndex)],
      button,
      revisionContent.querySelector(`#missed-answer-explanation-${button.dataset.answerIndex}`),
    ));
  });
  showView("revision");
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
    state.explainedTopicIndices.add(answer.topicIndex);
    saveProgress(true);
    const revisionQuizButton = document.querySelector("#revision-quiz");
    if (revisionQuizButton) {
      const topicCount = state.explainedTopicIndices.size;
      revisionQuizButton.disabled = false;
      revisionQuizButton.textContent = `Check ${topicCount} reviewed topic${topicCount === 1 ? "" : "s"} (${topicCount} question${topicCount === 1 ? "" : "s"})`;
    }
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
      imageMaterialReady = true;
    } else {
      materialInput.value = cleanText(await file.text(), file.name).trim();
      fileLabel.textContent = file.name;
      fileStatus.textContent = "Text file ready to study.";
    }
    updateWordCount();
    showToast(isImage ? "Study-ready content from your image is ready." : "Your file is ready to study.");
  } catch (error) {
    console.error(isImage ? "Could not analyze uploaded image." : "Could not read uploaded file.", error);
    formError.textContent = FRIENDLY_ERROR;
    fileStatus.textContent = FRIENDLY_ERROR;
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const material = cleanExtractedStudyText(getStudyMaterial());
  if (!imageMaterialReady && material.split(/\s+/).filter(Boolean).length < 20) {
    formError.textContent = FRIENDLY_ERROR;
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
  createPlan(material, schedule, topics, inputMaterial, inputKind);
  if (topics.length === 1) {
    showToast("One topic found. Add blank lines between sections for a more detailed plan.");
  } else {
    showToast(`${topics.length} topics ready. Your learning room is waiting.`);
  }
});

document.querySelector("#prev-lesson").addEventListener("click", () => {
  if (state.currentLesson > 0) {
    state.currentLesson -= 1;
    renderLearningRoom();
  }
});
document.querySelector("#next-lesson").addEventListener("click", () => {
  state.completedLessons.add(state.currentLesson);
  if (state.currentLesson < state.topics.length - 1) {
    state.currentLesson += 1;
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
    } else if (link.dataset.view === "revision") {
      if (state.answers.length) renderRevision();
      else {
        showView("home");
        showToast("Finish a quick check-in first to get your personal revision plan.");
      }
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
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

const date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
document.querySelector("#today-date").textContent = date;
renderDailyHours(Number(studyDaysInput.value), state.schedule);
document.querySelector("#auth-toggle").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  const originalText = submit.textContent;
  submit.textContent = authMode === "register" ? "Creating account…" : "Signing in…";
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.querySelector("#auth-email").value.trim(),
        password: document.querySelector("#auth-password").value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(FRIENDLY_ERROR);
    document.querySelector("#auth-password").value = "";
    const session = await fetch("/api/auth/session", { cache: "no-store" }).then((res) => res.json());
    await enterApp(session.user || result.user, session.progress);
  } catch (error) {
    console.error("Could not complete account request.", error);
    authError.textContent = FRIENDLY_ERROR;
  } finally {
    submit.disabled = false;
    submit.textContent = originalText;
  }
});
document.querySelector("#sign-out").addEventListener("click", async () => {
  await saveProgress(true);
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  signedIn = false;
  resetStudyState();
  sessionStorage.removeItem("studybuddy-session");
  appShell.hidden = true;
  authGate.hidden = false;
  setAuthMode("login");
  document.querySelector("#auth-password").value = "";
});
window.addEventListener("pagehide", () => saveProgress(true));
loadSignedInSession();
