const state = {
  schema: null,
  people: [],
  columns: {},
  summary: {},
  filters: {
    search: "",
    branch: "",
  },
  activeUid: null,
  auth: {
    configured: false,
    authenticated: false,
  },
  archives: {
    selected: null,
    list: [],
    files: [],
  },
  page: "dashboard",
  exports: {
    selected: null,
  },
};

const apiFetch = async (url, options = {}) => {
  const response = await fetch(url, options);
  if (response.status === 401) {
    await showAuthModal();
    throw new Error("Unauthorized");
  }
  return response;
};

const setTheme = (theme) => {
  document.body.dataset.theme = theme;
  localStorage.setItem("workflow-theme", theme);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
};

const initTheme = () => {
  const stored = localStorage.getItem("workflow-theme");
  const theme = stored || "dark";
  setTheme(theme);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const next = document.body.dataset.theme === "dark" ? "light" : "dark";
      setTheme(next);
    });
  }
};

const badgeClass = (type) => {
  switch (type) {
    case "success":
      return "badge badge--success";
    case "danger":
      return "badge badge--danger";
    default:
      return "badge badge--warning";
  }
};

const renderCard = (item) => {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.uid = item.uid || "";

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = item.name;

  const badge = document.createElement("span");
  badge.className = badgeClass(item.badge);
  badge.textContent = item.status;

  const meta = document.createElement("div");
  meta.className = "card__meta";
  meta.innerHTML = `<span>${item.manager}</span><span>•</span><span>${item.date}</span>`;

  card.append(title, badge, meta);
  return card;
};

const renderColumns = (columns) => {
  Object.entries(columns).forEach(([column, items]) => {
    const container = document.getElementById(column);
    if (!container) return;
    container.innerHTML = "";
    items.forEach((item) => {
      const card = renderCard(item);
      card.addEventListener("click", () => openModal(item.uid));
      container.appendChild(card);
    });
  });
};

const updateStats = () => {
  const notScheduled = document.getElementById("stat-not-scheduled");
  const neoScheduled = document.getElementById("stat-neo-scheduled");
  const inProgress = document.getElementById("stat-in-progress");
  const total = document.getElementById("stat-total");
  if (notScheduled) notScheduled.textContent = state.summary["not-scheduled"] ?? 0;
  if (neoScheduled) neoScheduled.textContent = state.summary["neo-scheduled"] ?? 0;
  if (inProgress) inProgress.textContent = state.summary["in-progress"] ?? 0;
  if (total) total.textContent = state.summary.total ?? 0;
};

const loadData = async () => {
  const params = new URLSearchParams();
  if (state.filters.search) params.set("search", state.filters.search);
  if (state.filters.branch) params.set("branch", state.filters.branch);
  try {
    const response = await apiFetch(`/api/people?${params.toString()}`);
    if (!response.ok) throw new Error("API unavailable");
    const payload = await response.json();
    state.people = payload.people || [];
    state.columns = payload.columns || {};
    state.summary = payload.summary || {};
    renderColumns(state.columns);
    updateStats();
  } catch (error) {
    renderColumns({});
  }
};

const fetchSchema = async () => {
  const response = await apiFetch("/api/schema");
  if (!response.ok) throw new Error("Schema unavailable");
  state.schema = await response.json();
  const branchFilter = document.getElementById("branch-filter");
  if (branchFilter) {
    branchFilter.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "All branches";
    branchFilter.appendChild(defaultOption);
    (state.schema.branches || []).forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      branchFilter.appendChild(option);
    });
  }
};

const fieldValue = (field, person) => {
  if (!person) return "";
  return person[field] ?? "";
};

const buildField = (field, person) => {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const label = document.createElement("label");
  label.textContent = field;

  let input;
  const codeMap = state.schema?.code_maps?.[field];
  if (field === "Notes") {
    input = document.createElement("textarea");
  } else if (codeMap) {
    input = document.createElement("select");
    codeMap.forEach(([labelText, value]) => {
      const option = document.createElement("option");
      option.value = labelText;
      option.textContent = labelText;
      const stored = fieldValue(field, person);
      if (labelText === stored || value === stored) {
        option.selected = true;
      }
      input.appendChild(option);
    });
  } else if (field === "Branch" && state.schema?.branches?.length) {
    input = document.createElement("select");
    state.schema.branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      if (branch === fieldValue(field, person)) {
        option.selected = true;
      }
      input.appendChild(option);
    });
  } else {
    input = document.createElement("input");
    input.type = "text";
  }

  input.name = field;
  input.value = fieldValue(field, person);

  wrapper.append(label, input);
  return wrapper;
};

const openModal = (uid = null) => {
  const modal = document.getElementById("modal");
  const form = document.getElementById("candidate-form");
  const title = document.getElementById("modal-title");
  const deleteButton = document.getElementById("delete-candidate");
  const archiveButton = document.getElementById("archive-candidate");
  if (!modal || !form || !state.schema) return;

  state.activeUid = uid;
  const person = state.people.find((item) => item.uid === uid) || null;

  form.innerHTML = "";
  (state.schema.fields || []).forEach((field) => {
    form.appendChild(buildField(field, person));
  });

  title.textContent = uid ? "Edit Candidate" : "Add Candidate";
  deleteButton.style.display = uid ? "inline-flex" : "none";
  if (archiveButton) {
    archiveButton.style.display = uid ? "inline-flex" : "none";
  }
  modal.classList.remove("hidden");
};

const closeModal = () => {
  const modal = document.getElementById("modal");
  if (modal) modal.classList.add("hidden");
  state.activeUid = null;
};

const collectFormData = () => {
  const form = document.getElementById("candidate-form");
  if (!form) return {};
  const data = {};
  Array.from(form.elements).forEach((element) => {
    if (!element.name) return;
    data[element.name] = element.value;
  });
  return data;
};

const saveCandidate = async (event) => {
  event.preventDefault();
  const payload = collectFormData();
  const url = state.activeUid ? `/api/people/${state.activeUid}` : "/api/people";
  const method = state.activeUid ? "PUT" : "POST";
  const response = await apiFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    alert("Save failed. Check WORKFLOW_PASSWORD or try again.");
    return;
  }
  closeModal();
  loadData();
};

const deleteCandidate = async () => {
  if (!state.activeUid) return;
  if (!confirm("Delete this candidate?")) return;
  const response = await apiFetch(`/api/people/${state.activeUid}`, { method: "DELETE" });
  if (!response.ok) {
    alert("Delete failed.");
    return;
  }
  closeModal();
  loadData();
};

const showAuthModal = async () => {
  const modal = document.getElementById("auth-modal");
  const title = document.getElementById("auth-title");
  if (!modal || !title) return;
  const response = await fetch("/api/auth/status");
  if (!response.ok) return false;
  const status = await response.json();
  state.auth = status;
  title.textContent = status.configured ? "Sign In" : "Create Program Password";
  if (status.authenticated) return true;
  modal.classList.remove("hidden");
  return await new Promise((resolve) => {
    const onSuccess = () => {
      window.removeEventListener('workflow:auth-success', onSuccess);
      window.removeEventListener('workflow:auth-cancel', onCancel);
      modal.classList.add('hidden');
      resolve(true);
    };
    const onCancel = () => {
      window.removeEventListener('workflow:auth-success', onSuccess);
      window.removeEventListener('workflow:auth-cancel', onCancel);
      modal.classList.add('hidden');
      resolve(false);
    };
    window.addEventListener('workflow:auth-success', onSuccess);
    window.addEventListener('workflow:auth-cancel', onCancel);
  });
};

const hideAuthModal = () => {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.add("hidden");
  if (!state.auth || !state.auth.authenticated) {
    window.dispatchEvent(new Event('workflow:auth-cancel'));
  }
};

const handleAuthSubmit = async (event) => {
  event.preventDefault();
  const password = document.getElementById("auth-password").value;
  const endpoint = state.auth.configured ? "/api/auth/login" : "/api/auth/setup";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    alert("Authentication failed.");
    return;
  }
  if (!state.auth) state.auth = {};
  state.auth.authenticated = true;
  if (!state.auth.configured) {
    state.auth.configured = true;
  }
  if (endpoint === "/api/auth/setup") {
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  }
  window.dispatchEvent(new Event('workflow:auth-success'));
  hideAuthModal();
  await fetchSchema();
  await loadData();
};

const openArchiveModal = () => {
  if (!state.activeUid) return;
  const modal = document.getElementById("archive-modal");
  if (modal) modal.classList.remove("hidden");
};

const closeArchiveModal = () => {
  const modal = document.getElementById("archive-modal");
  if (modal) modal.classList.add("hidden");
};

const submitArchive = async (event) => {
  event.preventDefault();
  if (!state.activeUid) return;
  const archivePassword = document.getElementById("archive-password").value;
  const startTime = document.getElementById("archive-start").value;
  const endTime = document.getElementById("archive-end").value;
  if (!archivePassword) {
    await showMessageModal('Missing password', 'Please enter an archive password before archiving.');
    return;
  }
  // Ensure person has required fields
  const person = state.people.find((p) => p.uid === state.activeUid) || {};
  const name = (person.Name || '').trim();
  const neo = (person['NEO Scheduled Date'] || '').trim();
  if (!name || !neo) {
    await showMessageModal('Missing information', 'Name and NEO Scheduled Date must be set before archiving.');
    return;
  }
  try {
    const response = await apiFetch(`/api/archive/${state.activeUid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archive_password: archivePassword,
        start_time: startTime,
        end_time: endTime,
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = (body && body.detail) ? body.detail : 'Archive failed.';
      await showMessageModal('Archive failed', msg);
      return;
    }
    closeArchiveModal();
    closeModal();
    loadData();
  } catch (err) {
    console.error('submitArchive error', err);
    await showMessageModal('Archive failed', 'Network or server error. Check logs.');
  }
};

const loadArchivesList = async () => {
  const response = await apiFetch("/api/archive/list");
  if (!response.ok) {
    await showMessageModal('Error', 'Unable to load archives.');
    return;
  }
  const payload = await response.json();
  state.archives.list = payload.archives || [];
  state.archives.selected = null;
  renderArchiveList();
  renderArchiveContents([]);
};

const renderArchiveList = () => {
  const list = document.getElementById("archives-list");
  if (!list) return;
  list.innerHTML = "";
  state.archives.list.forEach((archive) => {
    const item = document.createElement("li");
    item.className = "archive-item";
    if (archive === state.archives.selected) item.classList.add("archive-item--active");
    item.textContent = archive;
    item.addEventListener("click", () => {
      state.archives.selected = archive;
      renderArchiveList();
    });
    list.appendChild(item);
  });
};

// Prompt modal for archive password (returns string or null when cancelled)
const showArchivePasswordPrompt = async (archiveName) => {
  // Ensure authenticated first
  const authOk = await showAuthModal();
  if (!authOk) return null;
  return new Promise((resolve) => {
    const modal = document.getElementById('archive-password-modal');
    const form = document.getElementById('archive-password-form');
    const input = document.getElementById('archive-prompt-password');
    const close = document.getElementById('archive-password-close');
    const cancel = document.getElementById('archive-password-cancel');
    if (!modal || !form || !input) return resolve(null);
    input.value = '';
    initPasswordToggles();
    modal.classList.remove('hidden');
    input.focus();
    const cleanup = () => {
      modal.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      if (close) close.removeEventListener('click', onCancel);
      if (cancel) cancel.removeEventListener('click', onCancel);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const val = input.value;
      cleanup();
      resolve(val);
    };
    const onCancel = (e) => {
      e && e.preventDefault();
      cleanup();
      resolve(null);
    };
    form.addEventListener('submit', onSubmit);
    if (close) close.addEventListener('click', onCancel);
    if (cancel) cancel.addEventListener('click', onCancel);
  });
};

// Confirm delete modal: asks for program password and returns it, or null on cancel
const showDeleteArchiveModal = (archiveName) => {
  return new Promise((resolve) => {
    const modal = document.getElementById('archive-delete-modal');
    const form = document.getElementById('archive-delete-form');
    const input = document.getElementById('archive-delete-password');
    const close = document.getElementById('archive-delete-close');
    const cancel = document.getElementById('archive-delete-cancel');
    const message = document.getElementById('archive-delete-message');
    if (!modal || !form || !input || !message) return resolve(null);
    message.textContent = `Delete '${archiveName}' — this action cannot be undone.`;
    input.value = '';
    initPasswordToggles();
    modal.classList.remove('hidden');
    input.focus();
    const cleanup = () => {
      modal.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      if (close) close.removeEventListener('click', onCancel);
      if (cancel) cancel.removeEventListener('click', onCancel);
    };
    const onSubmit = (e) => {
      e.preventDefault();
      const val = input.value;
      cleanup();
      resolve(val);
    };
    const onCancel = (e) => {
      e && e.preventDefault();
      cleanup();
      resolve(null);
    };
    form.addEventListener('submit', onSubmit);
    if (close) close.addEventListener('click', onCancel);
    if (cancel) cancel.addEventListener('click', onCancel);
  });
};

// Small modal to show result messages
const showMessageModal = (title, message) => {
  return new Promise((resolve) => {
    const modal = document.getElementById('action-result-modal');
    if (!modal) return resolve();
    const t = document.getElementById('action-result-title');
    const m = document.getElementById('action-result-message');
    const ok = document.getElementById('action-result-ok');
    const close = document.getElementById('action-result-close');
    t.textContent = title || '';
    m.textContent = message || '';
    modal.classList.remove('hidden');
    const cleanup = () => {
      modal.classList.add('hidden');
      ok.removeEventListener('click', onClose);
      if (close) close.removeEventListener('click', onClose);
    };
    const onClose = (e) => {
      e && e.preventDefault();
      cleanup();
      resolve();
    };
    ok.addEventListener('click', onClose);
    if (close) close.addEventListener('click', onClose);
  });
};

const renderArchiveContents = (files) => {
  const list = document.getElementById("archives-contents");
  if (!list) return;
  list.innerHTML = "";
  files.forEach((file) => {
    const item = document.createElement("li");
    item.className = "archive-item";

    const row = document.createElement('div');
    row.className = 'archive-row';

    const name = document.createElement('span');
    name.className = 'archive-file-name';
    name.textContent = file.split('/').pop();
    name.title = file;
    name.style.cursor = 'pointer';
    name.addEventListener('click', () => { state.archives.selectedFile = file; viewArchiveFile(file); });

    row.append(name);
    item.appendChild(row);
    list.appendChild(item);
  });
};

const ARCHIVE_PW_TTL_MS = 10 * 60 * 1000; // 10 minutes

state.archives.passwordCache = {};

const cacheArchivePassword = (archiveName, pw) => {
  if (!archiveName || !pw) return;
  state.archives.passwordCache[archiveName] = { pw, expiresAt: Date.now() + ARCHIVE_PW_TTL_MS };
};

const getCachedArchivePassword = (archiveName) => {
  const entry = state.archives.passwordCache[archiveName];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete state.archives.passwordCache[archiveName];
    return null;
  }
  return entry.pw;
};

const getArchivePassword = async (archiveName) => {
  if (!archiveName) return null;
  const cached = getCachedArchivePassword(archiveName);
  if (cached) return cached;
  const pw = await showArchivePasswordPrompt(archiveName);
  if (pw) cacheArchivePassword(archiveName, pw);
  return pw;
};

const loadArchiveContents = async () => {
  if (!state.archives.selected) {
    await showMessageModal('No archive selected', 'Select an archive first.');
    return;
  }
  const password = await getArchivePassword(state.archives.selected);
  if (!password) return;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/contents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password }),
  });
  if (!response.ok) {
    await showMessageModal('Error', 'Unable to load archive contents.');
    return;
  }
  const payload = await response.json();
  state.archives.files = payload.files || [];
  renderArchiveContents(state.archives.files);
};

const downloadArchiveFile = async (internalPath) => {
  const password = await getArchivePassword(state.archives.selected);
  if (!password) return;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password, internal_path: internalPath }),
  });
  if (!response.ok) {
    await showMessageModal('Error', 'Unable to download file.');
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = internalPath.split("/").pop();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const loadExportsList = async () => {
  const response = await apiFetch("/api/exports/list");
  if (!response.ok) {
    alert("Unable to load exports.");
    return;
  }
  const payload = await response.json();
  const list = document.getElementById("exports-list");
  const preview = document.getElementById("exports-preview");
  const deleteButton = document.getElementById("exports-delete");
  const downloadButton = document.getElementById("download-selected");
  if (!list) return;
  list.innerHTML = "";
  state.exports.selected = null;
  if (deleteButton) deleteButton.disabled = true;
  if (downloadButton) downloadButton.disabled = true;
  (payload.files || []).forEach((file) => {
    const item = document.createElement("li");
    item.className = "archive-item";
    const row = document.createElement("div");
    row.className = "exports-file";
    const name = document.createElement("span");
    name.textContent = file;
    // Per-row download button removed — use the preview's Download or the topbar Download button
    row.append(name);
    item.appendChild(row);
    item.addEventListener("click", () => {
      document.querySelectorAll("#exports-list .archive-item").forEach((el) => {
        el.classList.remove("archive-item--active");
      });
      item.classList.add("archive-item--active");
      state.exports.selected = file;
      if (deleteButton) deleteButton.disabled = false;
      if (downloadButton) downloadButton.disabled = false;
      previewExport(file);
    });
    list.appendChild(item);
  });
  if (preview) {
    preview.textContent = "Select a CSV to preview.";
  }
};

const previewExport = async (file) => {
  const preview = document.getElementById("exports-preview");
  if (!preview) return;
  preview.textContent = "Loading preview...";
  const response = await apiFetch(`/api/exports/preview?name=${encodeURIComponent(file)}`);
  if (!response.ok) {
    preview.textContent = "Unable to load preview.";
    return;
  }
  const payload = await response.json();
  if (!payload.headers || !payload.rows) {
    preview.textContent = "No preview available.";
    return;
  }
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  payload.headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  payload.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  preview.innerHTML = "";
  preview.appendChild(table);
};

const switchPage = (page) => {
  if (!page) return;
  const target = document.getElementById(`page-${page}`) ? page : "dashboard";
  state.page = target;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("page--active", section.id === `page-${target}`);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.page === target);
  });
  const details = document.querySelector(".details");
  if (details) {
    details.style.display = target === "dashboard" ? "flex" : "none";
  }
  if (target === "exports") {
    loadExportsList();
  }
  if (target === "archives") {
    loadArchivesList();
  }
};

const deleteSelectedExport = async () => {
  if (!state.exports.selected) return;
  if (!confirm(`Delete ${state.exports.selected}?`)) return;
  const response = await apiFetch(
    `/api/exports/delete?name=${encodeURIComponent(state.exports.selected)}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    alert("Unable to delete export.");
    return;
  }
  loadExportsList();
};

const downloadSelectedExport = () => {
  if (!state.exports.selected) return;
  window.location.href = `/api/exports/file?name=${encodeURIComponent(state.exports.selected)}`;
};

const setupEventListeners = () => {
  const addButton = document.getElementById("add-candidate");
  const closeButton = document.getElementById("modal-close");
  const cancelButton = document.getElementById("cancel-candidate");
  const deleteButton = document.getElementById("delete-candidate");
  const archiveButton = document.getElementById("archive-candidate");
  const form = document.getElementById("candidate-form");
  const searchInput = document.getElementById("search-input");
  const branchFilter = document.getElementById("branch-filter");
  const exportButton = document.getElementById("export-csv");
  const weeklyButton = document.getElementById("weekly-tracker");
  const weeklyClose = document.getElementById("weekly-close");
  const weeklyCancel = document.getElementById("weekly-cancel");
  const weeklyForm = document.getElementById("weekly-form");
  const weeklyExport = document.getElementById("weekly-export");
  const archiveModalClose = document.getElementById("archive-close");
  const archiveModalCancel = document.getElementById("archive-cancel");
  const archiveForm = document.getElementById("archive-form");
  const archivesLoad = document.getElementById("archives-load");
  const authForm = document.getElementById("auth-form");
  const exportsRefresh = document.getElementById("exports-refresh");
  const exportsDelete = document.getElementById("exports-delete");
  const exportsDownload = document.getElementById("download-selected");

  if (addButton) addButton.addEventListener("click", () => openModal());
  if (closeButton) closeButton.addEventListener("click", closeModal);
  if (cancelButton) cancelButton.addEventListener("click", closeModal);
  if (deleteButton) deleteButton.addEventListener("click", deleteCandidate);
  if (archiveButton) archiveButton.addEventListener("click", openArchiveModal);
  if (form) form.addEventListener("submit", saveCandidate);
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      state.filters.search = event.target.value;
      loadData();
    });
  }
  if (branchFilter) {
    branchFilter.addEventListener("change", (event) => {
      state.filters.branch = event.target.value;
      loadData();
    });
  }
  if (exportButton) {
    exportButton.addEventListener("click", () => {
      window.location.href = "/api/export/csv";
      setTimeout(loadExportsList, 1200);
    });
  }
  if (weeklyButton) weeklyButton.addEventListener("click", openWeeklyTracker);
  if (weeklyClose) weeklyClose.addEventListener("click", closeWeeklyTracker);
  if (weeklyCancel) weeklyCancel.addEventListener("click", closeWeeklyTracker);
  if (weeklyForm) weeklyForm.addEventListener("submit", saveWeeklyTracker);
  if (weeklyExport) {
    weeklyExport.addEventListener("click", () => {
      window.location.href = "/api/weekly/summary";
    });
  }
  if (archiveModalClose) archiveModalClose.addEventListener("click", closeArchiveModal);
  if (archiveModalCancel) archiveModalCancel.addEventListener("click", closeArchiveModal);
  if (archiveForm) archiveForm.addEventListener("submit", submitArchive);
  if (archivesLoad) archivesLoad.addEventListener("click", loadArchiveContents);
  if (authForm) authForm.addEventListener("submit", handleAuthSubmit);
  if (authClose) authClose.addEventListener('click', hideAuthModal);
  if (exportsRefresh) exportsRefresh.addEventListener("click", loadExportsList);
  if (exportsDelete) exportsDelete.addEventListener("click", deleteSelectedExport);
  if (exportsDownload) exportsDownload.addEventListener("click", downloadSelectedExport);
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });
};

const openWeeklyTracker = async () => {
  const modal = document.getElementById("weekly-modal");
  const form = document.getElementById("weekly-form");
  const range = document.getElementById("weekly-range");
  if (!modal || !form) return;
  const response = await apiFetch("/api/weekly/current");
  if (!response.ok) {
    alert("Unable to load weekly tracker.");
    return;
  }
  const data = await response.json();
  form.innerHTML = "";
  if (range) {
    range.textContent = `Week of ${data.week_start} to ${data.week_end}`;
  }
  Object.entries(data.entries || {}).forEach(([day, info]) => {
    const container = document.createElement("div");
    container.className = "weekly__day";

    const header = document.createElement("div");
    header.className = "weekly__day-header";
    const title = document.createElement("div");
    title.className = "weekly__day-title";
    title.textContent = day;
    const timeWrap = document.createElement("div");
    timeWrap.className = "weekly__time";
    const startInput = document.createElement("input");
    startInput.type = "text";
    startInput.name = `${day}__start`;
    startInput.placeholder = "Start";
    startInput.value = info.start || "";
    const endInput = document.createElement("input");
    endInput.type = "text";
    endInput.name = `${day}__end`;
    endInput.placeholder = "End";
    endInput.value = info.end || "";
    timeWrap.append(startInput, endInput);
    header.append(title, timeWrap);

    const textarea = document.createElement("textarea");
    textarea.name = `${day}__content`;
    textarea.placeholder = "Activities";
    textarea.value = info.content || "";

    container.append(header, textarea);
    form.appendChild(container);
  });
  modal.classList.remove("hidden");
};

const closeWeeklyTracker = () => {
  const modal = document.getElementById("weekly-modal");
  if (modal) modal.classList.add("hidden");
};

const saveWeeklyTracker = async (event) => {
  event.preventDefault();
  const form = document.getElementById("weekly-form");
  if (!form) return;
  const entries = {};
  Array.from(form.elements).forEach((element) => {
    const [day, field] = element.name.split("__");
    if (!day || !field) return;
    entries[day] = entries[day] || { content: "", start: "", end: "" };
    entries[day][field] = element.value;
  });
  const response = await apiFetch("/api/weekly/current", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!response.ok) {
    alert("Unable to save weekly tracker.");
    return;
  }
  closeWeeklyTracker();
};

initTheme();
setupEventListeners();
fetch("/api/auth/status")
  .then((response) => response.json())
  .then((status) => {
    state.auth = status;
    if (!status.authenticated) {
      showAuthModal();
      return;
    }
    return fetchSchema().then(() => {
      switchPage("dashboard");
      return loadData();
    });
  })
  .catch(() => {
    showAuthModal();
  });
