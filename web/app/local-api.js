const existingApi = window.workflowApi;
if (existingApi) {
  // Native runtime already provided an API bridge.
} else {
  const tauriBridge = window.__workflowTauriBridge || null;

  const AUTH_MAX_ATTEMPTS = 5;
  const AUTH_LOCK_MS = 30 * 1000;
  const AUTH_WINDOW_MS = 5 * 60 * 1000;

  const authLimiter = { failures: 0, lockUntil: 0, lastFailureAt: 0 };
  let authState = { configured: false, authenticated: false };
  let authStateLoaded = false;
  let activePassword = null;

  let platform =
    tauriBridge && typeof tauriBridge.platform === "string" ? tauriBridge.platform : "web";

  const refreshPlatform = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    platform = next;
  };

  if (tauriBridge && typeof tauriBridge.platformName === "function") {
    tauriBridge
      .platformName()
      .then((value) => {
        refreshPlatform(value);
      })
      .catch(() => {});
  }

  const checkAuthRateLimit = () => {
    const now = Date.now();
    if (authLimiter.lastFailureAt && now - authLimiter.lastFailureAt > AUTH_WINDOW_MS) {
      authLimiter.failures = 0;
    }
    if (authLimiter.lockUntil && now < authLimiter.lockUntil) {
      return { ok: false, retryAfterMs: authLimiter.lockUntil - now };
    }
    return { ok: true };
  };

  const recordAuthFailure = () => {
    const now = Date.now();
    authLimiter.failures += 1;
    authLimiter.lastFailureAt = now;
    if (authLimiter.failures >= AUTH_MAX_ATTEMPTS) {
      authLimiter.lockUntil = now + AUTH_LOCK_MS;
    }
  };

  const recordAuthSuccess = () => {
    authLimiter.failures = 0;
    authLimiter.lockUntil = 0;
    authLimiter.lastFailureAt = 0;
  };

  const ensureAuthState = async () => {
    if (authStateLoaded) return;
    if (!tauriBridge || typeof tauriBridge.authRead !== "function") {
      authState.configured = false;
      authState.authenticated = false;
      authStateLoaded = true;
      return;
    }
    try {
      const auth = await tauriBridge.authRead();
      authState.configured = !!(auth && auth.salt && auth.hash);
      authState.authenticated = !!(authState.authenticated && activePassword);
    } catch (_err) {
      authState.configured = false;
      authState.authenticated = false;
    }
    authStateLoaded = true;
  };

  const requireAuth = () => {
    if (!authState.authenticated || !activePassword) {
      throw new Error("Not authenticated");
    }
  };

  const api = {
    get platform() {
      return platform;
    },
    appVersion: async () => {
      if (tauriBridge && typeof tauriBridge.appVersion === "function") {
        try {
          const value = await tauriBridge.appVersion();
          if (value) return String(value);
        } catch (_err) {
          return "";
        }
      }
      return "";
    },
    windowControls:
      tauriBridge && tauriBridge.windowControls
        ? tauriBridge.windowControls
        : {
            minimize: async () => {},
            maximize: async () => {},
            unmaximize: async () => {},
            toggleMaximize: async () => {},
            close: async () => {},
            isMaximized: async () => false,
            onMaximized: () => {},
            onUnmaximized: () => {},
          },
    storageInfo: async () => {
      if (tauriBridge && typeof tauriBridge.storageInfo === "function") {
        try {
          const result = await tauriBridge.storageInfo();
          if (result && typeof result === "object") {
            return {
              mode: result.mode || "tauri",
              directory: result.directory || "APPDATA",
              pathLabel: result.path_label || "",
              fallback: !!result.fallback,
            };
          }
        } catch (_err) {
          return { mode: "tauri", directory: "APPDATA", pathLabel: "", fallback: false };
        }
      }
      return { mode: "localStorage", directory: "LOCAL", pathLabel: "", fallback: false };
    },
    setupStatus: async () => {
      if (tauriBridge && typeof tauriBridge.setupStatus === "function") {
        try {
          const result = await tauriBridge.setupStatus();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return {
              needsSetup: !!result.needsSetup,
              folder: String(result.folder || ""),
              fallback: !!result.fallback,
            };
          }
        } catch (_err) {
          return { needsSetup: false };
        }
      }
      return { needsSetup: false };
    },
    setupComplete: async ({ donationChoice } = {}) => {
      if (tauriBridge && typeof tauriBridge.setupComplete === "function") {
        try {
          const result = await tauriBridge.setupComplete({
            donationChoice: String(donationChoice || "") || null,
          });
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return result.ok !== false;
          }
          if (typeof result === "boolean") return result;
        } catch (_err) {
          return false;
        }
      }
      return false;
    },
    donationPreference: async () => {
      if (tauriBridge && typeof tauriBridge.donationPreference === "function") {
        try {
          const result = await tauriBridge.donationPreference();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return { choice: String(result.choice || "not_now") || "not_now" };
          }
        } catch (_err) {
          return { choice: "not_now" };
        }
      }
      return { choice: "not_now" };
    },
    biometricStatus: async () => {
      if (tauriBridge && typeof tauriBridge.biometricStatus === "function") {
        try {
          const result = await tauriBridge.biometricStatus();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return {
              available: !!result.available,
              enabled: !!result.enabled,
              biometryType: String(result.biometryType || ""),
            };
          }
        } catch (_err) {
          return { available: false, enabled: false, biometryType: "" };
        }
      }
      return { available: false, enabled: false, biometryType: "" };
    },
    biometricEnable: async (password) => {
      if (tauriBridge && typeof tauriBridge.biometricEnable === "function") {
        try {
          const result = await tauriBridge.biometricEnable(String(password || ""));
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return { ok: result.ok !== false, error: String(result.error || "") };
          }
          if (typeof result === "boolean") return { ok: result };
        } catch (_err) {
          return { ok: false, error: "Biometrics unavailable." };
        }
      }
      return { ok: false, error: "Biometrics unavailable." };
    },
    biometricDisable: async () => {
      if (tauriBridge && typeof tauriBridge.biometricDisable === "function") {
        try {
          const result = await tauriBridge.biometricDisable();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return { ok: result.ok !== false, error: String(result.error || "") };
          }
          if (typeof result === "boolean") return { ok: result };
        } catch (_err) {
          return { ok: false, error: "Biometrics unavailable." };
        }
      }
      return { ok: false, error: "Biometrics unavailable." };
    },
    biometricUnlock: async () => {
      if (tauriBridge && typeof tauriBridge.biometricUnlock === "function") {
        try {
          const result = await tauriBridge.biometricUnlock();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return {
              ok: result.ok !== false,
              password: String(result.password || ""),
              error: String(result.error || ""),
            };
          }
        } catch (_err) {
          return { ok: false, error: "Biometrics unavailable." };
        }
      }
      return { ok: false, error: "Biometrics unavailable." };
    },

    authStatus: async () => {
      await ensureAuthState();
      const rate = checkAuthRateLimit();
      const authenticated = !!(authState.authenticated && activePassword);
      return {
        ...authState,
        authenticated,
        locked: !rate.ok,
        retryAfterMs: rate.ok ? 0 : rate.retryAfterMs,
      };
    },
    authLock: async () => {
      await ensureAuthState();
      authState.authenticated = false;
      activePassword = null;
      return { ok: true };
    },
    authSetup: async (password) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok)
        return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safePassword = String(password || "");
      if (!safePassword) return { ok: false, error: "Password is required." };
      if (!tauriBridge || typeof tauriBridge.authSetup !== "function") {
        return { ok: false, error: "Auth unavailable." };
      }
      const created = await tauriBridge.authSetup({
        password: safePassword,
        iterations: 200000,
      });
      if (!created || !created.salt || !created.hash) {
        return { ok: false, error: "Unable to configure authentication." };
      }
      authState = { configured: true, authenticated: true };
      authStateLoaded = true;
      activePassword = safePassword;
      recordAuthSuccess();
      return { ok: true };
    },
    authLogin: async (password) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok)
        return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safePassword = String(password || "");
      if (!safePassword) return { ok: false, error: "Password is required." };
      if (!tauriBridge || typeof tauriBridge.authVerify !== "function") {
        return { ok: false, error: "Auth unavailable." };
      }
      const valid = await tauriBridge.authVerify({ password: safePassword });
      if (!valid) {
        recordAuthFailure();
        return { ok: false, error: "Invalid password." };
      }
      authState.authenticated = true;
      authStateLoaded = true;
      activePassword = safePassword;
      recordAuthSuccess();
      return { ok: true };
    },
    authChange: async (current, next) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok)
        return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safeCurrent = String(current || "");
      const safeNext = String(next || "");
      if (!safeCurrent || !safeNext) return { ok: false, error: "Missing password." };
      if (!tauriBridge || typeof tauriBridge.authChange !== "function") {
        return { ok: false, error: "Auth unavailable." };
      }
      const changed = await tauriBridge.authChange({
        current: safeCurrent,
        next: safeNext,
        iterations: 200000,
      });
      if (!changed) {
        recordAuthFailure();
        return { ok: false, error: "Invalid password." };
      }
      activePassword = safeNext;
      authState.authenticated = true;
      authStateLoaded = true;
      recordAuthSuccess();
      return { ok: true };
    },

    kanbanGet: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanGet !== "function")
        return { columns: [], cards: [] };
      const result = await tauriBridge.dbKanbanGet(activePassword);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return {
          columns: Array.isArray(result.columns) ? result.columns : [],
          cards: Array.isArray(result.cards) ? result.cards : [],
        };
      }
      return { columns: [], cards: [] };
    },
    kanbanAddColumn: async (name) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanAddColumn !== "function") {
        return { ok: false, error: "Column name is required.", columns: [] };
      }
      const result = await tauriBridge.dbKanbanAddColumn({
        password: activePassword,
        name: String(name || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const columns = Array.isArray(result.columns) ? result.columns : [];
        if (result.ok === false) {
          return { ok: false, error: result.error || "Column name is required.", columns };
        }
        return { ok: true, columns };
      }
      return { ok: false, error: "Column name is required.", columns: [] };
    },
    kanbanRemoveColumn: async (columnId) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanRemoveColumn !== "function") {
        return { ok: false, error: "Missing column.", columns: [], cards: [] };
      }
      const result = await tauriBridge.dbKanbanRemoveColumn({
        password: activePassword,
        columnId: String(columnId || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const columns = Array.isArray(result.columns) ? result.columns : [];
        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (result.ok === false) {
          return {
            ok: false,
            error: result.error || "",
            message: result.message || "",
            columns,
            cards,
          };
        }
        return { ok: true, columns, cards, undoId: result.undoId || null };
      }
      return { ok: false, error: "Missing column.", columns: [], cards: [] };
    },
    kanbanAddCard: async (payload) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanAddCard !== "function") {
        return { ok: false, error: "Invalid column." };
      }
      const result = await tauriBridge.dbKanbanAddCard({
        password: activePassword,
        payload: payload || {},
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return { ok: false, error: result.error || "Invalid column." };
        }
        return {
          ok: true,
          card: result.card && typeof result.card === "object" ? result.card : null,
        };
      }
      return { ok: false, error: "Invalid column." };
    },
    kanbanUpdateCard: async (id, payload) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanUpdateCard !== "function")
        return { cards: [] };
      const result = await tauriBridge.dbKanbanUpdateCard({
        password: activePassword,
        id: String(id || ""),
        payload: payload || {},
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const cards = Array.isArray(result.cards) ? result.cards : [];
        return { cards };
      }
      return { cards: [] };
    },
    piiGet: async (candidateId) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbPiiGet !== "function") {
        return { row: {}, candidateName: "" };
      }
      const result = await tauriBridge.dbPiiGet({
        password: activePassword,
        candidateId: String(candidateId || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const row =
          result.row && typeof result.row === "object" && !Array.isArray(result.row)
            ? result.row
            : {};
        return {
          row,
          candidateName: String(result.candidateName || row["Candidate Name"] || ""),
        };
      }
      return { row: {}, candidateName: "" };
    },
    piiSave: async (candidateId, data) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbPiiSave !== "function") return false;
      const ok = await tauriBridge.dbPiiSave({
        password: activePassword,
        candidateId: String(candidateId || ""),
        data: data || {},
      });
      return !!ok;
    },
    kanbanProcessCandidate: async ({ candidateId, arrival, departure, branch }) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanProcessCandidate !== "function") {
        return { ok: false, message: "Missing candidate." };
      }
      const result = await tauriBridge.dbKanbanProcessCandidate({
        password: activePassword,
        candidateId: String(candidateId || ""),
        arrival: String(arrival || ""),
        departure: String(departure || ""),
        branch: String(branch || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (result.ok === false) {
          return { ok: false, message: result.message || "Unable to process candidate." };
        }
        return { ok: true, cards, undoId: result.undoId || null };
      }
      return { ok: false, message: "Unable to process candidate." };
    },
    kanbanRemoveCandidate: async (candidateId) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanRemoveCandidate !== "function") {
        return { ok: false, message: "Missing candidate." };
      }
      const result = await tauriBridge.dbKanbanRemoveCandidate({
        password: activePassword,
        candidateId: String(candidateId || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const columns = Array.isArray(result.columns) ? result.columns : [];
        const cards = Array.isArray(result.cards) ? result.cards : [];
        if (result.ok === false) {
          return { ok: false, message: result.message || "Missing candidate." };
        }
        return { ok: true, columns, cards, undoId: result.undoId || null };
      }
      return { ok: false, message: "Missing candidate." };
    },
    kanbanReorderColumn: async (columnId, cardIds) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbKanbanReorderColumn !== "function") {
        return { cards: [] };
      }
      const result = await tauriBridge.dbKanbanReorderColumn({
        password: activePassword,
        columnId: String(columnId || ""),
        cardIds: Array.isArray(cardIds) ? cardIds : [],
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        const cards = Array.isArray(result.cards) ? result.cards : [];
        return { cards };
      }
      return { cards: [] };
    },

    weeklyGet: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbWeeklyGet !== "function") return null;
      const now = new Date();
      const weekday = (now.getDay() + 6) % 7;
      const weekStart = new Date(now);
      if (weekday >= 4) {
        weekStart.setDate(now.getDate() - (weekday - 4));
      } else {
        weekStart.setDate(now.getDate() - (weekday + 3));
      }
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const toIso = (d) => d.toISOString().slice(0, 10);
      const weekStartIso = toIso(weekStart);
      const weekEndIso = toIso(weekEnd);
      const week = await tauriBridge.dbWeeklyGet({
        password: activePassword,
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
      });
      if (week && typeof week === "object" && !Array.isArray(week)) {
        return {
          week_start: String(week.week_start || weekStartIso),
          week_end: String(week.week_end || weekEndIso),
          entries: week.entries || {},
        };
      }
      return null;
    },
    weeklySave: async (entries) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbWeeklySet !== "function") return false;
      const now = new Date();
      const weekday = (now.getDay() + 6) % 7;
      const weekStart = new Date(now);
      if (weekday >= 4) {
        weekStart.setDate(now.getDate() - (weekday - 4));
      } else {
        weekStart.setDate(now.getDate() - (weekday + 3));
      }
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const toIso = (d) => d.toISOString().slice(0, 10);
      const weekStartIso = toIso(weekStart);
      const weekEndIso = toIso(weekEnd);
      const ok = await tauriBridge.dbWeeklySet({
        password: activePassword,
        weekStart: weekStartIso,
        weekEnd: weekEndIso,
        entries: entries || {},
      });
      return !!ok;
    },
    weeklySummary: async () => {
      requireAuth();
      if (!tauriBridge) return null;
      const now = new Date();
      const weekday = (now.getDay() + 6) % 7;
      const weekStart = new Date(now);
      if (weekday >= 4) {
        weekStart.setDate(now.getDate() - (weekday - 4));
      } else {
        weekStart.setDate(now.getDate() - (weekday + 3));
      }
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const toIso = (d) => d.toISOString().slice(0, 10);
      const weekStartIso = toIso(weekStart);
      const weekEndIso = toIso(weekEnd);
      if (typeof tauriBridge.dbWeeklySummarySave === "function") {
        const saved = await tauriBridge.dbWeeklySummarySave({
          password: activePassword,
          weekStart: weekStartIso,
          weekEnd: weekEndIso,
        });
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
          if (saved.ok || saved.canceled) {
            return {
              saved: true,
              canceled: !!saved.canceled,
              filename: String(saved.filename || `Weekly_${weekStartIso}_Summary.md`),
            };
          }
        }
      }
      if (typeof tauriBridge.dbWeeklySummary === "function") {
        const summary = await tauriBridge.dbWeeklySummary({
          password: activePassword,
          weekStart: weekStartIso,
          weekEnd: weekEndIso,
        });
        if (summary && typeof summary === "object" && !Array.isArray(summary)) {
          return {
            filename: String(summary.filename || `Weekly_${weekStartIso}_Summary.md`),
            content: String(summary.content || ""),
          };
        }
      }
      return null;
    },

    dashboardGet: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbDashboardGet !== "function") {
        return { kanban: { columns: [], cards: [] }, todos: [] };
      }
      const snapshot = await tauriBridge.dbDashboardGet(activePassword);
      if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
        const kanban =
          snapshot.kanban && typeof snapshot.kanban === "object" ? snapshot.kanban : {};
        const columns = Array.isArray(kanban.columns) ? kanban.columns : [];
        const cards = Array.isArray(kanban.cards) ? kanban.cards : [];
        const todos = Array.isArray(snapshot.todos) ? snapshot.todos : [];
        return { kanban: { columns, cards }, todos };
      }
      return { kanban: { columns: [], cards: [] }, todos: [] };
    },

    todosGet: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbTodosGet !== "function") return [];
      const rawTodos = await tauriBridge.dbTodosGet(activePassword);
      return Array.isArray(rawTodos) ? rawTodos : [];
    },
    todosSave: async (todos) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbTodosSet !== "function") return false;
      const ok = await tauriBridge.dbTodosSet(activePassword, Array.isArray(todos) ? todos : []);
      return !!ok;
    },

    emailTemplatesGet: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.emailTemplatesGetRaw !== "function") {
        return { ok: false, templates: {}, customTypes: {}, customTokens: {} };
      }
      const raw = await tauriBridge.emailTemplatesGetRaw();
      const templates =
        raw && raw.templates && typeof raw.templates === "object" ? raw.templates : {};
      const customTypes =
        raw && raw.customTypes && typeof raw.customTypes === "object" ? raw.customTypes : {};
      const customTokens =
        raw && raw.customTokens && typeof raw.customTokens === "object" ? raw.customTokens : {};
      return { ok: true, templates, customTypes, customTokens };
    },
    emailTemplatesSave: async (payload) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.emailTemplatesSetRaw !== "function") {
        return { ok: false, templates: {}, customTypes: {}, customTokens: {} };
      }
      const saved = {
        version: 1,
        updated_at: new Date().toISOString(),
        templates:
          payload && payload.templates && typeof payload.templates === "object"
            ? payload.templates
            : {},
        customTypes:
          payload && payload.customTypes && typeof payload.customTypes === "object"
            ? payload.customTypes
            : {},
        customTokens:
          payload && payload.customTokens && typeof payload.customTokens === "object"
            ? payload.customTokens
            : {},
      };
      const ok = await tauriBridge.emailTemplatesSetRaw(saved);
      return {
        ok: !!ok,
        templates: saved.templates || {},
        customTypes: saved.customTypes || {},
        customTokens: saved.customTokens || {},
      };
    },

    uniformsAddItem: async (payload) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbUniformsAddItem !== "function") {
        return { ok: false, error: "Unable to add uniform inventory." };
      }
      const result = await tauriBridge.dbUniformsAddItem({
        password: activePassword,
        payload: payload || {},
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return { ok: false, error: result.error || "Unable to add uniform inventory." };
        }
        return {
          ok: true,
          row: result.row && typeof result.row === "object" ? result.row : null,
        };
      }
      return { ok: false, error: "Unable to add uniform inventory." };
    },

    dbSources: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbSources !== "function") {
        return { sources: [], activeId: "current" };
      }
      const result = await tauriBridge.dbSources(activePassword);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return {
          sources: Array.isArray(result.sources) ? result.sources : [],
          activeId: result.activeId || "current",
        };
      }
      return { sources: [], activeId: "current" };
    },
    dbSetSource: async (sourceId) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbSetSource !== "function") {
        return { ok: false, activeId: "current" };
      }
      const result = await tauriBridge.dbSetSource({
        password: activePassword,
        sourceId: String(sourceId || "current"),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return { ok: result.ok !== false, activeId: result.activeId || "current" };
      }
      return { ok: false, activeId: "current" };
    },
    dbListTables: async (sourceId) => {
      requireAuth();
      const safeSourceId = sourceId || "current";
      if (!tauriBridge) return [];
      if (typeof tauriBridge.dbListTablesSource === "function") {
        const tables = await tauriBridge.dbListTablesSource({
          password: activePassword,
          sourceId: safeSourceId,
        });
        return Array.isArray(tables) ? tables : [];
      }
      if (safeSourceId === "current" && typeof tauriBridge.dbListTables === "function") {
        const tables = await tauriBridge.dbListTables(activePassword);
        return Array.isArray(tables) ? tables : [];
      }
      return [];
    },
    dbGetTable: async (tableId, sourceId) => {
      requireAuth();
      const safeTableId = String(tableId || "");
      const safeSourceId = sourceId || "current";
      if (!tauriBridge) return { id: safeTableId, name: "Unknown", columns: [], rows: [] };
      if (typeof tauriBridge.dbGetTableSource === "function") {
        const table = await tauriBridge.dbGetTableSource({
          password: activePassword,
          sourceId: safeSourceId,
          tableId: safeTableId,
        });
        if (table && typeof table === "object" && !Array.isArray(table)) {
          return {
            id: safeTableId,
            name: table.name || "Unknown",
            columns: Array.isArray(table.columns) ? table.columns : [],
            rows: Array.isArray(table.rows) ? table.rows : [],
          };
        }
      }
      if (safeSourceId === "current" && typeof tauriBridge.dbGetTable === "function") {
        const table = await tauriBridge.dbGetTable({
          password: activePassword,
          tableId: safeTableId,
        });
        if (table && typeof table === "object" && !Array.isArray(table)) {
          return {
            id: safeTableId,
            name: table.name || "Unknown",
            columns: Array.isArray(table.columns) ? table.columns : [],
            rows: Array.isArray(table.rows) ? table.rows : [],
          };
        }
      }
      return { id: safeTableId, name: "Unknown", columns: [], rows: [] };
    },
    dbDeleteRows: async (tableId, rowIds, sourceId) => {
      requireAuth();
      if (sourceId && sourceId !== "current") {
        return { ok: false, error: "Read-only database." };
      }
      if (!tauriBridge || typeof tauriBridge.dbDeleteRows !== "function") {
        return { ok: false, error: "Invalid table." };
      }
      const result = await tauriBridge.dbDeleteRows({
        password: activePassword,
        tableId: String(tableId || ""),
        rowIds: Array.isArray(rowIds) ? rowIds : [],
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return {
            ok: false,
            error: result.error || "Invalid table.",
            message: result.message || "",
          };
        }
        return { ok: true, undoId: result.undoId || null };
      }
      return { ok: false, error: "Invalid table." };
    },
    dbExportCsv: async (payload) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbExportCsv !== "function") {
        return { ok: false, error: "Export unavailable." };
      }
      const { tableId, tableName, columns, rows } = payload || {};
      const baseName = String(tableName || tableId || "table") || "table";
      const filename = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
      const result = await tauriBridge.dbExportCsv({
        filename,
        columns: Array.isArray(columns) ? columns : [],
        rows: Array.isArray(rows) ? rows : [],
      });
      if (result && result.ok) {
        return { ok: true, filename: result.filename || filename };
      }
      if (result && result.canceled) {
        return { ok: true, canceled: true, filename };
      }
      return { ok: false, error: "Export failed." };
    },

    dbImportPick: async () => {
      requireAuth();
      if (tauriBridge && typeof tauriBridge.pickTextFile === "function") {
        const result = await tauriBridge.pickTextFile();
        if (result && (result.ok || result.canceled)) return result;
      }
      return { ok: false, canceled: true };
    },
    dbImportApply: async ({ action, fileName, fileData, password } = {}) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbImportApply !== "function") {
        return { ok: false, code: "broken", error: "Import unavailable." };
      }
      const safeAction = String(action || "").toLowerCase();
      if (!["append", "view", "replace"].includes(safeAction)) {
        return { ok: false, code: "broken", error: "Invalid import action." };
      }
      const result = await tauriBridge.dbImportApply({
        action: safeAction,
        fileName: String(fileName || ""),
        fileData: String(fileData || ""),
        password: String(password || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return {
            ok: false,
            code: String(result.code || "broken") || "broken",
            error: String(result.error || "Unable to import file."),
          };
        }
        return {
          ok: true,
          action: String(result.action || safeAction).toLowerCase(),
          viewId: result.viewId || null,
          viewName: result.viewName || null,
        };
      }
      return { ok: false, code: "broken", error: "Import unavailable." };
    },
    dbValidateCurrent: async () => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbValidateCurrent !== "function") {
        return { ok: false, code: "broken", message: "Validation unavailable." };
      }
      const result = await tauriBridge.dbValidateCurrent(activePassword);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        return {
          ok: !!result.ok,
          code: String(result.code || ""),
          message: String(result.message || ""),
        };
      }
      return { ok: false, code: "broken", message: "Validation unavailable." };
    },

    recycleUndo: async (id) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbRecycleUndo !== "function") {
        return { ok: false, error: "Nothing to undo." };
      }
      const result = await tauriBridge.dbRecycleUndo({
        password: activePassword,
        id: String(id || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return { ok: false, error: result.error || "Nothing to undo." };
        }
        return { ok: true, redoId: result.redoId || null };
      }
      return { ok: false, error: "Nothing to undo." };
    },
    recycleRedo: async (id) => {
      requireAuth();
      if (!tauriBridge || typeof tauriBridge.dbRecycleRedo !== "function") {
        return { ok: false, error: "Nothing to redo." };
      }
      const result = await tauriBridge.dbRecycleRedo({
        password: activePassword,
        id: String(id || ""),
      });
      if (result && typeof result === "object" && !Array.isArray(result)) {
        if (result.ok === false) {
          return { ok: false, error: result.error || "Nothing to redo." };
        }
        return { ok: true, undoId: result.undoId || null };
      }
      return { ok: false, error: "Nothing to redo." };
    },

    donate: async () => {
      if (tauriBridge && typeof tauriBridge.donate === "function") {
        try {
          const result = await tauriBridge.donate();
          if (result && typeof result === "object" && !Array.isArray(result)) {
            return { ok: result.ok !== false, message: String(result.message || "") };
          }
        } catch (_err) {
          return { ok: false, message: "Billing unavailable." };
        }
      }
      return { ok: false, message: "Billing unavailable." };
    },
    clipboardWrite: async (text) => {
      if (tauriBridge && typeof tauriBridge.clipboardWrite === "function") {
        try {
          return !!(await tauriBridge.clipboardWrite(String(text || "")));
        } catch (_err) {
          return false;
        }
      }
      return false;
    },
    openExternal: async (url) => {
      if (tauriBridge && typeof tauriBridge.openExternal === "function") {
        try {
          return !!(await tauriBridge.openExternal(String(url || "")));
        } catch (_err) {
          return false;
        }
      }
      return false;
    },
    openEmailDraft: async ({ filename, content }) => {
      if (tauriBridge && typeof tauriBridge.openEmailDraft === "function") {
        try {
          return !!(await tauriBridge.openEmailDraft({
            filename: String(filename || ""),
            content: String(content || ""),
          }));
        } catch (_err) {
          return false;
        }
      }
      return false;
    },
    saveEmailFile: async ({ filename, content }) => {
      const safeFilename = String(filename || "email-draft.eml");
      const safeContent = String(content || "");
      if (tauriBridge && typeof tauriBridge.saveCsvFile === "function") {
        try {
          const result = await tauriBridge.saveCsvFile({
            filename: safeFilename,
            content: safeContent,
          });
          if (result && result.ok) {
            return { ok: true, canceled: false, filename: safeFilename, path: result.path || null };
          }
          if (result && result.canceled) {
            return { ok: false, canceled: true, filename: safeFilename, path: null };
          }
          return {
            ok: false,
            canceled: false,
            filename: safeFilename,
            path: null,
            error: result && result.error ? String(result.error) : "Unable to save email.",
          };
        } catch (_err) {
          return {
            ok: false,
            canceled: false,
            filename: safeFilename,
            path: null,
            error: "Unable to save email.",
          };
        }
      }
      try {
        const blob = new Blob([safeContent], { type: "message/rfc822;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = safeFilename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return { ok: true, canceled: false, filename: safeFilename, path: null };
      } catch (_err) {
        return {
          ok: false,
          canceled: false,
          filename: safeFilename,
          path: null,
          error: "Unable to save email.",
        };
      }
    },
  };

  window.workflowApi = api;
}
