const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginError = document.querySelector("#admin-login-error");
const adminPassword = document.querySelector("#admin-password");
const passwordToggle = document.querySelector("#toggle-admin-password");
const passwordEyeOpen = document.querySelector("#password-eye-open");
const passwordEyeClosed = document.querySelector("#password-eye-closed");
const dashboard = document.querySelector("#admin-dashboard");
const loading = document.querySelector("#admin-loading");
const pageError = document.querySelector("#admin-error");
const logoutButton = document.querySelector("#admin-logout");
const imagesContainer = document.querySelector("#admin-images");
const usersContainer = document.querySelector("#admin-users");
const userHistoryPanel = document.querySelector("#user-history-panel");
const userHistoryTitle = document.querySelector("#user-history-title");
const userHistoryContent = document.querySelector("#user-history-content");
const userHistoryError = document.querySelector("#user-history-error");
const imagePreviewDialog = document.querySelector("#image-preview-dialog");
const imagePreview = document.querySelector("#image-preview");
const filePreviewFrame = document.querySelector("#file-preview-frame");
const filePreviewText = document.querySelector("#file-preview-text");
const filePreviewTruncated = document.querySelector("#file-preview-truncated");
const imagePreviewTitle = document.querySelector("#image-preview-title");
const imagePreviewError = document.querySelector("#image-preview-error");
const userHistoryCache = new Map();
const userHistoryFiles = new Map();
const adminRefreshButton = document.querySelector("#admin-refresh");
let selectedUserId = null;
let filePreviewRequest = 0;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const dateText = (timestamp) => new Date(Number(timestamp) * 1000).toLocaleString();
const sizeText = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB`;
const isImageFile = (file) => file.isImage === true ||
  (file.isImage !== false && String(file.content_type || file.contentType || "").startsWith("image/"));

function previewAttributes(file) {
  return `data-preview-file data-preview-url="${escapeHtml(file.previewUrl || "")}" data-preview-text-url="${escapeHtml(file.previewTextUrl || "")}" data-preview-type="${escapeHtml(file.content_type || file.contentType || "")}" data-preview-name="${escapeHtml(file.file_name || file.fileName || "Uploaded file")}"`;
}

function showState(isAdmin) {
  loading.hidden = true;
  loginPanel.hidden = isAdmin;
  dashboard.hidden = !isAdmin;
  logoutButton.hidden = !isAdmin;
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function loadAdminData() {
  pageError.textContent = "";
  const [statsResult, usersResult, imagesResult] = await Promise.all([
    api("/api/admin/stats"),
    api("/api/admin/users"),
    api("/api/admin/images"),
  ]);
  const stats = statsResult.stats;
  document.querySelector("#stat-users").textContent = stats.users;
  document.querySelector("#stat-active-users").textContent = stats.active_users;
  document.querySelector("#stat-disabled-users").textContent = stats.disabled_users;
  document.querySelector("#stat-plans").textContent = stats.study_plans;
  document.querySelector("#stat-images").textContent = stats.files ?? stats.images ?? 0;
  renderImages(imagesResult.images);
  renderUsers(usersResult.users);
}

function renderImages(images) {
  images = Array.isArray(images) ? images : [];
  imagesContainer.innerHTML = images.length ? images.map((image) => `
    <article class="image-card">
      ${isImageFile(image)
        ? `<button class="image-preview-button" type="button" ${previewAttributes(image)} aria-label="Preview ${escapeHtml(image.file_name)}"><img src="${escapeHtml(image.previewUrl)}" alt="" loading="lazy" /></button>`
        : `<button class="file-type-preview" type="button" ${previewAttributes(image)} aria-label="Preview ${escapeHtml(image.file_name)}">${escapeHtml(image.file_name.split(".").pop().toUpperCase())}</button>`}
      <div class="image-card-body">
        <strong title="${escapeHtml(image.file_name)}">${escapeHtml(image.file_name)}</strong>
        <small>${escapeHtml(image.email)}</small>
        <small>${sizeText(image.file_size)} · expires ${dateText(image.expires_at)}</small>
        <div class="image-actions">
          <button type="button" ${previewAttributes(image)}>Preview</button>
          <button type="button" data-delete-image="${Number(image.id)}">Delete</button>
        </div>
      </div>
    </article>`).join("") : '<p class="empty">No retained files.</p>';
  imagesContainer.querySelectorAll("[data-delete-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Permanently delete this file?")) return;
      try {
        await api(`/api/admin/images/${Number(button.dataset.deleteImage)}`, { method: "DELETE" });
        await loadAdminData();
      } catch (error) {
        pageError.textContent = error.message;
      }
    });
  });
}

function renderUsers(users) {
  users = Array.isArray(users) ? users : [];
  usersContainer.innerHTML = users.length ? users.map((user) => `
    <tr>
      <td><button class="user-history-link" type="button" data-user-history="${Number(user.id)}">${escapeHtml(user.email)}</button></td>
      <td>${escapeHtml(user.auth_provider)}</td>
      <td>${dateText(user.created_at)}</td>
      <td>${Number(user.file_count ?? user.image_count ?? user.fileCount ?? 0)}</td>
      <td>${user.is_disabled ? "Disabled" : "Active"}</td>
      <td class="actions">
        <button class="button secondary" type="button" data-user-action="${user.is_disabled ? "enable" : "disable"}" data-user-id="${Number(user.id)}">${user.is_disabled ? "Enable" : "Disable"}</button>
        <button class="button danger" type="button" data-user-action="delete" data-user-id="${Number(user.id)}">Delete</button>
      </td>
    </tr>`).join("") : '<tr><td colspan="6">No user accounts.</td></tr>';
  usersContainer.querySelectorAll("[data-user-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.userAction;
      const id = Number(button.dataset.userId);
      if (action === "delete" && !confirm("Permanently delete this account and its stored images?")) return;
      if (action === "disable" && !confirm("Disable this account and sign out its active sessions?")) return;
      try {
        if (action === "delete") await api(`/api/admin/users/${id}`, { method: "DELETE" });
        else await api(`/api/admin/users/${id}/${action}`, { method: "POST" });
        await loadAdminData();
      } catch (error) {
        pageError.textContent = error.message;
      }
    });
  });
  usersContainer.querySelectorAll("[data-user-history]").forEach((button) => {
    button.addEventListener("click", () => loadUserHistory(Number(button.dataset.userHistory)));
  });
}

function renderHistoryImages(images) {
  images = Array.isArray(images) ? images : [];
  return images.length ? `<div class="image-grid">${images.map((image) => `
    <article class="image-card">
      ${isImageFile(image)
        ? `<button class="image-preview-button" type="button" ${previewAttributes(image)} aria-label="Preview ${escapeHtml(image.file_name)}"><img src="${escapeHtml(image.previewUrl)}" alt="" loading="lazy" /></button>`
        : `<button class="file-type-preview" type="button" ${previewAttributes(image)} aria-label="Preview ${escapeHtml(image.file_name)}">${escapeHtml(image.file_name.split(".").pop().toUpperCase())}</button>`}
      <div class="image-card-body">
        <strong title="${escapeHtml(image.file_name)}">${escapeHtml(image.file_name)}</strong>
        <small>${sizeText(image.file_size)} · uploaded ${dateText(image.uploaded_at)} · expires ${dateText(image.expires_at)}</small>
        <div class="image-actions">
          <button type="button" ${previewAttributes(image)}>Preview</button>
        </div>
      </div>
    </article>`).join("")}</div>` : '<p class="empty">No retained files.</p>';
}

function renderUserHistory(result) {
  const history = Array.isArray(result.history) ? result.history : [];
  const unlinkedFiles = Array.isArray(result.unlinkedFiles)
    ? result.unlinkedFiles
    : Array.isArray(result.unlinkedImages) ? result.unlinkedImages : [];
  userHistoryTitle.textContent = `History for ${result.user.email}`;
  const histories = history.length ? history.map((item) => {
    const images = Array.isArray(item.images) ? item.images : Array.isArray(item.files) ? item.files : [];
    return `
    <article class="history-record">
      <div class="history-record-heading">
        <div><h3>${escapeHtml(item.title)}</h3><small>${dateText(item.createdAt)}</small></div>
        <div class="history-record-actions">
          <button class="button secondary" type="button" data-view-plan="${Number(item.id)}">View saved plan</button>
          ${images.length
            ? isImageFile(images.find(isImageFile) || images[0])
              ? `<button class="plan-image-thumbnail" type="button" ${previewAttributes(images.find(isImageFile) || images[0])} aria-label="Preview file uploaded for ${escapeHtml(item.title)}"><img src="${escapeHtml((images.find(isImageFile) || images[0]).previewUrl)}" alt="" loading="lazy" /></button>`
              : `<button class="plan-image-file" type="button" ${previewAttributes(images[0])}>Preview ${escapeHtml(images[0].file_name.split(".").pop().toUpperCase())}</button>`
            : '<span class="plan-image-missing">No saved files</span>'}
        </div>
      </div>
      <div class="user-plan-details" data-plan-details="${Number(item.id)}" hidden></div>
    </article>`;
  }).join("") : '<p class="empty">No saved study history.</p>';
  userHistoryFiles.clear();
  history.forEach((item) => userHistoryFiles.set(
    Number(item.id),
    Array.isArray(item.images) ? item.images : Array.isArray(item.files) ? item.files : [],
  ));
  const unlinkedImages = unlinkedFiles.length ? `
    <section class="history-uploads">
      <h3>Other retained files</h3>${renderHistoryImages(unlinkedFiles)}
    </section>` : "";
  userHistoryContent.innerHTML = `${histories}${unlinkedImages}`;
  userHistoryContent.querySelectorAll("[data-view-plan]").forEach((button) => {
    button.addEventListener("click", () => loadUserPlanDetails(
      Number(button.dataset.viewPlan),
      button,
    ));
  });
}

function openFilePreview(button) {
  const requestId = ++filePreviewRequest;
  imagePreviewTitle.textContent = button.dataset.previewName || "Uploaded file";
  imagePreviewError.hidden = true;
  imagePreview.hidden = true;
  filePreviewFrame.hidden = true;
  filePreviewText.hidden = true;
  filePreviewTruncated.hidden = true;
  imagePreview.removeAttribute("src");
  filePreviewFrame.removeAttribute("src");
  filePreviewText.textContent = "";
  imagePreviewDialog.showModal();
  const contentType = (button.dataset.previewType || "").toLowerCase();
  if (contentType.startsWith("image/")) {
    imagePreview.hidden = false;
    imagePreview.src = button.dataset.previewUrl;
    return;
  }
  if (contentType === "application/pdf") {
    filePreviewFrame.hidden = false;
    filePreviewFrame.src = button.dataset.previewUrl;
    return;
  }
  fetch(button.dataset.previewTextUrl, { cache: "no-store" })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (requestId !== filePreviewRequest) return;
      if (!response.ok) throw new Error(result.error || "This file preview could not be loaded.");
      filePreviewText.textContent = String(result.text || "");
      filePreviewTruncated.hidden = !result.truncated;
      filePreviewText.hidden = false;
    })
    .catch((error) => {
      if (requestId !== filePreviewRequest) return;
      imagePreviewError.textContent = error instanceof Error ? error.message : "This file preview could not be loaded.";
      imagePreviewError.hidden = false;
    });
}

async function loadUserHistory(userId, scrollToPanel = true) {
  selectedUserId = userId;
  userHistoryError.textContent = "";
  userHistoryContent.innerHTML = '<p class="loading">Loading this user’s history…</p>';
  userHistoryTitle.textContent = "User history";
  userHistoryPanel.dataset.userId = userId;
  userHistoryCache.clear();
  userHistoryFiles.clear();
  userHistoryPanel.hidden = false;
  if (scrollToPanel) userHistoryPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const result = await api(`/api/admin/users/${userId}/history`);
    renderUserHistory(result);
    return true;
  } catch (error) {
    userHistoryContent.innerHTML = "";
    userHistoryError.textContent = error.message;
    return false;
  }
}

async function loadUserPlanDetails(historyId, button) {
  const details = userHistoryContent.querySelector(`[data-plan-details="${historyId}"]`);
  if (!details) return;
  if (!details.hidden) {
    details.hidden = true;
    button.textContent = "View saved plan";
    return;
  }
  if (userHistoryCache.has(historyId)) {
    details.innerHTML = userHistoryCache.get(historyId);
    details.hidden = false;
    button.textContent = "Hide saved plan";
    return;
  }
  button.disabled = true;
  try {
    const activeUserId = Number(userHistoryPanel.dataset.userId);
    const result = await api(`/api/admin/users/${activeUserId}/history/${historyId}`);
    const progress = result.progress && typeof result.progress === "object" ? result.progress : {};
    const material = typeof progress.material === "string" ? progress.material : "";
    const images = userHistoryFiles.get(Number(historyId)) || [];
    const detailsHtml = `
      <section class="plan-images"><h4>Files attached to this plan</h4>${images.length
        ? renderHistoryImages(images)
        : '<p class="empty">No retained files are linked to this plan. Files are available here only if private storage was configured when uploaded and they have not expired.</p>'}</section>
      ${material ? `<h4>Study material</h4><pre>${escapeHtml(material)}</pre>` : ""}
      <h4>Saved progress</h4><pre>${escapeHtml(JSON.stringify(progress, null, 2))}</pre>
      `;
    userHistoryCache.set(historyId, detailsHtml);
    details.innerHTML = detailsHtml;
    details.hidden = false;
    button.textContent = "Hide saved plan";
  } catch (error) {
    userHistoryError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  if (!adminPassword.value) {
    loginError.textContent = "Enter the admin password.";
    adminPassword.focus();
    return;
  }
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword.value }),
    });
    adminPassword.value = "";
    adminPassword.type = "password";
    passwordToggle.setAttribute("aria-label", "Show password");
    passwordToggle.setAttribute("aria-pressed", "false");
    passwordEyeOpen.hidden = false;
    passwordEyeClosed.hidden = true;
    showState(true);
    await loadAdminData();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

passwordToggle.addEventListener("click", () => {
  const isVisible = adminPassword.type === "text";
  adminPassword.type = isVisible ? "password" : "text";
  passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  passwordToggle.setAttribute("aria-pressed", String(!isVisible));
  passwordEyeOpen.hidden = !isVisible;
  passwordEyeClosed.hidden = isVisible;
  adminPassword.focus();
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
    showState(false);
  } catch (error) {
    pageError.textContent = error.message;
  }
});
adminRefreshButton.addEventListener("click", async () => {
  if (adminRefreshButton.disabled) return;
  adminRefreshButton.disabled = true;
  adminRefreshButton.textContent = "Refreshing…";
  pageError.textContent = "";
  try {
    await loadAdminData();
    if (selectedUserId !== null && !userHistoryPanel.hidden) {
      const expandedHistoryIds = [...userHistoryContent.querySelectorAll(".user-plan-details:not([hidden])")]
        .map((details) => Number(details.dataset.planDetails));
      if (!await loadUserHistory(selectedUserId, false)) {
        throw new Error(userHistoryError.textContent || "User history could not be refreshed.");
      }
      for (const historyId of expandedHistoryIds) {
        const planButton = userHistoryContent.querySelector(`[data-view-plan="${historyId}"]`);
        if (planButton) await loadUserPlanDetails(historyId, planButton);
      }
    }
    adminRefreshButton.textContent = "Updated";
    setTimeout(() => {
      adminRefreshButton.textContent = "Refresh";
    }, 1200);
  } catch (error) {
    pageError.textContent = error.message;
    adminRefreshButton.textContent = "Refresh";
  } finally {
    adminRefreshButton.disabled = false;
  }
});
document.querySelector("#close-user-history").addEventListener("click", () => {
  userHistoryPanel.hidden = true;
  userHistoryContent.innerHTML = "";
  userHistoryCache.clear();
  userHistoryFiles.clear();
  selectedUserId = null;
});
dashboard.addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-preview-file]");
  if (previewButton) openFilePreview(previewButton);
});
imagePreview.addEventListener("error", () => {
  imagePreview.hidden = true;
  imagePreviewError.hidden = false;
});
imagePreviewDialog.addEventListener("close", () => {
  filePreviewRequest += 1;
  imagePreview.removeAttribute("src");
  filePreviewFrame.removeAttribute("src");
  filePreviewText.textContent = "";
});

api("/api/admin/session")
  .then(async (result) => {
    if (!result.configured) {
      showState(false);
      loginError.textContent = "Admin access is not configured. Set STUDYBUDDY_ADMIN_PASSWORD to at least 8 characters, including uppercase and lowercase letters, a number, and a symbol.";
      document.querySelector("#admin-password").disabled = true;
      loginForm.querySelector("button[type=submit]").disabled = true;
      return;
    }
    showState(result.authenticated);
    if (result.authenticated) await loadAdminData();
  })
  .catch((error) => {
    showState(false);
    loginError.textContent = error.message;
  });
