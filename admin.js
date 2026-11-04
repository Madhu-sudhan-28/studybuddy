const loginPanel = document.querySelector("#admin-login-panel");
const loginForm = document.querySelector("#admin-login-form");
const loginError = document.querySelector("#admin-login-error");
const dashboard = document.querySelector("#admin-dashboard");
const loading = document.querySelector("#admin-loading");
const pageError = document.querySelector("#admin-error");
const logoutButton = document.querySelector("#admin-logout");
const imagesContainer = document.querySelector("#admin-images");
const usersContainer = document.querySelector("#admin-users");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const dateText = (timestamp) => new Date(Number(timestamp) * 1000).toLocaleString();
const sizeText = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(2)} MB`;

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
  document.querySelector("#stat-images").textContent = stats.images;
  renderImages(imagesResult.images);
  renderUsers(usersResult.users);
}

function renderImages(images) {
  imagesContainer.innerHTML = images.length ? images.map((image) => `
    <article class="image-card">
      <img src="${escapeHtml(image.previewUrl)}" alt="Uploaded study image" loading="lazy" />
      <div class="image-card-body">
        <strong title="${escapeHtml(image.file_name)}">${escapeHtml(image.file_name)}</strong>
        <small>${escapeHtml(image.email)}</small>
        <small>${sizeText(image.file_size)} · expires ${dateText(image.expires_at)}</small>
        <div class="image-actions">
          <a href="${escapeHtml(image.downloadUrl)}">Download</a>
          <button type="button" data-delete-image="${Number(image.id)}">Delete</button>
        </div>
      </div>
    </article>`).join("") : '<p class="empty">No retained images.</p>';
  imagesContainer.querySelectorAll("[data-delete-image]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Permanently delete this image?")) return;
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
  usersContainer.innerHTML = users.length ? users.map((user) => `
    <tr>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.auth_provider)}</td>
      <td>${dateText(user.created_at)}</td>
      <td>${Number(user.image_count)}</td>
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
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const password = document.querySelector("#admin-password");
  if (!password.value) {
    loginError.textContent = "Enter the admin password.";
    password.focus();
    return;
  }
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password.value }),
    });
    password.value = "";
    showState(true);
    await loadAdminData();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
    showState(false);
  } catch (error) {
    pageError.textContent = error.message;
  }
});
document.querySelector("#admin-refresh").addEventListener("click", () => loadAdminData().catch((error) => {
  pageError.textContent = error.message;
}));

api("/api/admin/session")
  .then(async (result) => {
    if (!result.configured) {
      showState(false);
      loginError.textContent = "Admin access is not configured. Set STUDYBUDDY_ADMIN_PASSWORD to a private password with at least 16 characters.";
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
