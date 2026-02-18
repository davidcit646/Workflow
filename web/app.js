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

  const isTopbarAutoHideEnabled = (page) => {
    return !!page && page.id === "page-dashboard";
  };

  const getTopbarScrollTarget = (page) => {
    if (!page) return null;
    const isScrollable = (el) => el && el.scrollHeight - el.clientHeight > 1;
    const dashboardBoard = page.querySelector("#kanban-board");
    if (dashboardBoard) {
      return isScrollable(dashboardBoard) ? dashboardBoard : null;
    }
    const pageBody = page.querySelector(".page__body");
    return isScrollable(pageBody) ? pageBody : null;
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
    if (!isTopbarAutoHideEnabled(page)) return;

    const scrollEl = getTopbarScrollTarget(page);
    if (!scrollEl) return;
    const threshold = 6;
    const minHideScroll = 48;
    let hidden = false;
    let lastScrollTop = scrollEl.scrollTop || 0;
    const applyHidden = (nextHidden) => {
      if (hidden === nextHidden) return;
      hidden = nextHidden;
      setTopbarHidden(page, topbar, nextHidden);
    };
    const onScroll = () => {
      if (document.querySelector(".modal:not(.hidden)")) {
        applyHidden(false);
        lastScrollTop = scrollEl.scrollTop || 0;
        return;
      }
      const current = scrollEl.scrollTop || 0;
      const delta = current - lastScrollTop;
      if (current <= 4) {
        applyHidden(false);
      } else if (delta > threshold && current > minHideScroll) {
        applyHidden(true);
      } else if (delta < -threshold) {
        applyHidden(false);
      }
      lastScrollTop = current;
    };
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    topbarScrollCleanup = () => scrollEl.removeEventListener("scroll", onScroll);
  };

  const HELP_FEEDBACK_URL = "https://github.com/davidcit646/Workflow/issues";
  const HELP_MANUALS = [
    { id: "user-manual", label: "User Manual", path: "./manuals/USER_MANUAL.md" },
    { id: "backup-restore", label: "Backup & Restore", path: "./manuals/BACKUP_RESTORE.md" },
    { id: "readme", label: "GitHub Issues & Contributing", path: "./manuals/README.md" },
  ];

  const helpState = {
    cache: new Map(),
    activeManualId: "user-manual",
    headings: [],
    appVersion: null,
    appVersionLoading: null,
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const toHeadingSlug = (value, used = new Set()) => {
    const base =
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-") || "section";
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    return slug;
  };

  const formatInlineMarkdown = (value) => {
    let text = escapeHtml(value);
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      const safeLabel = escapeHtml(label);
      const safeUrl = String(url || "").trim();
      if (/^https?:\/\//i.test(safeUrl)) {
        return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${safeLabel}</a>`;
      }
      return `<a href="${escapeHtml(safeUrl)}">${safeLabel}</a>`;
    });
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return text;
  };

  const parseMarkdownManual = (markdownText) => {
    const lines = String(markdownText || "")
      .replace(/\r\n?/g, "\n")
      .split("\n");
    const html = [];
    const headings = [];
    const usedIds = new Set();
    let paragraph = [];
    let listType = null;
    let inCodeBlock = false;
    let codeLanguage = "";
    let codeLines = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${formatInlineMarkdown(paragraph.join(" ").trim())}</p>`);
      paragraph = [];
    };

    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };

    const openList = (type, start = null) => {
      if (listType === type) return;
      closeList();
      if (type === "ol") {
        const safeStart = Number(start);
        if (Number.isInteger(safeStart) && safeStart > 1) {
          html.push(`<ol start="${safeStart}">`);
        } else {
          html.push("<ol>");
        }
      } else {
        html.push(`<${type}>`);
      }
      listType = type;
    };

    lines.forEach((line) => {
      if (inCodeBlock) {
        if (/^```/.test(line.trim())) {
          const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
          html.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
          inCodeBlock = false;
          codeLanguage = "";
          codeLines = [];
        } else {
          codeLines.push(line);
        }
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        flushParagraph();
        closeList();
        return;
      }

      const codeStart = trimmed.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
      if (codeStart) {
        flushParagraph();
        closeList();
        inCodeBlock = true;
        codeLanguage = codeStart[1] || "";
        codeLines = [];
        return;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        closeList();
        const level = headingMatch[1].length;
        const headingText = headingMatch[2].trim();
        const id = toHeadingSlug(headingText, usedIds);
        headings.push({ id, text: headingText, level });
        html.push(`<h${level} id="${id}">${formatInlineMarkdown(headingText)}</h${level}>`);
        return;
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (unorderedMatch) {
        flushParagraph();
        openList("ul");
        html.push(`<li>${formatInlineMarkdown(unorderedMatch[1])}</li>`);
        return;
      }

      const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (orderedMatch) {
        flushParagraph();
        if (listType !== "ol") {
          openList("ol", Number(orderedMatch[1]));
        }
        html.push(`<li>${formatInlineMarkdown(orderedMatch[2])}</li>`);
        return;
      }

      const quoteMatch = trimmed.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        flushParagraph();
        closeList();
        html.push(`<blockquote><p>${formatInlineMarkdown(quoteMatch[1])}</p></blockquote>`);
        return;
      }

      if (/^---+$/.test(trimmed)) {
        flushParagraph();
        closeList();
        html.push("<hr />");
        return;
      }

      closeList();
      paragraph.push(trimmed);
    });

    flushParagraph();
    closeList();
    if (inCodeBlock) {
      const langClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : "";
      html.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    }

    return { html: html.join("\n"), headings };
  };

  const getHelpManualById = (manualId) => {
    return HELP_MANUALS.find((manual) => manual.id === manualId) || HELP_MANUALS[0];
  };

  const clearHelpHighlights = (container) => {
    if (!container) return;
    container.querySelectorAll("mark.manual-highlight").forEach((mark) => {
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
    container.normalize();
  };

  const highlightHelpMatches = (container, rawQuery) => {
    clearHelpHighlights(container);
    const query = String(rawQuery || "")
      .trim()
      .toLowerCase();
    if (!query) return { count: 0, firstMatch: null };

    let count = 0;
    let firstMatch = null;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("mark.manual-highlight")) return NodeFilter.FILTER_REJECT;
          if (parent.closest("pre, code")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
      false,
    );

    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node);
      node = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const source = textNode.nodeValue;
      const lower = source.toLowerCase();
      let from = 0;
      let foundAt = lower.indexOf(query, from);
      if (foundAt < 0) return;

      const fragment = document.createDocumentFragment();
      while (foundAt >= 0) {
        if (foundAt > from) {
          fragment.appendChild(document.createTextNode(source.slice(from, foundAt)));
        }
        const matchText = source.slice(foundAt, foundAt + query.length);
        const mark = document.createElement("mark");
        mark.className = "manual-highlight";
        mark.textContent = matchText;
        fragment.appendChild(mark);
        if (!firstMatch) firstMatch = mark;
        count += 1;
        from = foundAt + query.length;
        foundAt = lower.indexOf(query, from);
      }
      if (from < source.length) {
        fragment.appendChild(document.createTextNode(source.slice(from)));
      }
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    });

    return { count, firstMatch };
  };

  const updateHelpTocActive = () => {
    const content = $("help-manual-content");
    const tocList = $("help-manual-toc-list");
    if (!content || !tocList || !helpState.headings.length) return;

    const top = content.scrollTop + 10;
    let activeId = helpState.headings[0].id;
    helpState.headings.forEach((heading) => {
      const headingEl = content.querySelector(`#${heading.id}`);
      if (headingEl && headingEl.offsetTop <= top) {
        activeId = heading.id;
      }
    });

    tocList.querySelectorAll(".help-manual-toc__item").forEach((item) => {
      item.classList.toggle("help-manual-toc__item--active", item.dataset.headingId === activeId);
    });
  };

  const renderHelpManualToc = (headings) => {
    const tocList = $("help-manual-toc-list");
    const content = $("help-manual-content");
    if (!tocList || !content) return;
    tocList.innerHTML = "";
    if (!headings.length) {
      tocList.innerHTML = '<div class="muted">No headings found in this manual.</div>';
      return;
    }

    headings.forEach((heading) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `help-manual-toc__item help-manual-toc__item--lvl${Math.min(heading.level, 6)}`;
      button.textContent = heading.text;
      button.dataset.headingId = heading.id;
      button.addEventListener("click", () => {
        const target = content.querySelector(`#${heading.id}`);
        if (!target) return;
        content.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: "smooth" });
      });
      tocList.appendChild(button);
    });
  };

  const loadHelpManualMarkdown = async (manualId) => {
    const manual = getHelpManualById(manualId);
    if (helpState.cache.has(manual.id)) {
      return helpState.cache.get(manual.id);
    }

    let response = null;
    let text = "";
    try {
      response = await fetch(manual.path, { cache: "no-store" });
      text = await response.text();
    } catch (error) {
      text = "";
    }

    if (!text.trim() || (response && response.ok === false && !text.trim())) {
      throw new Error(`Unable to load manual: ${manual.label}`);
    }

    helpState.cache.set(manual.id, text);
    return text;
  };

  const resolveAppVersionLabel = async () => {
    if (helpState.appVersion) return helpState.appVersion;
    if (helpState.appVersionLoading) return helpState.appVersionLoading;

    helpState.appVersionLoading = (async () => {
      if (!workflowApi || typeof workflowApi.appVersion !== "function") {
        helpState.appVersion = "Unavailable";
        return helpState.appVersion;
      }
      try {
        const value = await workflowApi.appVersion();
        const safe = String(value || "").trim();
        helpState.appVersion = safe || "Unavailable";
        return helpState.appVersion;
      } catch (error) {
        helpState.appVersion = "Unavailable";
        return helpState.appVersion;
      } finally {
        helpState.appVersionLoading = null;
      }
    })();

    return helpState.appVersionLoading;
  };

  const renderHelpPage = () => {
    const select = $("help-manual-select");
    const feedbackLink = $("help-feedback-link");
    const version = $("help-app-version");
    if (feedbackLink) feedbackLink.href = HELP_FEEDBACK_URL;
    if (version) {
      version.textContent = helpState.appVersion || "Loading...";
      resolveAppVersionLabel().then((label) => {
        const versionEl = $("help-app-version");
        if (versionEl) versionEl.textContent = label;
      });
    }
    if (!select) return;
    const manual = getHelpManualById(helpState.activeManualId);
    select.value = manual.id;
  };

  const applyHelpManualSearch = () => {
    const input = $("help-manual-search");
    const content = $("help-manual-content");
    const result = $("help-manual-search-result");
    if (!input || !content || !result) return;

    const query = input.value || "";
    const { count, firstMatch } = highlightHelpMatches(content, query);
    if (!query.trim()) {
      result.textContent = "Type to search.";
      return;
    }
    result.textContent = count === 1 ? "1 match found." : `${count} matches found.`;
    if (firstMatch) {
      firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  const openHelpManualModal = async (manualIdOverride) => {
    const modal = $("help-manual-modal");
    const title = $("help-manual-title");
    const content = $("help-manual-content");
    const searchInput = $("help-manual-search");
    const searchResult = $("help-manual-search-result");
    if (!modal || !title || !content) return;

    const select = $("help-manual-select");
    const manual = getHelpManualById(manualIdOverride || (select ? select.value : ""));
    helpState.activeManualId = manual.id;
    if (select) select.value = manual.id;

    try {
      const markdown = await loadHelpManualMarkdown(manual.id);
      const parsed = parseMarkdownManual(markdown);
      const headings = parsed.headings.length
        ? parsed.headings
        : [{ id: "manual-top", text: manual.label, level: 1 }];
      const contentHtml = parsed.headings.length
        ? parsed.html
        : `<h1 id="manual-top">${escapeHtml(manual.label)}</h1>\n${parsed.html}`;
      title.textContent = manual.label;
      content.innerHTML = contentHtml || "<p class='muted'>This manual is empty.</p>";
      helpState.headings = headings;
      renderHelpManualToc(headings);
      modal.classList.remove("hidden");
      content.scrollTop = 0;
      clearHelpHighlights(content);
      if (searchInput) searchInput.value = "";
      if (searchResult) searchResult.textContent = "Type to search.";
      updateHelpTocActive();
      if (searchInput) searchInput.focus();
    } catch (error) {
      await showMessageModal(
        "Manual Unavailable",
        `Unable to load ${manual.label}. Please verify the manual files are present.`,
      );
    }
  };

  const closeHelpManualModal = () => {
    const modal = $("help-manual-modal");
    const content = $("help-manual-content");
    if (modal) modal.classList.add("hidden");
    if (content) clearHelpHighlights(content);
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

  let authModalAwaitingResolution = false;
  let authReauthOnFocusRequired = false;
  let authReauthInProgress = false;
  const ENABLE_FOCUS_REAUTH = false;

  const getAuthStatusSafe = async () => {
    if (!workflowApi || typeof workflowApi.authStatus !== "function") return null;
    try {
      const status = await workflowApi.authStatus();
      if (!status || typeof status !== "object") return null;
      return status;
    } catch (_err) {
      return null;
    }
  };

  const showAuthModal = async ({ forcePrompt = false } = {}) => {
    const modal = $("auth-modal");
    const title = $("auth-title");
    if (!modal || !title) return false;
    if (!workflowApi) return false;
    if (forcePrompt && typeof workflowApi.authLock === "function") {
      try {
        await workflowApi.authLock();
      } catch (_err) {
        // Fall through and still prompt.
      }
    }
    const status = await getAuthStatusSafe();
    if (!status) {
      title.textContent = "Sign In";
      modal.classList.remove("hidden");
      return false;
    }
    state.auth = status;
    title.textContent = status.configured ? "Sign In" : "Create Program Password";
    if (status.authenticated && !forcePrompt) return true;
    setAuthInlineError("");
    const passwordInput = $("auth-password");
    if (passwordInput) {
      window.setTimeout(() => {
        try {
          passwordInput.focus();
        } catch (_err) {
          // Ignore focus errors.
        }
      }, 0);
    }
    modal.classList.remove("hidden");
    await refreshBiometricAuthButton();
    authModalAwaitingResolution = true;
    return new Promise((resolve) => {
      const cleanup = (ok) => {
        window.removeEventListener("workflow:auth-success", onSuccess);
        window.removeEventListener("workflow:auth-cancel", onCancel);
        modal.classList.add("hidden");
        authModalAwaitingResolution = false;
        resolve(ok);
      };
      const onSuccess = () => {
        cleanup(true);
      };
      const onCancel = () => {
        cleanup(false);
      };
      window.addEventListener("workflow:auth-success", onSuccess);
      window.addEventListener("workflow:auth-cancel", onCancel);
    });
  };

  const hideAuthModal = ({ cancelIfPending = true } = {}) => {
    const modal = $("auth-modal");
    if (modal) modal.classList.add("hidden");
    if (cancelIfPending && authModalAwaitingResolution) {
      window.dispatchEvent(new Event("workflow:auth-cancel"));
    }
  };

  const setAuthInlineError = (message = "") => {
    const el = $("auth-inline-error");
    if (!el) return;
    const text = String(message || "").trim();
    el.textContent = text;
    el.classList.toggle("hidden", !text);
  };

  const handleAuthSubmit = async (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    setAuthInlineError("");
    const submitBtn = $("auth-submit");
    if (submitBtn && submitBtn.dataset.submitting) return;
    const passwordEl = $("auth-password");
    const password = passwordEl ? passwordEl.value : "";
    if (!password) {
      setAuthInlineError("Enter your program password.");
      await showMessageModal("Missing password", "Enter your program password.");
      return;
    }
    try {
      if (submitBtn) {
        submitBtn.dataset.submitting = "1";
        submitBtn.disabled = true;
      }
      const status = await getAuthStatusSafe();
      if (!status) {
        setAuthInlineError("Authentication bridge unavailable.");
        await showMessageModal("Authentication unavailable", "Unable to check auth status.");
        return;
      }
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
        setAuthInlineError(errorMessage);
        const retryText = retryAfter ? ` Try again in ${Math.ceil(retryAfter / 1000)}s.` : "";
        await showMessageModal("Authentication failed", `${errorMessage}${retryText}`);
        return;
      }
      const refreshed = await getAuthStatusSafe();
      if (!refreshed || !refreshed.authenticated) {
        setAuthInlineError("Unable to complete sign-in.");
        await showMessageModal("Authentication failed", "Unable to complete sign-in.");
        return;
      }
      if (passwordEl) passwordEl.value = "";
      setAuthInlineError("");
      state.auth = refreshed;
      authReauthOnFocusRequired = false;
      window.dispatchEvent(new Event("workflow:auth-success"));
      hideAuthModal({ cancelIfPending: false });
      await refreshBiometricAuthButton();
    } catch (err) {
      console.error("Auth submit error", err);
      setAuthInlineError("Unable to authenticate.");
      await showMessageModal("Error", "Unable to authenticate.");
    } finally {
      if (submitBtn) {
        submitBtn.dataset.submitting = "";
        submitBtn.disabled = false;
      }
    }
  };

  const bindAuthModalControls = () => {
    const authForm = $("auth-form");
    const authClose = $("auth-close");
    const authSubmit = $("auth-submit");

    if (authForm && !authForm.dataset.authBound) {
      authForm.addEventListener("submit", handleAuthSubmit);
      authForm.dataset.authBound = "1";
    }
    if (authSubmit && !authSubmit.dataset.authBound) {
      authSubmit.addEventListener("click", handleAuthSubmit);
      authSubmit.dataset.authBound = "1";
    }
    if (authClose && !authClose.dataset.authBound) {
      authClose.addEventListener("click", hideAuthModal);
      authClose.dataset.authBound = "1";
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

  const requestAuthOnWindowFocus = async () => {
    if (!ENABLE_FOCUS_REAUTH) return;
    if (!authReauthOnFocusRequired || authReauthInProgress) return;
    const authModal = $("auth-modal");
    if (authModal && !authModal.classList.contains("hidden")) return;
    authReauthInProgress = true;
    try {
      const ok = await showAuthModal({ forcePrompt: true });
      if (ok) authReauthOnFocusRequired = false;
    } finally {
      authReauthInProgress = false;
    }
  };

  const requireStartupAuthentication = async () => {
    if (
      !workflowApi ||
      typeof workflowApi.authStatus !== "function" ||
      typeof workflowApi.authLogin !== "function" ||
      typeof workflowApi.authSetup !== "function"
    ) {
      await showMessageModal("Authentication unavailable", "Required auth APIs are not available.");
      return false;
    }
    // Keep requiring auth while the app stays open.
    // Closing the modal will immediately ask again, which prevents silent bypass.
    // Closing the app window is still possible.
    for (;;) {
      const ok = await showAuthModal({ forcePrompt: true });
      if (ok) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
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
    header.append(title);

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
      { label: "REQ ID", value: card.req_id || row["REQ ID"] },
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

    const parsedPantsSize = parsePantsSize(row["Pants Size"]);
    const uniformSizes = createDetailsCard("Uniform Sizes", [
      { label: "Shirt Size", value: row["Shirt Size"] },
      { label: "Waist", value: row["Waist"] || parsedPantsSize.waist },
      { label: "Inseam", value: row["Inseam"] || parsedPantsSize.inseam },
    ]);
    if (uniformSizes) cards.push(uniformSizes);

    const parsedIssuedPantsSize = parsePantsSize(row["Issued Pants Size"] || row["Pants Size"]);
    const uniformIssued = createDetailsCard("Uniform Issued", [
      { label: "Issued", value: isUniformIssued(row["Uniforms Issued"]) ? "Yes" : "" },
      { label: "Issued Shirt Size", value: row["Issued Shirt Size"] || row["Shirt Size"] },
      { label: "Issued Shirt Type(s)", value: row["Issued Shirt Type"] || row["Shirt Type"] },
      { label: "Issued Shirts Given", value: row["Issued Shirts Given"] || row["Shirts Given"] },
      { label: "Issued Waist", value: row["Issued Waist"] || parsedIssuedPantsSize.waist },
      { label: "Issued Inseam", value: row["Issued Inseam"] || parsedIssuedPantsSize.inseam },
      { label: "Issued Pants Type", value: row["Issued Pants Type"] || row["Pants Type"] },
      { label: "Issued Pants Given", value: row["Issued Pants Given"] || row["Pants Given"] },
    ]);
    if (uniformIssued) cards.push(uniformIssued);

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

  const getDetailsSelectedCard = () => {
    const cardId = state.kanban.detailsCardId;
    if (!cardId) return null;
    return state.kanban.cards.find((item) => item.uuid === cardId) || null;
  };

  const openDetailsBasicInfo = () => {
    const card = getDetailsSelectedCard();
    if (!card) return;
    openCandidateModal("edit", card.column_id, card);
  };

  const openDetailsPii = () => {
    const card = getDetailsSelectedCard();
    if (!card) return;
    openPiiModal(card);
  };

  const openDetailsEmailTemplate = async () => {
    if (!state.kanban.detailsCardId) return;
    await refreshDetailsRow(state.kanban.detailsCardId);
    openEmailTemplateModal();
  };

  const openProcessModal = () => {
    if (!state.kanban.detailsCardId) return;
    const modal = $("process-modal");
    const arrival = $("process-arrival");
    const departure = $("process-departure");
    const branch = $("process-branch");
    const card = state.kanban.cards.find((item) => item.uuid === state.kanban.detailsCardId);
    const row = state.kanban.detailsRow || {};
    if (!modal) return;
    if (arrival) arrival.value = "";
    if (departure) departure.value = "";
    if (branch) {
      const preferredBranch = card ? card.branch : row["Branch"];
      const nextBranch = ["Salem", "Portland"].includes(preferredBranch) ? preferredBranch : "";
      branch.value = nextBranch;
    }
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
    const branchInput = $("process-branch");
    const arrival = sanitizeTimeInput(arrivalInput);
    const departure = sanitizeTimeInput(departureInput);
    const branch = branchInput ? branchInput.value.trim() : "";
    if (arrival.length !== 4 || departure.length !== 4) {
      await showMessageModal(
        "Invalid Time",
        "Enter arrival and departure time as 4 digits in 24H format (e.g., 0824).",
      );
      return;
    }
    if (!branch) {
      await showMessageModal("Missing Branch", "Branch is required when processing a candidate.");
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
      request: () =>
        workflowApi.kanbanProcessCandidate({ candidateId, arrival, departure, branch }),
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
    const reqIdInput = $("candidate-req-id");
    const jobNameInput = $("candidate-job-name");
    const jobLocationInput = $("candidate-job-location");
    const managerInput = $("candidate-manager");
    const branchSelect = $("candidate-branch");
    const branchOther = $("candidate-branch-other");
    const backgroundProviderInput = $("candidate-background-provider");
    const backgroundDateInput = $("candidate-background-date");
    const backgroundMvrInput = $("candidate-background-mvr");
    const licenseTypeInput = $("candidate-license-type");
    const coriStatusInput = $("candidate-cori-status");
    const coriDateInput = $("candidate-cori-date");
    const nhStatusInput = $("candidate-nh-status");
    const nhExpirationInput = $("candidate-nh-expiration");
    const nhIdInput = $("candidate-nh-id");
    const meStatusInput = $("candidate-me-status");
    const meExpirationInput = $("candidate-me-expiration");

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
      fill(reqIdInput, cardData.req_id);
      fill(jobNameInput, cardData.job_name);
      fill(jobLocationInput, cardData.job_location);
      fill(managerInput, cardData.manager);
      fill(backgroundProviderInput, "");
      fill(backgroundDateInput, "");
      fill(backgroundMvrInput, "1");
      fill(licenseTypeInput, "");
      fill(coriStatusInput, "");
      fill(coriDateInput, "");
      fill(nhStatusInput, "");
      fill(nhExpirationInput, "");
      fill(nhIdInput, "");
      fill(meStatusInput, "");
      fill(meExpirationInput, "");
      toggleCandidateBackgroundDate("");
      toggleCandidateLicenseSections("");
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
          fill(backgroundProviderInput, row["Background Provider"]);
          fill(backgroundDateInput, row["Background Cleared Date"]);
          fill(backgroundMvrInput, row["Background MVR Flag"] || "1");
          fill(licenseTypeInput, row["License Type"]);
          fill(coriStatusInput, row["MA CORI Status"]);
          fill(coriDateInput, row["MA CORI Date"]);
          fill(nhStatusInput, row["NH GC Status"]);
          fill(nhExpirationInput, row["NH GC Expiration Date"]);
          fill(nhIdInput, row["NH GC ID Number"]);
          fill(meStatusInput, row["ME GC Status"]);
          fill(meExpirationInput, row["ME GC Expiration Date"]);
          const providerValue = row["Background Provider"] || "";
          toggleCandidateBackgroundDate(providerValue);
          updateCandidateBackgroundMvrFlag(providerValue);
          toggleCandidateLicenseSections(row["License Type"] || "");
        })
        .catch(() => {});
    } else {
      fill(nameInput, "");
      fill(icimsInput, "");
      fill(empInput, "");
      fill(phoneInput, "");
      fill(emailInput, "");
      fill(jobIdInput, "");
      fill(reqIdInput, "");
      fill(jobNameInput, "");
      fill(jobLocationInput, "");
      fill(managerInput, "");
      fill(backgroundProviderInput, "");
      fill(backgroundDateInput, "");
      fill(backgroundMvrInput, "1");
      fill(licenseTypeInput, "");
      fill(coriStatusInput, "");
      fill(coriDateInput, "");
      fill(nhStatusInput, "");
      fill(nhExpirationInput, "");
      fill(nhIdInput, "");
      fill(meStatusInput, "");
      fill(meExpirationInput, "");
      toggleCandidateBackgroundDate("");
      toggleCandidateLicenseSections("");
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

  const toggleCandidateLicenseSections = (value) => {
    const ma = $("candidate-license-ma");
    const nh = $("candidate-license-nh");
    const me = $("candidate-license-me");
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

  const toggleCandidateBackgroundDate = (value) => {
    const dateInput = $("candidate-background-date");
    if (!dateInput) return;
    if (value) {
      dateInput.classList.remove("hidden");
    } else {
      dateInput.classList.add("hidden");
      dateInput.value = "";
    }
  };

  const updateCandidateBackgroundMvrFlag = (value) => {
    const flag = $("candidate-background-mvr");
    if (!flag) return;
    if (value && value.toLowerCase().includes("mvr")) {
      flag.value = "2";
    } else {
      flag.value = "1";
    }
  };

  const UNIFORM_ISSUED_COUNT_OPTIONS = ["1", "2", "3", "4"];
  const UNIFORM_SHIRT_SIZE_OPTIONS = [
    "XS",
    "XM",
    "S",
    "M",
    "L",
    "XL",
    "2XL",
    "3XL",
    "4XL",
    "5XL",
    "6XL",
  ];
  const UNIFORM_WAIST_OPTIONS = Array.from({ length: 36 }, (_value, index) => String(20 + index));
  const UNIFORM_INSEAM_OPTIONS = Array.from({ length: 10 }, (_value, index) => String(27 + index));
  const UNIFORM_ADD_SHIRT_SIZE_OPTIONS = [...UNIFORM_SHIRT_SIZE_OPTIONS];
  let piiUniformInventoryContext = null;
  let emailTemplateContext = null;
  let emailTemplateContextOverride = null;
  let emailTemplateBackdropMouseDown = false;
  let emailTemplateAutoRefreshTimer = null;
  let emailTemplateAutoRefreshInFlight = false;
  let emailTemplateLastGeneratedDraft = null;
  let emailTemplateLastGeneratedHtmlBody = "";

  const normalizeUniformInventoryType = (value) => {
    const text = String(value || "")
      .trim()
      .toLowerCase();
    if (text === "shirts") return "shirt";
    if (text === "pants") return "pant";
    if (text === "shirt") return "shirt";
    if (text === "pant") return "pant";
    return text;
  };

  const parseUniformInventoryQuantity = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const whole = Math.floor(num);
    if (whole <= 0) return 0;
    return whole;
  };

  const parseUniformTypeListJson = (text) => {
    if (!text || text[0] !== "[" || text[text.length - 1] !== "]") return null;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch (_error) {
      return null;
    }
  };

  const splitUniformTypeList = (value, allowedOptions = null) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    const text = String(value || "").trim();
    if (!text) return [];
    const parsedJson = parseUniformTypeListJson(text);
    if (parsedJson) return parsedJson;

    const allowed = new Set(
      Array.from(allowedOptions || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );
    if (allowed.size && allowed.has(text)) return [text];

    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const normalizeUniformTypeList = (value, allowedOptions) => {
    const allowed = new Set(allowedOptions || []);
    const seen = new Set();
    const sourceValues = Array.isArray(value) ? value : splitUniformTypeList(value, allowed);
    return sourceValues.filter((item) => {
      if (allowed.size && !allowed.has(item)) return false;
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  };

  const serializeUniformTypeList = (value) => {
    const normalized = normalizeUniformTypeList(value, null);
    if (!normalized.length) return "";
    return JSON.stringify(normalized);
  };

  const toSortedUniqueList = (values, numeric = false) => {
    const items = Array.from(
      new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)),
    );
    if (numeric) {
      return items.sort((a, b) => Number(a) - Number(b));
    }
    return items.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  };

  const getMapValues = (map, key) => {
    if (!map || !key) return [];
    const values = map.get(String(key).trim());
    return values ? [...values] : [];
  };

  const getUniformNoneMessage = (kind, branch) => {
    const safeBranch = String(branch || "").trim();
    const suffix = safeBranch ? ` for ${safeBranch}.` : ".";
    if (kind === "shirt") return `No shirts to give out${suffix}`;
    return `No pants to give out${suffix}`;
  };

  const setSingleSelectOptions = (
    select,
    { options, placeholder, emptyText, value, preserveOrder = false },
  ) => {
    if (!select) return;
    const normalized = preserveOrder
      ? Array.from(
          new Set((options || []).map((item) => String(item || "").trim()).filter(Boolean)),
        )
      : toSortedUniqueList(options);
    select.innerHTML = "";
    if (!normalized.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = emptyText;
      select.appendChild(option);
      select.value = "";
      select.disabled = true;
      return;
    }
    const prompt = document.createElement("option");
    prompt.value = "";
    prompt.textContent = placeholder;
    select.appendChild(prompt);
    normalized.forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
    select.disabled = false;
    select.value = normalized.includes(value) ? value : "";
  };

  const setMultiSelectOptions = (select, { options, emptyText, values }) => {
    if (!select) return;
    const normalized = toSortedUniqueList(options);
    select.innerHTML = "";
    if (!normalized.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = emptyText;
      option.disabled = true;
      select.appendChild(option);
      select.disabled = true;
      return;
    }
    normalized.forEach((item) => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
    select.disabled = false;
    setMultiSelectValues(select, normalizeUniformTypeList(values || [], normalized));
  };

  const setMultiSelectValues = (selectElement, values) => {
    if (!selectElement) return;
    const targetValues = new Set(Array.isArray(values) ? values : []);
    Array.from(selectElement.options).forEach((option) => {
      option.selected = targetValues.has(option.value);
    });
  };

  const getMultiSelectValues = (selectElement, allowedOptions = null) => {
    if (!selectElement || selectElement.disabled) return [];
    const allowed = allowedOptions ? new Set(allowedOptions) : null;
    const selected = Array.from(selectElement.selectedOptions)
      .map((option) => option.value.trim())
      .filter((value) => {
        if (!value) return false;
        if (allowed && !allowed.has(value)) return false;
        return true;
      });
    const seen = new Set();
    return selected.filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  };

  const isUniformIssued = (value) =>
    String(value || "")
      .trim()
      .toLowerCase() === "yes";

  const buildPantsSize = (waist, inseam) => {
    if (!waist || !inseam) return "";
    return `${waist}x${inseam}`;
  };

  const normalizeUniformMeasurement = (value) => sanitizeNumbers(String(value || "")).slice(0, 2);

  const parsePantsSize = (value) => {
    const text = String(value || "").trim();
    if (!text) return { waist: "", inseam: "" };
    const strictMatch = text.match(/^(\d{1,2})\s*[xX]\s*(\d{1,2})$/);
    if (strictMatch) return { waist: strictMatch[1], inseam: strictMatch[2] };
    const looseMatch = text.match(/(\d{1,2})\D+(\d{1,2})/);
    if (looseMatch) return { waist: looseMatch[1], inseam: looseMatch[2] };
    return { waist: "", inseam: "" };
  };

  const buildPiiUniformInventoryContext = (rows, branch) => {
    const safeBranch = String(branch || "").trim();
    const normalizedBranch = safeBranch.toLowerCase();
    const shirtSizes = new Set();
    const waists = new Set();
    const inseams = new Set();
    const shirtAlterationsAll = new Set();
    const pantsAlterationsAll = new Set();
    const shirtAlterationsBySize = new Map();
    const pantsAlterationsBySize = new Map();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const rowBranch = String((row && row.Branch) || "").trim();
      if (normalizedBranch && rowBranch.toLowerCase() !== normalizedBranch) return;
      const rawType = normalizeUniformInventoryType(row && row.Type);
      const size = String((row && row.Size) || "").trim();
      const parsed = parsePantsSize(size);
      const storedWaist = normalizeUniformMeasurement(row && row.Waist);
      const storedInseam = normalizeUniformMeasurement(row && row.Inseam);
      const waist = storedWaist || normalizeUniformMeasurement(parsed.waist);
      const inseam = storedInseam || normalizeUniformMeasurement(parsed.inseam);
      const hasPantsMeasurements = !!(waist && inseam);
      const alteration = String((row && row.Alteration) || "").trim();
      const quantity = parseUniformInventoryQuantity(row && row.Quantity);
      if (quantity <= 0) return;

      let type = rawType;
      if (rawType === "shirt" && hasPantsMeasurements) type = "pant";
      if (!type) {
        if (hasPantsMeasurements) {
          type = "pant";
        } else if (size) {
          type = "shirt";
        }
      }
      if (!type) return;

      if (type === "shirt") {
        if (!size) return;
        shirtSizes.add(size);
        if (alteration) {
          shirtAlterationsAll.add(alteration);
          if (!shirtAlterationsBySize.has(size)) shirtAlterationsBySize.set(size, new Set());
          shirtAlterationsBySize.get(size).add(alteration);
        }
      } else if (type === "pant") {
        const pantsKey = buildPantsSize(waist, inseam);
        if (!pantsKey) return;
        if (waist) waists.add(waist);
        if (inseam) inseams.add(inseam);
        if (alteration) {
          pantsAlterationsAll.add(alteration);
          if (!pantsAlterationsBySize.has(pantsKey))
            pantsAlterationsBySize.set(pantsKey, new Set());
          pantsAlterationsBySize.get(pantsKey).add(alteration);
        }
      }
    });

    return {
      branch: safeBranch,
      shirtSizes: toSortedUniqueList([...shirtSizes]),
      waists: toSortedUniqueList([...waists], true),
      inseams: toSortedUniqueList([...inseams], true),
      shirtAlterationsAll: toSortedUniqueList([...shirtAlterationsAll]),
      pantsAlterationsAll: toSortedUniqueList([...pantsAlterationsAll]),
      shirtAlterationsBySize,
      pantsAlterationsBySize,
      hasShirts: shirtSizes.size > 0,
      hasPants: waists.size > 0 || inseams.size > 0,
    };
  };

  const loadPiiUniformInventoryContext = async (branch) => {
    try {
      const table = await workflowApi.dbGetTable("uniform_inventory", "current");
      return buildPiiUniformInventoryContext((table && table.rows) || [], branch);
    } catch (error) {
      return buildPiiUniformInventoryContext([], branch);
    }
  };

  const updatePiiIssuedTypeOptions = ({ shirtTypes = null, pantsType = null } = {}) => {
    const shirtSizeInput = $("pii-issued-shirt-size");
    const waistInput = $("pii-issued-waist");
    const inseamInput = $("pii-issued-inseam");
    const shirtTypeInput = $("pii-shirt-type");
    const pantsTypeInput = $("pii-pants-type");
    const context = piiUniformInventoryContext || buildPiiUniformInventoryContext([], "");
    const shirtSize = shirtSizeInput ? shirtSizeInput.value.trim() : "";
    const waist = waistInput ? waistInput.value.trim() : "";
    const inseam = inseamInput ? inseamInput.value.trim() : "";
    const pantsSize = buildPantsSize(waist, inseam);
    const shirtOptions = shirtSize
      ? toSortedUniqueList(getMapValues(context.shirtAlterationsBySize, shirtSize))
      : context.shirtAlterationsAll;
    const pantsOptions = pantsSize
      ? toSortedUniqueList(getMapValues(context.pantsAlterationsBySize, pantsSize))
      : context.pantsAlterationsAll;
    const currentShirtTypes = shirtTypes || getMultiSelectValues(shirtTypeInput);
    const currentPantsType =
      pantsType !== null && pantsType !== undefined
        ? String(pantsType || "").trim()
        : pantsTypeInput
          ? pantsTypeInput.value.trim()
          : "";

    setMultiSelectOptions(shirtTypeInput, {
      options: shirtOptions,
      emptyText: getUniformNoneMessage("shirt", context.branch),
      values: currentShirtTypes,
    });
    setSingleSelectOptions(pantsTypeInput, {
      options: pantsOptions,
      placeholder: "Pants Type",
      emptyText: getUniformNoneMessage("pant", context.branch),
      value: currentPantsType,
    });
  };

  const toggleUniformIssuedFields = (issued, { clearValues = false } = {}) => {
    const fields = $("pii-issued-fields");
    if (fields) fields.classList.toggle("hidden", !issued);
    if (issued) {
      updatePiiIssuedTypeOptions();
    }
    if (!issued && clearValues) {
      const shirtsGiven = $("pii-shirts-given");
      const pantsGiven = $("pii-pants-given");
      const pantsType = $("pii-pants-type");
      const shirtType = $("pii-shirt-type");
      const issuedShirtSize = $("pii-issued-shirt-size");
      const issuedWaist = $("pii-issued-waist");
      const issuedInseam = $("pii-issued-inseam");
      if (shirtsGiven) shirtsGiven.value = "";
      if (pantsGiven) pantsGiven.value = "";
      if (pantsType) pantsType.value = "";
      if (issuedShirtSize) issuedShirtSize.value = "";
      if (issuedWaist) issuedWaist.value = "";
      if (issuedInseam) issuedInseam.value = "";
      setMultiSelectValues(shirtType, []);
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
    const uniformBranch = String(cardData.branch || row["Branch"] || "").trim();
    piiUniformInventoryContext = await loadPiiUniformInventoryContext(uniformBranch);

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
    const parsedPants = parsePantsSize(row["Pants Size"]);
    const waistValue = String(row["Waist"] || "").trim() || parsedPants.waist;
    const inseamValue = String(row["Inseam"] || "").trim() || parsedPants.inseam;
    const parsedIssuedPants = parsePantsSize(row["Issued Pants Size"] || row["Pants Size"]);
    const issuedShirtSizeValue =
      String(row["Issued Shirt Size"] || "").trim() || String(row["Shirt Size"] || "").trim();
    const issuedWaistValue =
      String(row["Issued Waist"] || "").trim() || parsedIssuedPants.waist || waistValue;
    const issuedInseamValue =
      String(row["Issued Inseam"] || "").trim() || parsedIssuedPants.inseam || inseamValue;
    const context =
      piiUniformInventoryContext || buildPiiUniformInventoryContext([], uniformBranch);
    setSingleSelectOptions($("pii-shirt"), {
      options: UNIFORM_SHIRT_SIZE_OPTIONS,
      placeholder: "Shirt Size",
      emptyText: "No shirt sizes available.",
      value: String(row["Shirt Size"] || "").trim(),
      preserveOrder: true,
    });
    setSingleSelectOptions($("pii-waist"), {
      options: UNIFORM_WAIST_OPTIONS,
      placeholder: "Waist",
      emptyText: "No waist sizes available.",
      value: waistValue,
      preserveOrder: true,
    });
    setSingleSelectOptions($("pii-inseam"), {
      options: UNIFORM_INSEAM_OPTIONS,
      placeholder: "Inseam",
      emptyText: "No inseam sizes available.",
      value: inseamValue,
      preserveOrder: true,
    });
    setSingleSelectOptions($("pii-issued-shirt-size"), {
      options: UNIFORM_SHIRT_SIZE_OPTIONS,
      placeholder: "Issued Shirt Size",
      emptyText: "No shirt sizes available.",
      value: issuedShirtSizeValue,
      preserveOrder: true,
    });
    setSingleSelectOptions($("pii-issued-waist"), {
      options: UNIFORM_WAIST_OPTIONS,
      placeholder: "Issued Waist",
      emptyText: "No waist sizes available.",
      value: issuedWaistValue,
      preserveOrder: true,
    });
    setSingleSelectOptions($("pii-issued-inseam"), {
      options: UNIFORM_INSEAM_OPTIONS,
      placeholder: "Issued Inseam",
      emptyText: "No inseam sizes available.",
      value: issuedInseamValue,
      preserveOrder: true,
    });
    const uniformsIssuedCheckbox = $("pii-uniforms-issued");
    if (uniformsIssuedCheckbox) {
      uniformsIssuedCheckbox.checked = isUniformIssued(row["Uniforms Issued"]);
    }
    updatePiiIssuedTypeOptions({
      shirtTypes: splitUniformTypeList(
        row["Issued Shirt Type"] || row["Shirt Type"],
        context.shirtAlterationsAll,
      ),
      pantsType: row["Issued Pants Type"] || row["Pants Type"],
    });
    setValue("pii-shirts-given", row["Issued Shirts Given"] || row["Shirts Given"]);
    setValue("pii-pants-given", row["Issued Pants Given"] || row["Pants Given"]);
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
    toggleUniformIssuedFields(uniformsIssuedCheckbox ? uniformsIssuedCheckbox.checked : false);

    modal.classList.remove("hidden");
  };

  const closePiiModal = () => {
    const modal = $("pii-modal");
    if (modal) modal.classList.add("hidden");
    state.kanban.piiCandidateId = null;
    piiUniformInventoryContext = null;
  };

  const collectPiiPayload = () => {
    const value = (id) => ($(id) ? $(id).value.trim() : "");
    const uniformsIssuedCheckbox = $("pii-uniforms-issued");
    const uniformsIssued = !!(uniformsIssuedCheckbox && uniformsIssuedCheckbox.checked);
    const shirtTypes = getMultiSelectValues($("pii-shirt-type"));
    const waist = value("pii-waist");
    const inseam = value("pii-inseam");
    const issuedShirtSize = value("pii-issued-shirt-size");
    const issuedWaist = value("pii-issued-waist");
    const issuedInseam = value("pii-issued-inseam");
    return {
      "Bank Name": value("pii-bank-name"),
      "Account Type": value("pii-account-type"),
      "Routing Number": value("pii-routing"),
      "Account Number": value("pii-account"),
      "Shirt Size": value("pii-shirt"),
      Waist: waist,
      Inseam: inseam,
      "Pants Size": buildPantsSize(waist, inseam),
      "Issued Shirt Size": uniformsIssued ? issuedShirtSize : "",
      "Issued Waist": uniformsIssued ? issuedWaist : "",
      "Issued Inseam": uniformsIssued ? issuedInseam : "",
      "Issued Pants Size": uniformsIssued ? buildPantsSize(issuedWaist, issuedInseam) : "",
      "Uniforms Issued": uniformsIssued ? "Yes" : "",
      "Issued Shirt Type": uniformsIssued ? serializeUniformTypeList(shirtTypes) : "",
      "Issued Shirts Given": uniformsIssued ? value("pii-shirts-given") : "",
      "Issued Pants Type": uniformsIssued ? value("pii-pants-type") : "",
      "Issued Pants Given": uniformsIssued ? value("pii-pants-given") : "",
      "Shirt Type": uniformsIssued ? serializeUniformTypeList(shirtTypes) : "",
      "Shirts Given": uniformsIssued ? value("pii-shirts-given") : "",
      "Pants Type": uniformsIssued ? value("pii-pants-type") : "",
      "Pants Given": uniformsIssued ? value("pii-pants-given") : "",
      "Boots Size": "",
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

    const context = piiUniformInventoryContext || buildPiiUniformInventoryContext([], "");
    const shirtSizeValue = String(payload["Shirt Size"] || "").trim();
    const waistValue = String(payload["Waist"] || "").trim();
    const inseamValue = String(payload["Inseam"] || "").trim();
    const issuedShirtSizeValue = String(payload["Issued Shirt Size"] || "").trim();
    const issuedWaistValue = String(payload["Issued Waist"] || "").trim();
    const issuedInseamValue = String(payload["Issued Inseam"] || "").trim();
    const issuedShirtsGivenValue = String(
      payload["Issued Shirts Given"] || payload["Shirts Given"] || "",
    ).trim();
    const issuedPantsGivenValue = String(
      payload["Issued Pants Given"] || payload["Pants Given"] || "",
    ).trim();
    const issuedPantsTypeValue = String(
      payload["Issued Pants Type"] || payload["Pants Type"] || "",
    ).trim();
    const issuedShirtTypeValue = String(
      payload["Issued Shirt Type"] || payload["Shirt Type"] || "",
    ).trim();
    const issuedPantsSize = buildPantsSize(issuedWaistValue, issuedInseamValue);
    const allowedShirtSizes = new Set(UNIFORM_SHIRT_SIZE_OPTIONS);
    const allowedWaists = new Set(UNIFORM_WAIST_OPTIONS);
    const allowedInseams = new Set(UNIFORM_INSEAM_OPTIONS);
    const allowedShirtTypes = new Set(
      issuedShirtSizeValue
        ? getMapValues(context.shirtAlterationsBySize, issuedShirtSizeValue)
        : context.shirtAlterationsAll,
    );
    const allowedPantsTypes = new Set(
      issuedPantsSize
        ? getMapValues(context.pantsAlterationsBySize, issuedPantsSize)
        : context.pantsAlterationsAll,
    );
    const isValidDropdownValue = (value, allowedOptions) => {
      if (!value) return true;
      const text = String(value);
      if (allowedOptions instanceof Set) return allowedOptions.has(text);
      if (Array.isArray(allowedOptions)) return allowedOptions.includes(text);
      return false;
    };

    if (!isValidDropdownValue(shirtSizeValue, allowedShirtSizes)) {
      await showMessageModal(
        "Invalid Shirt Size",
        "Shirt Size must be selected from the dropdown.",
      );
      return false;
    }
    if (!isValidDropdownValue(waistValue, allowedWaists)) {
      await showMessageModal("Invalid Waist", "Waist must be selected from the dropdown.");
      return false;
    }
    if (!isValidDropdownValue(inseamValue, allowedInseams)) {
      await showMessageModal("Invalid Inseam", "Inseam must be selected from the dropdown.");
      return false;
    }
    if (!isValidDropdownValue(issuedShirtSizeValue, allowedShirtSizes)) {
      await showMessageModal(
        "Invalid Issued Shirt Size",
        "Issued Shirt Size must be selected from the dropdown.",
      );
      return false;
    }
    if (!isValidDropdownValue(issuedWaistValue, allowedWaists)) {
      await showMessageModal(
        "Invalid Issued Waist",
        "Issued Waist must be selected from the dropdown.",
      );
      return false;
    }
    if (!isValidDropdownValue(issuedInseamValue, allowedInseams)) {
      await showMessageModal(
        "Invalid Issued Inseam",
        "Issued Inseam must be selected from the dropdown.",
      );
      return false;
    }
    if (!isValidDropdownValue(issuedShirtsGivenValue, UNIFORM_ISSUED_COUNT_OPTIONS)) {
      await showMessageModal(
        "Invalid Shirts Given",
        "Issued Shirts Given must be selected as a number from 1 to 4.",
      );
      return false;
    }
    if (!isValidDropdownValue(issuedPantsGivenValue, UNIFORM_ISSUED_COUNT_OPTIONS)) {
      await showMessageModal(
        "Invalid Pants Given",
        "Issued Pants Given must be selected as a number from 1 to 4.",
      );
      return false;
    }
    if (!isValidDropdownValue(issuedPantsTypeValue, allowedPantsTypes)) {
      await showMessageModal(
        "Invalid Pants Type",
        "Issued Pants Type must match available pants inventory.",
      );
      return false;
    }

    const shirtTypes = splitUniformTypeList(issuedShirtTypeValue, allowedShirtTypes);
    if (shirtTypes.some((type) => !allowedShirtTypes.has(type))) {
      await showMessageModal(
        "Invalid Shirt Type",
        "Issued Shirt Type(s) must match available shirt inventory.",
      );
      return false;
    }

    const uniformsIssued = isUniformIssued(payload["Uniforms Issued"]);
    if (payload["Uniforms Issued"] && !uniformsIssued) {
      await showMessageModal(
        "Invalid Uniform Status",
        "Uniforms Issued must come from the checkbox.",
      );
      return false;
    }
    if (uniformsIssued) {
      if (!issuedShirtsGivenValue && !issuedPantsGivenValue) {
        await showMessageModal(
          "Missing Uniform Counts",
          "Select Issued Shirts Given and/or Issued Pants Given when Uniforms Issued is checked.",
        );
        return false;
      }
      if (issuedShirtsGivenValue) {
        if (!payload["Issued Shirt Size"]) {
          await showMessageModal(
            "Missing Issued Shirt Size",
            "Select Issued Shirt Size when shirts are issued.",
          );
          return false;
        }
        if (!allowedShirtTypes.size) {
          await showMessageModal(
            "No Shirts Available",
            getUniformNoneMessage("shirt", context.branch),
          );
          return false;
        }
        if (!shirtTypes.length) {
          await showMessageModal("Missing Shirt Type", "Select one or more Issued Shirt Type(s).");
          return false;
        }
      }
      if (issuedPantsGivenValue) {
        if (!payload["Issued Waist"] || !payload["Issued Inseam"]) {
          await showMessageModal(
            "Missing Issued Pants Size",
            "Select Issued Waist and Issued Inseam when pants are issued.",
          );
          return false;
        }
        if (!allowedPantsTypes.size) {
          await showMessageModal(
            "No Pants Available",
            `No pants to give out${context.branch ? ` for ${context.branch}` : ""} in ${issuedPantsSize}.`,
          );
          return false;
        }
        if (!issuedPantsTypeValue) {
          await showMessageModal(
            "Missing Pants Type",
            "Select Issued Pants Type when pants are issued.",
          );
          return false;
        }
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
    const reqIdInput = $("candidate-req-id");
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
      req_id: reqIdInput ? reqIdInput.value.trim() : "",
      job_name: jobNameInput ? jobNameInput.value.trim() : "",
      job_location: jobLocationInput ? jobLocationInput.value.trim() : "",
      manager: managerInput ? managerInput.value.trim() : "",
      branch: branchValue,
    };
  };

  const collectCandidatePreNeoPayload = () => {
    const value = (id) => ($(id) ? $(id).value.trim() : "");
    return {
      "Background Provider": value("candidate-background-provider"),
      "Background Cleared Date": value("candidate-background-date"),
      "Background MVR Flag": value("candidate-background-mvr") || "1",
      "License Type": value("candidate-license-type"),
      "MA CORI Status": value("candidate-cori-status"),
      "MA CORI Date": value("candidate-cori-date"),
      "NH GC Status": value("candidate-nh-status"),
      "NH GC Expiration Date": value("candidate-nh-expiration"),
      "NH GC ID Number": value("candidate-nh-id"),
      "ME GC Status": value("candidate-me-status"),
      "ME GC Expiration Date": value("candidate-me-expiration"),
    };
  };

  const validateCandidatePreNeoPayload = async (payload) => {
    const dateFields = [
      { label: "Background Cleared Date", value: payload["Background Cleared Date"] },
      { label: "MA CORI Date", value: payload["MA CORI Date"] },
      { label: "NH GC Expiration Date", value: payload["NH GC Expiration Date"] },
      { label: "ME GC Expiration Date", value: payload["ME GC Expiration Date"] },
    ];
    for (const field of dateFields) {
      if (field.value && !isDateLikeValid(field.value)) {
        await showMessageModal(
          "Invalid Format",
          `${field.label} must be in MM/DD/YY or MM/DD/YYYY format.`,
        );
        return false;
      }
    }
    return true;
  };

  const persistCandidatePreNeoPayload = async (candidateId, payload) => {
    if (!candidateId) return;
    try {
      await workflowApi.piiSave(candidateId, payload);
    } catch (_error) {
      await showMessageModal(
        "Pre Neo Save Failed",
        "Candidate was saved, but Pre Neo fields could not be saved. Reopen Basic Info and try again.",
      );
    }
  };

  const handleCandidateSubmit = async (event) => {
    event.preventDefault();
    const payload = buildCandidatePayload();
    const preNeoPayload = collectCandidatePreNeoPayload();
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
    if (!(await validateCandidatePreNeoPayload(preNeoPayload))) return;

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
      await persistCandidatePreNeoPayload(cardId, preNeoPayload);
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
      await persistCandidatePreNeoPayload(
        result && result.card ? result.card.uuid : null,
        preNeoPayload,
      );
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
    const backgroundProvider = $("candidate-background-provider");
    const licenseType = $("candidate-license-type");
    const nhId = $("candidate-nh-id");
    const backgroundDate = $("candidate-background-date");
    const coriDate = $("candidate-cori-date");
    const nhExpiration = $("candidate-nh-expiration");
    const meExpiration = $("candidate-me-expiration");

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

    [backgroundDate, coriDate, nhExpiration, meExpiration].filter(Boolean).forEach((input) => {
      input.addEventListener("input", () => {
        input.value = formatDateLike(input.value);
      });
    });

    if (nhId) {
      nhId.addEventListener("input", () => {
        nhId.value = sanitizeAlphaNum(nhId.value);
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

    if (backgroundProvider) {
      backgroundProvider.addEventListener("change", () => {
        toggleCandidateBackgroundDate(backgroundProvider.value);
        updateCandidateBackgroundMvrFlag(backgroundProvider.value);
      });
    }

    if (licenseType) {
      licenseType.addEventListener("change", () => {
        toggleCandidateLicenseSections(licenseType.value);
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

    const nhId = $("pii-nh-id");
    if (nhId) {
      nhId.addEventListener("input", () => {
        nhId.value = sanitizeAlphaNum(nhId.value);
      });
    }

    const uniformsIssued = $("pii-uniforms-issued");
    if (uniformsIssued) {
      uniformsIssued.addEventListener("change", () => {
        toggleUniformIssuedFields(uniformsIssued.checked, {
          clearValues: !uniformsIssued.checked,
        });
      });
    }

    const uniformSizeInputs = [
      $("pii-issued-shirt-size"),
      $("pii-issued-waist"),
      $("pii-issued-inseam"),
    ].filter(Boolean);
    uniformSizeInputs.forEach((input) => {
      input.addEventListener("change", () => {
        updatePiiIssuedTypeOptions();
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
    const [status, storageInfo] = await Promise.all([
      workflowApi.setupStatus(),
      workflowApi.storageInfo ? workflowApi.storageInfo() : Promise.resolve(null),
    ]);
    if (!status || !status.needsSetup) return;
    const pathEl = $("setup-folder-path");
    if (pathEl) {
      const storageLabel =
        storageInfo && storageInfo.pathLabel ? storageInfo.pathLabel : status.folder || "";
      if (storageLabel) pathEl.textContent = storageLabel;
    }
    const warning = $("setup-storage-warning");
    if (warning) {
      const fallback = !!(storageInfo && storageInfo.fallback) || !!(status && status.fallback);
      warning.classList.toggle("hidden", !fallback);
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
    if (!workflowApi || !workflowApi.donate) {
      const card = donateBtn.closest(".card");
      if (card) card.classList.add("hidden");
      return;
    }
    const preference = workflowApi.donationPreference && (await workflowApi.donationPreference());
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
          if (
            delta > 0 &&
            columnBody.scrollTop + columnBody.clientHeight < columnBody.scrollHeight
          ) {
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
    if (!summary) return;
    if (summary.saved) return;
    if (!summary.content) return;
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

  const INITIAL_COMPLIANCE_BASE_ITEMS = [
    "Employee Master file, Drug Test, & Paperwork",
    "MVR in WT",
    "DL in WT",
  ];

  const AUS_COMPLIANCE_BASE_ITEMS = ["CORE.", "1st Amendment Edge Training"];

  const CLIENT_COMPLIANCE_SECTIONS = [
    {
      id: "amazon",
      title: "Completed Amazon Compliance Items:",
      matchers: [/\bamazon\b/i, /\bamzl\b/i, /\bamzn\b/i],
      items: ["ASHI", "Heliaus SP Training", "Driver Training (Edge)"],
    },
    {
      id: "bae",
      title: "Completed BAE Compliance Items:",
      matchers: [/\bbae\b/i],
      items: ["4 NISP Courses in Edge", "Driver Training"],
    },
    {
      id: "fedex",
      title: "Completed FedEx Compliance Items:",
      matchers: [/\bfedex\b/i],
      items: ["FedEx Trainings in Edge"],
    },
    {
      id: "schneider-mercury",
      title: "Completed Schneider/Mercury Edge Items:",
      matchers: [/\bschneider\b/i, /\bmercury\b/i],
      items: [
        "School of Manufacturing Essentials",
        "Access Control Training",
        "Ready Response",
        "Ashi (Part One)",
      ],
    },
  ];

  const EDGE_PORTAL_URL = "https://allieduniversaledge.exceedlms.com/";
  const EDGE_URL_CORE =
    "https://allieduniversaledge.exceedlms.com/student/path/235757-allied-universal-core-training-program?sid=23282cc8-cf0f-40e6-aee3-0247c063d22b&sid_i=0";
  const EDGE_URL_FIRST_AMENDMENT =
    "https://allieduniversaledge.exceedlms.com/student/activity/466290-the-right-of-the-people?sid=751dd690-0334-4ac9-b316-0944e6fc4f7c&sid_i=0";
  const EDGE_URL_DRIVER =
    "https://allieduniversaledge.exceedlms.com/student/path/156722-driver-training-program?sid=31fd0473-d838-42a3-8bcc-a1ed22194a43&sid_i=0";
  const EDGE_URL_DRIVER_ONLY =
    "https://allieduniversaledge.exceedlms.com/student/path/156722-driver-training-program?sid=cead8730-124e-4e2b-bdde-36eca537b3d1&sid_i=1";

  const EDGE_COMMON_LINKS = [
    { label: "Allied Universal Core Competencies", url: EDGE_URL_CORE },
    { label: "Allied Universal 1st Amendment Rights Training", url: EDGE_URL_FIRST_AMENDMENT },
  ];

  const EDGE_TRACK_LINKS = {
    amazon: [
      {
        label: "Heliaus Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/443135-security-professional-heliaus-training?sid=423369e9-382c-4f7f-b0c1-d2e6708eb6bc&sid_i=0",
      },
      {
        label: "CPR Training (ASHI Part One)",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/410737-ashi-part-one-cpr-fa-aed-all-ages-online-course?sid=b5989ca8-49c1-4c15-967f-12048f94751c&sid_i=1",
      },
      { label: "Driver Training", url: EDGE_URL_DRIVER },
    ],
    bae: [
      {
        label: "NISP Training 1",
        url: "https://allieduniversaledge.exceedlms.com/student/path/17061-nisp-initial-security-briefing?sid=5cc6f81a-9439-44e7-97db-65665be35d66&sid_i=0",
      },
      {
        label: "NISP Training 2",
        url: "https://allieduniversaledge.exceedlms.com/student/path/1266313-nisp-reporting-requirements-at-a-glance-cdse-short-series?sid=5cc6f81a-9439-44e7-97db-65665be35d66&sid_i=1",
      },
      {
        label: "NISP Training 3",
        url: "https://allieduniversaledge.exceedlms.com/student/path/1266260-nisp-adverse-information-reporting-cdse-short-series?sid=881299e9-bf14-4078-a00b-89546e3575c3&sid_i=0",
      },
      {
        label: "NISP Training 4",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/238514-cdse-s-insider-threat-awareness-course?sid=98a1dff2-80df-4b37-a8cb-7e6a47e29a6b&sid_i=0",
      },
      { label: "Driver Training", url: EDGE_URL_DRIVER },
    ],
    fedex: [
      {
        label: "Freight Training",
        url: "https://allieduniversaledge.exceedlms.com/student/path/381244-fedex-freight-training-101?sid=d9544c03-bce3-408a-8843-3bdcef7a3d59&sid_i=0",
      },
      {
        label: "Video Screen Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/977017-fedex-video-screening-training-annual?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=1",
      },
      {
        label: "Pedestrian Screening Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/1257423-fedex-express-ground-pedestrian-screening-training?sid=5d40f0b0-2723-4439-972c-d5c01d2197b8&sid_i=2",
      },
      {
        label: "Threat Awareness & Workplace Violence Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/2022797-fedex-workplace-violence-threat-awareness?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=3",
      },
      {
        label: "Truck Screening Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/1279138-fedex-ground-truck-screening?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=4",
      },
      {
        label: "FedEx General Security Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/2133277-fedex-general-security-awareness?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=5",
      },
      {
        label: "Telephone Etiquette Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/319-telephone-etiquette?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=6",
      },
      {
        label: "Radio Communication Training",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/143319-radio-communications-two-way?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=7",
      },
      {
        label: "Workplace Violence Training",
        url: "https://allieduniversaledge.exceedlms.com/student/path/78829-workplace-violence-awareness?sid=911a863e-ba26-4ca1-ba35-7818c527aad4&sid_i=8",
      },
    ],
    schneider: [
      {
        label: "School of Manufacturing Industrial Essentials",
        url: "https://allieduniversaledge.exceedlms.com/student/path/67048-school-of-manufacturing-industrial-essentials?sid=11939feb-85db-4eca-a8df-eb65f8390980&sid_i=0",
      },
      {
        label: "Access Control Training",
        url: "https://allieduniversaledge.exceedlms.com/student/path/61728-lightning-lessons-access-control?sid=150c0b97-86e6-432b-9778-47e925342308&sid_i=0",
      },
      {
        label: "Ready Response",
        url: "https://allieduniversaledge.exceedlms.com/student/path/8086-ready-response?sid=c0d7e0a2-06e1-4632-93e0-68f8173e7f4a&sid_i=0",
      },
      {
        label: "CPR Training (ASHI Part One)",
        url: "https://allieduniversaledge.exceedlms.com/student/activity/410737-ashi-part-one-cpr-fa-aed-all-ages-online-course?sid=42c998fd-6832-45fd-966d-43f7da14a829&sid_i=0",
      },
    ],
    driverOnly: [{ label: "Allied Universal Driver Training", url: EDGE_URL_DRIVER_ONLY }],
    coreOnly: [],
  };

  const EDGE_LINK_TEMPLATE_DEFINITIONS = {
    "edge-amazon": {
      label: "Amazon Trainings",
      key: "amazon",
      includeCommon: true,
      note: "After completing the online CPR training, complete an in-person CPR class before starting work.",
    },
    "edge-bae": {
      label: "BAE Trainings",
      key: "bae",
      includeCommon: true,
      cc: ["SAVANAH.ROBBINS@BAESYSTEMS.US", "RAY.FELICIANO@BAESYSTEMS.US"],
      note: "",
    },
    "edge-fedex": {
      label: "FedEx Trainings",
      key: "fedex",
      includeCommon: true,
      note: "Complete each FedEx training one at-a-time, then notify the trainer.",
    },
    "edge-schneider": {
      label: "Schneider Trainings",
      key: "schneider",
      includeCommon: true,
      note: "After completing online CPR courses, complete an in-person CPR class before starting work.",
    },
    "edge-driver-only": {
      label: "Driver Only",
      key: "driverOnly",
      includeCommon: true,
      note: "",
    },
    "edge-core-only": {
      label: "CORE Only",
      key: "coreOnly",
      includeCommon: true,
      note: "",
    },
  };

  const BUILTIN_EMAIL_TEMPLATE_DEFINITIONS = Object.freeze([
    { id: "neo-compliance", label: "NEO Summary" },
    { id: "cori-template", label: "CORI Template" },
    { id: "edge-credentials", label: "Edge Credentials & Links" },
    { id: "edge-amazon", label: "Edge Links - Amazon" },
    { id: "edge-bae", label: "Edge Links - BAE" },
    { id: "edge-fedex", label: "Edge Links - FedEx" },
    { id: "edge-schneider", label: "Edge Links - Schneider" },
    { id: "edge-driver-only", label: "Edge Links - Driver Only" },
    { id: "edge-core-only", label: "Edge Links - CORE Only" },
    { id: "follow-up", label: "Onboarding Follow-Up" },
    { id: "missing-pii", label: "Missing PII Reminder" },
    { id: "uniform-issued", label: "Uniform Issue Confirmation" },
  ]);

  const EMAIL_TEMPLATE_TYPES = BUILTIN_EMAIL_TEMPLATE_DEFINITIONS.map((item) => item.id);

  const DEFAULT_EMAIL_TEMPLATE_CONFIG = Object.freeze(
    EMAIL_TEMPLATE_TYPES.reduce((acc, type) => {
      const isEdge = type.startsWith("edge-");
      if (type === "neo-compliance") {
        acc[type] = {
          toTemplate: "{{managerEmail}}",
          ccTemplate: "",
          subjectTemplate: "{{defaultSubject}}",
          bodyTemplate: "{{defaultBody}}",
        };
      } else if (type === "cori-template") {
        acc[type] = {
          toTemplate: "Nancy.Major@aus.com",
          ccTemplate: "",
          subjectTemplate: "{{defaultSubject}}",
          bodyTemplate: "{{defaultBody}}",
        };
      } else if (isEdge) {
        acc[type] = {
          toTemplate: "{{email}}",
          ccTemplate: "{{managerEmail}}",
          subjectTemplate: "{{defaultSubject}}",
          bodyTemplate: "{{defaultBody}}",
        };
      } else if (type === "missing-pii" || type === "uniform-issued") {
        acc[type] = {
          toTemplate: "{{email}}",
          ccTemplate: "",
          subjectTemplate: "{{defaultSubject}}",
          bodyTemplate: "{{defaultBody}}",
        };
      } else {
        acc[type] = {
          toTemplate: "{{managerEmail}}",
          ccTemplate: "",
          subjectTemplate: "{{defaultSubject}}",
          bodyTemplate: "{{defaultBody}}",
        };
      }
      acc[type].htmlBodyTemplate = "{{defaultHtmlBody}}";
      return acc;
    }, {}),
  );

  const MAX_EMAIL_TEMPLATE_TO_LEN = 320;
  const MAX_EMAIL_TEMPLATE_CC_LEN = 1200;
  const MAX_EMAIL_TEMPLATE_SUBJECT_LEN = 500;
  const MAX_EMAIL_TEMPLATE_BODY_LEN = 40000;
  const MAX_EMAIL_TEMPLATE_HTML_BODY_LEN = 120000;
  const MAX_EMAIL_TEMPLATE_TOKEN_KEY_LEN = 40;
  const MAX_EMAIL_TEMPLATE_TOKEN_VALUE_LEN = 2000;

  const toTemplateValue = (value) => {
    const text = String(value || "").trim();
    return text && text !== "—" ? text : "";
  };

  const normalizeTemplateFieldName = (value) => {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  };

  const buildTemplateRowLookup = (rowValue) => {
    const row = rowValue && typeof rowValue === "object" ? rowValue : {};
    const normalized = {};
    Object.keys(row).forEach((key) => {
      const normalizedKey = normalizeTemplateFieldName(key);
      if (!normalizedKey || Object.prototype.hasOwnProperty.call(normalized, normalizedKey)) return;
      normalized[normalizedKey] = row[key];
    });
    return { row, normalized };
  };

  const readTemplateRowValue = (rowLookup, ...keys) => {
    if (!rowLookup) return "";
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(rowLookup.row, key)) {
        const value = rowLookup.row[key];
        const text = toTemplateValue(value);
        if (text) return text;
      }
    }
    for (const key of keys) {
      const normalizedKey = normalizeTemplateFieldName(key);
      if (!normalizedKey) continue;
      if (!Object.prototype.hasOwnProperty.call(rowLookup.normalized, normalizedKey)) continue;
      const value = rowLookup.normalized[normalizedKey];
      const text = toTemplateValue(value);
      if (text) return text;
    }
    return "";
  };

  const clampTemplateString = (value, maxLen) => {
    const text = String(value || "");
    return text.length > maxLen ? text.slice(0, maxLen) : text;
  };

  const sanitizeEmailTemplateRecord = (record) => {
    const payload = record && typeof record === "object" ? record : {};
    return {
      toTemplate: clampTemplateString(payload.toTemplate, MAX_EMAIL_TEMPLATE_TO_LEN),
      ccTemplate: clampTemplateString(payload.ccTemplate, MAX_EMAIL_TEMPLATE_CC_LEN),
      subjectTemplate: clampTemplateString(payload.subjectTemplate, MAX_EMAIL_TEMPLATE_SUBJECT_LEN),
      bodyTemplate: clampTemplateString(payload.bodyTemplate, MAX_EMAIL_TEMPLATE_BODY_LEN),
      htmlBodyTemplate: clampTemplateString(
        payload.htmlBodyTemplate,
        MAX_EMAIL_TEMPLATE_HTML_BODY_LEN,
      ),
    };
  };

  const sanitizeEmailTemplateMap = (templates) => {
    const out = {};
    if (!templates || typeof templates !== "object" || Array.isArray(templates)) return out;
    Object.keys(templates)
      .slice(0, 64)
      .forEach((type) => {
        const safeType = String(type || "")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 64);
        if (!safeType) return;
        out[safeType] = sanitizeEmailTemplateRecord(templates[type]);
      });
    return out;
  };

  const sanitizeEmailTemplateTokenKey = (value) => {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, MAX_EMAIL_TEMPLATE_TOKEN_KEY_LEN);
  };

  const sanitizeEmailTemplateTokenValue = (value) => {
    return clampTemplateString(value, MAX_EMAIL_TEMPLATE_TOKEN_VALUE_LEN);
  };

  const sanitizeEmailTemplateTokenMap = (tokens) => {
    const out = {};
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return out;
    Object.keys(tokens)
      .slice(0, 128)
      .forEach((key) => {
        const safeKey = sanitizeEmailTemplateTokenKey(key);
        if (!safeKey) return;
        const value = sanitizeEmailTemplateTokenValue(tokens[key]);
        if (!value) return;
        out[safeKey] = value;
      });
    return out;
  };

  const formatUniformTypeText = (value) => {
    const values = splitUniformTypeList(value);
    return values.length ? values.join(", ") : "";
  };

  const managerNameToAusEmail = (managerValue) => {
    const raw = toTemplateValue(managerValue);
    if (!raw) return "";
    if (raw.includes("@")) return raw.toLowerCase();
    const tokens = raw
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z]/g, ""))
      .filter(Boolean);
    if (tokens.length < 2) return "";
    return `${tokens[0]}.${tokens[tokens.length - 1]}@aus.com`;
  };

  const isEdgeTemplateType = (type) => String(type || "").startsWith("edge-");

  const getEmailTemplateRecipients = (type, context) => {
    const safeContext = context || {};
    if (type === "neo-compliance") {
      return {
        to: safeContext.managerEmail || safeContext.manager || "",
        cc: "",
      };
    }
    if (type === "cori-template") {
      return {
        to: "Nancy.Major@aus.com",
        cc: "",
      };
    }
    if (isEdgeTemplateType(type)) {
      return {
        to: safeContext.email || "",
        cc: safeContext.managerEmail || "",
      };
    }
    return {
      to: safeContext.manager || safeContext.email || "",
      cc: "",
    };
  };

  const getEmailTemplateConfigForType = (type) => {
    const safeType = String(type || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 64);
    const defaults = DEFAULT_EMAIL_TEMPLATE_CONFIG[safeType] || {
      toTemplate: "{{managerEmail}}",
      ccTemplate: "",
      subjectTemplate: "{{defaultSubject}}",
      bodyTemplate: "{{defaultBody}}",
      htmlBodyTemplate: "{{defaultHtmlBody}}",
    };
    const custom =
      state.emailTemplates && state.emailTemplates.items && state.emailTemplates.items[safeType]
        ? sanitizeEmailTemplateRecord(state.emailTemplates.items[safeType])
        : {};
    return {
      ...defaults,
      ...custom,
    };
  };

  const renderTemplateText = (templateText, tokenMap) => {
    const text = String(templateText || "");
    if (!text) return "";
    let rendered = text.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(tokenMap, key)) return match;
      return String(tokenMap[key] ?? "");
    });
    const legacyTokenMap = {
      EID: "eid",
      DOB_NO_SLASHES: "dobDigits",
      RECIPIENT_NAME: "recipientName",
      CANDIDATE_NAME: "recipientName",
      CANDIDATE_EMAIL: "candidateEmail",
      ICIMS_ID: "icimsId",
      REQ_ID: "reqId",
      WT_JOB_NO: "wtJobNo",
      MANAGER: "manager",
      MANAGER_EMAIL: "managerEmail",
      BRANCH: "branch",
      JOB_ID: "jobId",
      JOB_NAME: "jobName",
      PHONE: "phone",
      EMAIL: "email",
      START_TIME: "startTime",
      END_TIME: "endTime",
      TOTAL_HOURS: "totalHours",
      HIRE_DATE: "hireDate",
    };
    const legacyTokenMapNormalized = Object.keys(legacyTokenMap).reduce((acc, legacyKey) => {
      acc[normalizeTemplateFieldName(legacyKey)] = legacyTokenMap[legacyKey];
      return acc;
    }, {});
    rendered = rendered.replace(/\[([^\]\r\n]+)\]/g, (match, key) => {
      const trimmedKey = String(key || "").trim();
      if (!trimmedKey) return match;
      const mappedKey =
        legacyTokenMap[trimmedKey] || legacyTokenMapNormalized[normalizeTemplateFieldName(trimmedKey)];
      if (!mappedKey) return match;
      if (!Object.prototype.hasOwnProperty.call(tokenMap, mappedKey)) return match;
      return String(tokenMap[mappedKey] ?? "");
    });
    return rendered;
  };

  const sanitizeTemplateDisplayName = (value) => {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 80);
  };

  const buildCustomTemplateTypeId = (label) => {
    const base = sanitizeTemplateDisplayName(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return base ? `custom-${base}` : "";
  };

  const getAllEmailTemplateDefinitions = () => {
    const customTypes =
      state.emailTemplates && state.emailTemplates.customTypes
        ? state.emailTemplates.customTypes
        : {};
    const customDefs = Object.keys(customTypes)
      .map((id) => ({
        id,
        label: sanitizeTemplateDisplayName(customTypes[id]) || id,
      }))
      .filter((item) => !!item.id)
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...BUILTIN_EMAIL_TEMPLATE_DEFINITIONS, ...customDefs];
  };

  const getEmailTemplateTypeLabel = (type) => {
    const match = getAllEmailTemplateDefinitions().find((item) => item.id === type);
    return match ? match.label : sanitizeTemplateDisplayName(type) || "Template";
  };

  const makeUniqueCustomTemplateTypeId = (label) => {
    const base = buildCustomTemplateTypeId(label);
    if (!base) return "";
    const existing = new Set(getAllEmailTemplateDefinitions().map((item) => item.id));
    if (!existing.has(base)) return base;
    let index = 2;
    while (index < 1000) {
      const next = `${base}-${index}`;
      if (!existing.has(next)) return next;
      index += 1;
    }
    return "";
  };

  const renderEmailTemplateTypeSelectOptions = (selectId, selectedType) => {
    const select = $(selectId);
    if (!select) return;
    const definitions = getAllEmailTemplateDefinitions();
    const selected = selectedType || select.value || "neo-compliance";
    select.innerHTML = "";
    const fragment = document.createDocumentFragment();
    definitions.forEach((definition) => {
      const option = document.createElement("option");
      option.value = definition.id;
      option.textContent = definition.label;
      fragment.appendChild(option);
    });
    select.appendChild(fragment);
    const hasSelected = definitions.some((item) => item.id === selected);
    select.value = hasSelected ? selected : definitions[0]?.id || "neo-compliance";
  };

  const formatTemplateDate = (value) => {
    const text = toTemplateValue(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isoToSlashDate(text);
    return text;
  };

  const toDisplayValue = (value, fallback = "x") => {
    return toTemplateValue(value) || fallback;
  };

  const formatNumberedListLines = (items) => {
    return (items || []).map((item, index) => `  ${index + 1}. ${item}`);
  };

  const formatNumberedLinkLines = (links) => {
    return (links || []).map((item, index) => {
      const label = toTemplateValue(item && item.label);
      const url = toTemplateValue(item && item.url);
      if (label && url) return `${index + 1}. ${label}\n${url}`;
      if (label) return `${index + 1}. ${label}`;
      if (url) return `${index + 1}. ${url}`;
      return `${index + 1}.`;
    });
  };

  const formatBulletedLinkLines = (links) => {
    return (links || []).map((item) => {
      const label = toTemplateValue(item && item.label);
      const url = toTemplateValue(item && item.url);
      if (label && url) return `- ${label}: ${url}`;
      if (label) return `- ${label}`;
      if (url) return `- ${url}`;
      return "-";
    });
  };

  const buildBulletedLinkListHtml = (links) => {
    const items = (links || []).map((item) => {
      const label = toTemplateValue(item && item.label);
      const url = toTemplateValue(item && item.url);
      if (label && url) {
        return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a></li>`;
      }
      if (label) return `<li>${escapeHtml(label)}</li>`;
      if (url) return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(url)}</a></li>`;
      return "<li></li>";
    });
    return items.length ? `<ul>\n${items.join("\n")}\n</ul>` : "<ul><li>[Training Link]</li></ul>";
  };

  const getEdgeLinksForType = (type) => {
    const definition = EDGE_LINK_TEMPLATE_DEFINITIONS[type] || null;
    if (definition) {
      const scopedLinks = EDGE_TRACK_LINKS[definition.key] || [];
      return definition.includeCommon ? [...EDGE_COMMON_LINKS, ...scopedLinks] : [...scopedLinks];
    }
    if (type === "edge-credentials") {
      return [
        ...EDGE_COMMON_LINKS,
        ...(EDGE_TRACK_LINKS.amazon || []),
        ...(EDGE_TRACK_LINKS.fedex || []),
        ...(EDGE_TRACK_LINKS.bae || []),
        ...(EDGE_TRACK_LINKS.schneider || []),
        { label: "Driver Training", url: EDGE_URL_DRIVER },
        { label: "Allied Universal Driver Training", url: EDGE_URL_DRIVER_ONLY },
      ];
    }
    return [];
  };

  const buildEdgeCredentialsTemplate = (context, recipientName, type) => {
    const eid = context.eid || "[EID]";
    const dobNoSlashes = context.dobDigits || "[DOB_NO_SLASHES]";
    const definition = EDGE_LINK_TEMPLATE_DEFINITIONS[type] || null;
    const links = getEdgeLinksForType(type);

    const lines = [
      `Hi ${recipientName},`,
      "",
      `Your Employee ID: ${eid}`,
      "",
      `Edge Username: ${eid}`,
      `Edge Password: ${dobNoSlashes}`,
      "",
      "There are additional trainings you must complete. Click each link below:",
      "",
      ...(links.length ? formatBulletedLinkLines(links) : ["- [Training Link]"]),
    ];

    const templateLabel = definition ? definition.label : "Edge Credentials";
    const htmlBody = [
      `<p>Hi ${escapeHtml(recipientName)},</p>`,
      `<p>Your Employee ID: ${escapeHtml(eid)}</p>`,
      `<p>Edge Username: ${escapeHtml(eid)}<br />Edge Password: ${escapeHtml(dobNoSlashes)}</p>`,
      "<p>There are additional trainings you must complete. Click each link below:</p>",
      buildBulletedLinkListHtml(links),
    ].join("\n");
    return {
      subject: `NEO | ${recipientName} | EID ${eid} | ${templateLabel}`,
      body: lines.join("\n"),
      htmlBody,
    };
  };

  const isClearedStatus = (value) => toTemplateValue(value).toLowerCase() === "cleared";

  const hasComplianceInfo = (...values) => values.some((value) => !!toTemplateValue(value));

  const buildInitialComplianceItems = (context) => {
    const items = [...INITIAL_COMPLIANCE_BASE_ITEMS];
    if (isClearedStatus(context.coriStatus)) {
      items.push("CORI entered into WT");
    }

    const hasNhGuardCardInfo = hasComplianceInfo(
      context.nhStatus,
      context.nhId,
      context.nhExpiration,
    );
    const hasMeGuardCardInfo = hasComplianceInfo(context.meStatus, context.meExpiration);
    if (hasNhGuardCardInfo) items.push("NH GC entered into WT");
    if (hasMeGuardCardInfo) items.push("ME GC entered into WT");
    if (!hasNhGuardCardInfo && !hasMeGuardCardInfo) {
      items.push("Candidate has No NH GC");
    }
    return items;
  };

  const calculateTimeRangeHours = (startTime, endTime) => {
    const startMinutes = parseWeeklyTime(startTime || "");
    const endMinutes = parseWeeklyTime(endTime || "");
    if (startMinutes === null || endMinutes === null) return "";
    let totalMinutes = endMinutes - startMinutes;
    if (totalMinutes < 0) totalMinutes += 24 * 60;
    return formatWeeklyHours(totalMinutes);
  };

  const inferClientComplianceSections = (context) => {
    const haystack = [
      context.job,
      context.jobId,
      context.jobName,
      context.location,
      context.branch,
      context.manager,
    ]
      .filter(Boolean)
      .join(" ");
    if (!haystack) return [];
    return CLIENT_COMPLIANCE_SECTIONS.filter((section) =>
      section.matchers.some((pattern) => pattern.test(haystack)),
    );
  };

  const buildNeoComplianceTemplate = (context, recipientName, today) => {
    const clientSections = inferClientComplianceSections(context);
    const initialItems = buildInitialComplianceItems(context);
    const eid = context.eid || "[EID]";
    const uniformsIssued = !!context.uniformsIssued;
    const uniformLine = uniformsIssued
      ? "One set of uniforms WAS issued during NEO."
      : "One set of uniforms WAS NOT issued during NEO.";
    const ausItems = [...AUS_COMPLIANCE_BASE_ITEMS, uniformLine];
    const uniformSizeParts = [
      `Shirt Size: ${toDisplayValue(context.shirtSize)}`,
      `Pants Size: ${toDisplayValue(context.pantsSize)}`,
    ];
    const bootsSize = toTemplateValue(context.bootsSize);
    if (bootsSize) {
      uniformSizeParts.push(`Boots Size: ${bootsSize}`);
    }

    const fallbackIssuedPantsSize = buildPantsSize(
      toTemplateValue(context.issuedWaist),
      toTemplateValue(context.issuedInseam),
    );
    const shirtIssuedSize =
      toTemplateValue(context.issuedShirtSize) || toTemplateValue(context.shirtSize) || "x";
    const shirtIssuedAlteration = toTemplateValue(context.issuedShirtType) || "None";
    const pantsIssuedAlteration = toTemplateValue(context.issuedPantsType) || "None";
    const pantsIssuedSize =
      toTemplateValue(context.issuedPantsSize) ||
      fallbackIssuedPantsSize ||
      toTemplateValue(context.pantsSize) ||
      "x";
    const issuedItems = uniformsIssued
      ? [
          `${shirtIssuedSize}, ${shirtIssuedAlteration}`,
          `${pantsIssuedAlteration}, ${pantsIssuedSize}`,
        ]
      : ["None, None", "None, None"];

    const bodyLines = [
      "NEO Summary",
      `Generated: ${today}`,
      "",
      `PERSON: ${recipientName} | EID: ${eid}`,
      `Phone: ${toDisplayValue(context.phone)} | Email: ${toDisplayValue(context.email)}`,
      `Start: ${toDisplayValue(context.startTime)} | End: ${toDisplayValue(context.endTime)} | Total: ${toDisplayValue(context.hours)}`,
      "",
      `Hire Date: ${context.hireDate || "x"}`,
      "",
      `Uniform Sizes: ${uniformSizeParts.join(" | ")}`,
      "Uniforms Issued:",
      ...formatNumberedListLines(issuedItems),
      "",
      "Completed Initial Compliance Items:",
      ...formatNumberedListLines(initialItems),
      "",
      "Completed AUS Compliance Items:",
      ...formatNumberedListLines(ausItems),
    ];

    if (clientSections.length) {
      clientSections.forEach((section) => {
        bodyLines.push("");
        bodyLines.push(section.title);
        bodyLines.push(...formatNumberedListLines(section.items));
      });
    } else {
      bodyLines.push("");
      bodyLines.push("Completed Client Compliance Items:");
      bodyLines.push(
        "  1. No client-specific list auto-matched from Job ID, Job Name, or Location.",
      );
    }

    return {
      subject: `NEO | ${recipientName} | EID ${eid} | NEO Summary`,
      body: bodyLines.join("\n"),
    };
  };

  const buildEmailTemplateContextFromCardRow = (card, rowValue) => {
    const rowLookup = buildTemplateRowLookup(rowValue);
    const pickTemplateValue = (...values) => {
      for (const value of values) {
        const text = toTemplateValue(value);
        if (text) return text;
      }
      return "";
    };
    const pickRowValue = (...keys) => readTemplateRowValue(rowLookup, ...keys);
    const parsedIssuedPants = parsePantsSize(
      pickRowValue("Issued Pants Size", "issued_pants_size", "Pants Size", "pants_size"),
    );
    const parsedPants = parsePantsSize(pickRowValue("Pants Size", "pants_size"));
    const shirtType = formatUniformTypeText(
      pickRowValue("Issued Shirt Type", "issued_shirt_type", "Shirt Type", "shirt_type"),
    );
    const pantsType = pickRowValue(
      "Issued Pants Type",
      "issued_pants_type",
      "Pants Type",
      "pants_type",
    );
    const issuedPantsSize = buildPantsSize(
      pickTemplateValue(pickRowValue("Issued Waist", "issued_waist"), parsedIssuedPants.waist),
      pickTemplateValue(pickRowValue("Issued Inseam", "issued_inseam"), parsedIssuedPants.inseam),
    );
    const basePantsSize = buildPantsSize(
      pickTemplateValue(pickRowValue("Waist", "waist"), parsedPants.waist),
      pickTemplateValue(pickRowValue("Inseam", "inseam"), parsedPants.inseam),
    );
    const fallbackJobText = pickRowValue("Job ID Name", "job_id_name", "Job");
    const jobParts = fallbackJobText
      ? fallbackJobText
          .split(/[·|•]/)
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
    const cardJobId = pickTemplateValue(card ? card.job_id : "", pickRowValue("Job ID", "job_id"));
    const reqId = pickTemplateValue(
      card ? card.req_id : "",
      pickRowValue("REQ ID", "Req ID", "req_id", "reqid"),
    );
    const cardJobName = pickTemplateValue(
      card ? card.job_name : "",
      pickRowValue("Job Name", "job_name"),
    );
    const icimsId = pickTemplateValue(
      card ? card.icims_id : "",
      pickRowValue("ICIMS ID", "ICIMS", "icims_id", "icimsid"),
    );
    const candidateId = pickTemplateValue(
      card ? card.uuid : "",
      pickRowValue("candidate UUID", "Candidate UUID", "candidate_uuid", "uuid"),
    );
    const jobId = cardJobId || (jobParts.length ? jobParts[0] : "");
    const jobName = cardJobName || (jobParts.length > 1 ? jobParts.slice(1).join(" · ") : "");
    const hireDate = formatTemplateDate(pickRowValue("Hire Date", "hire_date"));
    const dobDigits = sanitizeNumbers(
      pickTemplateValue(
        pickRowValue("DOB", "Date of Birth", "Birth Date", "dob", "birth_date"),
      ),
    );
    const manager = pickTemplateValue(
      card ? card.manager : "",
      pickRowValue("Manager", "Manager Name", "manager", "manager_name"),
    );
    const managerEmail = pickTemplateValue(
      pickRowValue("Manager Email", "manager_email"),
      managerNameToAusEmail(manager),
    );

    return {
      name: pickTemplateValue(
        card ? card.candidate_name : "",
        pickRowValue("Candidate Name", "Name", "candidate_name"),
      ),
      eid: pickTemplateValue(
        card ? card.employee_id : "",
        pickRowValue("Employee ID", "EID", "employee_id"),
      ),
      candidateId,
      reqId,
      icimsId,
      dobDigits,
      phone: pickRowValue("Contact Phone", "Phone Number", "Phone", "contact_phone", "phone"),
      email: pickRowValue("Contact Email", "Candidate Email", "Email", "contact_email", "email"),
      hireDate,
      branch: pickTemplateValue(card ? card.branch : "", pickRowValue("Branch", "branch")),
      location: pickTemplateValue(
        card ? card.job_location : "",
        pickRowValue("Job Location", "Location", "job_location", "location"),
      ),
      jobId,
      jobName,
      job: toTemplateValue([jobId, jobName].filter(Boolean).join(" · ")) || fallbackJobText,
      manager,
      managerEmail,
      startTime: pickRowValue("Neo Arrival Time", "Arrival", "neo_arrival_time"),
      endTime: pickRowValue("Neo Departure Time", "Departure", "neo_departure_time"),
      hours: pickRowValue("Total Neo Hours", "Total Hours", "total_neo_hours", "hours"),
      shirtSize: pickRowValue("Shirt Size", "shirt_size"),
      pantsSize: pickTemplateValue(pickRowValue("Pants Size", "pants_size"), basePantsSize),
      bootsSize: pickRowValue("Boots Size", "boots_size"),
      uniformsIssued: isUniformIssued(pickRowValue("Uniforms Issued", "uniforms_issued")),
      issuedShirtSize: pickTemplateValue(
        pickRowValue("Issued Shirt Size", "issued_shirt_size"),
        pickRowValue("Shirt Size", "shirt_size"),
      ),
      issuedPantsSize: pickTemplateValue(
        pickRowValue("Issued Pants Size", "issued_pants_size"),
        issuedPantsSize,
      ),
      issuedShirtType: shirtType,
      issuedShirtsGiven: pickTemplateValue(
        pickRowValue("Issued Shirts Given", "issued_shirts_given"),
        pickRowValue("Shirts Given", "shirts_given"),
      ),
      issuedWaist: pickTemplateValue(
        pickRowValue("Issued Waist", "issued_waist"),
        parsedIssuedPants.waist,
      ),
      issuedInseam: pickTemplateValue(
        pickRowValue("Issued Inseam", "issued_inseam"),
        parsedIssuedPants.inseam,
      ),
      issuedPantsType: pantsType,
      issuedPantsGiven: pickTemplateValue(
        pickRowValue("Issued Pants Given", "issued_pants_given"),
        pickRowValue("Pants Given", "pants_given"),
      ),
      coriStatus: pickRowValue("MA CORI Status", "ma_cori_status"),
      nhStatus: pickRowValue("NH GC Status", "nh_gc_status"),
      nhId: pickRowValue("NH GC ID Number", "nh_gc_id_number"),
      nhExpiration: pickRowValue("NH GC Expiration Date", "nh_gc_expiration_date"),
      meStatus: pickRowValue("ME GC Status", "me_gc_status"),
      meExpiration: pickRowValue("ME GC Expiration Date", "me_gc_expiration_date"),
    };
  };

  const getEmailTemplateContext = () => {
    const cardId = state.kanban.detailsCardId;
    const card = cardId ? state.kanban.cards.find((item) => item.uuid === cardId) : null;
    return buildEmailTemplateContextFromCardRow(card, state.kanban.detailsRow || {});
  };

  const buildDefaultEmailTemplateByType = (
    type,
    context,
    recipientName,
    manager,
    branch,
    job,
    today,
  ) => {
    let subject = "";
    let body = "";
    if (type === "neo-compliance") {
      const neoTemplate = buildNeoComplianceTemplate(context, recipientName, today);
      subject = neoTemplate.subject;
      body = neoTemplate.body;
    } else if (type === "cori-template") {
      const safeName = toTemplateValue(recipientName) || "[Candidate Name]";
      const candidateEmail = toTemplateValue(context.email) || "x";
      const icimsId = toTemplateValue(context.icimsId) || "x";
      const reqId = toTemplateValue(context.reqId) || "x";
      const wtJobNo = toTemplateValue(context.wtJobNo || context.jobId) || "x";
      const managerName = toTemplateValue(context.manager) || "x";
      subject = `${safeName}, CORI`;
      body = [
        safeName,
        "Conditional Offer Sent",
        "Background Check Initiated (Sterling)",
        "Background Check Initiated (Accurate)",
        "Background Check Completed",
        `Cand. Email: ${candidateEmail}`,
        `ICIMS ID: ${icimsId}`,
        `REQ ID: ${reqId}`,
        `WT JOB #: ${wtJobNo}`,
        `Mana. Name: ${managerName}`,
      ].join("\n");
    } else if (isEdgeTemplateType(type)) {
      const edgeTemplate = buildEdgeCredentialsTemplate(context, recipientName, type);
      subject = edgeTemplate.subject;
      body = edgeTemplate.body;
    } else if (type === "missing-pii") {
      subject = `Action Needed: Missing Onboarding Information - ${recipientName}`;
      body = [
        `Hi ${recipientName},`,
        "",
        "We are still missing some onboarding information needed to complete your file.",
        "Please reply with the missing items as soon as possible.",
        "",
        `Branch: ${branch}`,
        `Manager: ${manager}`,
        "",
        "Thank you,",
        "[Your Name]",
      ].join("\n");
    } else if (type === "uniform-issued") {
      subject = `Uniform Issue Confirmation - ${recipientName}`;
      const actualShirtLine = `Shirt Size: ${toDisplayValue(context.shirtSize)}`;
      const actualPantsLine = `Pants Size: ${toDisplayValue(context.pantsSize)}`;
      const actualBootsLine = `Boots Size: ${toDisplayValue(context.bootsSize)}`;
      const issuedStatusLine = `Uniforms Issued During NEO: ${context.uniformsIssued ? "Yes" : "No"}`;
      const issuedShirtLine = context.uniformsIssued
        ? [
            `Issued Shirts: ${toDisplayValue(context.issuedShirtsGiven)}`,
            `Type: ${toDisplayValue(context.issuedShirtType)}`,
            `Size: ${toDisplayValue(context.issuedShirtSize)}`,
          ].join(" | ")
        : "Issued Shirts: None";
      const issuedPantsLine = context.uniformsIssued
        ? [
            `Issued Pants: ${toDisplayValue(context.issuedPantsGiven)}`,
            `Type: ${toDisplayValue(context.issuedPantsType)}`,
            `Waist: ${toDisplayValue(context.issuedWaist)}`,
            `Inseam: ${toDisplayValue(context.issuedInseam)}`,
            `Size: ${toDisplayValue(context.issuedPantsSize)}`,
          ].join(" | ")
        : "Issued Pants: None";
      body = [
        `Hi ${recipientName},`,
        "",
        "This email confirms uniform sizing on file and issued uniform details.",
        "",
        "Actual Uniform Sizes (On File):",
        actualShirtLine,
        actualPantsLine,
        actualBootsLine,
        "",
        issuedStatusLine,
        issuedShirtLine,
        issuedPantsLine,
        "",
        `Branch: ${branch}`,
        `Date: ${today}`,
        "",
        "Please reply if any item listed above is incorrect.",
        "",
        "Thank you,",
        "[Your Name]",
      ].join("\n");
    } else {
      subject = `Onboarding Follow-Up - ${recipientName}`;
      body = [
        `Hi ${recipientName},`,
        "",
        `Following up on your onboarding status as of ${today}.`,
        "",
        `Branch: ${branch}`,
        `Role: ${job}`,
        `Manager: ${manager}`,
        "",
        "If anything has changed, please reply to this email so we can update your record.",
        "",
        "Thank you,",
        "[Your Name]",
      ].join("\n");
    }
    return { subject, body };
  };

  const buildClientComplianceSectionsText = (context) => {
    const clientSections = inferClientComplianceSections(context);
    if (clientSections.length) {
      return clientSections
        .map((section) => [section.title, ...formatNumberedListLines(section.items)].join("\n"))
        .join("\n\n");
    }
    return [
      "Completed Client Compliance Items:",
      "  1. No client-specific list auto-matched from Job ID, Job Name, or Location.",
    ].join("\n");
  };

  const splitUrlAndTrailingPunctuation = (rawUrl) => {
    let url = String(rawUrl || "");
    let trailing = "";
    while (/[),.;!?]$/.test(url)) {
      trailing = `${url.slice(-1)}${trailing}`;
      url = url.slice(0, -1);
    }
    return { url, trailing };
  };

  const normalizeTemplateLinkUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^www\./i.test(raw)) return `https://${raw}`;
    return "";
  };

  const linkifyEmailTextToHtml = (value) => {
    const text = String(value || "");
    const urlPattern = /(https?:\/\/[^\s<]+)/gi;
    let output = "";
    let cursor = 0;
    let match = urlPattern.exec(text);
    while (match) {
      const fullMatch = match[0];
      const start = match.index;
      const { url, trailing } = splitUrlAndTrailingPunctuation(fullMatch);
      output += escapeHtml(text.slice(cursor, start));
      if (url) {
        const safeUrl = escapeHtml(url);
        output += `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${safeUrl}</a>`;
      }
      if (trailing) output += escapeHtml(trailing);
      cursor = start + fullMatch.length;
      match = urlPattern.exec(text);
    }
    output += escapeHtml(text.slice(cursor));
    return output;
  };

  const renderTemplateLabelUrlLinks = (lineText) => {
    const line = String(lineText || "");
    const labelUrlPattern = /\[\s*"([^"\n]+)"\s*=\s*"([^"\n]+)"\s*\]/g;
    let output = "";
    let cursor = 0;
    let match = labelUrlPattern.exec(line);
    while (match) {
      const [fullMatch, labelRaw, urlRaw] = match;
      const start = match.index;
      output += linkifyEmailTextToHtml(line.slice(cursor, start));
      const label = String(labelRaw || "").trim();
      const url = normalizeTemplateLinkUrl(urlRaw);
      if (label && url) {
        const safeUrl = escapeHtml(url);
        output += `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
      } else {
        output += escapeHtml(fullMatch);
      }
      cursor = start + fullMatch.length;
      match = labelUrlPattern.exec(line);
    }
    output += linkifyEmailTextToHtml(line.slice(cursor));
    return output;
  };

  const convertEmailTextLineToHtml = (lineText) => {
    const line = String(lineText || "");
    const bulletLinkMatch = line.match(/^(\s*[-*]\s+)(.+?):\s*(https?:\/\/[^\s<]+)\s*$/i);
    if (bulletLinkMatch) {
      const [, prefix, labelRaw, rawUrl] = bulletLinkMatch;
      const label = String(labelRaw || "").trim();
      const { url, trailing } = splitUrlAndTrailingPunctuation(rawUrl);
      if (label && url) {
        const safeUrl = escapeHtml(url);
        return `${escapeHtml(prefix)}<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>${escapeHtml(trailing)}`;
      }
    }
    return renderTemplateLabelUrlLinks(line);
  };

  const buildEmailHtmlBodyFromText = (value) => {
    const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) return "<p></p>";
    return normalized
      .split(/\n{2,}/)
      .filter(Boolean)
      .map((paragraph) => {
        const htmlLines = paragraph.split("\n").map((line) => convertEmailTextLineToHtml(line));
        return `<p>${htmlLines.join("<br />")}</p>`;
      })
      .join("\n");
  };

  const ensureEmailHtmlDocument = (value) => {
    const htmlText = String(value || "").trim();
    const bodyContent = htmlText || "<p></p>";
    if (/<html[\s>]/i.test(bodyContent)) return bodyContent;
    return [
      "<!doctype html>",
      "<html>",
      "  <head>",
      '    <meta charset="UTF-8" />',
      "  </head>",
      '  <body style="margin:0;padding:16px;font-family:Segoe UI, Arial, sans-serif;font-size:14px;line-height:1.5;color:#1f2937;background:#ffffff;">',
      bodyContent,
      "  </body>",
      "</html>",
    ].join("\n");
  };

  const buildEmailTemplateTokenMap = (
    type,
    context,
    recipientName,
    manager,
    branch,
    job,
    today,
    defaults,
  ) => {
    const safeContext = context || {};
    const templateLabel = getEmailTemplateTypeLabel(type);
    const shirtSummary = safeContext.issuedShirtSize || safeContext.shirtSize;
    const pantsSummary = safeContext.issuedPantsSize || safeContext.pantsSize;
    const uniformLine = safeContext.uniformsIssued
      ? "One set of uniforms WAS issued during NEO."
      : "One set of uniforms WAS NOT issued during NEO.";
    const initialItems = buildInitialComplianceItems(safeContext);
    const ausItems = [...AUS_COMPLIANCE_BASE_ITEMS, uniformLine];
    const edgeDefinition = EDGE_LINK_TEMPLATE_DEFINITIONS[type] || null;
    const edgeLinks = getEdgeLinksForType(type);

    const tokenMap = {
      defaultSubject: defaults.subject,
      defaultBody: defaults.body,
      defaultHtmlBody: defaults.htmlBody,
      templateType: type || "",
      templateLabel,
      today,
      date: today,
      recipientName: recipientName || "[Candidate Name]",
      eid: safeContext.eid || "[EID]",
      icimsId: toTemplateValue(safeContext.icimsId),
      reqId: toTemplateValue(safeContext.reqId) || "x",
      wtJobNo: toTemplateValue(safeContext.jobId) || "x",
      dobDigits: safeContext.dobDigits || "[DOB_NO_SLASHES]",
      phone: toDisplayValue(safeContext.phone),
      email: toTemplateValue(safeContext.email),
      candidateEmail: toTemplateValue(safeContext.email),
      emailDisplay: toDisplayValue(safeContext.email),
      manager: manager || "[Manager]",
      managerEmail: toTemplateValue(safeContext.managerEmail),
      branch: branch || "[Branch]",
      location: safeContext.location || "x",
      job: job || "[Job]",
      jobId: safeContext.jobId || "x",
      jobName: safeContext.jobName || "x",
      hireDate: safeContext.hireDate || "x",
      startTime: toDisplayValue(safeContext.startTime),
      endTime: toDisplayValue(safeContext.endTime),
      totalHours: toDisplayValue(safeContext.hours),
      hours: toDisplayValue(safeContext.hours),
      shirtSize: toDisplayValue(safeContext.shirtSize),
      pantsSize: toDisplayValue(safeContext.pantsSize),
      bootsSize: toTemplateValue(safeContext.bootsSize),
      issuedShirtSize: toDisplayValue(safeContext.issuedShirtSize),
      issuedPantsSize: toDisplayValue(safeContext.issuedPantsSize),
      issuedShirtType: toTemplateValue(safeContext.issuedShirtType),
      issuedPantsType: toTemplateValue(safeContext.issuedPantsType),
      issuedWaist: toTemplateValue(safeContext.issuedWaist),
      issuedInseam: toTemplateValue(safeContext.issuedInseam),
      issuedShirtsGiven: toTemplateValue(safeContext.issuedShirtsGiven),
      issuedPantsGiven: toTemplateValue(safeContext.issuedPantsGiven),
      shirtSummary: toDisplayValue(shirtSummary),
      pantsSummary: toDisplayValue(pantsSummary),
      uniformIssuedLine: uniformLine,
      initialComplianceList: formatNumberedListLines(initialItems).join("\n"),
      ausComplianceList: formatNumberedListLines(ausItems).join("\n"),
      clientComplianceSections: buildClientComplianceSectionsText(safeContext),
      edgePortal: EDGE_PORTAL_URL,
      edgeTemplateLabel: edgeDefinition ? edgeDefinition.label : "Edge Credentials",
      edgeLinksList: edgeLinks.length ? formatNumberedLinkLines(edgeLinks).join("\n") : "",
      edgeSuggestedCc:
        edgeDefinition && edgeDefinition.cc && edgeDefinition.cc.length
          ? edgeDefinition.cc.join(", ")
          : "",
      edgeNote: edgeDefinition && edgeDefinition.note ? edgeDefinition.note : "",
    };

    const customTokens =
      state.emailTemplates && state.emailTemplates.customTokens
        ? state.emailTemplates.customTokens
        : {};
    Object.keys(customTokens).forEach((key) => {
      const safeKey = sanitizeEmailTemplateTokenKey(key);
      if (!safeKey) return;
      tokenMap[`custom.${safeKey}`] = String(customTokens[key] || "");
    });

    return tokenMap;
  };

  const resolveEmailTemplateRecipients = (type, context, templateConfig, tokenMap) => {
    const fallback = getEmailTemplateRecipients(type, context);
    const configuredTo = toTemplateValue(renderTemplateText(templateConfig.toTemplate, tokenMap));
    const configuredCc = toTemplateValue(renderTemplateText(templateConfig.ccTemplate, tokenMap));
    return {
      to: configuredTo || fallback.to,
      cc: configuredCc || fallback.cc,
    };
  };

  const buildEmailTemplateOutput = (
    type,
    context,
    recipientName,
    startTime,
    endTime,
    totalHours,
  ) => {
    const templateContext = {
      ...(context || {}),
      startTime,
      endTime,
      hours: totalHours,
    };
    const manager = templateContext.manager || "[Manager]";
    const branch = templateContext.branch || "[Branch]";
    const job = templateContext.job || "[Job]";
    const today = new Date().toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const defaults = buildDefaultEmailTemplateByType(
      type,
      templateContext,
      recipientName,
      manager,
      branch,
      job,
      today,
    );
    const defaultsWithHtml = {
      ...defaults,
      htmlBody: defaults.htmlBody || buildEmailHtmlBodyFromText(defaults.body),
    };
    const templateConfig = getEmailTemplateConfigForType(type);
    const tokenMap = buildEmailTemplateTokenMap(
      type,
      templateContext,
      recipientName,
      manager,
      branch,
      job,
      today,
      defaultsWithHtml,
    );
    const subjectText = toTemplateValue(
      renderTemplateText(templateConfig.subjectTemplate, tokenMap),
    );
    const bodyText = renderTemplateText(templateConfig.bodyTemplate, tokenMap);
    const resolvedBodyText = bodyText || defaultsWithHtml.body;
    const htmlTemplateText = renderTemplateText(templateConfig.htmlBodyTemplate, tokenMap);
    const htmlBodyText = htmlTemplateText.trim()
      ? htmlTemplateText
      : buildEmailHtmlBodyFromText(resolvedBodyText);
    const recipients = resolveEmailTemplateRecipients(
      type,
      templateContext,
      templateConfig,
      tokenMap,
    );
    return {
      subject: subjectText || defaultsWithHtml.subject,
      body: resolvedBodyText,
      htmlBody: ensureEmailHtmlDocument(htmlBodyText),
      recipients,
    };
  };

  const buildEmailTemplateDashboardDefaults = (type) => {
    const today = new Date().toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const sampleContext = {
      name: "[Candidate Name]",
      eid: "[EID]",
      icimsId: "[ICIMS ID]",
      dobDigits: "[DOB_NO_SLASHES]",
      phone: "x",
      email: "candidate@domain.com",
      manager: "[Manager Name]",
      managerEmail: "manager.name@aus.com",
      branch: "[Branch]",
      location: "[Location]",
      job: "[Job]",
      jobId: "[Job ID]",
      jobName: "[Job Name]",
      hireDate: "x",
      startTime: "x",
      endTime: "x",
      hours: "x",
      shirtSize: "x",
      pantsSize: "x",
      uniformsIssued: false,
      issuedShirtSize: "",
      issuedPantsSize: "",
      issuedShirtType: "",
      issuedShirtsGiven: "",
      issuedWaist: "",
      issuedInseam: "",
      issuedPantsType: "",
      issuedPantsGiven: "",
      coriStatus: "",
      nhStatus: "",
      nhId: "",
      nhExpiration: "",
      meStatus: "",
      meExpiration: "",
    };
    const defaults = buildDefaultEmailTemplateByType(
      type,
      sampleContext,
      sampleContext.name,
      sampleContext.manager,
      sampleContext.branch,
      sampleContext.job,
      today,
    );
    return {
      ...defaults,
      htmlBody: buildEmailHtmlBodyFromText(defaults.body),
    };
  };

  const buildEmailTemplateFromForm = () => {
    const typeInput = $("email-template-type");
    const recipientInput = $("email-template-recipient");
    const ccInput = $("email-template-cc");
    const startInput = $("email-template-start-time");
    const endInput = $("email-template-end-time");
    const totalInput = $("email-template-total-hours");
    const type = typeInput ? typeInput.value : "neo-compliance";
    const context = emailTemplateContext || {};
    const recipientName = context.name || "[Candidate Name]";
    const startTime = startInput
      ? sanitizeTimeInput(startInput)
      : toTemplateValue(context.startTime);
    const endTime = endInput ? sanitizeTimeInput(endInput) : toTemplateValue(context.endTime);
    const computedTotal = calculateTimeRangeHours(startTime, endTime);
    if (totalInput) {
      const fallbackTotal = toTemplateValue(context.hours);
      totalInput.value = computedTotal || fallbackTotal || "";
    }
    const totalHours =
      toTemplateValue(totalInput ? totalInput.value : "") || computedTotal || context.hours;
    const next = buildEmailTemplateOutput(
      type,
      context,
      recipientName,
      startTime,
      endTime,
      totalHours,
    );
    if (recipientInput && !recipientInput.value.trim()) {
      recipientInput.value = next.recipients.to;
    }
    if (ccInput && !ccInput.value.trim()) {
      ccInput.value = next.recipients.cc;
    }
    return { subject: next.subject, body: next.body, htmlBody: next.htmlBody };
  };

  const captureEmailTemplateGeneratedDraft = (draftOutput = null) => {
    const subjectInput = $("email-template-subject");
    const bodyInput = $("email-template-body");
    emailTemplateLastGeneratedDraft = {
      subject: subjectInput ? subjectInput.value : "",
      body: bodyInput ? bodyInput.value : "",
    };
    if (
      draftOutput &&
      typeof draftOutput === "object" &&
      typeof draftOutput.htmlBody === "string" &&
      draftOutput.htmlBody.trim()
    ) {
      emailTemplateLastGeneratedHtmlBody = draftOutput.htmlBody;
    }
  };

  const canAutoOverwriteEmailTemplateDraft = () => {
    if (!emailTemplateLastGeneratedDraft) return true;
    const subjectInput = $("email-template-subject");
    const bodyInput = $("email-template-body");
    if (!subjectInput || !bodyInput) return false;
    return (
      subjectInput.value === emailTemplateLastGeneratedDraft.subject &&
      bodyInput.value === emailTemplateLastGeneratedDraft.body
    );
  };

  const applyEmailTemplateDraft = ({ force = false } = {}) => {
    const subjectInput = $("email-template-subject");
    const bodyInput = $("email-template-body");
    if (!subjectInput || !bodyInput) return;
    const next = buildEmailTemplateFromForm();
    if (!force && !canAutoOverwriteEmailTemplateDraft()) return;
    subjectInput.value = next.subject;
    bodyInput.value = next.body;
    captureEmailTemplateGeneratedDraft(next);
  };

  const refreshEmailTemplateContextFromDatabase = async () => {
    const modal = $("email-template-modal");
    if (!modal || modal.classList.contains("hidden")) return;
    const baseContext = emailTemplateContextOverride || emailTemplateContext || {};
    const sourceId = toTemplateValue(baseContext.sourceId) || "current";
    if (!isCurrentDatabaseSource(sourceId)) return;
    const candidateId = toTemplateValue(baseContext.candidateId);
    if (!candidateId) return;
    const fallbackRow =
      baseContext.rowSnapshot && typeof baseContext.rowSnapshot === "object"
        ? baseContext.rowSnapshot
        : {};
    const latestRow = await getLatestCandidateRow(candidateId, fallbackRow, sourceId);
    if (!latestRow || typeof latestRow !== "object") return;
    const card = state.kanban.cards.find((item) => item.uuid === candidateId) || null;
    emailTemplateContext = {
      ...buildEmailTemplateContextFromCardRow(card, latestRow),
      sourceId,
      rowSnapshot: latestRow,
    };
    applyEmailTemplateDraft();
  };

  const stopEmailTemplateAutoRefresh = () => {
    if (emailTemplateAutoRefreshTimer) {
      window.clearInterval(emailTemplateAutoRefreshTimer);
      emailTemplateAutoRefreshTimer = null;
    }
    emailTemplateAutoRefreshInFlight = false;
  };

  const startEmailTemplateAutoRefresh = () => {
    stopEmailTemplateAutoRefresh();
    const activeContext = emailTemplateContextOverride || emailTemplateContext || {};
    const sourceId = toTemplateValue(activeContext.sourceId) || "current";
    if (!isCurrentDatabaseSource(sourceId)) return;
    emailTemplateAutoRefreshTimer = window.setInterval(async () => {
      if (emailTemplateAutoRefreshInFlight) return;
      emailTemplateAutoRefreshInFlight = true;
      try {
        await refreshEmailTemplateContextFromDatabase();
      } finally {
        emailTemplateAutoRefreshInFlight = false;
      }
    }, 4000);
  };

  const handleEmailTemplateTypeChange = () => {
    const typeInput = $("email-template-type");
    const recipientInput = $("email-template-recipient");
    const ccInput = $("email-template-cc");
    const startInput = $("email-template-start-time");
    const endInput = $("email-template-end-time");
    const totalInput = $("email-template-total-hours");
    const subjectInput = $("email-template-subject");
    const bodyInput = $("email-template-body");
    const context = emailTemplateContext || getEmailTemplateContext();
    const type = typeInput ? typeInput.value : "neo-compliance";
    const recipientName = context.name || "[Candidate Name]";
    const startTime = startInput
      ? sanitizeTimeInput(startInput)
      : toTemplateValue(context.startTime);
    const endTime = endInput ? sanitizeTimeInput(endInput) : toTemplateValue(context.endTime);
    const computedTotal = calculateTimeRangeHours(startTime, endTime);
    const totalHours =
      toTemplateValue(totalInput ? totalInput.value : "") || computedTotal || context.hours;
    if (totalInput) totalInput.value = computedTotal || toTemplateValue(context.hours) || "";
    const next = buildEmailTemplateOutput(
      type,
      context,
      recipientName,
      startTime,
      endTime,
      totalHours,
    );
    if (recipientInput) recipientInput.value = next.recipients.to;
    if (ccInput) ccInput.value = next.recipients.cc;
    if (subjectInput) subjectInput.value = next.subject;
    if (bodyInput) bodyInput.value = next.body;
    captureEmailTemplateGeneratedDraft(next);
  };

  const handleEmailTemplateGenerate = async (event) => {
    if (event) event.preventDefault();
    await refreshEmailTemplateContextFromDatabase();
    applyEmailTemplateDraft({ force: true });
  };

  const writeTextToClipboard = async (text) => {
    if (workflowApi && typeof workflowApi.clipboardWrite === "function") {
      const ok = await workflowApi.clipboardWrite(text);
      if (ok) return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard copy failed.");
    return true;
  };

  const handleEmailTemplateCopy = async () => {
    const recipient = $("email-template-recipient");
    const cc = $("email-template-cc");
    const subject = $("email-template-subject");
    const body = $("email-template-body");
    const lines = [];
    const toText = recipient ? recipient.value.trim() : "";
    const ccText = cc ? cc.value.trim() : "";
    const subjectText = subject ? subject.value.trim() : "";
    const bodyText = body ? body.value.trim() : "";
    if (!toText && !subjectText && !bodyText) {
      await showMessageModal(
        "Nothing to Copy",
        "Click Update Info or enter an email template first.",
      );
      return;
    }
    if (toText) lines.push(`To: ${toText}`);
    if (ccText) lines.push(`Cc: ${ccText}`);
    if (subjectText) lines.push(`Subject: ${subjectText}`);
    if (lines.length) lines.push("");
    lines.push(bodyText);
    try {
      await writeTextToClipboard(lines.join("\n"));
      showToast({ message: "Email template copied." });
    } catch (error) {
      await showMessageModal("Copy Failed", "Unable to copy template to clipboard.");
    }
  };

  const sanitizeEmailHeaderValue = (value) => {
    return String(value || "")
      .replace(/[\r\n]+/g, " ")
      .trim();
  };

  const toEmlLineEndings = (value) => {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n/g, "\r\n");
  };

  const buildEmailDraftEml = ({ to, cc, subject, textBody, htmlBody }) => {
    const safeTo = sanitizeEmailHeaderValue(to);
    const safeCc = sanitizeEmailHeaderValue(cc);
    const safeSubject = sanitizeEmailHeaderValue(subject);
    const boundary = `----=_Workflow_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    const lines = [];
    if (safeTo) lines.push(`To: ${safeTo}`);
    if (safeCc) lines.push(`Cc: ${safeCc}`);
    if (safeSubject) lines.push(`Subject: ${safeSubject}`);
    lines.push(`Date: ${new Date().toUTCString()}`);
    lines.push("X-Unsent: 1");
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(String(textBody || "").replace(/\r\n?/g, "\n"));
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(String(htmlBody || "").replace(/\r\n?/g, "\n"));
    lines.push(`--${boundary}--`);
    lines.push("");
    return toEmlLineEndings(lines.join("\n"));
  };

  const sanitizeEmailDraftFilenamePart = (value, fallback) => {
    const safe = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return safe || fallback;
  };

  const buildEmailDraftFilename = () => {
    const typeInput = $("email-template-type");
    const type = sanitizeEmailDraftFilenamePart(typeInput ? typeInput.value : "template", "template");
    const candidate = sanitizeEmailDraftFilenamePart(
      emailTemplateContext && emailTemplateContext.name ? emailTemplateContext.name : "candidate",
      "candidate",
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `email-drafts/${candidate}-${type}-${stamp}.eml`;
  };

  const buildMailtoLink = ({ toText, ccText, subjectText, bodyText }) => {
    const encodeParam = (value) => encodeURIComponent(value);
    const params = [];
    if (ccText) params.push(`cc=${encodeParam(ccText)}`);
    if (subjectText) params.push(`subject=${encodeParam(subjectText)}`);
    if (bodyText) {
      const normalizedBody = bodyText.replace(/\r?\n/g, "\r\n");
      params.push(`body=${encodeParam(normalizedBody)}`);
    }
    const query = params.join("&");
    return `mailto:${encodeURIComponent(toText)}${query ? `?${query}` : ""}`;
  };

  const handleEmailTemplateSend = async () => {
    const recipient = $("email-template-recipient");
    const cc = $("email-template-cc");
    const subject = $("email-template-subject");
    const body = $("email-template-body");
    const toText = recipient ? recipient.value.trim() : "";
    const ccText = cc ? cc.value.trim() : "";
    const subjectText = subject ? subject.value.trim() : "";
    const bodyText = body ? body.value.trim() : "";
    if (!toText && !ccText && !subjectText && !bodyText) {
      await showMessageModal(
        "Nothing to Send",
        "Click Update Info or enter an email template first.",
      );
      return;
    }

    const generatedBodyMatches =
      !!emailTemplateLastGeneratedDraft &&
      !!body &&
      body.value === emailTemplateLastGeneratedDraft.body;
    const htmlBody = generatedBodyMatches && emailTemplateLastGeneratedHtmlBody.trim()
      ? emailTemplateLastGeneratedHtmlBody
      : ensureEmailHtmlDocument(buildEmailHtmlBodyFromText(bodyText));
    const emlContent = buildEmailDraftEml({
      to: toText,
      cc: ccText,
      subject: subjectText,
      textBody: bodyText,
      htmlBody,
    });
    const draftFilename = buildEmailDraftFilename();

    if (workflowApi && typeof workflowApi.openEmailDraft === "function") {
      const opened = await workflowApi.openEmailDraft({
        filename: draftFilename,
        content: emlContent,
      });
      if (opened) {
        showToast({ message: "Email draft opened in your mail client." });
        return;
      }
    }

    if (workflowApi && typeof workflowApi.saveEmailFile === "function") {
      const saved = await workflowApi.saveEmailFile({
        filename: draftFilename.split("/").pop() || "email-draft.eml",
        content: emlContent,
      });
      if (saved && saved.ok) {
        showToast({ message: "Email draft saved. Open it in Thunderbird to send." });
        return;
      }
      if (saved && saved.canceled) return;
    }

    const mailto = buildMailtoLink({ toText, ccText, subjectText, bodyText });
    if (workflowApi && typeof workflowApi.openExternal === "function") {
      const ok = await workflowApi.openExternal(mailto);
      if (ok) return;
    }
    window.location.href = mailto;
  };

  const openEmailTemplateModal = (contextOverride = null) => {
    const modal = $("email-template-modal");
    const typeInput = $("email-template-type");
    const recipientInput = $("email-template-recipient");
    const ccInput = $("email-template-cc");
    const startInput = $("email-template-start-time");
    const endInput = $("email-template-end-time");
    const totalInput = $("email-template-total-hours");
    const subjectInput = $("email-template-subject");
    const bodyInput = $("email-template-body");
    if (!modal) return;
    emailTemplateContextOverride =
      contextOverride && typeof contextOverride === "object"
        ? {
            ...contextOverride,
            sourceId: toTemplateValue(contextOverride.sourceId) || "current",
            rowSnapshot:
              contextOverride.rowSnapshot && typeof contextOverride.rowSnapshot === "object"
                ? contextOverride.rowSnapshot
                : {},
          }
        : null;
    const baseContext = emailTemplateContextOverride || getEmailTemplateContext();
    emailTemplateContext = {
      ...baseContext,
      sourceId: toTemplateValue(baseContext.sourceId) || "current",
      rowSnapshot:
        baseContext.rowSnapshot && typeof baseContext.rowSnapshot === "object"
          ? baseContext.rowSnapshot
          : state.kanban.detailsRow || {},
    };
    if (typeInput) {
      renderEmailTemplateTypeSelectOptions("email-template-type", "neo-compliance");
      typeInput.value = "neo-compliance";
    }
    const nextType = typeInput ? typeInput.value : "neo-compliance";
    if (startInput) startInput.value = emailTemplateContext.startTime || "";
    if (endInput) endInput.value = emailTemplateContext.endTime || "";
    const startTime = startInput
      ? sanitizeTimeInput(startInput)
      : toTemplateValue(emailTemplateContext.startTime);
    const endTime = endInput
      ? sanitizeTimeInput(endInput)
      : toTemplateValue(emailTemplateContext.endTime);
    const computedTotal = calculateTimeRangeHours(startTime, endTime);
    const totalHours = computedTotal || toTemplateValue(emailTemplateContext.hours);
    if (totalInput) {
      totalInput.value = totalHours || "";
    }
    const recipientName = emailTemplateContext.name || "[Candidate Name]";
    const next = buildEmailTemplateOutput(
      nextType,
      emailTemplateContext,
      recipientName,
      startTime,
      endTime,
      totalHours,
    );
    if (recipientInput) recipientInput.value = next.recipients.to;
    if (ccInput) ccInput.value = next.recipients.cc;
    if (subjectInput) subjectInput.value = "";
    if (bodyInput) bodyInput.value = "";
    emailTemplateLastGeneratedDraft = null;
    emailTemplateLastGeneratedHtmlBody = "";
    emailTemplateBackdropMouseDown = false;
    modal.classList.remove("hidden");
    applyEmailTemplateDraft({ force: true });
    startEmailTemplateAutoRefresh();
    if (recipientInput) recipientInput.focus();
  };

  const closeEmailTemplateModal = () => {
    const modal = $("email-template-modal");
    if (modal) modal.classList.add("hidden");
    stopEmailTemplateAutoRefresh();
    emailTemplateLastGeneratedDraft = null;
    emailTemplateLastGeneratedHtmlBody = "";
    emailTemplateBackdropMouseDown = false;
    emailTemplateContext = null;
    emailTemplateContextOverride = null;
  };

  const loadEmailTemplateSettings = async () => {
    state.emailTemplates.customTypes = {};
    state.emailTemplates.items = {};
    state.emailTemplates.customTokens = {};
    if (!workflowApi || !workflowApi.emailTemplatesGet) {
      state.emailTemplates.loaded = true;
      renderEmailTemplateTypeSelectOptions("email-template-type", "neo-compliance");
      renderEmailTemplateDashboard();
      return;
    }
    try {
      const result = await workflowApi.emailTemplatesGet();
      state.emailTemplates.items = sanitizeEmailTemplateMap(
        result && result.templates ? result.templates : {},
      );
      const customTypesRaw =
        result && result.customTypes && typeof result.customTypes === "object"
          ? result.customTypes
          : {};
      state.emailTemplates.customTypes = Object.keys(customTypesRaw)
        .slice(0, 64)
        .reduce((acc, key) => {
          const safeId = String(key || "")
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 64);
          const label = sanitizeTemplateDisplayName(customTypesRaw[key]);
          if (!safeId || !safeId.startsWith("custom-") || !label) return acc;
          acc[safeId] = label;
          return acc;
        }, {});
      const customTokensRaw =
        result && result.customTokens && typeof result.customTokens === "object"
          ? result.customTokens
          : {};
      state.emailTemplates.customTokens = sanitizeEmailTemplateTokenMap(customTokensRaw);
    } catch (_error) {
      state.emailTemplates.customTypes = {};
      state.emailTemplates.items = {};
      state.emailTemplates.customTokens = {};
    }
    state.emailTemplates.loaded = true;
    renderEmailTemplateTypeSelectOptions("email-template-type", "neo-compliance");
    renderEmailTemplateDashboard();
  };

  const saveEmailTemplateSettings = async () => {
    if (!workflowApi || !workflowApi.emailTemplatesSave) return false;
    const payload = {
      templates: sanitizeEmailTemplateMap(state.emailTemplates.items),
      customTypes: state.emailTemplates.customTypes || {},
      customTokens: sanitizeEmailTemplateTokenMap(state.emailTemplates.customTokens),
    };
    const result = await workflowApi.emailTemplatesSave(payload);
    if (result && result.ok === false) {
      throw new Error(result.error || "Unable to save template settings.");
    }
    state.emailTemplates.items = sanitizeEmailTemplateMap(
      result && result.templates ? result.templates : {},
    );
    const customTypesRaw =
      result && result.customTypes && typeof result.customTypes === "object"
        ? result.customTypes
        : {};
    state.emailTemplates.customTypes = Object.keys(customTypesRaw)
      .slice(0, 64)
      .reduce((acc, key) => {
        const safeId = String(key || "")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 64);
        const label = sanitizeTemplateDisplayName(customTypesRaw[key]);
        if (!safeId || !safeId.startsWith("custom-") || !label) return acc;
        acc[safeId] = label;
        return acc;
      }, {});
    const customTokensRaw =
      result && result.customTokens && typeof result.customTokens === "object"
        ? result.customTokens
        : {};
    state.emailTemplates.customTokens = sanitizeEmailTemplateTokenMap(customTokensRaw);
    return true;
  };

  const readEmailTemplateDashboardForm = () => {
    const toInput = $("template-dashboard-to");
    const ccInput = $("template-dashboard-cc");
    const subjectInput = $("template-dashboard-subject");
    const bodyInput = $("template-dashboard-body");
    const htmlBodyInput = $("template-dashboard-body-html");
    return sanitizeEmailTemplateRecord({
      toTemplate: toInput ? toInput.value : "",
      ccTemplate: ccInput ? ccInput.value : "",
      subjectTemplate: subjectInput ? subjectInput.value : "",
      bodyTemplate: bodyInput ? bodyInput.value : "",
      htmlBodyTemplate: htmlBodyInput ? htmlBodyInput.value : "",
    });
  };

  const renderEmailTemplateDashboardHtmlPreview = () => {
    const previewFrame = $("template-dashboard-html-preview");
    const bodyInput = $("template-dashboard-body");
    const htmlBodyInput = $("template-dashboard-body-html");
    if (!previewFrame || !bodyInput || !htmlBodyInput) return;
    const htmlTemplate = htmlBodyInput.value.trim() || "{{defaultHtmlBody}}";
    const tokenMap = {
      defaultBody: bodyInput.value || "",
      defaultHtmlBody: buildEmailHtmlBodyFromText(bodyInput.value || ""),
    };
    const rendered = renderTemplateText(htmlTemplate, tokenMap);
    previewFrame.srcdoc = ensureEmailHtmlDocument(rendered);
  };

  const renderEmailTemplateDashboard = () => {
    const typeInput = $("template-dashboard-type");
    const toInput = $("template-dashboard-to");
    const ccInput = $("template-dashboard-cc");
    const subjectInput = $("template-dashboard-subject");
    const bodyInput = $("template-dashboard-body");
    const htmlBodyInput = $("template-dashboard-body-html");
    if (!typeInput || !toInput || !ccInput || !subjectInput || !bodyInput || !htmlBodyInput) return;
    const allDefs = getAllEmailTemplateDefinitions();
    const fallbackType = allDefs[0]?.id || "neo-compliance";
    const hasActive = allDefs.some((item) => item.id === state.emailTemplates.activeType);
    const nextType = hasActive ? state.emailTemplates.activeType : fallbackType;
    state.emailTemplates.activeType = nextType;
    renderEmailTemplateTypeSelectOptions("template-dashboard-type", nextType);
    renderEmailTemplateTypeSelectOptions(
      "email-template-type",
      $("email-template-type")?.value || "neo-compliance",
    );
    const existing =
      state.emailTemplates && state.emailTemplates.items && state.emailTemplates.items[nextType]
        ? sanitizeEmailTemplateRecord(state.emailTemplates.items[nextType])
        : null;
    const defaults = getEmailTemplateConfigForType(nextType);
    const preview = buildEmailTemplateDashboardDefaults(nextType);
    toInput.value = existing ? existing.toTemplate : defaults.toTemplate || "";
    ccInput.value = existing ? existing.ccTemplate : defaults.ccTemplate || "";
    const subjectValue = existing ? existing.subjectTemplate : preview.subject || "";
    const bodyValue = existing ? existing.bodyTemplate : preview.body || "";
    subjectInput.value =
      subjectValue.trim() === "{{defaultSubject}}" ? preview.subject || "" : subjectValue;
    bodyInput.value = bodyValue.trim() === "{{defaultBody}}" ? preview.body || "" : bodyValue;
    htmlBodyInput.value = existing
      ? existing.htmlBodyTemplate || ""
      : defaults.htmlBodyTemplate || "{{defaultHtmlBody}}";
    renderEmailTemplateDashboardHtmlPreview();
    renderEmailTemplateTokenTable();
  };

  const renderEmailTemplateTokenTable = () => {
    const table = $("template-token-table");
    const empty = $("template-token-empty");
    if (!table || !empty) return;
    const tokens = state.emailTemplates.customTokens || {};
    const keys = Object.keys(tokens).sort((a, b) => a.localeCompare(b));
    table.innerHTML = "";
    if (!keys.length) {
      empty.textContent = "No custom tokens yet.";
      return;
    }
    empty.textContent = "";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Token", "Value", ""].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    keys.forEach((key) => {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.textContent = `{{custom.${key}}}`;
      const tdValue = document.createElement("td");
      tdValue.textContent = String(tokens[key] || "");
      const tdAction = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button button--ghost";
      btn.textContent = "Remove";
      btn.dataset.tokenKey = key;
      tdAction.appendChild(btn);
      tr.appendChild(tdKey);
      tr.appendChild(tdValue);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  };

  const handleEmailTemplateTokenAdd = async () => {
    const keyInput = $("template-token-key");
    const valueInput = $("template-token-value");
    if (!keyInput || !valueInput) return;
    const rawKey = keyInput.value;
    const rawValue = valueInput.value;
    const key = sanitizeEmailTemplateTokenKey(rawKey);
    const value = sanitizeEmailTemplateTokenValue(rawValue);
    if (!key) {
      await showMessageModal("Token Name Required", "Enter a valid token name.");
      return;
    }
    if (!value) {
      await showMessageModal("Token Value Required", "Enter a token value.");
      return;
    }
    state.emailTemplates.customTokens = state.emailTemplates.customTokens || {};
    state.emailTemplates.customTokens[key] = value;
    keyInput.value = "";
    valueInput.value = "";
    renderEmailTemplateTokenTable();
    try {
      await saveEmailTemplateSettings();
      showToast({ message: "Token saved." });
    } catch (_error) {
      await showMessageModal("Save Failed", "Unable to save the token.");
    }
  };

  const handleEmailTemplateTokenRemove = async (event) => {
    const target = event && event.target ? event.target : null;
    const key = target && target.dataset ? target.dataset.tokenKey : "";
    if (!key) return;
    if (!state.emailTemplates.customTokens || !state.emailTemplates.customTokens[key]) return;
    delete state.emailTemplates.customTokens[key];
    renderEmailTemplateTokenTable();
    try {
      await saveEmailTemplateSettings();
      showToast({ message: "Token removed." });
    } catch (_error) {
      await showMessageModal("Save Failed", "Unable to remove the token.");
    }
  };

  const handleEmailTemplateDashboardTypeChange = () => {
    const typeInput = $("template-dashboard-type");
    const type = typeInput ? typeInput.value : "neo-compliance";
    const allDefs = getAllEmailTemplateDefinitions();
    state.emailTemplates.activeType = allDefs.some((item) => item.id === type)
      ? type
      : allDefs[0]?.id || "neo-compliance";
    renderEmailTemplateDashboard();
  };

  const handleEmailTemplateDashboardSave = async () => {
    const type = state.emailTemplates.activeType || "neo-compliance";
    const draft = readEmailTemplateDashboardForm();
    const defaults = getEmailTemplateConfigForType(type);
    const preview = buildEmailTemplateDashboardDefaults(type);
    const isBuiltin = EMAIL_TEMPLATE_TYPES.includes(type);
    const isDefault =
      draft.toTemplate === defaults.toTemplate &&
      draft.ccTemplate === defaults.ccTemplate &&
      draft.subjectTemplate === preview.subject &&
      draft.bodyTemplate === preview.body &&
      draft.htmlBodyTemplate === defaults.htmlBodyTemplate;
    if (isBuiltin && isDefault) {
      delete state.emailTemplates.items[type];
    } else {
      state.emailTemplates.items[type] = draft;
    }
    try {
      await saveEmailTemplateSettings();
      renderEmailTemplateDashboard();
      showToast({ message: "Email template saved." });
    } catch (_error) {
      await showMessageModal("Save Failed", "Unable to save email template settings.");
    }
  };

  const handleEmailTemplateDashboardDelete = async () => {
    const type = state.emailTemplates.activeType || "neo-compliance";
    delete state.emailTemplates.items[type];
    if (!EMAIL_TEMPLATE_TYPES.includes(type)) {
      delete state.emailTemplates.customTypes[type];
      const allDefs = getAllEmailTemplateDefinitions();
      state.emailTemplates.activeType = allDefs[0]?.id || "neo-compliance";
    }
    renderEmailTemplateDashboard();
    try {
      await saveEmailTemplateSettings();
      showToast({
        message: EMAIL_TEMPLATE_TYPES.includes(type)
          ? "Template override deleted."
          : "Template deleted.",
      });
    } catch (_error) {
      await showMessageModal("Delete Failed", "Unable to delete template settings.");
    }
  };

  const handleEmailTemplateDashboardAdd = async () => {
    const rawName = window.prompt("Enter a new template name:");
    if (rawName === null) return;
    const label = sanitizeTemplateDisplayName(rawName);
    if (!label) {
      await showMessageModal("Template Name Required", "Enter a name to create a template.");
      return;
    }
    const nextType = makeUniqueCustomTemplateTypeId(label);
    if (!nextType) {
      await showMessageModal("Template Error", "Unable to create a unique template ID.");
      return;
    }
    state.emailTemplates.customTypes[nextType] = label;
    const defaults = getEmailTemplateConfigForType(nextType);
    const preview = buildEmailTemplateDashboardDefaults(nextType);
    state.emailTemplates.items[nextType] = sanitizeEmailTemplateRecord({
      toTemplate: defaults.toTemplate,
      ccTemplate: defaults.ccTemplate,
      subjectTemplate: preview.subject,
      bodyTemplate: preview.body,
      htmlBodyTemplate: defaults.htmlBodyTemplate,
    });
    state.emailTemplates.activeType = nextType;
    renderEmailTemplateDashboard();
    try {
      await saveEmailTemplateSettings();
      showToast({ message: "Template added." });
    } catch (_error) {
      await showMessageModal("Save Failed", "Unable to create the new template.");
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

  const loadDashboardData = async () => {
    if (workflowApi && typeof workflowApi.dashboardGet === "function") {
      try {
        const snapshot = await workflowApi.dashboardGet();
        const kanban =
          snapshot && snapshot.kanban && typeof snapshot.kanban === "object"
            ? snapshot.kanban
            : null;
        if (kanban) {
          state.kanban.columns = Array.isArray(kanban.columns) ? kanban.columns : [];
          state.kanban.cards = Array.isArray(kanban.cards) ? kanban.cards : [];
          invalidateKanbanCache();
          state.kanban.loaded = true;
          state.todos = Array.isArray(snapshot.todos) ? snapshot.todos : [];
          renderKanbanBoard();
          renderKanbanSettings();
          if (state.kanban.detailsCardId) {
            await refreshDetailsRow(state.kanban.detailsCardId);
            renderDetailsDrawer();
          }
          renderTodoList();
          return;
        }
      } catch (err) {
        // fallback to separate requests
      }
    }
    await Promise.all([loadKanban(), loadTodos()]);
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

  const getSelectedDatabaseRows = () => {
    if (!state.data.selectedRowIds || state.data.selectedRowIds.size === 0) return [];
    return state.data.rows.filter((row) => state.data.selectedRowIds.has(row.__rowId));
  };

  const getSelectedDatabaseRow = () => {
    const selectedRows = getSelectedDatabaseRows();
    if (selectedRows.length !== 1) return null;
    return selectedRows[0];
  };

  const hasControlChars = (value) => {
    for (let idx = 0; idx < value.length; idx += 1) {
      const code = value.charCodeAt(idx);
      if (code < 32 || code === 127) return true;
    }
    return false;
  };

  const getDatabaseCandidateId = (row) => {
    if (!row || typeof row !== "object") return "";
    return toTemplateValue(row["candidate UUID"] || row["Candidate UUID"]);
  };

  const normalizeSingleEmailAddress = (value) => {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (!raw) {
      return { ok: false, error: "Email is required." };
    }
    if (raw.length > 120) {
      return { ok: false, error: "Email is too long." };
    }
    if (hasControlChars(raw)) {
      return { ok: false, error: "Email contains invalid control characters." };
    }
    if (/[\s,;]/.test(raw)) {
      return { ok: false, error: "Enter a single email address only." };
    }
    const emailProbe = document.createElement("input");
    emailProbe.type = "email";
    emailProbe.value = raw;
    if (!emailProbe.checkValidity()) {
      return { ok: false, error: "Please enter a valid email address." };
    }
    return { ok: true, value: raw };
  };

  const applyRowEmailToState = (candidateId, emailAddress) => {
    state.data.rows = state.data.rows.map((row) =>
      row.__rowId === candidateId ? { ...row, "Contact Email": emailAddress } : row,
    );
    const detailsRow = state.kanban.detailsRow;
    if (
      detailsRow &&
      toTemplateValue(detailsRow["candidate UUID"] || detailsRow.__rowId) === candidateId
    ) {
      detailsRow["Contact Email"] = emailAddress;
    }
  };

  const saveCandidateRowEmail = async (row, emailAddress) => {
    if (!row || typeof row !== "object") {
      return { ok: false, error: "No candidate row selected." };
    }
    if (state.data.readOnly || state.data.activeSourceId !== "current") {
      return {
        ok: false,
        error: "This database source is read-only. Switch to Current Database to edit email.",
      };
    }
    const candidateId = getDatabaseCandidateId(row);
    if (!candidateId) {
      return { ok: false, error: "Unable to locate candidate UUID for the selected row." };
    }
    try {
      const result = await workflowApi.piiSave(candidateId, { "Contact Email": emailAddress });
      if (result && result.ok === false) {
        return { ok: false, error: result.error || "Unable to save candidate email." };
      }
      applyRowEmailToState(candidateId, emailAddress);
      renderDatabaseTable();
      return { ok: true };
    } catch (_error) {
      return { ok: false, error: "Unable to save candidate email." };
    }
  };

  const buildEmailTemplateContextFromDatabaseRow = (row) => {
    const candidateId = getDatabaseCandidateId(row);
    const card = candidateId
      ? state.kanban.cards.find((item) => item.uuid === candidateId) || null
      : null;
    return buildEmailTemplateContextFromCardRow(card, row);
  };

  const isCurrentDatabaseSource = (sourceId) => {
    return !sourceId || sourceId === "current";
  };

  const hasEmailTemplateRowData = (rowValue) => {
    const rowLookup = buildTemplateRowLookup(rowValue);
    const candidateSignals = [
      "Candidate Name",
      "Employee ID",
      "Contact Email",
      "Contact Phone",
      "REQ ID",
      "Job ID Name",
      "Manager",
      "Branch",
      "Neo Arrival Time",
      "Neo Departure Time",
      "Total Neo Hours",
    ];
    return candidateSignals.some((field) => !!readTemplateRowValue(rowLookup, field));
  };

  const getLatestCandidateRow = async (candidateId, fallbackRow = {}, sourceId = "current") => {
    const fallback =
      fallbackRow && typeof fallbackRow === "object" && !Array.isArray(fallbackRow) ? fallbackRow : {};
    if (!isCurrentDatabaseSource(sourceId)) return fallback;
    if (!candidateId || !workflowApi || !workflowApi.piiGet) return fallback;
    try {
      const result = await workflowApi.piiGet(candidateId);
      const latestRow =
        result && result.row && typeof result.row === "object" && !Array.isArray(result.row)
          ? result.row
          : {};
      return hasEmailTemplateRowData(latestRow) ? latestRow : fallback;
    } catch (_error) {
      return fallback;
    }
  };

  const handleDatabaseSendEmail = async () => {
    if (state.data.tableId !== "candidate_data") {
      await showMessageModal(
        "Unavailable",
        "Send Email is available only for the Employee candidate_data table.",
      );
      return;
    }
    const selectedRows = getSelectedDatabaseRows();
    if (selectedRows.length === 0) {
      await showMessageModal("Selection Required", "Select one employee row first.");
      return;
    }
    if (selectedRows.length > 1) {
      await showMessageModal(
        "Single Row Required",
        "Select only one employee row to send an email.",
      );
      return;
    }

    const row = getSelectedDatabaseRow();
    if (!row) {
      await showMessageModal("Selection Required", "Select one employee row first.");
      return;
    }
    const rowLookup = buildTemplateRowLookup(row);
    const candidateName = readTemplateRowValue(rowLookup, "Candidate Name", "Name") || "This employee";
    let emailAddress = readTemplateRowValue(rowLookup, "Contact Email", "Candidate Email", "Email");
    let emailCheck = normalizeSingleEmailAddress(emailAddress);
    if (!emailAddress || !emailCheck.ok) {
      const needsValid = !emailAddress
        ? `${candidateName} does not have an email on file.`
        : `${candidateName} has an invalid email on file.`;
      const wantsToAdd = window.confirm(
        `${needsValid}\nWould you like to add/update the email now?`,
      );
      if (!wantsToAdd) return;

      if (state.data.readOnly || state.data.activeSourceId !== "current") {
        await showMessageModal(
          "Read-only Database",
          "This row is in a read-only database source. Switch to Current Database to add an email.",
        );
        return;
      }

      const entered = window.prompt(`Enter email for ${candidateName}:`, "");
      if (entered === null) return;
      emailCheck = normalizeSingleEmailAddress(entered);
      if (!emailCheck.ok) {
        await showMessageModal("Invalid Email", emailCheck.error);
        return;
      }
      const saved = await saveCandidateRowEmail(row, emailCheck.value);
      if (!saved.ok) {
        await showMessageModal("Update Failed", saved.error || "Unable to save candidate email.");
        return;
      }
      emailAddress = emailCheck.value;
    }

    const sourceId = state.data.activeSourceId || "current";
    const candidateId = getDatabaseCandidateId(row);
    const latestRow = await getLatestCandidateRow(candidateId, row, sourceId);
    const rowSnapshot = {
      ...row,
      ...latestRow,
      "Contact Email": emailAddress,
    };
    const context = {
      ...buildEmailTemplateContextFromDatabaseRow(rowSnapshot),
      candidateId: candidateId || "",
      sourceId,
      rowSnapshot,
    };
    openEmailTemplateModal(context);
  };

  const updateDbDeleteButton = () => {
    const btn = $("db-delete");
    const emailBtn = $("db-send-email");
    const clearBtn = $("db-clear-selection");
    const hasSelection = state.data.selectedRowIds.size > 0;
    const hasSingleSelection = state.data.selectedRowIds.size === 1;
    const isCandidateTable = state.data.tableId === "candidate_data";
    const canEdit = !state.data.readOnly;
    if (btn) btn.disabled = !canEdit || !hasSelection;
    if (clearBtn) clearBtn.disabled = !canEdit || !hasSelection;
    if (emailBtn) emailBtn.disabled = !isCandidateTable || !hasSingleSelection;
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

  const updateUniformDeleteButton = () => {
    const deleteBtn = $("uniform-delete");
    const clearBtn = $("uniform-clear-selection");
    const hasSelection = state.uniforms.selectedRowIds.size > 0;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
    if (clearBtn) clearBtn.disabled = !hasSelection;
  };

  const getFilteredUniformRows = () => {
    const query = state.uniforms.query.trim().toLowerCase();
    if (!query) return state.uniforms.rows;
    return state.uniforms.rows.filter((row) =>
      state.uniforms.columns.some((col) => {
        const value = row[col];
        return String(value ?? "")
          .toLowerCase()
          .includes(query);
      }),
    );
  };

  const getPagedUniformRows = () => {
    const filtered = getFilteredUniformRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.uniforms.pageSize));
    if (state.uniforms.page > totalPages) state.uniforms.page = totalPages;
    if (state.uniforms.page < 1) state.uniforms.page = 1;
    const start = (state.uniforms.page - 1) * state.uniforms.pageSize;
    return filtered.slice(start, start + state.uniforms.pageSize);
  };

  const updateUniformMeta = (filteredCount) => {
    const meta = $("uniform-table-meta");
    if (!meta) return;
    meta.textContent = `${filteredCount} of ${state.uniforms.rows.length} rows`;
  };

  const updateUniformPagination = (filteredCount) => {
    const totalPages = Math.max(1, Math.ceil(filteredCount / state.uniforms.pageSize));
    const info = $("uniform-page-info");
    const prev = $("uniform-page-prev");
    const next = $("uniform-page-next");
    const size = $("uniform-page-size");
    if (info) info.textContent = `Page ${state.uniforms.page} of ${totalPages}`;
    if (prev) prev.disabled = state.uniforms.page <= 1;
    if (next) next.disabled = state.uniforms.page >= totalPages;
    if (size) size.value = String(state.uniforms.pageSize);
  };

  const clearUniformSelection = (shouldRender = true) => {
    state.uniforms.selectedRowIds = new Set();
    updateUniformDeleteButton();
    if (shouldRender) renderUniformTable();
  };

  const renderUniformTable = () => {
    const table = $("uniform-table");
    if (!table) return;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    if (!thead || !tbody) return;

    const filteredRows = getFilteredUniformRows();
    const rows = getPagedUniformRows();

    thead.innerHTML = "";
    tbody.innerHTML = "";

    const headerRow = document.createElement("tr");
    const selectTh = document.createElement("th");
    const selectAll = document.createElement("input");
    selectAll.type = "checkbox";
    selectAll.className = "table-checkbox";
    selectAll.dataset.uniformSelectAll = "1";
    selectAll.checked =
      rows.length > 0 && rows.every((row) => state.uniforms.selectedRowIds.has(row.__rowId));
    selectTh.appendChild(selectAll);
    headerRow.appendChild(selectTh);

    state.uniforms.columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    if (!rows.length) {
      const emptyRow = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = state.uniforms.columns.length + 1;
      td.className = "data-table__empty";
      td.textContent = "No rows found.";
      emptyRow.appendChild(td);
      tbody.appendChild(emptyRow);
      updateUniformMeta(filteredRows.length);
      updateUniformPagination(filteredRows.length);
      updateUniformDeleteButton();
      return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const selectTd = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "table-checkbox uniform-row-checkbox";
      checkbox.dataset.rowId = row.__rowId;
      checkbox.checked = state.uniforms.selectedRowIds.has(row.__rowId);
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      state.uniforms.columns.forEach((col) => {
        const td = document.createElement("td");
        const value = row[col];
        td.textContent = value === null || value === undefined ? "" : String(value);
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);

    updateUniformMeta(filteredRows.length);
    updateUniformPagination(filteredRows.length);
    updateUniformDeleteButton();
  };

  const loadUniformTable = async () => {
    let table = null;
    try {
      table = await workflowApi.dbGetTable("uniform_inventory", "current");
    } catch (error) {
      await showMessageModal(
        "Uniforms Unavailable",
        "Uniform database handlers are not available. Please fully quit and relaunch the app.",
      );
      return;
    }
    state.uniforms.columns =
      table && table.columns && table.columns.length
        ? table.columns
        : ["Alteration", "Type", "Size", "Waist", "Inseam", "Quantity", "Branch"];
    state.uniforms.rows = table && table.rows ? table.rows : [];
    state.uniforms.page = 1;
    state.uniforms.selectedRowIds = new Set();
    renderUniformTable();
  };

  const handleUniformDelete = async () => {
    if (state.uniforms.selectedRowIds.size === 0) return;
    const ids = Array.from(state.uniforms.selectedRowIds);
    const previousRows = state.uniforms.rows.map((row) => ({ ...row }));
    const previousSelection = new Set(state.uniforms.selectedRowIds);
    const result = await withOptimisticUpdate({
      apply: () => {
        state.uniforms.rows = state.uniforms.rows.filter(
          (row) => !state.uniforms.selectedRowIds.has(row.__rowId),
        );
        state.uniforms.selectedRowIds = new Set();
        renderUniformTable();
      },
      rollback: () => {
        state.uniforms.rows = previousRows;
        state.uniforms.selectedRowIds = previousSelection;
        renderUniformTable();
      },
      request: () => workflowApi.dbDeleteRows("uniform_inventory", ids, "current"),
      onSuccess: async (payload) => {
        if (payload && payload.ok === false) {
          throw new Error(payload.message || "Unable to delete uniform rows.");
        }
        await loadUniformTable();
        if (payload && payload.undoId) {
          pushUndo(payload.undoId);
          showToast({
            message: "Uniform rows deleted.",
            actionLabel: "Undo",
            onAction: async () => {
              await applyUndoFromToast(payload.undoId, async () => {
                await loadUniformTable();
              });
            },
          });
        }
      },
      onErrorMessage: "Unable to delete uniform rows. Please fully quit and relaunch the app.",
    });
    if (!result) return;
    clearUniformSelection();
  };

  const handleUniformExport = async () => {
    const visibleRows = getFilteredUniformRows();
    const selectedRows = state.uniforms.rows.filter((row) =>
      state.uniforms.selectedRowIds.has(row.__rowId),
    );
    let rowsToExport = selectedRows.length ? selectedRows : visibleRows;
    if (!rowsToExport.length) {
      rowsToExport = state.uniforms.rows;
    }
    if (!rowsToExport.length) {
      await showMessageModal("Nothing to Export", "There are no uniform rows to export.");
      clearUniformSelection();
      return;
    }
    try {
      const result = await workflowApi.dbExportCsv({
        tableId: "uniform_inventory",
        tableName: "Uniform Inventory",
        columns: state.uniforms.columns,
        rows: rowsToExport,
        sourceId: "current",
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
      clearUniformSelection();
    }
  };

  const updateUniformAddTypeFields = () => {
    const typeInput = $("uniform-add-type");
    const details = $("uniform-add-details");
    const alterationInput = $("uniform-add-alteration");
    const shirtSizeInput = $("uniform-add-shirt-size");
    const pantsFields = $("uniform-add-pants-fields");
    const waistInput = $("uniform-add-waist");
    const inseamInput = $("uniform-add-inseam");
    const quantityInput = $("uniform-add-quantity");
    const branchInput = $("uniform-add-branch");
    const type = typeInput ? typeInput.value.trim() : "";
    const showShirt = type === "Shirt";
    const showPants = type === "Pants";
    const hasType = showShirt || showPants;

    if (details) details.classList.toggle("hidden", !hasType);
    if (alterationInput) {
      alterationInput.disabled = !hasType;
      alterationInput.required = hasType;
      if (!hasType) alterationInput.value = "";
    }
    if (quantityInput) {
      quantityInput.disabled = !hasType;
      quantityInput.required = hasType;
      if (!hasType) quantityInput.value = "";
    }
    if (branchInput) {
      branchInput.disabled = !hasType;
      branchInput.required = hasType;
      if (!hasType) branchInput.value = "";
    }

    if (shirtSizeInput) {
      shirtSizeInput.classList.toggle("hidden", !showShirt);
      shirtSizeInput.disabled = !showShirt;
      shirtSizeInput.required = showShirt;
      if (!showShirt) shirtSizeInput.value = "";
    }
    if (pantsFields) pantsFields.classList.toggle("hidden", !showPants);
    if (waistInput) {
      waistInput.disabled = !showPants;
      waistInput.required = showPants;
      if (!showPants) waistInput.value = "";
    }
    if (inseamInput) {
      inseamInput.disabled = !showPants;
      inseamInput.required = showPants;
      if (!showPants) inseamInput.value = "";
    }
  };

  const openUniformAddModal = () => {
    const modal = $("uniform-add-modal");
    const alteration = $("uniform-add-alteration");
    const type = $("uniform-add-type");
    const shirtSize = $("uniform-add-shirt-size");
    const waist = $("uniform-add-waist");
    const inseam = $("uniform-add-inseam");
    const quantity = $("uniform-add-quantity");
    const branch = $("uniform-add-branch");
    if (!modal) return;
    if (alteration) alteration.value = "";
    if (type) type.value = "";
    if (shirtSize) shirtSize.value = "";
    if (waist) waist.value = "";
    if (inseam) inseam.value = "";
    if (quantity) quantity.value = "";
    if (branch) branch.value = "";
    updateUniformAddTypeFields();
    modal.classList.remove("hidden");
    if (type) type.focus();
  };

  const closeUniformAddModal = () => {
    const modal = $("uniform-add-modal");
    if (modal) modal.classList.add("hidden");
  };

  const handleUniformAddSubmit = async (event) => {
    event.preventDefault();
    const alterationInput = $("uniform-add-alteration");
    const typeInput = $("uniform-add-type");
    const shirtSizeInput = $("uniform-add-shirt-size");
    const waistInput = $("uniform-add-waist");
    const inseamInput = $("uniform-add-inseam");
    const quantityInput = $("uniform-add-quantity");
    const branchInput = $("uniform-add-branch");
    const alteration = alterationInput ? alterationInput.value.trim() : "";
    const type = typeInput ? typeInput.value.trim() : "";
    const shirtSize = shirtSizeInput ? shirtSizeInput.value.trim() : "";
    const waist = normalizeUniformMeasurement(waistInput ? waistInput.value : "");
    const inseam = normalizeUniformMeasurement(inseamInput ? inseamInput.value : "");
    const quantityRaw = quantityInput ? quantityInput.value.trim() : "";
    const branch = branchInput ? branchInput.value.trim() : "";
    const quantity = Number(quantityRaw);
    const size = type === "Pants" ? buildPantsSize(waist, inseam) : shirtSize;

    if (!alteration || !type || !branch) {
      await showMessageModal("Missing Fields", "Alteration, Type, and Branch are required.");
      return;
    }
    if (type === "Shirt") {
      if (!UNIFORM_ADD_SHIRT_SIZE_OPTIONS.includes(shirtSize)) {
        await showMessageModal("Missing Shirt Size", "Select a shirt size from the dropdown.");
        return;
      }
    } else if (type === "Pants") {
      if (!waist || !inseam) {
        await showMessageModal("Missing Pants Size", "Waist and Inseam are required for pants.");
        return;
      }
    } else {
      await showMessageModal("Invalid Type", "Type must be Shirt or Pants.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      await showMessageModal("Invalid Quantity", "Quantity must be a number greater than 0.");
      return;
    }

    let result = null;
    try {
      result = await workflowApi.uniformsAddItem({
        alteration,
        type,
        size,
        waist,
        inseam,
        quantity,
        branch,
      });
    } catch (error) {
      await showMessageModal(
        "Save Failed",
        "Unable to add uniform inventory. Please fully quit and relaunch the app.",
      );
      return;
    }
    if (!result || result.ok === false) {
      await showMessageModal(
        "Save Failed",
        (result && result.error) || "Unable to add uniform inventory.",
      );
      return;
    }
    closeUniformAddModal();
    await loadUniformTable();
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
    if (state.page === "uniforms" && target !== "uniforms") {
      clearUniformSelection(false);
    }
    state.page = target;
    document.body.dataset.page = target;
    document.querySelectorAll(".page").forEach((section) => {
      section.classList.toggle("page--active", section.id === `page-${target}`);
    });
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("nav-item--active", btn.dataset.page === target);
    });
    const pageHandlers = {
      dashboard: renderKanbanBoard,
      settings: renderKanbanSettings,
      database: () => loadDatabaseSources().then(loadDatabaseTables),
      uniforms: loadUniformTable,
      "email-templates": renderEmailTemplateDashboard,
      help: renderHelpPage,
      about: () => {},
    };
    const handler = pageHandlers[target];
    if (handler) handler();
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
    const detailsBasicInfo = $("details-basic-info");
    const detailsPii = $("details-pii");
    const detailsEmailTemplate = $("details-email-template");
    const detailsProcess = $("details-process");
    const processClose = $("process-close");
    const processConfirm = $("process-confirm");
    const processRemove = $("process-remove");
    const processArrival = $("process-arrival");
    const processDeparture = $("process-departure");
    const processBranch = $("process-branch");
    const emailTemplateModal = $("email-template-modal");
    const emailTemplateForm = $("email-template-form");
    const emailTemplateType = $("email-template-type");
    const emailTemplateStartTime = $("email-template-start-time");
    const emailTemplateEndTime = $("email-template-end-time");
    const emailTemplateClose = $("email-template-close");
    const emailTemplateCancel = $("email-template-cancel");
    const emailTemplateCopy = $("email-template-copy");
    const emailTemplateSend = $("email-template-send");
    const templateDashboardAdd = $("template-dashboard-add");
    const templateDashboardType = $("template-dashboard-type");
    const templateDashboardSave = $("template-dashboard-save");
    const templateDashboardReset = $("template-dashboard-reset");
    const templateDashboardBody = $("template-dashboard-body");
    const templateDashboardHtmlBody = $("template-dashboard-body-html");
    const templateTokenAdd = $("template-token-add");
    const templateTokenTable = $("template-token-table");
    const helpManualSelect = $("help-manual-select");
    const helpOpenManual = $("help-open-manual");
    const aboutOpenContributingGuide = $("about-open-contributing-guide");
    const helpManualModal = $("help-manual-modal");
    const helpManualClose = $("help-manual-close");
    const helpManualCloseFooter = $("help-manual-close-footer");
    const helpManualSearch = $("help-manual-search");
    const helpManualContent = $("help-manual-content");

    const on = (el, eventName, handler) => {
      if (el) el.addEventListener(eventName, handler);
    };
    const onClick = (el, handler) => on(el, "click", handler);

    onClick(addColumnHeader, openAddColumnModal);
    onClick(addColumnSettings, openAddColumnModal);
    onClick(removeColumnSettings, removeSelectedColumn);
    on(addColumnForm, "submit", handleAddColumnSubmit);
    onClick(addColumnClose, closeAddColumnModal);
    onClick(addColumnCancel, closeAddColumnModal);
    onClick(undoBtn, handleUndo);
    onClick(redoBtn, handleRedo);
    onClick(authBiometric, handleAuthBiometric);
    onClick(biometricToggle, handleBiometricToggle);
    onClick(dbImport, handleDatabaseImport);
    onClick(helpOpenManual, () =>
      openHelpManualModal(helpManualSelect ? helpManualSelect.value : helpState.activeManualId),
    );
    onClick(aboutOpenContributingGuide, () => openHelpManualModal("readme"));
    onClick(helpManualClose, closeHelpManualModal);
    onClick(helpManualCloseFooter, closeHelpManualModal);
    if (helpManualSelect) {
      helpManualSelect.addEventListener("change", () => {
        helpState.activeManualId = getHelpManualById(helpManualSelect.value).id;
      });
      helpManualSelect.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        openHelpManualModal(helpManualSelect.value);
      });
    }
    if (helpManualModal) {
      helpManualModal.addEventListener("click", (event) => {
        if (event.target === helpManualModal) closeHelpManualModal();
      });
    }
    if (helpManualSearch) {
      const onManualSearch = debounce(applyHelpManualSearch, 120);
      helpManualSearch.addEventListener("input", onManualSearch);
    }
    if (helpManualContent) {
      const onManualScroll = debounce(updateHelpTocActive, 50);
      helpManualContent.addEventListener("scroll", onManualScroll);
    }
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const manualModalOpen = helpManualModal && !helpManualModal.classList.contains("hidden");
      if (manualModalOpen) closeHelpManualModal();
      const uniformModal = $("uniform-add-modal");
      if (uniformModal && !uniformModal.classList.contains("hidden")) {
        closeUniformAddModal();
      }
      if (emailTemplateModal && !emailTemplateModal.classList.contains("hidden")) {
        closeEmailTemplateModal();
      }
    });
    window.addEventListener("focus", () => {
      if (ENABLE_FOCUS_REAUTH) {
        void requestAuthOnWindowFocus();
      }
      const modalOpen = emailTemplateModal && !emailTemplateModal.classList.contains("hidden");
      if (!modalOpen) return;
      void refreshEmailTemplateContextFromDatabase();
    });
    window.addEventListener("blur", () => {
      if (!ENABLE_FOCUS_REAUTH) return;
      if (state.auth && state.auth.configured && state.auth.authenticated) {
        authReauthOnFocusRequired = true;
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (!ENABLE_FOCUS_REAUTH) return;
      if (document.visibilityState === "hidden") {
        if (state.auth && state.auth.configured && state.auth.authenticated) {
          authReauthOnFocusRequired = true;
        }
        return;
      }
      void requestAuthOnWindowFocus();
    });
    onClick(detailsBasicInfo, openDetailsBasicInfo);
    onClick(detailsPii, openDetailsPii);
    onClick(detailsEmailTemplate, openDetailsEmailTemplate);
    onClick(emailTemplateClose, closeEmailTemplateModal);
    onClick(emailTemplateCancel, closeEmailTemplateModal);
    on(emailTemplateForm, "submit", handleEmailTemplateGenerate);
    on(emailTemplateType, "change", handleEmailTemplateTypeChange);
    [emailTemplateStartTime, emailTemplateEndTime].forEach((input) => {
      on(input, "input", () => {
        sanitizeTimeInput(input);
        handleEmailTemplateGenerate();
      });
    });
    onClick(emailTemplateCopy, handleEmailTemplateCopy);
    onClick(emailTemplateSend, handleEmailTemplateSend);
    onClick(templateDashboardAdd, handleEmailTemplateDashboardAdd);
    on(templateDashboardType, "change", handleEmailTemplateDashboardTypeChange);
    onClick(templateDashboardSave, handleEmailTemplateDashboardSave);
    onClick(templateDashboardReset, handleEmailTemplateDashboardDelete);
    on(templateDashboardBody, "input", renderEmailTemplateDashboardHtmlPreview);
    on(templateDashboardHtmlBody, "input", renderEmailTemplateDashboardHtmlPreview);
    onClick(templateTokenAdd, handleEmailTemplateTokenAdd);
    if (templateTokenTable) {
      templateTokenTable.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || !target.dataset || !target.dataset.tokenKey) return;
        handleEmailTemplateTokenRemove(event);
      });
    }
    if (emailTemplateModal) {
      emailTemplateModal.addEventListener("mousedown", (event) => {
        emailTemplateBackdropMouseDown = event.target === emailTemplateModal;
      });
      emailTemplateModal.addEventListener("click", (event) => {
        const shouldClose = event.target === emailTemplateModal && emailTemplateBackdropMouseDown;
        emailTemplateBackdropMouseDown = false;
        if (shouldClose) closeEmailTemplateModal();
      });
    }
    if (dbSourceSelect) {
      dbSourceSelect.addEventListener("change", () =>
        setDatabaseSource(dbSourceSelect.value || "current"),
      );
    }
    on(candidateForm, "submit", handleCandidateSubmit);
    onClick(candidateClose, closeCandidateModal);
    onClick(candidateCancel, closeCandidateModal);
    on(piiForm, "submit", handlePiiSubmit);
    onClick(piiClose, closePiiModal);
    onClick(piiCancel, closePiiModal);
    onClick(neoDatePill, openNeoDateModal);
    on(neoDateForm, "submit", handleNeoDateSubmit);
    onClick(neoDateClose, closeNeoDateModal);
    onClick(neoDateCancel, closeNeoDateModal);
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
    onClick(detailsClose, closeDetailsDrawer);
    onClick(detailsProcess, openProcessModal);
    onClick(processClose, closeProcessModal);
    onClick(processConfirm, handleProcessConfirm);
    onClick(processRemove, handleProcessRemove);
    [processArrival, processDeparture].forEach((input) => {
      on(input, "input", () => sanitizeTimeInput(input));
    });
    on(processBranch, "change", () => {
      if (processBranch) processBranch.value = processBranch.value.trim();
    });

    const weeklyButton = $("weekly-toggle");
    const weeklyClose = $("weekly-close");
    const weeklyCancel = $("weekly-cancel");
    const weeklyForm = $("weekly-form");
    const weeklyExport = $("weekly-export");
    const weeklyPanel = $("weekly-panel");
    onClick(weeklyPanel, (event) => event.stopPropagation());
    onClick(weeklyButton, toggleWeeklyTracker);
    onClick(weeklyClose, closeWeeklyTracker);
    onClick(weeklyCancel, closeWeeklyTracker);
    on(weeklyForm, "submit", saveWeeklyTracker);
    onClick(weeklyExport, downloadWeeklySummary);

    const todoPanel = $("todo-panel");
    onClick(todoPanel, (event) => event.stopPropagation());
    bindAuthModalControls();

    const changeBtn = $("change-password-button");
    const changeModalClose = $("change-password-close");
    const changeForm = $("change-password-form");
    onClick(changeBtn, showChangePasswordModal);
    onClick(changeModalClose, hideChangePasswordModal);
    on(changeForm, "submit", handleChangePasswordSubmit);

    const dbSearch = $("db-search");
    const dbExport = $("db-export");
    const dbSendEmail = $("db-send-email");
    const dbClear = $("db-clear-selection");
    const dbDelete = $("db-delete");
    const dbSelect = $("db-table-select");
    const dbTable = $("db-table");
    const dbPrev = $("db-page-prev");
    const dbNext = $("db-page-next");
    const dbSize = $("db-page-size");
    const uniformSearch = $("uniform-search");
    const uniformAdd = $("uniform-add");
    const uniformExport = $("uniform-export");
    const uniformClear = $("uniform-clear-selection");
    const uniformDelete = $("uniform-delete");
    const uniformTable = $("uniform-table");
    const uniformPrev = $("uniform-page-prev");
    const uniformNext = $("uniform-page-next");
    const uniformSize = $("uniform-page-size");
    const uniformAddForm = $("uniform-add-form");
    const uniformAddClose = $("uniform-add-close");
    const uniformAddCancel = $("uniform-add-cancel");
    const uniformAddType = $("uniform-add-type");
    const uniformAddWaist = $("uniform-add-waist");
    const uniformAddInseam = $("uniform-add-inseam");
    if (dbSearch) {
      const onSearch = debounce(() => {
        state.data.query = dbSearch.value;
        state.data.page = 1;
        renderDatabaseTable();
      }, 200);
      dbSearch.addEventListener("input", onSearch);
    }
    onClick(dbExport, handleDatabaseExport);
    onClick(dbSendEmail, handleDatabaseSendEmail);
    onClick(dbClear, () => clearDatabaseSelection());
    onClick(dbDelete, handleDatabaseDelete);
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

    if (uniformSearch) {
      const onUniformSearch = debounce(() => {
        state.uniforms.query = uniformSearch.value;
        state.uniforms.page = 1;
        renderUniformTable();
      }, 200);
      uniformSearch.addEventListener("input", onUniformSearch);
    }
    onClick(uniformAdd, openUniformAddModal);
    onClick(uniformExport, handleUniformExport);
    onClick(uniformClear, () => clearUniformSelection());
    onClick(uniformDelete, handleUniformDelete);
    on(uniformAddForm, "submit", handleUniformAddSubmit);
    onClick(uniformAddClose, closeUniformAddModal);
    onClick(uniformAddCancel, closeUniformAddModal);
    on(uniformAddType, "change", updateUniformAddTypeFields);
    on(uniformAddWaist, "input", () => {
      uniformAddWaist.value = normalizeUniformMeasurement(uniformAddWaist.value);
    });
    on(uniformAddInseam, "input", () => {
      uniformAddInseam.value = normalizeUniformMeasurement(uniformAddInseam.value);
    });
    if (uniformPrev) {
      uniformPrev.addEventListener("click", () => {
        if (state.uniforms.page > 1) {
          state.uniforms.page -= 1;
          renderUniformTable();
        }
      });
    }
    if (uniformNext) {
      uniformNext.addEventListener("click", () => {
        state.uniforms.page += 1;
        renderUniformTable();
      });
    }
    if (uniformSize) {
      uniformSize.addEventListener("change", () => {
        state.uniforms.pageSize = Number(uniformSize.value) || 50;
        state.uniforms.page = 1;
        renderUniformTable();
      });
    }
    if (uniformTable) {
      uniformTable.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.uniformSelectAll) {
          if (target.checked) {
            const next = new Set(state.uniforms.selectedRowIds);
            getPagedUniformRows().forEach((row) => next.add(row.__rowId));
            state.uniforms.selectedRowIds = next;
          } else {
            const next = new Set(state.uniforms.selectedRowIds);
            getPagedUniformRows().forEach((row) => next.delete(row.__rowId));
            state.uniforms.selectedRowIds = next;
          }
          renderUniformTable();
          return;
        }
        if (target.classList.contains("uniform-row-checkbox")) {
          const rowId = target.dataset.rowId;
          if (!rowId) return;
          if (target.checked) {
            state.uniforms.selectedRowIds.add(rowId);
          } else {
            state.uniforms.selectedRowIds.delete(rowId);
          }
          updateUniformDeleteButton();
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
      await showMessageModal("Error", "Native desktop bridge is unavailable.");
      return;
    }
    initWindowControls();
    initSidebarToggle();
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

    const ok = await requireStartupAuthentication();
    if (!ok) return;

    await loadEmailTemplateSettings();
    switchPage("dashboard");
    await loadDashboardData();
    await checkDatabaseIntegrity();
  };

  bindAuthModalControls();

  initApp().catch(async (error) => {
    console.error("App initialization failed", error);
    const modal = $("auth-modal");
    if (modal) modal.classList.remove("hidden");
    try {
      await showMessageModal("Startup error", "The app failed to initialize correctly.");
    } catch (_err) {
      // Ignore modal failures.
    }
  });
})();
