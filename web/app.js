import { state, workflowApi } from "./app/state.js";
import {
  $,
  debounce,
  showToast,
  withOptimisticUpdate,
  positionFlyout,
  setPanelVisibility,
  showMessageModal,
  initWindowControls,
  initPasswordToggles,
  observeNewPasswordFields,
} from "./app/ui.js";
import {
  sanitizeLetters,
  sanitizeNumbers,
  sanitizeAlphaNum,
  sanitizeAlphaNumTight,
  sanitizeStateAbbrev,
  formatPhoneLike,
  formatDateLike,
  isPhoneLikeValid,
  formatSsnLike,
  isSsnLikeValid,
  parseWeeklyTime,
  formatWeeklyHours,
  isDateLikeValid,
  isFullDateValid,
  isoToSlashDate,
  slashToIsoDate,
  sortByOrder,
  normalizeValue,
  hasValue,
  formatMvrFlag,
  sanitizeTimeInput,
  getWeekdayName,
} from "./app/utils.js";

(() => {
  if (window.__workflowAppInitialized) return;
  window.__workflowAppInitialized = true;

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
  const invalidateKanbanCache = () => {
    if (state.kanban.cache) {
      state.kanban.cache.dirty = true;
    }
  };

  const updateUndoRedoButtons = () => {
    const undoBtn = $("dashboard-undo");
    const redoBtn = $("dashboard-redo");
    if (undoBtn) undoBtn.disabled = state.history.undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = state.history.redoStack.length === 0;
  };

  let topbarScrollCleanup = null;

  const setTopbarHidden = (page, topbar, hidden) => {
    if (!page || !topbar) return;
    page.classList.toggle("page--topbar-hidden", hidden);
    topbar.classList.toggle("topbar--hidden", hidden);
  };

  const getTopbarScrollTarget = (page) => {
    if (!page) return null;
    const candidates = [
      page.querySelector("#kanban-board"),
      page.querySelector(".page__body"),
      document.querySelector(".main"),
      document.scrollingElement,
    ].filter(Boolean);
    const isScrollable = (el) => el && el.scrollHeight - el.clientHeight > 1;
    return candidates.find(isScrollable) || candidates[0] || null;
  };

  const bindTopbarAutoHide = () => {
    if (topbarScrollCleanup) {
      topbarScrollCleanup();
      topbarScrollCleanup = null;
    }
    const page = document.querySelector(".page--active");
    if (!page) return;
    const topbar = page.querySelector(".topbar");
    if (!topbar) return;
    setTopbarHidden(page, topbar, false);

    const scrollEl = getTopbarScrollTarget(page);
    if (!scrollEl) return;
    const threshold = 6;
    let lastScrollTop = scrollEl.scrollTop || 0;
    const onScroll = () => {
      if (document.querySelector(".modal:not(.hidden)")) {
        setTopbarHidden(page, topbar, false);
        lastScrollTop = scrollEl.scrollTop || 0;
        return;
      }
      const current = scrollEl.scrollTop || 0;
      const delta = current - lastScrollTop;
      if (current <= 4) {
        setTopbarHidden(page, topbar, false);
      } else if (delta > threshold) {
        setTopbarHidden(page, topbar, true);
      } else if (delta < -threshold) {
        setTopbarHidden(page, topbar, false);
      }
      lastScrollTop = current;
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    topbarScrollCleanup = () => scrollEl.removeEventListener("scroll", onScroll);
  };

  const pushUndo = (undoId, { clearRedo = true } = {}) => {
    if (!undoId) return;
    state.history.undoStack.unshift({ id: undoId, at: Date.now() });
    state.history.undoStack = state.history.undoStack.slice(0, 50);
    if (clearRedo) state.history.redoStack = [];
    updateUndoRedoButtons();
  };

  const pushRedo = (redoId) => {
    if (!redoId) return;
    state.history.redoStack.unshift({ id: redoId, at: Date.now() });
    state.history.redoStack = state.history.redoStack.slice(0, 50);
    updateUndoRedoButtons();
  };

  const removeUndoFromStack = (undoId) => {
    if (!undoId) return;
    state.history.undoStack = state.history.undoStack.filter((item) => item.id !== undoId);
    updateUndoRedoButtons();
  };

  const applyUndoFromToast = async (undoId, reloadFn) => {
    const undo = await workflowApi.recycleUndo(undoId);
    if (undo && undo.ok) {
      if (undo.redoId) pushRedo(undo.redoId);
      removeUndoFromStack(undoId);
      if (reloadFn) await reloadFn();
      return true;
    }
    await showMessageModal("Undo Failed", (undo && undo.error) || "Unable to restore.");
    return false;
  };

  const handleUndo = async () => {
    if (!state.history.undoStack.length) return;
    const entry = state.history.undoStack.shift();
    updateUndoRedoButtons();
    try {
      const result = await workflowApi.recycleUndo(entry.id);
      if (!result || result.ok === false) {
        state.history.undoStack.unshift(entry);
        updateUndoRedoButtons();
        await showMessageModal("Undo Failed", (result && result.error) || "Unable to restore.");
        return;
      }
      if (result && result.redoId) pushRedo(result.redoId);
      if (state.page === "database") {
        await loadDatabaseTables();
      } else {
        await loadKanban();
        renderKanbanSettings();
      }
    } catch (err) {
      state.history.undoStack.unshift(entry);
      updateUndoRedoButtons();
      await showMessageModal("Undo Failed", "Unable to restore.");
    }
  };

  const handleRedo = async () => {
    if (!state.history.redoStack.length) return;
    const entry = state.history.redoStack.shift();
    updateUndoRedoButtons();
    try {
      const result = await workflowApi.recycleRedo(entry.id);
      if (!result || result.ok === false) {
        state.history.redoStack.unshift(entry);
        updateUndoRedoButtons();
        await showMessageModal("Redo Failed", (result && result.error) || "Unable to redo.");
        return;
      }
      if (result && result.undoId) pushUndo(result.undoId, { clearRedo: false });
      if (state.page === "database") {
        await loadDatabaseTables();
      } else {
        await loadKanban();
        renderKanbanSettings();
      }
    } catch (err) {
      state.history.redoStack.unshift(entry);
      updateUndoRedoButtons();
      await showMessageModal("Redo Failed", "Unable to redo.");
    }
  };

  const ensureKanbanCache = () => {
    if (!state.kanban.cache) return;
    if (!state.kanban.cache.dirty && state.kanban.cache.columns) return;
    const sortedColumns = [...state.kanban.columns].sort(sortByOrder);
    const cardsByColumn = new Map();
    state.kanban.cards.forEach((card) => {
      if (!card) return;
      const list = cardsByColumn.get(card.column_id) || [];
      list.push(card);
      cardsByColumn.set(card.column_id, list);
    });
    cardsByColumn.forEach((list, key) => {
      cardsByColumn.set(key, list.sort(sortByOrder));
    });
    state.kanban.cache.columns = sortedColumns;
    state.kanban.cache.cardsByColumn = cardsByColumn;
    state.kanban.cache.dirty = false;
  };

  const getSortedColumns = () => {
    ensureKanbanCache();
    return state.kanban.cache.columns || [];
  };

  const getCardsForColumn = (columnId) => {
    ensureKanbanCache();
    return state.kanban.cache.cardsByColumn.get(columnId) || [];
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
    await refreshBiometricAuthButton();
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
      if (status && status.locked) {
        const retryText = status.retryAfterMs
          ? `Try again in ${Math.ceil(status.retryAfterMs / 1000)}s.`
          : "Please wait and try again.";
        await showMessageModal("Too Many Attempts", retryText);
        return;
      }
      let ok = false;
      let errorMessage = "Invalid password.";
      let retryAfter = 0;
      if (status.configured) {
        const result = await workflowApi.authLogin(password);
        ok = result === true || (result && result.ok);
        if (result && result.error) errorMessage = result.error;
        if (result && result.retryAfterMs) retryAfter = result.retryAfterMs;
      } else {
        const result = await workflowApi.authSetup(password);
        ok = result === true || (result && result.ok);
        if (result && result.error) errorMessage = result.error;
        if (result && result.retryAfterMs) retryAfter = result.retryAfterMs;
      }
      if (!ok) {
        const retryText = retryAfter ? ` Try again in ${Math.ceil(retryAfter / 1000)}s.` : "";
        await showMessageModal("Authentication failed", `${errorMessage}${retryText}`);
        return;
      }
      state.auth = await workflowApi.authStatus();
      window.dispatchEvent(new Event("workflow:auth-success"));
      hideAuthModal();
      switchPage("dashboard");
      await loadKanban();
      await loadTodos();
      await refreshBiometricSettings();
      await refreshBiometricAuthButton();
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

  const promptForPassword = ({
    title = "Confirm With Password",
    note = "Biometrics are disabled for this action. Enter your password to continue.",
    confirmLabel = "Confirm",
    danger = true,
  } = {}) => {
    const modal = $("db-import-password-modal");
    const titleEl = $("db-import-password-title");
    const noteEl = $("db-import-password-note");
    const input = $("db-import-password");
    const form = $("db-import-password-form");
    const confirmBtn = $("db-import-password-confirm");
    const cancelBtn = $("db-import-password-cancel");
    const closeBtn = $("db-import-password-close");
    if (!modal || !input || !form || !confirmBtn) return Promise.resolve("");

    if (titleEl) titleEl.textContent = title;
    if (noteEl) noteEl.textContent = note;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle("button--danger", danger);
    confirmBtn.classList.toggle("button--primary", !danger);
    input.value = "";
    initPasswordToggles();
    modal.classList.remove("hidden");

    return new Promise((resolve) => {
      const cleanup = () => {
        form.removeEventListener("submit", onSubmit);
        if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        modal.classList.add("hidden");
      };
      const onCancel = (event) => {
        event && event.preventDefault();
        cleanup();
        resolve("");
      };
      const onSubmit = (event) => {
        event.preventDefault();
        const value = input.value;
        if (!value) return;
        cleanup();
        resolve(value);
      };
      form.addEventListener("submit", onSubmit);
      if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
    });
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
    const result = await workflowApi.authChange(current, nw);
    const ok = result === true || (result && result.ok);
    if (!ok) {
      const retryText =
        result && result.retryAfterMs
          ? ` Try again in ${Math.ceil(result.retryAfterMs / 1000)}s.`
          : "";
      await showMessageModal(
        "Error",
        `${(result && result.error) || "Unable to change password."}${retryText}`,
      );
      return;
    }
    await showMessageModal("Updated", "Password changed successfully.");
    hideChangePasswordModal();
    if (workflowApi && workflowApi.biometricStatus && workflowApi.biometricEnable) {
      const status = await workflowApi.biometricStatus();
      if (status && status.enabled) {
        await workflowApi.biometricEnable(nw);
      }
      await refreshBiometricSettings();
    }
  };

  const getBiometryLabel = (type) => {
    if (!type) return "Biometrics";
    const lower = String(type).toLowerCase();
    if (lower.includes("face")) return "Face ID";
    if (lower.includes("finger")) return "Fingerprint";
    return "Biometrics";
  };

  const refreshBiometricAuthButton = async () => {
    const btn = $("auth-biometric");
    if (!btn) return;
    if (!workflowApi || !workflowApi.biometricStatus) {
      btn.classList.add("hidden");
      return;
    }
    const status = await workflowApi.biometricStatus();
    if (!status || !status.available || !status.enabled) {
      btn.classList.add("hidden");
      return;
    }
    btn.textContent = `Use ${getBiometryLabel(status.biometryType)}`;
    btn.classList.remove("hidden");
  };

  const handleAuthBiometric = async () => {
    const btn = $("auth-biometric");
    const input = $("auth-password");
    if (!btn || !workflowApi || !workflowApi.biometricUnlock || !input) return;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const result = await workflowApi.biometricUnlock();
      if (!result || !result.ok || !result.password) {
        await showMessageModal(
          "Biometric Failed",
          (result && result.error) || "Unable to authenticate with biometrics.",
        );
        return;
      }
      input.value = result.password;
      await handleAuthSubmit({ preventDefault: () => {} });
    } finally {
      btn.disabled = false;
    }
  };

  const refreshBiometricSettings = async () => {
    const btn = $("biometric-toggle");
    const statusEl = $("biometric-status");
    if (!btn || !statusEl) return;
    if (!workflowApi || !workflowApi.biometricStatus) {
      btn.disabled = true;
      btn.textContent = "Biometrics unavailable";
      statusEl.textContent = "Biometrics are not supported on this device.";
      return;
    }
    const status = await workflowApi.biometricStatus();
    if (!status || !status.available) {
      btn.disabled = true;
      btn.textContent = "Biometrics unavailable";
      statusEl.textContent = "No biometric hardware detected.";
      return;
    }
    btn.disabled = false;
    if (status.enabled) {
      btn.textContent = "Disable biometrics";
      statusEl.textContent = "Biometrics are enabled for quick sign-in.";
    } else {
      btn.textContent = "Enable biometrics";
      statusEl.textContent = "Biometrics are not enabled yet.";
    }
  };

  const handleBiometricToggle = async () => {
    if (!workflowApi || !workflowApi.biometricStatus) return;
    const status = await workflowApi.biometricStatus();
    if (!status || !status.available) {
      await showMessageModal("Biometrics Unavailable", "No biometric hardware detected.");
      return;
    }
    if (status.enabled) {
      const result = await workflowApi.biometricDisable();
      if (!result || result.ok === false) {
        await showMessageModal(
          "Unable to Disable",
          (result && result.error) || "Unable to disable biometrics.",
        );
      }
      await refreshBiometricSettings();
      await refreshBiometricAuthButton();
      return;
    }
    const password = await promptForPassword({
      title: "Enable Biometrics",
      note: "Enter your password to store it securely for biometric sign-in.",
      confirmLabel: "Enable",
      danger: false,
    });
    if (!password) return;
    const result = await workflowApi.biometricEnable(password);
    if (!result || result.ok === false) {
      await showMessageModal(
        "Unable to Enable",
        (result && result.error) || "Unable to enable biometrics.",
      );
    }
    await refreshBiometricSettings();
    await refreshBiometricAuthButton();
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
      { offset: Number.NEGATIVE_INFINITY, element: null },
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
      [card.job_id, card.job_name].filter(Boolean).join(" · ") ||
      normalizeValue(row["Job ID Name"]);
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
        "Unable to load candidate details. Please fully quit and relaunch the app.",
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
        "Unable to save Neo Scheduled Date. Please fully quit and relaunch the app.",
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
        "Enter arrival and departure time as 4 digits in 24H format (e.g., 0824).",
      );
      return;
    }

    const previousCards = [...state.kanban.cards];
    const result = await withOptimisticUpdate({
      apply: () => {
        state.kanban.cards = state.kanban.cards.filter((card) => card.uuid !== candidateId);
        invalidateKanbanCache();
        renderKanbanBoard();
      },
      rollback: () => {
        state.kanban.cards = previousCards;
        invalidateKanbanCache();
        renderKanbanBoard();
      },
      request: () => workflowApi.kanbanProcessCandidate({ candidateId, arrival, departure }),
      onSuccess: (payload) => {
        if (payload && payload.cards) {
          state.kanban.cards = payload.cards;
        } else if (payload && payload.card) {
          const idx = state.kanban.cards.findIndex((card) => card.uuid === payload.card.uuid);
          if (idx >= 0) state.kanban.cards[idx] = payload.card;
        }
        invalidateKanbanCache();
        renderKanbanBoard();
        if (payload && payload.undoId) {
          pushUndo(payload.undoId);
          showToast({
            message: "Candidate processed.",
            actionLabel: "Undo",
            onAction: async () => {
              await applyUndoFromToast(payload.undoId, async () => {
                await loadKanban();
                renderKanbanSettings();
              });
            },
          });
        }
      },
      onErrorMessage: "Unable to process candidate. Please fully quit and relaunch the app.",
    });

    if (!result) return;
    closeProcessModal();
    closeDetailsDrawer();
  };

  const handleProcessRemove = async () => {
    const candidateId = state.kanban.detailsCardId;
    if (!candidateId) return;
    const previousColumns = [...state.kanban.columns];
    const previousCards = [...state.kanban.cards];
    const result = await withOptimisticUpdate({
      apply: () => {
        state.kanban.cards = state.kanban.cards.filter((card) => card.uuid !== candidateId);
        invalidateKanbanCache();
        renderKanbanBoard();
      },
      rollback: () => {
        state.kanban.columns = previousColumns;
        state.kanban.cards = previousCards;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      request: () => workflowApi.kanbanRemoveCandidate(candidateId),
      onSuccess: (payload) => {
        if (payload && payload.columns) state.kanban.columns = payload.columns;
        if (payload && payload.cards) state.kanban.cards = payload.cards;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
        if (payload && payload.undoId) {
          pushUndo(payload.undoId);
          showToast({
            message: "Candidate removed.",
            actionLabel: "Undo",
            onAction: async () => {
              await applyUndoFromToast(payload.undoId, async () => {
                await loadKanban();
                renderKanbanSettings();
              });
            },
          });
        }
      },
      onErrorMessage: "Unable to remove candidate. Please fully quit and relaunch the app.",
    });

    if (!result) return;
    closeProcessModal();
    closeDetailsDrawer();
  };

  const buildKanbanColumn = (column) => {
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
        `.kanban-card[data-card-id="${state.kanban.draggingCardId}"]`,
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
        (el) => el.dataset.cardId,
      );
      await moveCardToColumn(cardId, column.id, orderedIds);
    });

    columnEl.append(header, body);
    return columnEl;
  };

  const renderKanbanColumnCards = (columnEl, columnId) => {
    if (!columnEl) return;
    const body = columnEl.querySelector(".kanban__column-body");
    if (!body) return;
    const fragment = document.createDocumentFragment();
    const cards = getCardsForColumn(columnId);
    cards.forEach((cardData) => {
      fragment.appendChild(renderKanbanCard(cardData));
    });
    body.replaceChildren(fragment);
  };

  const renderKanbanColumn = (columnId) => {
    const columnEl = state.kanban.dom.columns.get(columnId);
    if (!columnEl) {
      renderKanbanBoard();
      return;
    }
    renderKanbanColumnCards(columnEl, columnId);
  };

  const renderKanbanBoard = () => {
    const page = $("page-dashboard");
    if (!page || !page.classList.contains("page--active")) return;
    const board = $("kanban-board");
    const empty = $("kanban-empty");
    const layout = $("kanban-layout");
    if (!board || !empty) return;
    state.kanban.dom.board = board;

    const columns = getSortedColumns();
    const hasColumns = columns.length > 0;
    empty.classList.toggle("hidden", hasColumns);
    if (layout) layout.classList.toggle("hidden", !hasColumns);

    if (state.kanban.detailsCardId) {
      const exists = state.kanban.cards.some((card) => card.uuid === state.kanban.detailsCardId);
      if (!exists) closeDetailsDrawer();
    }

    const fragment = document.createDocumentFragment();
    const existing = state.kanban.dom.columns;
    const seen = new Set();

    columns.forEach((column) => {
      let columnEl = existing.get(column.id);
      if (!columnEl) {
        columnEl = buildKanbanColumn(column);
        existing.set(column.id, columnEl);
      } else {
        const titleEl = columnEl.querySelector(".kanban__column-title");
        if (titleEl) titleEl.textContent = column.name;
        columnEl.dataset.columnId = column.id;
      }
      renderKanbanColumnCards(columnEl, column.id);
      fragment.appendChild(columnEl);
      seen.add(column.id);
    });

    existing.forEach((el, id) => {
      if (!seen.has(id)) {
        el.remove();
        existing.delete(id);
      }
    });

    board.replaceChildren(fragment);
  };

  const renderKanbanSettings = () => {
    const list = $("kanban-columns-list");
    const removeBtn = $("settings-remove-column");
    if (!list) return;
    list.innerHTML = "";
    const columns = getSortedColumns();
    if (!columns.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No columns yet. Add one to start building your board.";
      list.appendChild(empty);
    }
    const fragment = document.createDocumentFragment();
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
      fragment.appendChild(chip);
    });
    list.appendChild(fragment);
    if (removeBtn) removeBtn.disabled = !state.kanban.selectedColumnId;
  };

  const loadKanban = async () => {
    const payload = await workflowApi.kanbanGet();
    state.kanban.columns = payload.columns || [];
    state.kanban.cards = payload.cards || [];
    invalidateKanbanCache();
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
    const previousColumns = [...state.kanban.columns];
    const nextOrder = Math.max(0, ...state.kanban.columns.map((c) => c.order || 0)) + 1;
    const tempColumn = {
      id: `temp-${Date.now()}`,
      name,
      order: nextOrder,
    };
    const result = await withOptimisticUpdate({
      apply: () => {
        state.kanban.columns = [...state.kanban.columns, tempColumn];
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      rollback: () => {
        state.kanban.columns = previousColumns;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      request: () => workflowApi.kanbanAddColumn(name),
      onSuccess: (payload) => {
        if (payload && payload.columns) {
          state.kanban.columns = payload.columns;
        }
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      onErrorMessage: "Unable to add column. Please try again.",
    });
    if (!result) return;
    closeAddColumnModal();
  };

  const removeSelectedColumn = async () => {
    const columnId = state.kanban.selectedColumnId;
    if (!columnId) return;
    const previousColumns = [...state.kanban.columns];
    const previousCards = [...state.kanban.cards];
    const result = await withOptimisticUpdate({
      apply: () => {
        state.kanban.columns = state.kanban.columns.filter((col) => col.id !== columnId);
        state.kanban.selectedColumnId = null;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      rollback: () => {
        state.kanban.columns = previousColumns;
        state.kanban.cards = previousCards;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
      },
      request: () => workflowApi.kanbanRemoveColumn(columnId),
      onSuccess: (payload) => {
        if (payload && payload.ok === false) {
          throw new Error(payload.message || "Unable to delete column.");
        }
        state.kanban.columns = payload.columns || [];
        state.kanban.cards = payload.cards || [];
        state.kanban.selectedColumnId = null;
        invalidateKanbanCache();
        renderKanbanBoard();
        renderKanbanSettings();
        if (payload && payload.undoId) {
          pushUndo(payload.undoId);
          showToast({
            message: "Column removed.",
            actionLabel: "Undo",
            onAction: async () => {
              await applyUndoFromToast(payload.undoId, async () => {
                await loadKanban();
                renderKanbanSettings();
              });
            },
          });
        }
      },
      onErrorMessage: "Unable to delete column.",
    });
    if (!result) return;
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
    state.kanban.editingCardId = mode === "edit" ? cardData && cardData.uuid : null;

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
        "PII handlers are not available. Please fully quit and relaunch the app.",
      );
      return;
    }
    const row = (result && result.row) || {};
    const displayName =
      result && result.candidateName ? result.candidateName : cardData.candidate_name;

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
      DOB: value("pii-id-dob"),
      EXP: value("pii-id-exp"),
      "Other ID Type": value("pii-id-other-type"),
      Social: value("pii-social"),
      "Additional Details": value("pii-additional-details"),
    };
  };

  const validatePiiPayload = async (payload) => {
    const phoneFields = [
      { label: "Emergency Contact Phone", value: payload["Emergency Contact Phone"] },
    ];
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
        await showMessageModal(
          "Invalid Format",
          `${field.label} must be in MM/DD/YY or MM/DD/YYYY format.`,
        );
        return false;
      }
    }

    if (payload["Routing Number"] && payload["Routing Number"].length > 9) {
      await showMessageModal("Invalid Routing Number", "Routing Number must be 9 digits or fewer.");
      return false;
    }

    if (payload["Account Number"] && payload["Account Number"].length > 20) {
      await showMessageModal(
        "Invalid Account Number",
        "Account Number must be 20 digits or fewer.",
      );
      return false;
    }

    if (payload["ID Type"]) {
      if (!payload["DOB"] || !payload["EXP"]) {
        await showMessageModal(
          "Missing Dates",
          "DOB and EXP are required for the selected ID Type.",
        );
        return false;
      }
    }

    if (payload["ID Type"] === "Other" && !payload["Other ID Type"]) {
      await showMessageModal("Missing ID Type", "Other ID Type is required when ID Type is Other.");
      return false;
    }

    if (
      payload["Social"] &&
      payload["Social"].length === 11 &&
      !isSsnLikeValid(payload["Social"])
    ) {
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
        "Unable to save PII. Please fully quit and relaunch the app.",
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

    const branchValue =
      branchSelect && branchSelect.value === "Other"
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
      const previousCards = state.kanban.cards.map((card) => ({ ...card }));
      const cardId = state.kanban.editingCardId;
      const targetColumnId = payload.column_id;
      const result = await withOptimisticUpdate({
        apply: () => {
          const card = state.kanban.cards.find((item) => item.uuid === cardId);
          if (card) Object.assign(card, payload);
          invalidateKanbanCache();
          renderKanbanColumn(targetColumnId);
        },
        rollback: () => {
          state.kanban.cards = previousCards;
          invalidateKanbanCache();
          renderKanbanBoard();
        },
        request: () => workflowApi.kanbanUpdateCard(cardId, payload),
        onSuccess: (data) => {
          if (data && data.cards) state.kanban.cards = data.cards;
          invalidateKanbanCache();
          renderKanbanColumn(targetColumnId);
        },
        onErrorMessage: "Unable to update candidate.",
      });
      if (!result) return;
    } else {
      const previousCards = state.kanban.cards.map((card) => ({ ...card }));
      const columnCards = state.kanban.cards.filter((card) => card.column_id === payload.column_id);
      const nextOrder = Math.max(0, ...columnCards.map((card) => card.order || 0)) + 1;
      const tempCard = {
        uuid: `temp-${Date.now()}`,
        column_id: payload.column_id,
        order: nextOrder,
        candidate_name: payload.candidate_name,
        icims_id: payload.icims_id,
        employee_id: payload.employee_id,
        job_id: payload.job_id,
        job_name: payload.job_name,
        job_location: payload.job_location,
        manager: payload.manager,
        branch: payload.branch,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await withOptimisticUpdate({
        apply: () => {
          state.kanban.cards = [...state.kanban.cards, tempCard];
          invalidateKanbanCache();
          renderKanbanColumn(payload.column_id);
        },
        rollback: () => {
          state.kanban.cards = previousCards;
          invalidateKanbanCache();
          renderKanbanColumn(payload.column_id);
        },
        request: () => workflowApi.kanbanAddCard(payload),
        onSuccess: (data) => {
          if (data && data.card) {
            state.kanban.cards = state.kanban.cards
              .filter((card) => card.uuid !== tempCard.uuid)
              .concat(data.card);
          } else if (data && data.cards) {
            state.kanban.cards = data.cards;
          }
          invalidateKanbanCache();
          renderKanbanColumn(payload.column_id);
        },
        onErrorMessage: "Unable to add candidate.",
      });
      if (!result) return;
    }
    closeCandidateModal();
    if (state.kanban.detailsCardId) {
      await refreshDetailsRow(state.kanban.detailsCardId);
      renderDetailsDrawer();
    }
  };

  const persistColumnOrder = async (columnId) => {
    if (!columnId) return;
    const orderedIds = getOrderedIdsForColumn(columnId);
    const data = await workflowApi.kanbanReorderColumn(columnId, orderedIds);
    if (data.cards) {
      state.kanban.cards = data.cards;
      invalidateKanbanCache();
    }
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
          .map((item) => item.order || 0),
      );
      card.order = maxOrder + 1;
    }

    if (!sameColumn && fromColumnId) {
      applyOrderToColumn(fromColumnId, getOrderedIdsForColumn(fromColumnId));
    }

    invalidateKanbanCache();
    if (sameColumn) {
      renderKanbanColumn(columnId);
    } else {
      renderKanbanColumn(columnId);
      if (fromColumnId) renderKanbanColumn(fromColumnId);
    }

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
    const dateInputs = [backgroundDate, coriDate, nhExpiration, meExpiration, idDob, idExp].filter(
      Boolean,
    );
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

    const alphaNumInputs = [$("pii-shirt"), $("pii-pants"), $("pii-boots"), $("pii-nh-id")].filter(
      Boolean,
    );
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

  const initSidebarToggle = () => {
    const appRoot = document.querySelector(".app");
    const toggleButtons = document.querySelectorAll("[data-sidebar-toggle]");
    const scrim = $("sidebar-scrim");
    if (!appRoot || toggleButtons.length === 0) return;
    const storageKey = "workflow.sidebarOpen";

    const apply = (open) => {
      appRoot.classList.toggle("app--drawer-open", open);
      toggleButtons.forEach((toggle) => {
        toggle.setAttribute("aria-pressed", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        toggle.title = open ? "Close menu" : "Open menu";
      });
      if (scrim) scrim.setAttribute("aria-hidden", open ? "false" : "true");
      localStorage.setItem(storageKey, open ? "1" : "0");
    };

    const stored = localStorage.getItem(storageKey);
    const preferOpen = window.innerWidth > 900;
    const initialOpen = stored === null ? preferOpen : stored === "1";
    apply(initialOpen);

    toggleButtons.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const next = !appRoot.classList.contains("app--drawer-open");
        apply(next);
      });
    });

    if (scrim) {
      scrim.addEventListener("click", () => apply(false));
    }

    let touchStartX = 0;
    let touchStartY = 0;
    let tracking = false;
    const swipeThreshold = 60;
    const maxVertical = 50;
    const edgeOpen = 48;

    const onTouchStart = (event) => {
      if (window.innerWidth > 900) return;
      if (!event.touches || event.touches.length !== 1) return;
      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      tracking = true;
    };

    const onTouchEnd = (event) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaY) > maxVertical) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
      const open = appRoot.classList.contains("app--drawer-open");
      if (!open && touchStartX <= edgeOpen && deltaX > swipeThreshold) {
        apply(true);
      }
      if (open && deltaX < -swipeThreshold) {
        apply(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
  };

  const initAndroidWorkflowActions = () => {
    const platform = workflowApi && workflowApi.platform ? workflowApi.platform : "";
    if (platform !== "android") return;
    const actions = document.querySelector("#page-dashboard .topbar__actions");
    const target = $("sidebar-workflow-actions");
    const section = $("sidebar-workflow-section");
    if (!actions || !target) return;
    const items = Array.from(actions.children);
    if (items.length === 0) return;
    items.forEach((item) => target.appendChild(item));
    if (section) section.classList.remove("hidden");
  };

  const initResponsiveModes = () => {
    const apply = () => {
      const compact = window.innerWidth <= 1200 || window.innerHeight <= 820;
      document.body.classList.toggle("app-compact", compact);
      bindTopbarAutoHide();
    };
    apply();
    window.addEventListener("resize", debounce(apply, 150));
  };

  const initSetupExperience = async () => {
    if (!workflowApi || !workflowApi.setupStatus) return;
    const modal = $("setup-modal");
    const continueBtn = $("setup-continue");
    if (!modal || !continueBtn) return;
    const status = await workflowApi.setupStatus();
    if (!status || !status.needsSetup) return;
    const pathEl = $("setup-folder-path");
    if (pathEl && status.folder) pathEl.textContent = status.folder;
    const warning = $("setup-storage-warning");
    if (warning) {
      warning.classList.toggle("hidden", !status.fallback);
    }
    modal.classList.remove("hidden");
    await new Promise((resolve) => {
      const onContinue = async () => {
        continueBtn.removeEventListener("click", onContinue);
        modal.classList.add("hidden");
        const selected = document.querySelector('input[name="donate-choice"]:checked');
        const choice = selected ? selected.value : "not_now";
        if (workflowApi.setupComplete) await workflowApi.setupComplete({ donationChoice: choice });
        if (choice === "donate_now") {
          switchPage("settings");
          const donateBtn = $("donate-button");
          if (donateBtn) donateBtn.focus();
        }
        resolve();
      };
      continueBtn.addEventListener("click", onContinue);
    });
  };

  const initDonation = async () => {
    const donateBtn = $("donate-button");
    if (!donateBtn) return;
    if (!workflowApi || !workflowApi.donate || workflowApi.platform !== "android") {
      const card = donateBtn.closest(".card");
      if (card) card.classList.add("hidden");
      return;
    }
    const preference =
      workflowApi.donationPreference && (await workflowApi.donationPreference());
    if (preference && preference.choice === "never") {
      const inSettings = !!donateBtn.closest("#page-settings");
      if (!inSettings) {
        const card = donateBtn.closest(".card");
        if (card) card.classList.add("hidden");
        return;
      }
    }

    donateBtn.addEventListener("click", async () => {
      await showMessageModal(
        "Coming Soon",
        "Donation checkout will be added soon. Thanks for supporting the project!",
      );
    });
  };

  const initKanbanWheelScroll = () => {
    const board = $("kanban-board");
    if (!board || board.dataset.wheelScroll) return;
    board.dataset.wheelScroll = "1";
    board.addEventListener(
      "wheel",
      (event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (board.scrollWidth <= board.clientWidth) return;
        if (Math.abs(event.deltaX) > 0) return;

        const columnBody = event.target.closest(".kanban__column-body");
        if (columnBody) {
          const delta = event.deltaY;
          if (delta < 0 && columnBody.scrollTop > 0) return;
          if (delta > 0 && columnBody.scrollTop + columnBody.clientHeight < columnBody.scrollHeight) {
            return;
          }
        }

        if (event.deltaY !== 0) {
          board.scrollLeft += event.deltaY;
          event.preventDefault();
        }
      },
      { passive: false },
    );
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
      const info =
        data.entries && data.entries[day] ? data.entries[day] : { start: "", end: "", content: "" };
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
    const fragment = document.createDocumentFragment();
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
      fragment.appendChild(li);
    });
    todoList.appendChild(fragment);
  };

  const loadTodos = async () => {
    state.todos = (await workflowApi.todosGet()) || [];
    renderTodoList();
  };

  const saveTodos = async () => {
    try {
      await workflowApi.todosSave(state.todos);
      return true;
    } catch (error) {
      return false;
    }
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
      todoForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = $("todo-input");
        const text = input.value.trim();
        if (!text) return;
        const previous = state.todos.map((todo) => ({ ...todo }));
        const nextTodo = { text, done: false, createdAt: new Date().toISOString() };
        state.todos.push(nextTodo);
        input.value = "";
        renderTodoList();
        const ok = await saveTodos();
        if (!ok) {
          state.todos = previous;
          renderTodoList();
          await showMessageModal("Save Failed", "Unable to save the todo item.");
        }
      });
    }

    todoList.addEventListener("click", async (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("todo-complete")) {
        const idx = Number(target.dataset.idx);
        const todo = state.todos[idx];
        if (!todo || todo.done) return;
        const previous = state.todos.map((item) => ({ ...item }));
        todo.done = true;
        renderTodoList();
        const ok = await saveTodos();
        if (!ok) {
          state.todos = previous;
          renderTodoList();
          await showMessageModal("Save Failed", "Unable to update the todo item.");
          return;
        }
        await appendTodoToWeekly(todo);
        return;
      }
      if (target.classList.contains("todo-delete")) {
        const idx = Number(target.dataset.idx);
        const previous = state.todos.map((item) => ({ ...item }));
        state.todos.splice(idx, 1);
        renderTodoList();
        const ok = await saveTodos();
        if (!ok) {
          state.todos = previous;
          renderTodoList();
          await showMessageModal("Save Failed", "Unable to delete the todo item.");
        }
      }
    });
  };

  const renderDatabaseSourceSelect = () => {
    const select = $("db-source-select");
    const note = $("db-source-note");
    if (!select) return;
    select.innerHTML = "";
    const fragment = document.createDocumentFragment();
    state.data.sources.forEach((source) => {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.readonly ? `${source.name} (view only)` : source.name;
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
    if (state.data.activeSourceId) {
      select.value = state.data.activeSourceId;
    }
    if (note) {
      if (state.data.readOnly) {
        const active =
          state.data.sources.find((source) => source.id === state.data.activeSourceId) || null;
        note.textContent = `Viewing ${active ? active.name : "an imported database"} (read-only).`;
        note.classList.remove("hidden");
      } else {
        note.classList.add("hidden");
      }
    }
  };

  const loadDatabaseSources = async () => {
    if (!workflowApi || !workflowApi.dbSources) return;
    try {
      const result = await workflowApi.dbSources();
      state.data.sources = (result && result.sources) || [];
      state.data.activeSourceId = (result && result.activeId) || "current";
      state.data.readOnly = state.data.activeSourceId !== "current";
      renderDatabaseSourceSelect();
    } catch (err) {
      // ignore
    }
  };

  const setDatabaseSource = async (sourceId) => {
    if (!workflowApi || !workflowApi.dbSetSource) return;
    const result = await workflowApi.dbSetSource(sourceId);
    if (result && result.activeId) {
      state.data.activeSourceId = result.activeId;
      state.data.readOnly = state.data.activeSourceId !== "current";
      renderDatabaseSourceSelect();
      clearDatabaseSelection();
      await loadDatabaseTables();
    }
  };

  const renderDatabaseTableSelect = () => {
    const select = $("db-table-select");
    if (!select) return;
    select.innerHTML = "";
    const fragment = document.createDocumentFragment();
    state.data.tables.forEach((table) => {
      const option = document.createElement("option");
      option.value = table.id;
      option.textContent = `${table.name} (${table.count})`;
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
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
        return String(value ?? "")
          .toLowerCase()
          .includes(query);
      }),
    );
  };

  const getPagedDatabaseRows = () => {
    const filtered = getFilteredDatabaseRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.data.pageSize));
    if (state.data.page > totalPages) state.data.page = totalPages;
    if (state.data.page < 1) state.data.page = 1;
    const start = (state.data.page - 1) * state.data.pageSize;
    return filtered.slice(start, start + state.data.pageSize);
  };

  const updateDatabaseMeta = (filteredCount) => {
    const meta = $("db-table-meta");
    if (!meta) return;
    const total = state.data.rows.length;
    meta.textContent = `${filteredCount} of ${total} rows`;
  };

  const updatePaginationControls = (filteredCount) => {
    const totalPages = Math.max(1, Math.ceil(filteredCount / state.data.pageSize));
    const info = $("db-page-info");
    const prev = $("db-page-prev");
    const next = $("db-page-next");
    const size = $("db-page-size");
    if (info) info.textContent = `Page ${state.data.page} of ${totalPages}`;
    if (prev) prev.disabled = state.data.page <= 1;
    if (next) next.disabled = state.data.page >= totalPages;
    if (size) size.value = String(state.data.pageSize);
  };

  const updateDbDeleteButton = () => {
    const btn = $("db-delete");
    const clearBtn = $("db-clear-selection");
    const hasSelection = state.data.selectedRowIds.size > 0;
    const canEdit = !state.data.readOnly;
    if (btn) btn.disabled = !canEdit || !hasSelection;
    if (clearBtn) clearBtn.disabled = !canEdit || !hasSelection;
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

    const filteredRows = getFilteredDatabaseRows();
    const rows = getPagedDatabaseRows();

    thead.innerHTML = "";
    tbody.innerHTML = "";

    const headerRow = document.createElement("tr");
    const selectTh = document.createElement("th");
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.className = "table-checkbox";
    selectAll.dataset.selectAll = "1";
    selectAll.checked =
      rows.length > 0 && rows.every((row) => state.data.selectedRowIds.has(row.__rowId));
    selectAll.disabled = state.data.readOnly;
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
      updateDatabaseMeta(filteredRows.length);
      updatePaginationControls(filteredRows.length);
      updateDbDeleteButton();
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const selectTd = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "table-checkbox db-row-checkbox";
      checkbox.dataset.rowId = row.__rowId;
      checkbox.checked = state.data.selectedRowIds.has(row.__rowId);
      checkbox.disabled = state.data.readOnly;
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      state.data.columns.forEach((col) => {
        const td = document.createElement("td");
        const value = row[col];
        td.textContent = value === null || value === undefined ? "" : String(value);
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);

    updateDatabaseMeta(filteredRows.length);
    updatePaginationControls(filteredRows.length);
    updateDbDeleteButton();
  };

  const loadDatabaseTable = async (tableId) => {
    if (!tableId) return;
    let table = null;
    try {
      table = await workflowApi.dbGetTable(tableId, state.data.activeSourceId);
    } catch (error) {
      await showMessageModal(
        "Database Unavailable",
        "Database handlers are not available. Please fully quit and relaunch the app.",
      );
      return;
    }
    state.data.tableId = table.id;
    state.data.columns = table.columns || [];
    state.data.rows = table.rows || [];
    state.data.selectedRowIds = new Set();
    state.data.page = 1;
    renderDatabaseTableSelect();
    updateDatabaseSearchPlaceholder(table.name);
    renderDatabaseTable();
  };

  const loadDatabaseTables = async () => {
    let tables = [];
    try {
      tables = (await workflowApi.dbListTables(state.data.activeSourceId)) || [];
    } catch (error) {
      await showMessageModal(
        "Database Unavailable",
        "Database handlers are not available. Please fully quit and relaunch the app.",
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
    if (state.data.readOnly) {
      await showMessageModal(
        "Read-only Database",
        "Imported databases are view-only. Switch back to the current database to delete rows.",
      );
      return;
    }
    if (!state.data.tableId || state.data.selectedRowIds.size === 0) return;
    const ids = Array.from(state.data.selectedRowIds);
    const previousRows = state.data.rows.map((row) => ({ ...row }));
    const previousSelection = new Set(state.data.selectedRowIds);
    const result = await withOptimisticUpdate({
      apply: () => {
        state.data.rows = state.data.rows.filter(
          (row) => !state.data.selectedRowIds.has(row.__rowId),
        );
        state.data.selectedRowIds = new Set();
        renderDatabaseTable();
      },
      rollback: () => {
        state.data.rows = previousRows;
        state.data.selectedRowIds = previousSelection;
        renderDatabaseTable();
      },
      request: () => workflowApi.dbDeleteRows(state.data.tableId, ids, state.data.activeSourceId),
      onSuccess: async (payload) => {
        if (payload && payload.ok === false) {
          throw new Error(payload.message || "Unable to delete rows.");
        }
        await loadDatabaseTables();
        if (["kanban_columns", "kanban_cards", "candidate_data"].includes(state.data.tableId)) {
          await loadKanban();
        }
        if (payload && payload.undoId) {
          pushUndo(payload.undoId);
          showToast({
            message: "Rows deleted.",
            actionLabel: "Undo",
            onAction: async () => {
              await applyUndoFromToast(payload.undoId, async () => {
                await loadDatabaseTables();
                if (
                  ["kanban_columns", "kanban_cards", "candidate_data"].includes(state.data.tableId)
                ) {
                  await loadKanban();
                }
              });
            },
          });
        }
      },
      onErrorMessage: "Unable to delete rows. Please fully quit and relaunch the app.",
    });
    if (!result) return;
    clearDatabaseSelection();
  };

  const handleDatabaseExport = async () => {
    if (!state.data.tableId) {
      clearDatabaseSelection();
      return;
    }
    const visibleRows = getFilteredDatabaseRows();
    const selectedRows = state.data.rows.filter((row) =>
      state.data.selectedRowIds.has(row.__rowId),
    );
    let rowsToExport = selectedRows.length ? selectedRows : visibleRows;
    if (!rowsToExport.length) {
      rowsToExport = state.data.rows;
    }
    if (!rowsToExport.length) {
      await showMessageModal(
        "Nothing to Export",
        "There are no rows to export for the current table.",
      );
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
        sourceId: state.data.activeSourceId,
      });
      if (result && result.ok === false) {
        await showMessageModal("Export Failed", result.message || "Unable to export CSV.");
      }
    } catch (error) {
      await showMessageModal(
        "Export Failed",
        "Unable to export CSV. Please fully quit and relaunch the app.",
      );
    } finally {
      clearDatabaseSelection();
    }
  };

  const showDbImportActionModal = (fileName) => {
    const modal = $("db-import-action-modal");
    const nameEl = $("db-import-file-name");
    const appendBtn = $("db-import-action-append");
    const viewBtn = $("db-import-action-view");
    const replaceBtn = $("db-import-action-replace");
    const cancelBtn = $("db-import-action-cancel");
    const closeBtn = $("db-import-action-close");
    if (!modal || !appendBtn || !viewBtn || !replaceBtn || !cancelBtn) {
      return Promise.resolve(null);
    }
    if (nameEl) nameEl.textContent = fileName || "selected database";
    modal.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = () => {
        appendBtn.removeEventListener("click", onAppend);
        viewBtn.removeEventListener("click", onView);
        replaceBtn.removeEventListener("click", onReplace);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        modal.classList.add("hidden");
      };
      const onAppend = () => {
        cleanup();
        resolve("append");
      };
      const onView = () => {
        cleanup();
        resolve("view");
      };
      const onReplace = () => {
        cleanup();
        resolve("replace");
      };
      const onCancel = () => {
        cleanup();
        resolve(null);
      };
      appendBtn.addEventListener("click", onAppend);
      viewBtn.addEventListener("click", onView);
      replaceBtn.addEventListener("click", onReplace);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
    });
  };

  const showDbImportWarningModal = ({ action, fileName }) => {
    const modal = $("db-import-warning-modal");
    const actionEl = $("db-import-warning-action");
    const nameEl = $("db-import-warning-name");
    const proceedBtn = $("db-import-warning-proceed");
    const cancelBtn = $("db-import-warning-cancel");
    const closeBtn = $("db-import-warning-close");
    if (!modal || !proceedBtn || !cancelBtn) return Promise.resolve(false);
    if (actionEl) actionEl.textContent = action.toUpperCase();
    if (nameEl) nameEl.textContent = fileName || "selected database";
    modal.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = () => {
        proceedBtn.removeEventListener("click", onProceed);
        cancelBtn.removeEventListener("click", onCancel);
        if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        modal.classList.add("hidden");
      };
      const onProceed = () => {
        cleanup();
        resolve(true);
      };
      const onCancel = () => {
        cleanup();
        resolve(false);
      };
      proceedBtn.addEventListener("click", onProceed);
      cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
    });
  };

  const showDbImportSuccessModal = ({ message, showView }) => {
    const modal = $("db-import-success-modal");
    const messageEl = $("db-import-success-message");
    const viewBtn = $("db-import-success-view");
    const continueBtn = $("db-import-success-continue");
    const closeBtn = $("db-import-success-close");
    if (!modal || !continueBtn || !messageEl) return Promise.resolve("continue");
    messageEl.textContent = message || "Database import completed.";
    if (viewBtn) viewBtn.classList.toggle("hidden", !showView);
    modal.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = () => {
        if (viewBtn) viewBtn.removeEventListener("click", onView);
        continueBtn.removeEventListener("click", onContinue);
        if (closeBtn) closeBtn.removeEventListener("click", onContinue);
        modal.classList.add("hidden");
      };
      const onView = () => {
        cleanup();
        resolve("view");
      };
      const onContinue = () => {
        cleanup();
        resolve("continue");
      };
      if (viewBtn) viewBtn.addEventListener("click", onView);
      continueBtn.addEventListener("click", onContinue);
      if (closeBtn) closeBtn.addEventListener("click", onContinue);
    });
  };

  const showDbImportErrorModal = ({ title, message, detail }) => {
    const modal = $("db-import-error-modal");
    const titleEl = $("db-import-error-title");
    const messageEl = $("db-import-error-message");
    const detailEl = $("db-import-error-detail");
    const okBtn = $("db-import-error-ok");
    const closeBtn = $("db-import-error-close");
    if (!modal || !okBtn || !messageEl) return Promise.resolve();
    if (titleEl) titleEl.textContent = title || "Import Blocked";
    messageEl.textContent = message || "";
    if (detailEl) detailEl.textContent = detail || "";
    modal.classList.remove("hidden");
    return new Promise((resolve) => {
      const cleanup = () => {
        okBtn.removeEventListener("click", onClose);
        if (closeBtn) closeBtn.removeEventListener("click", onClose);
        modal.classList.add("hidden");
        resolve();
      };
      const onClose = (event) => {
        event && event.preventDefault();
        cleanup();
      };
      okBtn.addEventListener("click", onClose);
      if (closeBtn) closeBtn.addEventListener("click", onClose);
    });
  };

  const handleDatabaseImport = async () => {
    if (!workflowApi || !workflowApi.dbImportPick || !workflowApi.dbImportApply) {
      await showMessageModal("Unavailable", "Database import is not available.");
      return;
    }
    const pick = await workflowApi.dbImportPick();
    if (!pick || pick.canceled) return;
    if (pick.ok === false) {
      await showMessageModal("Import Failed", pick.error || "Unable to open the import file.");
      return;
    }
    const action = await showDbImportActionModal(pick.name);
    if (!action) return;
    const proceed = await showDbImportWarningModal({ action, fileName: pick.name });
    if (!proceed) return;
    const password = await promptForPassword({
      title: "Confirm Database Import",
      note: "Biometrics are disabled for this action. Enter your password to continue.",
      confirmLabel: "Proceed",
      danger: true,
    });
    if (!password) return;

    const result = await workflowApi.dbImportApply({
      action,
      fileName: pick.name,
      fileData: pick.data,
      password,
    });

    if (!result || result.ok === false) {
      if (result && result.code === "password") {
        await showMessageModal("Invalid Password", result.error || "Password is incorrect.");
        return;
      }
      if (result && result.code === "fraud") {
        await showDbImportErrorModal({
          title: "WARNING FROM THE DEV",
          message:
            "This database looks fraudulent or unsafe. We refused to import it to protect your data.",
          detail:
            result.error ||
            "If you can’t figure out how to fix it manually, you probably shouldn’t.",
        });
        return;
      }
      await showDbImportErrorModal({
        title: "WARNING",
        message: "We won't import this database because it's broken. From the dev: Shit's broke.",
        detail: (result && result.error) || "Fix the file and try again.",
      });
      return;
    }

    await loadDatabaseSources();
    if (action === "append" || action === "replace") {
      await loadKanban();
      renderKanbanSettings();
    }
    await loadDatabaseTables();

    const successMessage =
      action === "replace"
        ? "Database replaced successfully."
        : action === "append"
          ? "Database appended successfully."
          : "Database imported for viewing.";
    const choice = await showDbImportSuccessModal({
      message: successMessage,
      showView: !!result.viewId,
    });
    if (choice === "view" && result.viewId) {
      await setDatabaseSource(result.viewId);
    }
  };

  const checkDatabaseIntegrity = async () => {
    if (!workflowApi || !workflowApi.dbValidateCurrent) return;
    const result = await workflowApi.dbValidateCurrent();
    if (!result || result.ok) return;
    await showDbImportErrorModal({
      title: "Database Integrity Warning",
      message:
        "Your current database failed the integrity check. Some data may be corrupt or unsafe.",
      detail: result.message || "Please restore from a backup before continuing.",
    });
    switchPage("dashboard");
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
        const isOnCard =
          event.target && event.target.closest ? event.target.closest(".kanban-card") : null;
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
    document.body.dataset.page = target;
    const workflowSection = $("sidebar-workflow-section");
    if (workflowSection && document.body.classList.contains("platform-android")) {
      workflowSection.classList.toggle("hidden", target !== "dashboard");
    }
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
      loadDatabaseSources().then(loadDatabaseTables);
    }
    updateUndoRedoButtons();
    bindTopbarAutoHide();
  };

  const setupEventListeners = () => {
    const addColumnHeader = $("add-column-header");
    const addColumnSettings = $("settings-add-column");
    const removeColumnSettings = $("settings-remove-column");
    const addColumnForm = $("add-column-form");
    const addColumnClose = $("add-column-close");
    const addColumnCancel = $("add-column-cancel");
    const undoBtn = $("dashboard-undo");
    const redoBtn = $("dashboard-redo");
    const authBiometric = $("auth-biometric");
    const biometricToggle = $("biometric-toggle");
    const dbImport = $("db-import");
    const dbSourceSelect = $("db-source-select");
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
    if (undoBtn) undoBtn.addEventListener("click", handleUndo);
    if (redoBtn) redoBtn.addEventListener("click", handleRedo);
    if (authBiometric) authBiometric.addEventListener("click", handleAuthBiometric);
    if (biometricToggle) biometricToggle.addEventListener("click", handleBiometricToggle);
    if (dbImport) dbImport.addEventListener("click", handleDatabaseImport);
    if (dbSourceSelect) {
      dbSourceSelect.addEventListener("change", () =>
        setDatabaseSource(dbSourceSelect.value || "current"),
      );
    }
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
    if (processArrival)
      processArrival.addEventListener("input", () => sanitizeTimeInput(processArrival));
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
    const dbPrev = $("db-page-prev");
    const dbNext = $("db-page-next");
    const dbSize = $("db-page-size");
    if (dbSearch) {
      const onSearch = debounce(() => {
        state.data.query = dbSearch.value;
        state.data.page = 1;
        renderDatabaseTable();
      }, 200);
      dbSearch.addEventListener("input", onSearch);
    }
    if (dbExport) dbExport.addEventListener("click", handleDatabaseExport);
    if (dbClear) dbClear.addEventListener("click", () => clearDatabaseSelection());
    if (dbDelete) dbDelete.addEventListener("click", handleDatabaseDelete);
    if (dbPrev) {
      dbPrev.addEventListener("click", () => {
        if (state.data.page > 1) {
          state.data.page -= 1;
          renderDatabaseTable();
        }
      });
    }
    if (dbNext) {
      dbNext.addEventListener("click", () => {
        state.data.page += 1;
        renderDatabaseTable();
      });
    }
    if (dbSize) {
      dbSize.addEventListener("change", () => {
        const nextSize = Number(dbSize.value) || 50;
        state.data.pageSize = nextSize;
        state.data.page = 1;
        renderDatabaseTable();
      });
    }
    if (dbSelect) {
      dbSelect.addEventListener("change", async () => {
        state.data.query = "";
        state.data.page = 1;
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
            getPagedDatabaseRows().forEach((row) => next.add(row.__rowId));
            state.data.selectedRowIds = next;
          } else {
            const next = new Set(state.data.selectedRowIds);
            getPagedDatabaseRows().forEach((row) => next.delete(row.__rowId));
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
      button.addEventListener("click", () => {
        switchPage(button.dataset.page);
        const appRoot = document.querySelector(".app");
        if (appRoot && appRoot.classList.contains("app--drawer-open") && window.innerWidth <= 900) {
          appRoot.classList.remove("app--drawer-open");
          const scrim = $("sidebar-scrim");
          if (scrim) scrim.setAttribute("aria-hidden", "true");
          document.querySelectorAll("[data-sidebar-toggle]").forEach((toggle) => {
            toggle.setAttribute("aria-pressed", "false");
            toggle.setAttribute("aria-label", "Open menu");
            toggle.title = "Open menu";
          });
          localStorage.setItem("workflow.sidebarOpen", "0");
        }
      });
    });
  };

  const initApp = async () => {
    if (!workflowApi) {
      await showMessageModal("Error", "Electron preload is unavailable.");
      return;
    }
    initWindowControls();
    initSidebarToggle();
    initAndroidWorkflowActions();
    initResponsiveModes();
    initPasswordToggles();
    observeNewPasswordFields();
    setupEventListeners();
    initKanbanWheelScroll();
    setupFlyoutDismiss();
    setupTodoUI();
    initCandidateInputs();
    initPiiInputs();
    updateUndoRedoButtons();
    refreshBiometricSettings();

    await initSetupExperience();
    await initDonation();

    const status = await workflowApi.authStatus();
    state.auth = status;
    if (!status.authenticated) {
      const ok = await showAuthModal();
      if (!ok) return;
    }

    switchPage("dashboard");
    await loadKanban();
    await loadTodos();
    await checkDatabaseIntegrity();
  };

  initApp();
})();
