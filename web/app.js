(() => {
  if (window.__workflowAppInitialized) return;
  window.__workflowAppInitialized = true;

const state = {
  kanban: {
    columns: [],
    cards: [],
    selectedColumnId: null,
    activeColumnId: null,
    editingCardId: null,
    draggingCardId: null,
    piiCandidateId: null,
    detailsCardId: null,
    detailsRow: null,
    neoDateCandidateId: null,
    loaded: false,
  },
  auth: {
    configured: false,
    authenticated: false,
  },
  todos: [],
  data: {
    tables: [],
    tableId: null,
    columns: [],
    rows: [],
    query: "",
    selectedRowIds: new Set(),
  },
  flyouts: {
    weekly: false,
    todo: false,
  },
  page: "dashboard",
};

const workflowApi = window.workflowApi;

const $ = (id) => document.getElementById(id);

const initWindowControls = () => {
  const body = document.body;
  const platform = workflowApi && workflowApi.platform ? workflowApi.platform : "";
  const platformClass =
    platform === "darwin" ? "platform-mac" : platform === "win32" ? "platform-win" : "platform-linux";
  body.classList.add(platformClass);

  const controls = workflowApi && workflowApi.windowControls ? workflowApi.windowControls : null;
  const closeBtn = $("window-close");
  const minBtn = $("window-min");
  const maxBtn = $("window-max");
  if (!controls || !closeBtn || !minBtn || !maxBtn) return;

  closeBtn.addEventListener("click", () => controls.close());
  minBtn.addEventListener("click", () => controls.minimize());
  maxBtn.addEventListener("click", () => controls.toggleMaximize());

  const titlebar = document.querySelector(".titlebar");
  if (titlebar) {
    titlebar.addEventListener("dblclick", (event) => {
      if ((event.target && event.target.closest(".window-control")) || !controls) return;
      controls.toggleMaximize();
    });
  }
};

const positionFlyout = (panel) => {
  if (!panel) return;
  const header = document.querySelector(".page--active .topbar");
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const top = Math.max(24, Math.round(headerBottom + 16));
  panel.style.top = `${top}px`;
  panel.style.height = `calc(100% - ${top + 24}px)`;
};

const setPanelVisibility = (panel, isOpen) => {
  if (!panel) return;
  if (panel.dataset.animTimer) {
    clearTimeout(Number(panel.dataset.animTimer));
    delete panel.dataset.animTimer;
  }
  if (isOpen) {
    panel.classList.remove("hidden");
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
    });
    panel.setAttribute("aria-hidden", "false");
    return;
  }
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  const onEnd = (event) => {
    if (event.propertyName !== "opacity") return;
    panel.classList.add("hidden");
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
  const timer = window.setTimeout(() => {
    if (!panel.classList.contains("is-open")) {
      panel.classList.add("hidden");
    }
    panel.removeEventListener("transitionend", onEnd);
    delete panel.dataset.animTimer;
  }, 280);
  panel.dataset.animTimer = String(timer);
};

const showMessageModal = (title, message) => {
  const modal = $("action-result-modal");
  const titleEl = $("action-result-title");
  const messageEl = $("action-result-message");
  const ok = $("action-result-ok");
  const close = $("action-result-close");
  if (!modal || !titleEl || !messageEl || !ok) return Promise.resolve();
  titleEl.textContent = title || "";
  messageEl.textContent = message || "";
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const onClose = (e) => {
      e && e.preventDefault();
      modal.classList.add("hidden");
      ok.removeEventListener("click", onClose);
      if (close) close.removeEventListener("click", onClose);
      resolve();
    };
    ok.addEventListener("click", onClose);
    if (close) close.addEventListener("click", onClose);
  });
};

const sanitizeLetters = (value) => (value || "").replace(/[^a-zA-Z\s'-]/g, "");
const sanitizeNumbers = (value) => (value || "").replace(/\D/g, "");
const sanitizeAlphaNum = (value) => (value || "").replace(/[^a-zA-Z0-9\s-]/g, "");
const sanitizeAlphaNumTight = (value) => (value || "").replace(/[^a-zA-Z0-9]/g, "");
const sanitizeStateAbbrev = (value) =>
  (value || "").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();

const formatPhoneLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
};

const formatDateLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const isPhoneLikeValid = (value) => /^\d{3}-\d{3}-\d{4}$/.test(value);
const formatSsnLike = (value) => {
  const digits = sanitizeNumbers(value).slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
};
const isSsnLikeValid = (value) => /^\d{3}-\d{2}-\d{4}$/.test(value);

const parseWeeklyTime = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const meridiemMatch = raw.match(/\b([ap])(?:\.?m\.?)?\b/);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (!cleaned) return null;

  let hours = null;
  let minutes = null;

  if (cleaned.includes(":")) {
    const [h, m] = cleaned.split(":");
    if (!/^\d{1,2}$/.test(h || "") || !/^\d{1,2}$/.test(m || "")) return null;
    hours = Number(h);
    minutes = Number(m);
  } else {
    const digits = cleaned;
    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else if (digits.length === 3) {
      hours = Number(digits.slice(0, 1));
      minutes = Number(digits.slice(1));
    } else if (digits.length === 4) {
      hours = Number(digits.slice(0, 2));
      minutes = Number(digits.slice(2));
    } else {
      return null;
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "a") {
      hours = hours === 12 ? 0 : hours;
    } else {
      hours = hours === 12 ? 12 : hours + 12;
    }
  } else if (hours < 0 || hours > 23) {
    return null;
  }

  return hours * 60 + minutes;
};

const formatWeeklyHours = (minutes) => {
  if (minutes === null || minutes === undefined) return "—";
  const hours = minutes / 60;
  return Number.isFinite(hours) ? hours.toFixed(2) : "—";
};

const updateWeeklyHoursPill = (entries) => {
  const pill = $("weekly-hours-pill");
  if (!pill) return;
  const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  let totalMinutes = 0;
  let hasTotals = false;
  days.forEach((day) => {
    const entry = entries && entries[day] ? entries[day] : { start: "", end: "" };
    const startMinutes = parseWeeklyTime(entry.start || "");
    const endMinutes = parseWeeklyTime(entry.end || "");
    if (startMinutes !== null && endMinutes !== null) {
      let dayMinutes = endMinutes - startMinutes;
      if (dayMinutes < 0) dayMinutes += 24 * 60;
      totalMinutes += dayMinutes;
      hasTotals = true;
    }
  });
  const totalText = hasTotals ? formatWeeklyHours(totalMinutes) : "—";
  pill.textContent = `Total Hours: ${totalText}`;
};
const isDateLikeValid = (value) => /^\d{2}\/\d{2}\/(\d{2}|\d{4})$/.test(value);
const isFullDateValid = (value) => /^\d{2}\/\d{2}\/\d{4}$/.test(value);
const isoToSlashDate = (value) => {
  if (!value || typeof value !== "string") return "";
  const parts = value.split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  if (!year || !month || !day) return "";
  return `${month}/${day}/${year}`;
};
const slashToIsoDate = (value) => {
  if (!isFullDateValid(value)) return "";
  const [month, day, year] = value.split("/");
  return `${year}-${month}-${day}`;
};
const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
const normalizeValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value);
};
const hasValue = (value) => normalizeValue(value) !== "";
const formatMvrFlag = (value) => {
  const text = normalizeValue(value).toLowerCase();
  if (!text) return "";
  if (["1", "true", "yes"].includes(text)) return "Yes";
  if (["0", "false", "no"].includes(text)) return "No";
  return normalizeValue(value);
};

const initPasswordToggles = () => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = "1";
    const wrapper = document.createElement("div");
    wrapper.className = "password-wrapper";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-toggle";
    btn.title = "Show password";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = "👁️";
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? "🙈" : "👁️";
      btn.title = show ? "Hide password" : "Show password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
    });

    wrapper.appendChild(btn);
  });
};

const observeNewPasswordFields = () => {
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length) {
        initPasswordToggles();
        break;
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
};

const showAuthModal = async () => {
  const modal = $("auth-modal");
  const title = $("auth-title");
  if (!modal || !title) return false;
  if (!workflowApi) return false;
  const status = await workflowApi.authStatus();
  state.auth = status;
  title.textContent = status.configured ? "Sign In" : "Create Program Password";
  if (status.authenticated) return true;
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const onSuccess = () => {
      window.removeEventListener("workflow:auth-success", onSuccess);
      window.removeEventListener("workflow:auth-cancel", onCancel);
      modal.classList.add("hidden");
      resolve(true);
    };
    const onCancel = () => {
      window.removeEventListener("workflow:auth-success", onSuccess);
      window.removeEventListener("workflow:auth-cancel", onCancel);
      modal.classList.add("hidden");
      resolve(false);
    };
    window.addEventListener("workflow:auth-success", onSuccess);
    window.addEventListener("workflow:auth-cancel", onCancel);
  });
};

const hideAuthModal = () => {
  const modal = $("auth-modal");
  if (modal) modal.classList.add("hidden");
  if (!state.auth || !state.auth.authenticated) {
    window.dispatchEvent(new Event("workflow:auth-cancel"));
  }
};

const handleAuthSubmit = async (event) => {
  event.preventDefault();
  const submitBtn = $("auth-submit");
  if (submitBtn && submitBtn.dataset.submitting) return;
  const passwordEl = $("auth-password");
  const password = passwordEl ? passwordEl.value : "";
  if (!password) return;
  try {
    if (submitBtn) {
      submitBtn.dataset.submitting = "1";
      submitBtn.disabled = true;
    }
    const status = await workflowApi.authStatus();
    let ok = false;
    if (status.configured) {
      ok = await workflowApi.authLogin(password);
    } else {
      ok = await workflowApi.authSetup(password);
    }
    if (!ok) {
      await showMessageModal("Authentication failed", "Invalid password.");
      return;
    }
    state.auth = await workflowApi.authStatus();
    window.dispatchEvent(new Event("workflow:auth-success"));
    hideAuthModal();
    switchPage("dashboard");
    await loadKanban();
    await loadTodos();
  } catch (err) {
    console.error("Auth submit error", err);
    await showMessageModal("Error", "Unable to authenticate.");
  } finally {
    if (submitBtn) {
      submitBtn.dataset.submitting = "";
      submitBtn.disabled = false;
    }
  }
};

const showChangePasswordModal = () => {
  const modal = $("change-password-modal");
  if (!modal) return;
  const cur = $("change-current");
  const nw = $("change-new");
  const conf = $("change-confirm");
  if (cur) cur.value = "";
  if (nw) nw.value = "";
  if (conf) conf.value = "";
  initPasswordToggles();
  modal.classList.remove("hidden");
};

const hideChangePasswordModal = () => {
  const modal = $("change-password-modal");
  if (modal) modal.classList.add("hidden");
};

const handleChangePasswordSubmit = async (event) => {
  event.preventDefault();
  const current = $("change-current").value;
  const nw = $("change-new").value;
  const confirm = $("change-confirm").value;
  if (!current || !nw) {
    await showMessageModal("Missing fields", "Please enter current and new password.");
    return;
  }
  if (nw !== confirm) {
    await showMessageModal("Mismatch", "New password and confirmation do not match.");
    return;
  }
  const ok = await workflowApi.authChange(current, nw);
  if (!ok) {
    await showMessageModal("Error", "Unable to change password.");
    return;
  }
  await showMessageModal("Updated", "Password changed successfully.");
  hideChangePasswordModal();
};

const getColumnName = (columnId) => {
  const column = state.kanban.columns.find((col) => col.id === columnId);
  return column ? column.name : "";
};

const getDragAfterElement = (container, y) => {
  const draggableElements = [...container.querySelectorAll(".kanban-card:not(.dragging)")];
  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
};

const getOrderedIdsForColumn = (columnId) => {
  return state.kanban.cards
    .filter((card) => card.column_id === columnId)
    .sort(sortByOrder)
    .map((card) => card.uuid);
};

const applyOrderToColumn = (columnId, orderedIds) => {
  const columnCards = state.kanban.cards.filter((card) => card.column_id === columnId);
  const map = new Map(columnCards.map((card) => [card.uuid, card]));
  const seen = new Set();
  const ordered = [];
  orderedIds.forEach((id) => {
    const card = map.get(id);
    if (card && !seen.has(id)) {
      ordered.push(card);
      seen.add(id);
    }
  });
  columnCards
    .filter((card) => !seen.has(card.uuid))
    .sort(sortByOrder)
    .forEach((card) => ordered.push(card));
  ordered.forEach((card, index) => {
    card.order = index + 1;
  });
};

const renderKanbanCard = (cardData) => {
  const card = document.createElement("div");
  card.className = "kanban-card";
  card.draggable = true;
  card.dataset.cardId = cardData.uuid;

  const header = document.createElement("div");
  header.className = "kanban-card__header";

  const title = document.createElement("div");
  title.className = "kanban-card__title";
  title.textContent = cardData.candidate_name || "Unnamed Candidate";

  const actions = document.createElement("div");
  actions.className = "kanban-card__actions";

  const basicButton = document.createElement("button");
  basicButton.type = "button";
  basicButton.className = "kanban-card__pii";
  basicButton.textContent = "+ Basic Info";
  basicButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openCandidateModal("edit", cardData.column_id, cardData);
  });
  basicButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });

  const piiButton = document.createElement("button");
  piiButton.type = "button";
  piiButton.className = "kanban-card__pii";
  piiButton.textContent = "+ PII";
  piiButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openPiiModal(cardData);
  });
  piiButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });

  actions.append(basicButton, piiButton);
  header.append(title, actions);

  const meta = document.createElement("div");
  meta.className = "kanban-card__meta";

  const row = document.createElement("div");
  row.className = "kanban-card__row";
  const icims = document.createElement("span");
  const icimsLabel = document.createElement("span");
  icimsLabel.className = "kanban-card__label";
  icimsLabel.textContent = "ICIMS:";
  icims.append(icimsLabel, document.createTextNode(` ${cardData.icims_id || "—"}`));
  row.appendChild(icims);
  if (cardData.employee_id) {
    const emp = document.createElement("span");
    const empLabel = document.createElement("span");
    empLabel.className = "kanban-card__label";
    empLabel.textContent = "Employee:";
    emp.append(empLabel, document.createTextNode(` ${cardData.employee_id}`));
    row.appendChild(emp);
  }

  const jobRow = document.createElement("div");
  jobRow.className = "kanban-card__row";
  const jobText = [cardData.job_id, cardData.job_name].filter(Boolean).join(" · ");
  const jobSpan = document.createElement("span");
  const jobLabel = document.createElement("span");
  jobLabel.className = "kanban-card__label";
  jobLabel.textContent = "Job:";
  jobSpan.append(jobLabel, document.createTextNode(` ${jobText || "—"}`));
  const managerSpan = document.createElement("span");
  const managerLabel = document.createElement("span");
  managerLabel.className = "kanban-card__label";
  managerLabel.textContent = "Manager:";
  managerSpan.append(managerLabel, document.createTextNode(` ${cardData.manager || "—"}`));
  jobRow.append(jobSpan, managerSpan);

  const uuid = document.createElement("div");
  uuid.className = "kanban-card__uuid";
  uuid.textContent = cardData.uuid || "";

  meta.append(row, jobRow);
  card.append(header, meta, uuid);

  card.addEventListener("dragstart", (event) => {
    state.kanban.draggingCardId = cardData.uuid;
    card.classList.add("dragging");
    event.dataTransfer.setData("text/plain", cardData.uuid);
    event.dataTransfer.effectAllowed = "move";
  });

  card.addEventListener("dragend", () => {
    state.kanban.draggingCardId = null;
    card.classList.remove("dragging");
  });

  card.addEventListener("click", () => {
    if (state.kanban.draggingCardId) return;
    openDetailsDrawer(cardData);
  });
  card.addEventListener("dblclick", () => {
    if (state.kanban.draggingCardId) return;
    openCandidateModal("edit", cardData.column_id, cardData);
  });

  return card;
};

const createDetailsCard = (title, items) => {
  const filtered = items.filter((item) => hasValue(item.value));
  if (!filtered.length) return null;
  const card = document.createElement("div");
  card.className = "details-card";
  const titleEl = document.createElement("div");
  titleEl.className = "details-card__title";
  titleEl.textContent = title;
  card.appendChild(titleEl);
  filtered.forEach((item) => {
    const row = document.createElement("div");
    row.className = "details-item";
    const label = document.createElement("div");
    label.className = "details-item__label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "details-item__value";
    value.textContent = normalizeValue(item.value);
    row.append(label, value);
    card.appendChild(row);
  });
  return card;
};

const renderDetailsDrawer = () => {
  const drawer = $("details-drawer");
  const body = $("details-drawer-body");
  const title = $("details-drawer-name");
  const scheduled = $("details-drawer-scheduled");
  if (!drawer || !body || !title || !scheduled) return;

  const cardId = state.kanban.detailsCardId;
  const card = state.kanban.cards.find((item) => item.uuid === cardId);
  if (!card) {
    closeDetailsDrawer();
    return;
  }

  const row = state.kanban.detailsRow || {};
  const displayName =
    normalizeValue(card.candidate_name) || normalizeValue(row["Candidate Name"]) || "Candidate";
  title.textContent = displayName;

  const scheduledRaw = normalizeValue(row["Hire Date"]);
  const scheduledDate = /^\d{4}-\d{2}-\d{2}$/.test(scheduledRaw)
    ? isoToSlashDate(scheduledRaw)
    : scheduledRaw;
  scheduled.textContent = scheduledDate || "Click Here to Add Neo Date";
  scheduled.classList.remove("hidden");

  body.innerHTML = "";
  const cards = [];
  const jobText =
    [card.job_id, card.job_name].filter(Boolean).join(" · ") || normalizeValue(row["Job ID Name"]);
  const overview = createDetailsCard("Candidate Overview", [
    { label: "Job", value: jobText },
    { label: "Location", value: card.job_location || row["Job Location"] },
    { label: "Manager", value: card.manager || row["Manager"] },
    { label: "Branch", value: card.branch || row["Branch"] },
    { label: "ICIMS ID", value: card.icims_id || row["ICIMS ID"] },
    { label: "Employee ID", value: card.employee_id || row["Employee ID"] },
    { label: "Phone", value: row["Contact Phone"] },
    { label: "Email", value: row["Contact Email"] },
  ]);
  if (overview) cards.push(overview);

  const bank = createDetailsCard("Bank Info", [
    { label: "Bank Name", value: row["Bank Name"] },
    { label: "Account Type", value: row["Account Type"] },
    { label: "Routing Number", value: row["Routing Number"] },
    { label: "Account Number", value: row["Account Number"] },
  ]);
  if (bank) cards.push(bank);

  const emergency = createDetailsCard("Emergency Contact", [
    { label: "Name", value: row["Emergency Contact Name"] },
    { label: "Relationship", value: row["Emergency Contact Relationship"] },
    { label: "Phone", value: row["Emergency Contact Phone"] },
  ]);
  if (emergency) cards.push(emergency);

  const background = createDetailsCard("Background", [
    { label: "Provider", value: row["Background Provider"] },
    { label: "Cleared Date", value: row["Background Cleared Date"] },
    { label: "MVR Flag", value: formatMvrFlag(row["Background MVR Flag"]) },
  ]);
  if (background) cards.push(background);

  const licensing = createDetailsCard("Licensing", [
    { label: "License Type", value: row["License Type"] },
    { label: "MA CORI Status", value: row["MA CORI Status"] },
    { label: "MA CORI Date", value: row["MA CORI Date"] },
    { label: "NH GC Status", value: row["NH GC Status"] },
    { label: "NH GC Expiration", value: row["NH GC Expiration Date"] },
    { label: "NH GC ID", value: row["NH GC ID Number"] },
    { label: "ME GC Status", value: row["ME GC Status"] },
    { label: "ME GC Expiration", value: row["ME GC Expiration Date"] },
  ]);
  if (licensing) cards.push(licensing);

  const uniforms = createDetailsCard("Uniforms", [
    { label: "Shirt Size", value: row["Shirt Size"] },
    { label: "Pants Size", value: row["Pants Size"] },
    { label: "Boots Size", value: row["Boots Size"] },
  ]);
  if (uniforms) cards.push(uniforms);

  const identification = createDetailsCard("Identification", [
    { label: "ID Type", value: row["ID Type"] },
    { label: "State", value: row["State Abbreviation"] },
    { label: "ID Number", value: row["ID Number"] },
    { label: "DOB", value: row["DOB"] },
    { label: "EXP", value: row["EXP"] },
    { label: "Other ID Type", value: row["Other ID Type"] },
    { label: "Social", value: row["Social"] },
  ]);
  if (identification) cards.push(identification);

  const attendance = createDetailsCard("Neo Attendance", [
    { label: "Arrival", value: row["Neo Arrival Time"] },
    { label: "Departure", value: row["Neo Departure Time"] },
    { label: "Total Hours", value: row["Total Neo Hours"] },
  ]);
  if (attendance) cards.push(attendance);

  const notes = createDetailsCard("Notes", [
    { label: "Additional Details", value: row["Additional Details"] },
    { label: "Additional Notes", value: row["Additional Notes"] },
  ]);
  if (notes) cards.push(notes);

  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No details available yet.";
    body.appendChild(empty);
    return;
  }

  cards.forEach((cardEl) => body.appendChild(cardEl));
};

const refreshDetailsRow = async (candidateId) => {
  if (!candidateId) return;
  try {
    const result = await workflowApi.piiGet(candidateId);
    state.kanban.detailsRow = result ? result.row : null;
  } catch (error) {
    await showMessageModal(
      "Details Unavailable",
      "Unable to load candidate details. Please fully quit and relaunch the app."
    );
  }
};

const openDetailsDrawer = async (cardData) => {
  if (!cardData || !cardData.uuid) return;
  state.kanban.detailsCardId = cardData.uuid;
  state.kanban.detailsRow = null;
  setPanelVisibility($("details-drawer"), true);
  renderDetailsDrawer();
  await refreshDetailsRow(cardData.uuid);
  renderDetailsDrawer();
};

const closeDetailsDrawer = () => {
  state.kanban.detailsCardId = null;
  state.kanban.detailsRow = null;
  setPanelVisibility($("details-drawer"), false);
};

const sanitizeTimeInput = (input) => {
  if (!input) return "";
  const cleaned = input.value.replace(/\D/g, "").slice(0, 4);
  input.value = cleaned;
  return cleaned;
};

const openProcessModal = () => {
  if (!state.kanban.detailsCardId) return;
  const modal = $("process-modal");
  const arrival = $("process-arrival");
  const departure = $("process-departure");
  if (!modal) return;
  if (arrival) arrival.value = "";
  if (departure) departure.value = "";
  modal.classList.remove("hidden");
};

const closeProcessModal = () => {
  const modal = $("process-modal");
  if (modal) modal.classList.add("hidden");
};

const openNeoDateModal = () => {
  if (!state.kanban.detailsCardId) return;
  const modal = $("neo-date-modal");
  const input = $("neo-date-input");
  const picker = $("neo-date-picker");
  if (!modal || !input) return;
  state.kanban.neoDateCandidateId = state.kanban.detailsCardId;
  const row = state.kanban.detailsRow || {};
  const current = normalizeValue(row["Hire Date"]);
  const displayValue = /^\d{4}-\d{2}-\d{2}$/.test(current) ? isoToSlashDate(current) : current;
  input.value = displayValue;
  if (picker) picker.value = slashToIsoDate(displayValue);
  modal.classList.remove("hidden");
  input.focus();
  input.select();
};

const closeNeoDateModal = () => {
  const modal = $("neo-date-modal");
  if (modal) modal.classList.add("hidden");
  state.kanban.neoDateCandidateId = null;
};

const handleNeoDateSubmit = async (event) => {
  event.preventDefault();
  const candidateId = state.kanban.neoDateCandidateId || state.kanban.detailsCardId;
  if (!candidateId) return;
  const input = $("neo-date-input");
  const value = input ? normalizeValue(input.value) : "";
  if (value && !isFullDateValid(value)) {
    await showMessageModal("Invalid Format", "Neo Scheduled Date must be in MM/DD/YYYY format.");
    return;
  }
  try {
    await workflowApi.piiSave(candidateId, { "Hire Date": value });
  } catch (error) {
    await showMessageModal(
      "Save Failed",
      "Unable to save Neo Scheduled Date. Please fully quit and relaunch the app."
    );
    return;
  }
  await refreshDetailsRow(candidateId);
  renderDetailsDrawer();
  closeNeoDateModal();
};

const handleProcessConfirm = async () => {
  const candidateId = state.kanban.detailsCardId;
  if (!candidateId) return;
  const arrivalInput = $("process-arrival");
  const departureInput = $("process-departure");
  const arrival = sanitizeTimeInput(arrivalInput);
  const departure = sanitizeTimeInput(departureInput);
  if (arrival.length !== 4 || departure.length !== 4) {
    await showMessageModal(
      "Invalid Time",
      "Enter arrival and departure time as 4 digits in 24H format (e.g., 0824)."
    );
    return;
  }

  let result = null;
  try {
    result = await workflowApi.kanbanProcessCandidate({ candidateId, arrival, departure });
  } catch (error) {
    await showMessageModal(
      "Process Failed",
      "Unable to process candidate. Please fully quit and relaunch the app."
    );
    return;
  }

  if (result && result.ok === false) {
    await showMessageModal("Process Failed", result.message || "Unable to process candidate.");
    return;
  }

  if (result && result.cards) {
    state.kanban.cards = result.cards;
  } else if (result && result.card) {
    const idx = state.kanban.cards.findIndex((card) => card.uuid === result.card.uuid);
    if (idx >= 0) state.kanban.cards[idx] = result.card;
  }

  closeProcessModal();
  closeDetailsDrawer();
  renderKanbanBoard();
};

const handleProcessRemove = async () => {
  const candidateId = state.kanban.detailsCardId;
  if (!candidateId) return;
  let result = null;
  try {
    result = await workflowApi.kanbanRemoveCandidate(candidateId);
  } catch (error) {
    await showMessageModal(
      "Remove Failed",
      "Unable to remove candidate. Please fully quit and relaunch the app."
    );
    return;
  }

  if (result && result.ok === false) {
    await showMessageModal("Remove Failed", result.message || "Unable to remove candidate.");
    return;
  }

  if (result && result.columns) state.kanban.columns = result.columns;
  if (result && result.cards) state.kanban.cards = result.cards;
  closeProcessModal();
  closeDetailsDrawer();
  renderKanbanBoard();
  renderKanbanSettings();
};

const renderKanbanBoard = () => {
  const page = $("page-dashboard");
  if (!page || !page.classList.contains("page--active")) return;
  const board = $("kanban-board");
  const empty = $("kanban-empty");
  const layout = $("kanban-layout");
  if (!board || !empty) return;

  const columns = [...state.kanban.columns].sort(sortByOrder);
  const hasColumns = columns.length > 0;
  empty.classList.toggle("hidden", hasColumns);
  if (layout) layout.classList.toggle("hidden", !hasColumns);
  board.innerHTML = "";

  if (state.kanban.detailsCardId) {
    const exists = state.kanban.cards.some((card) => card.uuid === state.kanban.detailsCardId);
    if (!exists) closeDetailsDrawer();
  }

  columns.forEach((column) => {
    const columnEl = document.createElement("div");
    columnEl.className = "kanban__column";
    columnEl.dataset.columnId = column.id;

    const header = document.createElement("div");
    header.className = "kanban__column-header";
    const title = document.createElement("div");
    title.className = "kanban__column-title";
    title.textContent = column.name;
    const addBtn = document.createElement("button");
    addBtn.className = "icon-button";
    addBtn.type = "button";
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => openCandidateModal("add", column.id));
    header.append(title, addBtn);

    const body = document.createElement("div");
    body.className = "kanban__column-body";
    body.dataset.columnId = column.id;
    body.addEventListener("dragover", (event) => {
      if (!state.kanban.draggingCardId) return;
      event.preventDefault();
      body.classList.add("is-over");
      event.dataTransfer.dropEffect = "move";
      const afterElement = getDragAfterElement(body, event.clientY);
      const draggingEl = document.querySelector(
        `.kanban-card[data-card-id="${state.kanban.draggingCardId}"]`
      );
      if (draggingEl) {
        if (afterElement == null) {
          body.appendChild(draggingEl);
        } else {
          body.insertBefore(draggingEl, afterElement);
        }
      }
    });
    body.addEventListener("dragleave", () => {
      body.classList.remove("is-over");
    });
    body.addEventListener("drop", async (event) => {
      event.preventDefault();
      body.classList.remove("is-over");
      const cardId = event.dataTransfer.getData("text/plain");
      if (!cardId) return;
      const orderedIds = Array.from(body.querySelectorAll(".kanban-card")).map(
        (el) => el.dataset.cardId
      );
      await moveCardToColumn(cardId, column.id, orderedIds);
    });

    const cards = state.kanban.cards
      .filter((card) => card.column_id === column.id)
      .sort(sortByOrder);

    cards.forEach((cardData) => {
      body.appendChild(renderKanbanCard(cardData));
    });

    columnEl.append(header, body);
    board.appendChild(columnEl);
  });
};

const renderKanbanSettings = () => {
  const list = $("kanban-columns-list");
  const removeBtn = $("settings-remove-column");
  if (!list) return;
  list.innerHTML = "";
  const columns = [...state.kanban.columns].sort(sortByOrder);
  if (!columns.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No columns yet. Add one to start building your board.";
    list.appendChild(empty);
  }
  columns.forEach((column) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "kanban-chip";
    chip.textContent = column.name;
    chip.dataset.columnId = column.id;
    if (state.kanban.selectedColumnId === column.id) {
      chip.classList.add("kanban-chip--active");
    }
    chip.addEventListener("click", () => {
      state.kanban.selectedColumnId = column.id;
      renderKanbanSettings();
    });
    list.appendChild(chip);
  });
  if (removeBtn) removeBtn.disabled = !state.kanban.selectedColumnId;
};

const loadKanban = async () => {
  const payload = await workflowApi.kanbanGet();
  state.kanban.columns = payload.columns || [];
  state.kanban.cards = payload.cards || [];
  state.kanban.loaded = true;
  renderKanbanBoard();
  renderKanbanSettings();
  if (state.kanban.detailsCardId) {
    await refreshDetailsRow(state.kanban.detailsCardId);
    renderDetailsDrawer();
  }
};

const openAddColumnModal = () => {
  const modal = $("add-column-modal");
  const input = $("add-column-name");
  if (!modal || !input) return;
  input.value = "";
  modal.classList.remove("hidden");
  input.focus();
};

const closeAddColumnModal = () => {
  const modal = $("add-column-modal");
  if (modal) modal.classList.add("hidden");
};

const handleAddColumnSubmit = async (event) => {
  event.preventDefault();
  const input = $("add-column-name");
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  const payload = await workflowApi.kanbanAddColumn(name);
  state.kanban.columns = payload.columns || state.kanban.columns;
  closeAddColumnModal();
  renderKanbanBoard();
  renderKanbanSettings();
};

const removeSelectedColumn = async () => {
  const columnId = state.kanban.selectedColumnId;
  if (!columnId) return;
  const payload = await workflowApi.kanbanRemoveColumn(columnId);
  if (payload && payload.ok === false) {
    await showMessageModal("Delete Blocked", payload.message || "Unable to delete column.");
    return;
  }
  state.kanban.columns = payload.columns || [];
  state.kanban.cards = payload.cards || [];
  state.kanban.selectedColumnId = null;
  renderKanbanBoard();
  renderKanbanSettings();
};

const openCandidateModal = (mode, columnId, cardData = null) => {
  const modal = $("candidate-modal");
  if (!modal) return;
  const title = $("candidate-modal-title");
  const subtitle = $("candidate-modal-subtitle");
  const submit = $("candidate-submit");
  const nameInput = $("candidate-name");
  const icimsInput = $("candidate-icims");
  const empInput = $("candidate-employee");
  const phoneInput = $("candidate-phone");
  const emailInput = $("candidate-email");
  const jobIdInput = $("candidate-job-id");
  const jobNameInput = $("candidate-job-name");
  const jobLocationInput = $("candidate-job-location");
  const managerInput = $("candidate-manager");
  const branchSelect = $("candidate-branch");
  const branchOther = $("candidate-branch-other");

  state.kanban.activeColumnId = columnId;
  state.kanban.editingCardId = mode === "edit" ? (cardData && cardData.uuid) : null;

  if (title) title.textContent = mode === "edit" ? "Edit Candidate" : "Add Candidate";
  if (submit) submit.textContent = mode === "edit" ? "Save Changes" : "Add Candidate";
  if (subtitle) {
    const columnName = getColumnName(columnId);
    subtitle.textContent = columnName ? `Column: ${columnName}` : "";
  }

  const fill = (input, value) => {
    if (input) input.value = value || "";
  };

  if (mode === "edit" && cardData) {
    fill(nameInput, cardData.candidate_name);
    fill(icimsInput, cardData.icims_id);
    fill(empInput, cardData.employee_id);
    fill(phoneInput, "");
    fill(emailInput, "");
    fill(jobIdInput, cardData.job_id);
    fill(jobNameInput, cardData.job_name);
    fill(jobLocationInput, cardData.job_location);
    fill(managerInput, cardData.manager);
    if (branchSelect) {
      const branchValue = cardData.branch || "";
      const isOther = !["Salem", "Portland", "Other", ""].includes(branchValue);
      branchSelect.value = isOther ? "Other" : branchValue;
      if (branchOther) {
        branchOther.classList.toggle("hidden", !isOther && branchSelect.value !== "Other");
        branchOther.value = isOther ? branchValue : "";
      }
    }

    workflowApi
      .piiGet(cardData.uuid)
      .then((result) => {
        if (state.kanban.editingCardId !== cardData.uuid) return;
        const row = (result && result.row) || {};
        fill(phoneInput, row["Contact Phone"]);
        fill(emailInput, row["Contact Email"]);
      })
      .catch(() => {});
  } else {
    fill(nameInput, "");
    fill(icimsInput, "");
    fill(empInput, "");
    fill(phoneInput, "");
    fill(emailInput, "");
    fill(jobIdInput, "");
    fill(jobNameInput, "");
    fill(jobLocationInput, "");
    fill(managerInput, "");
    if (branchSelect) branchSelect.value = "";
    if (branchOther) {
      branchOther.value = "";
      branchOther.classList.add("hidden");
    }
  }

  modal.classList.remove("hidden");
  if (nameInput) nameInput.focus();
};

const closeCandidateModal = () => {
  const modal = $("candidate-modal");
  if (modal) modal.classList.add("hidden");
  state.kanban.activeColumnId = null;
  state.kanban.editingCardId = null;
};

const getPossessiveName = (name) => {
  const trimmed = (name || "").trim();
  if (!trimmed) return "Candidate's Personal Information";
  const suffix = trimmed.toLowerCase().endsWith("s") ? "'" : "'s";
  return `${trimmed}${suffix} Personal Information`;
};

const toggleLicenseSections = (value) => {
  const ma = $("pii-license-ma");
  const nh = $("pii-license-nh");
  const me = $("pii-license-me");
  if (ma) ma.classList.add("hidden");
  if (nh) nh.classList.add("hidden");
  if (me) me.classList.add("hidden");
  if (value === "MA CORI" && ma) ma.classList.remove("hidden");
  if (value === "NH GC" && nh) nh.classList.remove("hidden");
  if (value === "ME GC" && me) me.classList.remove("hidden");
};

const toggleIdFields = (value) => {
  const row = $("pii-id-row");
  const dates = $("pii-id-dates");
  const state = $("pii-id-state");
  const otherType = $("pii-id-other-type");
  const idNumber = $("pii-id-number");
  const dob = $("pii-id-dob");
  const exp = $("pii-id-exp");
  const social = $("pii-social");

  const hasType = !!value;
  const needsState = ["Driver's License", "State ID", "Other"].includes(value);
  const needsOther = value === "Other";

  if (row) row.classList.toggle("hidden", !hasType);
  if (dates) dates.classList.toggle("hidden", !hasType);

  if (state) {
    if (hasType && needsState) {
      state.classList.remove("hidden");
    } else {
      state.classList.add("hidden");
      state.value = "";
    }
  }

  if (otherType) {
    if (hasType && needsOther) {
      otherType.classList.remove("hidden");
    } else {
      otherType.classList.add("hidden");
      otherType.value = "";
    }
  }

  if (social) {
    if (hasType) {
      social.classList.remove("hidden");
    } else {
      social.classList.add("hidden");
      social.value = "";
    }
  }

  if (!hasType) {
    if (idNumber) idNumber.value = "";
    if (dob) dob.value = "";
    if (exp) exp.value = "";
  }
};

const toggleBackgroundDate = (value) => {
  const dateInput = $("pii-background-date");
  if (!dateInput) return;
  if (value) {
    dateInput.classList.remove("hidden");
  } else {
    dateInput.classList.add("hidden");
    dateInput.value = "";
  }
};

const updateBackgroundMvrFlag = (value) => {
  const flag = $("pii-background-mvr");
  if (!flag) return;
  if (value && value.toLowerCase().includes("mvr")) {
    flag.value = "2";
  } else {
    flag.value = "1";
  }
};

const openPiiModal = async (cardData) => {
  const modal = $("pii-modal");
  if (!modal || !cardData) return;
  const title = $("pii-modal-title");
  state.kanban.piiCandidateId = cardData.uuid;

  let result = null;
  try {
    result = await workflowApi.piiGet(cardData.uuid);
  } catch (error) {
    await showMessageModal(
      "PII Unavailable",
      "PII handlers are not available. Please fully quit and relaunch the app."
    );
    return;
  }
  const row = (result && result.row) || {};
  const displayName = result && result.candidateName ? result.candidateName : cardData.candidate_name;

  if (title) title.textContent = getPossessiveName(displayName);

  const setValue = (id, value) => {
    const input = $(id);
    if (input) input.value = value || "";
  };

  setValue("pii-background-provider", row["Background Provider"]);
  setValue("pii-background-date", row["Background Cleared Date"]);
  setValue("pii-background-mvr", row["Background MVR Flag"] || "1");
  setValue("pii-license-type", row["License Type"]);
  setValue("pii-cori-status", row["MA CORI Status"]);
  setValue("pii-cori-date", row["MA CORI Date"]);
  setValue("pii-nh-status", row["NH GC Status"]);
  setValue("pii-nh-expiration", row["NH GC Expiration Date"]);
  setValue("pii-nh-id", row["NH GC ID Number"]);
  setValue("pii-me-status", row["ME GC Status"]);
  setValue("pii-me-expiration", row["ME GC Expiration Date"]);
  setValue("pii-bank-name", row["Bank Name"]);
  setValue("pii-account-type", row["Account Type"]);
  setValue("pii-routing", row["Routing Number"]);
  setValue("pii-account", row["Account Number"]);
  setValue("pii-shirt", row["Shirt Size"]);
  setValue("pii-pants", row["Pants Size"]);
  setValue("pii-boots", row["Boots Size"]);
  setValue("pii-emergency-name", row["Emergency Contact Name"]);
  setValue("pii-emergency-relationship", row["Emergency Contact Relationship"]);
  setValue("pii-emergency-phone", row["Emergency Contact Phone"]);
  setValue("pii-id-type", row["ID Type"]);
  setValue("pii-id-state", row["State Abbreviation"]);
  setValue("pii-id-number", row["ID Number"]);
  setValue("pii-id-dob", row["DOB"]);
  setValue("pii-id-exp", row["EXP"]);
  setValue("pii-id-other-type", row["Other ID Type"]);
  setValue("pii-social", row["Social"]);
  setValue("pii-additional-details", row["Additional Details"]);

  const providerValue = row["Background Provider"] || "";
  toggleBackgroundDate(providerValue);
  updateBackgroundMvrFlag(providerValue);
  toggleLicenseSections(row["License Type"]);
  toggleIdFields(row["ID Type"]);

  modal.classList.remove("hidden");
};

const closePiiModal = () => {
  const modal = $("pii-modal");
  if (modal) modal.classList.add("hidden");
  state.kanban.piiCandidateId = null;
};

const collectPiiPayload = () => {
  const value = (id) => ($(id) ? $(id).value.trim() : "");
  return {
    "Background Provider": value("pii-background-provider"),
    "Background Cleared Date": value("pii-background-date"),
    "Background MVR Flag": value("pii-background-mvr") || "1",
    "License Type": value("pii-license-type"),
    "MA CORI Status": value("pii-cori-status"),
    "MA CORI Date": value("pii-cori-date"),
    "NH GC Status": value("pii-nh-status"),
    "NH GC Expiration Date": value("pii-nh-expiration"),
    "NH GC ID Number": value("pii-nh-id"),
    "ME GC Status": value("pii-me-status"),
    "ME GC Expiration Date": value("pii-me-expiration"),
    "Bank Name": value("pii-bank-name"),
    "Account Type": value("pii-account-type"),
    "Routing Number": value("pii-routing"),
    "Account Number": value("pii-account"),
    "Shirt Size": value("pii-shirt"),
    "Pants Size": value("pii-pants"),
    "Boots Size": value("pii-boots"),
    "Emergency Contact Name": value("pii-emergency-name"),
    "Emergency Contact Relationship": value("pii-emergency-relationship"),
    "Emergency Contact Phone": value("pii-emergency-phone"),
    "ID Type": value("pii-id-type"),
    "State Abbreviation": value("pii-id-state"),
    "ID Number": value("pii-id-number"),
    "DOB": value("pii-id-dob"),
    "EXP": value("pii-id-exp"),
    "Other ID Type": value("pii-id-other-type"),
    "Social": value("pii-social"),
    "Additional Details": value("pii-additional-details"),
  };
};

const validatePiiPayload = async (payload) => {
  const phoneFields = [{ label: "Emergency Contact Phone", value: payload["Emergency Contact Phone"] }];
  const dateFields = [
    { label: "Background Cleared Date", value: payload["Background Cleared Date"] },
    { label: "MA CORI Date", value: payload["MA CORI Date"] },
    { label: "NH GC Expiration Date", value: payload["NH GC Expiration Date"] },
    { label: "ME GC Expiration Date", value: payload["ME GC Expiration Date"] },
    { label: "DOB", value: payload["DOB"] },
    { label: "EXP", value: payload["EXP"] },
  ];

  for (const field of phoneFields) {
    if (field.value && !isPhoneLikeValid(field.value)) {
      await showMessageModal("Invalid Format", `${field.label} must be in 123-123-1234 format.`);
      return false;
    }
  }

  for (const field of dateFields) {
    if (field.value && !isDateLikeValid(field.value)) {
      await showMessageModal("Invalid Format", `${field.label} must be in MM/DD/YY or MM/DD/YYYY format.`);
      return false;
    }
  }

  if (payload["Routing Number"] && payload["Routing Number"].length > 9) {
    await showMessageModal("Invalid Routing Number", "Routing Number must be 9 digits or fewer.");
    return false;
  }

  if (payload["Account Number"] && payload["Account Number"].length > 20) {
    await showMessageModal("Invalid Account Number", "Account Number must be 20 digits or fewer.");
    return false;
  }

  if (payload["ID Type"]) {
    if (!payload["DOB"] || !payload["EXP"]) {
      await showMessageModal("Missing Dates", "DOB and EXP are required for the selected ID Type.");
      return false;
    }
  }

  if (payload["ID Type"] === "Other" && !payload["Other ID Type"]) {
    await showMessageModal("Missing ID Type", "Other ID Type is required when ID Type is Other.");
    return false;
  }

  if (payload["Social"] && payload["Social"].length === 11 && !isSsnLikeValid(payload["Social"])) {
    await showMessageModal("Invalid Format", "Social must be in 123-45-6789 format.");
    return false;
  }

  if (["Driver's License", "State ID", "Other"].includes(payload["ID Type"])) {
    if (!/^[A-Z]{2}$/.test(payload["State Abbreviation"] || "")) {
      await showMessageModal("Invalid State", "State Abbreviation must be 2 letters.");
      return false;
    }
  }

  return true;
};

const handlePiiSubmit = async (event) => {
  event.preventDefault();
  const candidateId = state.kanban.piiCandidateId;
  if (!candidateId) return;
  const payload = collectPiiPayload();
  const ok = await validatePiiPayload(payload);
  if (!ok) return;
  try {
    await workflowApi.piiSave(candidateId, payload);
  } catch (error) {
    await showMessageModal(
      "Save Failed",
      "Unable to save PII. Please fully quit and relaunch the app."
    );
    return;
  }
  if (state.kanban.detailsCardId === candidateId) {
    await refreshDetailsRow(candidateId);
    renderDetailsDrawer();
  }
  closePiiModal();
};

const buildCandidatePayload = () => {
  const nameInput = $("candidate-name");
  const icimsInput = $("candidate-icims");
  const empInput = $("candidate-employee");
  const phoneInput = $("candidate-phone");
  const emailInput = $("candidate-email");
  const jobIdInput = $("candidate-job-id");
  const jobNameInput = $("candidate-job-name");
  const jobLocationInput = $("candidate-job-location");
  const managerInput = $("candidate-manager");
  const branchSelect = $("candidate-branch");
  const branchOther = $("candidate-branch-other");

  const branchValue = branchSelect && branchSelect.value === "Other"
    ? (branchOther && branchOther.value.trim()) || "Other"
    : (branchSelect && branchSelect.value) || "";

  return {
    column_id: state.kanban.activeColumnId,
    candidate_name: nameInput ? nameInput.value.trim() : "",
    icims_id: icimsInput ? icimsInput.value.trim() : "",
    employee_id: empInput ? empInput.value.trim() : "",
    contact_phone: phoneInput ? phoneInput.value.trim() : "",
    contact_email: emailInput ? emailInput.value.trim() : "",
    job_id: jobIdInput ? jobIdInput.value.trim() : "",
    job_name: jobNameInput ? jobNameInput.value.trim() : "",
    job_location: jobLocationInput ? jobLocationInput.value.trim() : "",
    manager: managerInput ? managerInput.value.trim() : "",
    branch: branchValue,
  };
};

const handleCandidateSubmit = async (event) => {
  event.preventDefault();
  const payload = buildCandidatePayload();
  if (!payload.column_id) {
    await showMessageModal("Missing Column", "Select a column before adding a candidate.");
    return;
  }
  if (!payload.candidate_name) {
    await showMessageModal("Missing Name", "Candidate Name is required.");
    return;
  }
  if (payload.contact_phone && !isPhoneLikeValid(payload.contact_phone)) {
    await showMessageModal("Invalid Format", "Contact Phone must be in 123-123-1234 format.");
    return;
  }
  if (payload.contact_email) {
    const emailInput = $("candidate-email");
    if (emailInput && !emailInput.checkValidity()) {
      await showMessageModal("Invalid Email", "Please enter a valid email address.");
      return;
    }
  }

  if (state.kanban.editingCardId) {
    const data = await workflowApi.kanbanUpdateCard(state.kanban.editingCardId, payload);
    state.kanban.cards = data.cards || state.kanban.cards;
  } else {
    const data = await workflowApi.kanbanAddCard(payload);
    if (data.card) {
      state.kanban.cards.push(data.card);
    } else if (data.cards) {
      state.kanban.cards = data.cards;
    }
  }
  closeCandidateModal();
  renderKanbanBoard();
  if (state.kanban.detailsCardId) {
    await refreshDetailsRow(state.kanban.detailsCardId);
    renderDetailsDrawer();
  }
};

const persistColumnOrder = async (columnId) => {
  if (!columnId) return;
  const orderedIds = getOrderedIdsForColumn(columnId);
  const data = await workflowApi.kanbanReorderColumn(columnId, orderedIds);
  if (data.cards) state.kanban.cards = data.cards;
};

const moveCardToColumn = async (cardId, columnId, orderedIds = null) => {
  const card = state.kanban.cards.find((item) => item.uuid === cardId);
  if (!card) return;
  const fromColumnId = card.column_id;
  const sameColumn = fromColumnId === columnId;
  if (sameColumn && !orderedIds) return;

  if (!sameColumn) {
    card.column_id = columnId;
  }

  if (orderedIds && orderedIds.length) {
    applyOrderToColumn(columnId, orderedIds);
  } else if (!sameColumn) {
    const maxOrder = Math.max(
      0,
      ...state.kanban.cards
        .filter((item) => item.column_id === columnId)
        .map((item) => item.order || 0)
    );
    card.order = maxOrder + 1;
  }

  if (!sameColumn && fromColumnId) {
    applyOrderToColumn(fromColumnId, getOrderedIdsForColumn(fromColumnId));
  }

  renderKanbanBoard();

  try {
    if (!sameColumn) {
      await workflowApi.kanbanUpdateCard(cardId, { column_id: columnId });
    }
    await persistColumnOrder(columnId);
    if (!sameColumn && fromColumnId) {
      await persistColumnOrder(fromColumnId);
    }
  } catch (error) {
    console.error("Move card error", error);
    await loadKanban();
  }
};

const initCandidateInputs = () => {
  const nameInput = $("candidate-name");
  const jobLocationInput = $("candidate-job-location");
  const managerInput = $("candidate-manager");
  const branchOther = $("candidate-branch-other");
  const icimsInput = $("candidate-icims");
  const empInput = $("candidate-employee");
  const branchSelect = $("candidate-branch");
  const contactPhone = $("candidate-phone");

  const letterInputs = [nameInput, jobLocationInput, managerInput, branchOther].filter(Boolean);
  letterInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = sanitizeLetters(input.value);
    });
  });

  const numericInputs = [icimsInput, empInput].filter(Boolean);
  numericInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = sanitizeNumbers(input.value).slice(0, 12);
    });
  });

  if (contactPhone) {
    contactPhone.addEventListener("input", () => {
      contactPhone.value = formatPhoneLike(contactPhone.value);
    });
  }

  if (branchSelect && branchOther) {
    branchSelect.addEventListener("change", () => {
      if (branchSelect.value === "Other") {
        branchOther.classList.remove("hidden");
      } else {
        branchOther.classList.add("hidden");
        branchOther.value = "";
      }
    });
  }
};

const initPiiInputs = () => {
  const backgroundDate = $("pii-background-date");
  const coriDate = $("pii-cori-date");
  const nhExpiration = $("pii-nh-expiration");
  const meExpiration = $("pii-me-expiration");
  const idDob = $("pii-id-dob");
  const idExp = $("pii-id-exp");
  const emergencyPhone = $("pii-emergency-phone");
  const dateInputs = [backgroundDate, coriDate, nhExpiration, meExpiration, idDob, idExp].filter(Boolean);
  dateInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatDateLike(input.value);
    });
  });

  if (emergencyPhone) {
    emergencyPhone.addEventListener("input", () => {
      emergencyPhone.value = formatPhoneLike(emergencyPhone.value);
    });
  }

  const bankName = $("pii-bank-name");
  const emergencyName = $("pii-emergency-name");
  const emergencyRelationship = $("pii-emergency-relationship");
  [bankName, emergencyName, emergencyRelationship].filter(Boolean).forEach((input) => {
    input.addEventListener("input", () => {
      input.value = sanitizeLetters(input.value);
    });
  });

  const alphaNumInputs = [$("pii-shirt"), $("pii-pants"), $("pii-boots"), $("pii-nh-id")].filter(Boolean);
  alphaNumInputs.forEach((input) => {
    input.addEventListener("input", () => {
      input.value = sanitizeAlphaNum(input.value);
    });
  });

  const idType = $("pii-id-type");
  if (idType) {
    idType.addEventListener("change", () => {
      toggleIdFields(idType.value);
    });
  }

  const idState = $("pii-id-state");
  if (idState) {
    idState.addEventListener("input", () => {
      idState.value = sanitizeStateAbbrev(idState.value);
    });
  }

  const idNumber = $("pii-id-number");
  if (idNumber) {
    idNumber.addEventListener("input", () => {
      idNumber.value = sanitizeAlphaNumTight(idNumber.value).slice(0, 20);
    });
  }

  const idOtherType = $("pii-id-other-type");
  if (idOtherType) {
    idOtherType.addEventListener("input", () => {
      idOtherType.value = sanitizeAlphaNum(idOtherType.value).slice(0, 24);
    });
  }

  const social = $("pii-social");
  if (social) {
    social.addEventListener("input", () => {
      social.value = formatSsnLike(social.value);
    });
  }

  const routing = $("pii-routing");
  if (routing) {
    routing.addEventListener("input", () => {
      routing.value = sanitizeNumbers(routing.value).slice(0, 9);
    });
  }

  const account = $("pii-account");
  if (account) {
    account.addEventListener("input", () => {
      account.value = sanitizeNumbers(account.value).slice(0, 20);
    });
  }

  const backgroundProvider = $("pii-background-provider");
  if (backgroundProvider) {
    backgroundProvider.addEventListener("change", () => {
      toggleBackgroundDate(backgroundProvider.value);
      updateBackgroundMvrFlag(backgroundProvider.value);
    });
    backgroundProvider.addEventListener("blur", () => {
      updateBackgroundMvrFlag("");
    });
  }

  const licenseType = $("pii-license-type");
  if (licenseType) {
    licenseType.addEventListener("change", () => {
      toggleLicenseSections(licenseType.value);
    });
  }
};

const openWeeklyTracker = async () => {
  const panel = $("weekly-panel");
  const form = $("weekly-form");
  const range = $("weekly-range");
  if (!panel || !form) return;
  if (state.flyouts.todo) closeTodoPanel();
  positionFlyout(panel);
  const data = await workflowApi.weeklyGet();
  form.innerHTML = "";
  if (range) {
    range.textContent = `Week of ${data.week_start} to ${data.week_end}`;
  }
  updateWeeklyHoursPill(data.entries || {});
  const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  const grid = document.createElement("div");
  grid.className = "weekly__grid";
  days.forEach((day) => {
    const info = data.entries && data.entries[day] ? data.entries[day] : { start: "", end: "", content: "" };
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
    textarea.placeholder = "";
    textarea.value = info.content || "";

    container.append(header, textarea);
    grid.appendChild(container);
  });
  form.appendChild(grid);
  setPanelVisibility(panel, true);
  state.flyouts.weekly = true;
};

const closeWeeklyTracker = () => {
  const panel = $("weekly-panel");
  if (panel) {
    setPanelVisibility(panel, false);
  }
  state.flyouts.weekly = false;
};

const toggleWeeklyTracker = () => {
  if (state.flyouts.weekly) {
    closeWeeklyTracker();
  } else {
    openWeeklyTracker();
  }
};

const saveWeeklyTracker = async (event) => {
  event.preventDefault();
  const form = $("weekly-form");
  if (!form) return;
  const entries = {};
  Array.from(form.elements).forEach((element) => {
    const [day, field] = element.name.split("__");
    if (!day || !field) return;
    entries[day] = entries[day] || { content: "", start: "", end: "" };
    entries[day][field] = element.value;
  });
  await workflowApi.weeklySave(entries);
  updateWeeklyHoursPill(entries);
};

const downloadWeeklySummary = async () => {
  const summary = await workflowApi.weeklySummary();
  if (!summary || !summary.content) return;
  const blob = new Blob([summary.content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = summary.filename || "weekly_summary.md";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const openTodoPanel = () => {
  const panel = $("todo-panel");
  if (!panel) return;
  if (state.flyouts.weekly) closeWeeklyTracker();
  positionFlyout(panel);
  setPanelVisibility(panel, true);
  state.flyouts.todo = true;
};

const closeTodoPanel = () => {
  const panel = $("todo-panel");
  if (!panel) return;
  setPanelVisibility(panel, false);
  state.flyouts.todo = false;
};

const toggleTodoPanel = () => {
  if (state.flyouts.todo) {
    closeTodoPanel();
  } else {
    openTodoPanel();
  }
};

const getWeekdayName = (dateString) => {
  const date = dateString ? new Date(dateString) : new Date();
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[date.getDay()];
};

const appendTodoToWeekly = async (todo) => {
  try {
    const data = await workflowApi.weeklyGet();
    const entries = data.entries || {};
    const dayName = getWeekdayName(todo.createdAt);
    const entry = entries[dayName] || { content: "", start: "", end: "" };
    const content = entry.content || "";
    const line = todo.text || "";
    if (!line) return;
    if (!content.includes(line)) {
      const separator = content && !content.endsWith("\n") ? "\n" : "";
      entry.content = `${content}${separator}${line}`;
    }
    entries[dayName] = entry;
    await workflowApi.weeklySave(entries);
  } catch (error) {
    console.error("Unable to append todo to weekly tracker", error);
  }
};

const renderTodoList = () => {
  const todoList = $("todo-list");
  if (!todoList) return;
  todoList.innerHTML = "";
  state.todos.forEach((todo, idx) => {
    const li = document.createElement("li");
    li.className = "todo-item";
    if (todo.done) li.classList.add("todo-item--done");

    const text = document.createElement("div");
    text.className = "todo-text";
    text.textContent = todo.text;

    const actions = document.createElement("div");
    actions.className = "todo-actions";

    const completeBtn = document.createElement("button");
    completeBtn.className = "todo-complete";
    completeBtn.textContent = todo.done ? "Completed" : "Complete";
    completeBtn.dataset.idx = idx;
    if (todo.done) completeBtn.disabled = true;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "todo-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.idx = idx;

    actions.append(completeBtn, deleteBtn);
    li.append(text, actions);
    todoList.appendChild(li);
  });
};

const loadTodos = async () => {
  state.todos = (await workflowApi.todosGet()) || [];
  renderTodoList();
};

const saveTodos = async () => {
  await workflowApi.todosSave(state.todos);
};

const setupTodoUI = () => {
  const todoList = $("todo-list");
  if (!todoList) return;
  const todoToggle = $("todo-toggle");
  if (todoToggle) todoToggle.addEventListener("click", toggleTodoPanel);
  const todoClose = $("todo-close");
  if (todoClose) todoClose.addEventListener("click", closeTodoPanel);

  const todoForm = $("todo-form");
  if (todoForm) {
    todoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("todo-input");
      const text = input.value.trim();
      if (!text) return;
      state.todos.push({ text, done: false, createdAt: new Date().toISOString() });
      input.value = "";
      renderTodoList();
      saveTodos();
    });
  }

  todoList.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("todo-complete")) {
      const idx = Number(target.dataset.idx);
      const todo = state.todos[idx];
      if (!todo || todo.done) return;
      todo.done = true;
      renderTodoList();
      await saveTodos();
      await appendTodoToWeekly(todo);
      return;
    }
    if (target.classList.contains("todo-delete")) {
      const idx = Number(target.dataset.idx);
      state.todos.splice(idx, 1);
      renderTodoList();
      await saveTodos();
    }
  });
};

const renderDatabaseTableSelect = () => {
  const select = $("db-table-select");
  if (!select) return;
  select.innerHTML = "";
  state.data.tables.forEach((table) => {
    const option = document.createElement("option");
    option.value = table.id;
    option.textContent = `${table.name} (${table.count})`;
    select.appendChild(option);
  });
  if (state.data.tableId) {
    select.value = state.data.tableId;
  }
};

const updateDatabaseSearchPlaceholder = (tableName) => {
  const input = $("db-search");
  if (!input) return;
  const label = tableName ? `Search ${tableName}...` : "Search current table...";
  input.placeholder = label;
};

const getFilteredDatabaseRows = () => {
  const query = state.data.query.trim().toLowerCase();
  if (!query) return state.data.rows;
  return state.data.rows.filter((row) =>
    state.data.columns.some((col) => {
      const value = row[col];
      return String(value ?? "").toLowerCase().includes(query);
    })
  );
};

const updateDatabaseMeta = (filteredCount) => {
  const meta = $("db-table-meta");
  if (!meta) return;
  const total = state.data.rows.length;
  meta.textContent = `${filteredCount} of ${total} rows`;
};

const updateDbDeleteButton = () => {
  const btn = $("db-delete");
  const clearBtn = $("db-clear-selection");
  const hasSelection = state.data.selectedRowIds.size > 0;
  if (btn) btn.disabled = !hasSelection;
  if (clearBtn) clearBtn.disabled = !hasSelection;
};

const clearDatabaseSelection = (shouldRender = true) => {
  state.data.selectedRowIds = new Set();
  updateDbDeleteButton();
  if (shouldRender) renderDatabaseTable();
};

const renderDatabaseTable = () => {
  const table = $("db-table");
  if (!table) return;
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  if (!thead || !tbody) return;

  const rows = getFilteredDatabaseRows();

  thead.innerHTML = "";
  tbody.innerHTML = "";

  const headerRow = document.createElement("tr");
  const selectTh = document.createElement("th");
  const selectAll = document.createElement("input");
  selectAll.type = "checkbox";
  selectAll.className = "table-checkbox";
  selectAll.dataset.selectAll = "1";
  selectAll.checked = rows.length > 0 && rows.every((row) => state.data.selectedRowIds.has(row.__rowId));
  selectTh.appendChild(selectAll);
  headerRow.appendChild(selectTh);

  state.data.columns.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = state.data.columns.length + 1;
    td.className = "data-table__empty";
    td.textContent = "No rows found.";
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    updateDatabaseMeta(0);
    updateDbDeleteButton();
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const selectTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "table-checkbox db-row-checkbox";
    checkbox.dataset.rowId = row.__rowId;
    checkbox.checked = state.data.selectedRowIds.has(row.__rowId);
    selectTd.appendChild(checkbox);
    tr.appendChild(selectTd);

    state.data.columns.forEach((col) => {
      const td = document.createElement("td");
      const value = row[col];
      td.textContent = value === null || value === undefined ? "" : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  updateDatabaseMeta(rows.length);
  updateDbDeleteButton();
};

const loadDatabaseTable = async (tableId) => {
  if (!tableId) return;
  let table = null;
  try {
    table = await workflowApi.dbGetTable(tableId);
  } catch (error) {
    await showMessageModal(
      "Database Unavailable",
      "Database handlers are not available. Please fully quit and relaunch the app."
    );
    return;
  }
  state.data.tableId = table.id;
  state.data.columns = table.columns || [];
  state.data.rows = table.rows || [];
  state.data.selectedRowIds = new Set();
  renderDatabaseTableSelect();
  updateDatabaseSearchPlaceholder(table.name);
  renderDatabaseTable();
};

const loadDatabaseTables = async () => {
  let tables = [];
  try {
    tables = (await workflowApi.dbListTables()) || [];
  } catch (error) {
    await showMessageModal(
      "Database Unavailable",
      "Database handlers are not available. Please fully quit and relaunch the app."
    );
    return;
  }
  const candidateTable = tables.find((table) => table.id === "candidate_data") || null;
  state.data.tables = candidateTable ? [candidateTable] : [];
  state.data.tableId = candidateTable ? candidateTable.id : null;
  renderDatabaseTableSelect();
  if (state.data.tableId) {
    await loadDatabaseTable(state.data.tableId);
  }
};

const handleDatabaseDelete = async () => {
  if (!state.data.tableId || state.data.selectedRowIds.size === 0) return;
  const ids = Array.from(state.data.selectedRowIds);
  let result = null;
  try {
    result = await workflowApi.dbDeleteRows(state.data.tableId, ids);
    if (result && result.ok === false) {
      await showMessageModal("Delete Blocked", result.message || "Unable to delete rows.");
      return;
    }
    await loadDatabaseTables();
    if (["kanban_columns", "kanban_cards", "candidate_data"].includes(state.data.tableId)) {
      await loadKanban();
    }
  } catch (error) {
    await showMessageModal(
      "Delete Failed",
      "Unable to delete rows. Please fully quit and relaunch the app."
    );
  } finally {
    clearDatabaseSelection();
  }
};

const handleDatabaseExport = async () => {
  if (!state.data.tableId) {
    clearDatabaseSelection();
    return;
  }
  const visibleRows = getFilteredDatabaseRows();
  const selectedRows = state.data.rows.filter((row) => state.data.selectedRowIds.has(row.__rowId));
  let rowsToExport = selectedRows.length ? selectedRows : visibleRows;
  if (!rowsToExport.length) {
    rowsToExport = state.data.rows;
  }
  if (!rowsToExport.length) {
    await showMessageModal("Nothing to Export", "There are no rows to export for the current table.");
    clearDatabaseSelection();
    return;
  }
  const table = state.data.tables.find((item) => item.id === state.data.tableId);
  try {
    const result = await workflowApi.dbExportCsv({
      tableId: state.data.tableId,
      tableName: table ? table.name : state.data.tableId,
      columns: state.data.columns,
      rows: rowsToExport,
    });
    if (result && result.ok === false) {
      await showMessageModal("Export Failed", result.message || "Unable to export CSV.");
    }
  } catch (error) {
    await showMessageModal(
      "Export Failed",
      "Unable to export CSV. Please fully quit and relaunch the app."
    );
  } finally {
    clearDatabaseSelection();
  }
};

const setupFlyoutDismiss = () => {
  document.addEventListener("click", (event) => {
    const weeklyPanel = $("weekly-panel");
    const weeklyButton = $("weekly-toggle");
    if (state.flyouts.weekly && weeklyPanel && weeklyButton) {
      if (!weeklyPanel.contains(event.target) && !weeklyButton.contains(event.target)) {
        closeWeeklyTracker();
      }
    }
    const todoPanel = $("todo-panel");
    const todoButton = $("todo-toggle");
    if (state.flyouts.todo && todoPanel && todoButton) {
      if (!todoPanel.contains(event.target) && !todoButton.contains(event.target)) {
        closeTodoPanel();
      }
    }
    const drawer = $("details-drawer");
    if (state.kanban.detailsCardId && drawer) {
      const openModal = document.querySelector(".modal:not(.hidden)");
      if (openModal) return;
      const isOnCard = event.target && event.target.closest
        ? event.target.closest(".kanban-card")
        : null;
      if (!drawer.contains(event.target) && !isOnCard) {
        closeDetailsDrawer();
      }
    }
  });
};

const switchPage = (page) => {
  if (!page) return;
  const target = $(`page-${page}`) ? page : "dashboard";
  if (state.page === "database" && target !== "database") {
    clearDatabaseSelection(false);
  }
  state.page = target;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("page--active", section.id === `page-${target}`);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.page === target);
  });
  if (target === "dashboard") {
    renderKanbanBoard();
  }
  if (target === "settings") {
    renderKanbanSettings();
  }
  if (target === "database") {
    loadDatabaseTables();
  }
};

const setupEventListeners = () => {
  const addColumnHeader = $("add-column-header");
  const addColumnSettings = $("settings-add-column");
  const removeColumnSettings = $("settings-remove-column");
  const addColumnForm = $("add-column-form");
  const addColumnClose = $("add-column-close");
  const addColumnCancel = $("add-column-cancel");
  const candidateForm = $("candidate-form");
  const candidateClose = $("candidate-close");
  const candidateCancel = $("candidate-cancel");
  const piiForm = $("pii-form");
  const piiClose = $("pii-close");
  const piiCancel = $("pii-cancel");
  const neoDatePill = $("details-drawer-scheduled");
  const neoDateForm = $("neo-date-form");
  const neoDateClose = $("neo-date-close");
  const neoDateCancel = $("neo-date-cancel");
  const neoDatePickerButton = $("neo-date-picker-button");
  const neoDatePicker = $("neo-date-picker");
  const neoDateInput = $("neo-date-input");
  const detailsClose = $("details-drawer-close");
  const detailsProcess = $("details-process");
  const processClose = $("process-close");
  const processConfirm = $("process-confirm");
  const processRemove = $("process-remove");
  const processArrival = $("process-arrival");
  const processDeparture = $("process-departure");

  if (addColumnHeader) addColumnHeader.addEventListener("click", openAddColumnModal);
  if (addColumnSettings) addColumnSettings.addEventListener("click", openAddColumnModal);
  if (removeColumnSettings) removeColumnSettings.addEventListener("click", removeSelectedColumn);
  if (addColumnForm) addColumnForm.addEventListener("submit", handleAddColumnSubmit);
  if (addColumnClose) addColumnClose.addEventListener("click", closeAddColumnModal);
  if (addColumnCancel) addColumnCancel.addEventListener("click", closeAddColumnModal);
  if (candidateForm) candidateForm.addEventListener("submit", handleCandidateSubmit);
  if (candidateClose) candidateClose.addEventListener("click", closeCandidateModal);
  if (candidateCancel) candidateCancel.addEventListener("click", closeCandidateModal);
  if (piiForm) piiForm.addEventListener("submit", handlePiiSubmit);
  if (piiClose) piiClose.addEventListener("click", closePiiModal);
  if (piiCancel) piiCancel.addEventListener("click", closePiiModal);
  if (neoDatePill) neoDatePill.addEventListener("click", openNeoDateModal);
  if (neoDateForm) neoDateForm.addEventListener("submit", handleNeoDateSubmit);
  if (neoDateClose) neoDateClose.addEventListener("click", closeNeoDateModal);
  if (neoDateCancel) neoDateCancel.addEventListener("click", closeNeoDateModal);
  if (neoDatePickerButton && neoDatePicker) {
    neoDatePickerButton.addEventListener("click", () => {
      if (neoDatePicker.showPicker) {
        neoDatePicker.showPicker();
      } else {
        neoDatePicker.focus();
        neoDatePicker.click();
      }
    });
  }
  if (neoDatePicker && neoDateInput) {
    neoDatePicker.addEventListener("change", () => {
      neoDateInput.value = isoToSlashDate(neoDatePicker.value);
    });
  }
  if (neoDateInput) {
    neoDateInput.addEventListener("input", () => {
      neoDateInput.value = formatDateLike(neoDateInput.value);
      const iso = slashToIsoDate(neoDateInput.value);
      if (neoDatePicker) neoDatePicker.value = iso;
    });
  }
  if (detailsClose) detailsClose.addEventListener("click", closeDetailsDrawer);
  if (detailsProcess) detailsProcess.addEventListener("click", openProcessModal);
  if (processClose) processClose.addEventListener("click", closeProcessModal);
  if (processConfirm) processConfirm.addEventListener("click", handleProcessConfirm);
  if (processRemove) processRemove.addEventListener("click", handleProcessRemove);
  if (processArrival) processArrival.addEventListener("input", () => sanitizeTimeInput(processArrival));
  if (processDeparture) {
    processDeparture.addEventListener("input", () => sanitizeTimeInput(processDeparture));
  }

  const weeklyButton = $("weekly-toggle");
  const weeklyClose = $("weekly-close");
  const weeklyCancel = $("weekly-cancel");
  const weeklyForm = $("weekly-form");
  const weeklyExport = $("weekly-export");
  const weeklyPanel = $("weekly-panel");
  if (weeklyPanel) {
    weeklyPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }
  if (weeklyButton) weeklyButton.addEventListener("click", toggleWeeklyTracker);
  if (weeklyClose) weeklyClose.addEventListener("click", closeWeeklyTracker);
  if (weeklyCancel) weeklyCancel.addEventListener("click", closeWeeklyTracker);
  if (weeklyForm) weeklyForm.addEventListener("submit", saveWeeklyTracker);
  if (weeklyExport) weeklyExport.addEventListener("click", downloadWeeklySummary);

  const todoPanel = $("todo-panel");
  if (todoPanel) {
    todoPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  }
  const authForm = $("auth-form");
  const authClose = $("auth-close");
  if (authForm) authForm.addEventListener("submit", handleAuthSubmit);
  if (authClose) authClose.addEventListener("click", hideAuthModal);

  const changeBtn = $("change-password-button");
  const changeModalClose = $("change-password-close");
  const changeForm = $("change-password-form");
  if (changeBtn) changeBtn.addEventListener("click", showChangePasswordModal);
  if (changeModalClose) changeModalClose.addEventListener("click", hideChangePasswordModal);
  if (changeForm) changeForm.addEventListener("submit", handleChangePasswordSubmit);

  const dbSearch = $("db-search");
  const dbExport = $("db-export");
  const dbClear = $("db-clear-selection");
  const dbDelete = $("db-delete");
  const dbSelect = $("db-table-select");
  const dbTable = $("db-table");
  if (dbSearch) {
    dbSearch.addEventListener("input", () => {
      state.data.query = dbSearch.value;
      renderDatabaseTable();
    });
  }
  if (dbExport) dbExport.addEventListener("click", handleDatabaseExport);
  if (dbClear) dbClear.addEventListener("click", () => clearDatabaseSelection());
  if (dbDelete) dbDelete.addEventListener("click", handleDatabaseDelete);
  if (dbSelect) {
    dbSelect.addEventListener("change", async () => {
      state.data.query = "";
      if (dbSearch) dbSearch.value = "";
      await loadDatabaseTable(dbSelect.value);
    });
  }
  if (dbTable) {
    dbTable.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.selectAll) {
        if (target.checked) {
          const next = new Set(state.data.selectedRowIds);
          getFilteredDatabaseRows().forEach((row) => next.add(row.__rowId));
          state.data.selectedRowIds = next;
        } else {
          const next = new Set(state.data.selectedRowIds);
          getFilteredDatabaseRows().forEach((row) => next.delete(row.__rowId));
          state.data.selectedRowIds = next;
        }
        renderDatabaseTable();
        return;
      }
      if (target.classList.contains("db-row-checkbox")) {
        const rowId = target.dataset.rowId;
        if (!rowId) return;
        if (target.checked) {
          state.data.selectedRowIds.add(rowId);
        } else {
          state.data.selectedRowIds.delete(rowId);
        }
        updateDbDeleteButton();
      }
    });
  }

  window.addEventListener("resize", () => {
    if (state.flyouts.weekly) positionFlyout($("weekly-panel"));
    if (state.flyouts.todo) positionFlyout($("todo-panel"));
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });
  
  // Database viewer event listeners
  const tableSelector = document.getElementById('table-selector');
  const exportCsvBtn = document.getElementById('export-csv');
  
  if (tableSelector) {
    tableSelector.addEventListener('change', async (event) => {
      state.database.selectedTable = event.target.value;
      await loadDatabaseData();
      renderDatabaseViewer();
    });
  }
  
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', exportDatabaseToCsv);
  }
};

const initApp = async () => {
  if (!workflowApi) {
    await showMessageModal("Error", "Electron preload is unavailable.");
    return;
  }
  initWindowControls();
  initPasswordToggles();
  observeNewPasswordFields();
  setupEventListeners();
  setupFlyoutDismiss();
  setupTodoUI();
  initCandidateInputs();
  initPiiInputs();

  const status = await workflowApi.authStatus();
  state.auth = status;
  if (!status.authenticated) {
    const ok = await showAuthModal();
    if (!ok) return;
  }

  switchPage("dashboard");
  await loadKanban();
  await loadTodos();
};

initApp();
})();
