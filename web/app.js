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
  removed: {
    list: [],
  },
};

const apiFetch = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  const headers = options.headers || {};
  let body = options.body;

  if (typeof body === "string" && headers && String(headers["Content-Type"] || headers["content-type"] || "").includes("application/json")) {
    try {
      body = JSON.parse(body);
    } catch (e) {
      // leave as string
    }
  }

  // Option B: IPC-based API when running inside Electron.
  if (window.electronAPI && typeof window.electronAPI.apiRequest === "function") {
    const result = await window.electronAPI.apiRequest({
      method,
      url,
      headers,
      body,
    });

    // Avoid deadlocking auth flows: auth endpoints themselves may return 401
    // (e.g. invalid password). If we call showAuthModal() here, we'll re-enter
    // the modal while already awaiting auth completion.
    const isAuthEndpoint = typeof url === 'string' && url.startsWith('/api/auth/');
    if (!isAuthEndpoint && result && result.status === 401) {
      await showAuthModal();
      throw new Error("Unauthorized");
    }

    return {
      ok: Boolean(result && result.ok),
      status: result ? result.status : 500,
      json: async () => {
        if (result && result.ok) {
          return result.data || {};
        }
        const detail = (result && (result.error || result.detail)) ? String(result.error || result.detail) : 'Request failed';
        return { detail };
      },
      text: async () => {
        if (result && result.ok) {
          return JSON.stringify(result.data || {});
        }
        const detail = (result && (result.error || result.detail)) ? String(result.error || result.detail) : 'Request failed';
        return JSON.stringify({ detail });
      },
    };
  }

  const response = await fetch(url, options);
  const isAuthEndpoint = typeof url === 'string' && url.startsWith('/api/auth/');
  if (!isAuthEndpoint && response.status === 401) {
    await showAuthModal();
    throw new Error("Unauthorized");
  }
  return response;
};

const downloadBlob = (filename, blob) => {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const setTheme = (theme) => {
  document.body.dataset.theme = theme;
  localStorage.setItem("workflow-theme", theme);
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  }
};

// Desktop/Electron startup: prompt for auth immediately and then load app.
document.addEventListener('DOMContentLoaded', () => {
  const mainAuthModal = document.getElementById('auth-modal');
  if (!mainAuthModal) {
    return;
  }

  (async () => {
    try {
      const authed = await showAuthModal();
      if (!authed) return;
      await fetchSchema();
      await loadData();
      switchPage('dashboard');
    } catch (err) {
      console.error('Startup auth failed:', err);
    }
  })();
});

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

/* Minimal i18n: load simple JSON locales from /static/locales/<lang>.json */
const I18N = { locale: 'en', messages: {} };
const t = (key, fallback) => {
  const locale = I18N.locale || 'en';
  const parts = key.split('.');
  let cur = I18N.messages[locale] || I18N.messages['en'] || {};
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return fallback !== undefined ? fallback : key;
    }
  }
  return cur;
};

async function initI18n() {
  try {
    const response = await fetch(`./locales/${I18N.locale}.json`);
    if (response.ok) {
      I18N.messages[I18N.locale] = await response.json();
    } else {
      I18N.messages[I18N.locale] = {};
    }
  } catch (e) {
    I18N.messages[I18N.locale] = {};
  }
}

// Initialize i18n after I18N is defined to avoid temporal-dead-zone errors
initI18n();

// Add show/hide toggles to all password fields (including dynamically inserted ones)
const initPasswordToggles = () => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = "1";
    const wrapper = document.createElement('div');
    wrapper.className = 'password-wrapper';
    // Replace input with wrapper -> input inside wrapper
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.title = 'Show password';
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = 'Show';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.title = show ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
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

const DETAILS_FIELDS = [
  { label: "Branch", key: "Branch" },
  { label: "Manager", key: "Manager Name" },
  { label: "Job Location", key: "Job Location" },
  { label: "NEO Date", key: "NEO Scheduled Date" },
  { label: "Background Complete", key: "Background Completion Date" },
  { label: "Employee ID", key: "Employee ID" },
  { label: "ICIMS ID", key: "ICIMS ID" },
  { label: "CORI Status", key: "CORI Status" },
  { label: "NH GC Status", key: "NH GC Status" },
  { label: "ME GC Status", key: "ME GC Status" },
  { label: "DOD Clearance", key: "DOD Clearance" },
];

const FORM_LAYOUT = [
  {
    title: "Candidate Details",
    fields: [
      "ICIMS ID",
      "Employee ID",
      "Job Name",
      "Job Location", 
      "Manager Name",
      "Branch",
      "Scheduled",
      "NEO Scheduled Date",
      { type: "title", text: "Emergency Contact" },
      "EC First Name",
      "EC Last Name", 
      "EC Relationship",
      "EC Phone Number",
      { type: "title", text: "Bank Info" },
      "Bank Name",
      "Routing Number",
      "Account Number",
      "Deposit Account Type",
    ],
  },
  {
    title: "Background & Clearance",
    fields: [
      "Background Completion Date",
      "CORI Status",
      "CORI Submit Date", 
      "CORI Cleared Date",
      "NH GC Status",
      "NH GC ID Number",
      "ME GC Status",
      "ME GC Sent Date",
      "MVR",
      "DOD Clearance",
    ],
  },
  {
    title: "Uniforms & Sizing",
    fields: [
      "Shirt Size",
      "Pants Size", 
      "Boots",
    ],
  },
  {
    title: "Personal ID",
    fields: ["Other ID", "State", "ID No.", "DOB", "Social"],
  },
  {
    title: "Additional Notes",
    fields: ["Notes"],
  },
];

const updateCardSelection = () => {
  document.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("card--active", card.dataset.uid === state.activeUid);
  });
};

const findCardInfo = (uid) => {
  if (!uid) return null;
  const targetUid = String(uid);
  return Object.values(state.columns)
    .flat()
    .find((item) => String(item.uid ?? "") === targetUid);
};

const findPersonByUid = (uid) => {
  if (!uid) return null;
  const targetUid = String(uid);
  return (
    state.people.find((item) => String(item.uid ?? item.id ?? "") === targetUid) || null
  );
};

// ============================================================================
// FLYOUT PANEL SYSTEM (core definitions — must be before updateDetailsPanel)
// ============================================================================
const FLYOUT_PANELS = {
  details: 'details-panel',
  weekly: 'weekly-panel',
  todo: 'todo-panel',
};

state.flyoutPanel = null;
state.todos = { list: [] };

const _hideFlyoutPanel = (panelEl) => {
  if (!panelEl) return;
  panelEl.classList.add('details--hidden');
  panelEl.setAttribute('aria-hidden', 'true');
};

const _showFlyoutPanel = (panelEl) => {
  if (!panelEl) return;
  const board = document.querySelector('#page-dashboard .board');
  if (board) {
    const boardRect = board.getBoundingClientRect();
    panelEl.style.setProperty('--details-top', `${boardRect.top}px`);
  }
  panelEl.classList.remove('details--hidden');
  panelEl.setAttribute('aria-hidden', 'false');
};

const FLYOUT_TRANSITION_MS = 350;

const updateDetailsPanel = () => {
  const app = document.querySelector(".app");
  const panel = document.getElementById("details-panel");
  const title = document.getElementById("details-title");
  const subtitle = document.getElementById("details-subtitle");
  const status = document.getElementById("details-status");
  const body = document.getElementById("details-body");
  const notes = document.getElementById("details-notes");

  // Determine if we should show the panel
  // We only rely on state.activeUid being present.
  const person = state.activeUid ? findPersonByUid(state.activeUid) : null;
  const cardInfo = findCardInfo(state.activeUid);
  const showPanel = state.page === "dashboard" && !!person;

  if (panel) {
    if (showPanel) {
      // If another flyout panel is open, hide it first then show details
      if (state.flyoutPanel && state.flyoutPanel !== 'details') {
        const currentEl = document.getElementById(FLYOUT_PANELS[state.flyoutPanel]);
        if (currentEl) _hideFlyoutPanel(currentEl);
        state.flyoutPanel = 'details';
        setTimeout(() => {
          _showFlyoutPanel(panel);
        }, FLYOUT_TRANSITION_MS);
      } else {
        state.flyoutPanel = 'details';
        _showFlyoutPanel(panel);
      }
    } else {
      _hideFlyoutPanel(panel);
      if (state.flyoutPanel === 'details') {
        state.flyoutPanel = null;
      }
    }
  }
  if (app) {
    app.classList.toggle("app--details-hidden", !showPanel);
  }

  // If we are hiding the panel, return early to preserve DOM for animation
  if (!showPanel) {
    return;
  }

  if (title) {
    title.textContent = person.Name || cardInfo?.name || "Candidate Details";
    // Check for existing status element in title area or create it
    let statusEl = document.getElementById('details-status-inline');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'details-status-inline';
      statusEl.className = 'details__status-inline';
      // Insert after title
      title.parentNode.insertBefore(statusEl, title.nextSibling);
    }

    // Status logic
    const statusText = cardInfo?.status || "";
    // Only show if scheduled (starts with NEO:)
    const isNeo = statusText.toLowerCase().startsWith("neo:");

    if (isNeo) {
      statusEl.textContent = statusText;
      statusEl.className = `details__status-inline ${badgeClass(cardInfo?.badge || "warning")}`;
      statusEl.style.display = "inline-flex";

      // Clickable NEO actions
      statusEl.style.cursor = "pointer";
      statusEl.title = "Click for NEO actions";
      statusEl.onclick = (e) => {
        e.stopPropagation();
        showNeoModal(person?.uid);
      };
    } else {
      statusEl.style.display = "none";
    }
  }

  if (subtitle) {
    // Moved metadata logic to Body construction to ensure proper state access if needed,
    // or we can simply clear it here if it's being repurposed.
    // We will update it in the main body flow logic above or just keep it here.
    // Actually, let's keep it but just empty for now, as we set it below in the main flow?
    // The previous code had it here.
    // The request implies it's a fixed header part.
    // "Location Manager Branch"
  }

  // Remove the old independent status element if it exists in DOM
  if (status) {
    status.style.display = "none";
  }

  if (body) {
    body.innerHTML = "";

    // Subtitle: location / manager / branch metadata
    if (subtitle) {
      const metaParts = [person["Job Location"], cardInfo?.manager, person["Branch"]].filter(Boolean);
      subtitle.textContent = metaParts.join(" \u2022 ");
      subtitle.className = "details__meta";
    }

    // Helper: check if a value is meaningful (non-empty, non-placeholder)
    const hasValue = (key) => {
      const v = person[key];
      if (v === null || v === undefined) return false;
      const s = String(v).trim();
      if (!s) return false;
      const lower = s.toLowerCase();
      const empty = new Set(['none', 'n/a', 'na', 'false', 'no', 'no date', '\u2014', '-']);
      return !empty.has(lower);
    };

    const displayVal = (key) => {
      const v = person[key];
      if (v === null || v === undefined) return "";
      return String(v).trim();
    };

    // Build a label/value row (full-width single column)
    const makeKV = (label, value) => {
      const row = document.createElement("div");
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      row.className = `details__kv details__kv--${slug}`;

      const labelEl = document.createElement("div");
      labelEl.className = "details__kv-label";
      labelEl.textContent = label;

      const valEl = document.createElement("div");
      valEl.className = "details__kv-value";

      if (label.toLowerCase().includes("email") && value) {
        const a = document.createElement("a");
        a.href = `mailto:${value}`;
        a.textContent = value;
        a.style.color = "inherit";
        a.style.textDecoration = "underline";
        valEl.appendChild(a);
      } else {
        valEl.textContent = value;
      }

      row.appendChild(labelEl);
      row.appendChild(valEl);
      return row;
    };

    // Build sections from FORM_LAYOUT — only show fields that have data
    for (const section of FORM_LAYOUT) {
      // Collect rows for this section first, then only render if any exist
      const rows = [];

      for (const field of section.fields) {
        // Sub-title markers (e.g. { type: "title", text: "Emergency Contact" })
        if (typeof field === "object" && field.type === "title") {
          // We'll insert sub-headers only if subsequent fields have data
          rows.push({ type: "sub-header", text: field.text });
          continue;
        }

        const fieldName = typeof field === "string" ? field : field.name;
        if (!fieldName || fieldName === "uid") continue;

        if (hasValue(fieldName)) {
          rows.push({ type: "kv", label: fieldName, value: displayVal(fieldName) });
        }
      }

      // For the first section, also check contact fields
      if (section === FORM_LAYOUT[0]) {
        const phoneKey = hasValue("Candidate Phone Number") ? "Candidate Phone Number" : "Candidate Phone";
        const emailKey = hasValue("Candidate Email") ? "Candidate Email" : "Email";
        if (hasValue(phoneKey)) rows.push({ type: "kv", label: "Phone", value: displayVal(phoneKey) });
        if (hasValue(emailKey)) rows.push({ type: "kv", label: "Email", value: displayVal(emailKey) });
      }

      // Filter: only keep sub-headers that are followed by at least one KV row
      const filteredRows = [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].type === "sub-header") {
          // Check if any KV row follows before the next sub-header or end
          const hasFollowing = rows.slice(i + 1).some(r => r.type === "kv");
          if (hasFollowing) filteredRows.push(rows[i]);
        } else {
          filteredRows.push(rows[i]);
        }
      }

      // Only render section if it has at least one KV row
      const kvRows = filteredRows.filter(r => r.type === "kv");
      if (kvRows.length === 0) continue;

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "details__section-title";
      sectionHeader.textContent = section.title;
      body.appendChild(sectionHeader);

      for (const row of filteredRows) {
        if (row.type === "sub-header") {
          const subHeader = document.createElement("div");
          subHeader.className = "details__section-title details__section-title--sub";
          subHeader.textContent = row.text;
          body.appendChild(subHeader);
        } else {
          body.appendChild(makeKV(row.label, row.value));
        }
      }

      const sep = document.createElement("div");
      sep.className = "details__section-sep";
      body.appendChild(sep);
    }
  }

  if (notes) {
    const noteValue = (person.Notes || "").trim();
    notes.textContent = noteValue;
    notes.style.display = noteValue ? "block" : "none";
  }
};

const selectCandidate = (uid) => {
  const nextUid = uid ? String(uid) : null;
  state.activeUid = state.activeUid && nextUid && String(state.activeUid) === nextUid ? null : nextUid;
  updateCardSelection();
  updateDetailsPanel();
};

/* --- NEO action modal helpers --- */
const showNeoModal = (uid) => {
  const modal = document.getElementById("neo-modal");
  if (!modal) return;
  modal.dataset.uid = uid ? String(uid) : "";
  const person = findPersonByUid(uid) || {};
  const nameEl = document.getElementById("neo-name");
  const dateEl = document.getElementById("neo-date");
  if (nameEl) nameEl.textContent = person.Name || person.name || "Unnamed";
  const cardInfo = findCardInfo(uid);
  if (dateEl) dateEl.textContent = person["NEO Scheduled Date"] || cardInfo?.date || "—";
  modal.classList.remove("hidden");
};

const hideNeoModal = () => {
  const modal = document.getElementById("neo-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.dataset.uid = "";
};

const neoMoveToInProgress = async () => {
  const modal = document.getElementById("neo-modal");
  if (!modal) return;
  const uid = modal.dataset.uid;
  if (!uid) return hideNeoModal();
  const response = await apiFetch(`/api/people/${uid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ "Onboarding Status": "In Progress" }),
  });
  if (!response.ok) {
    alert("Unable to update onboarding status.");
    return;
  }
  hideNeoModal();
  loadData();
};

const neoRemoveCandidate = async () => {
  const modal = document.getElementById("neo-modal");
  if (!modal) return;
  const uid = modal.dataset.uid;
  if (!uid) return hideNeoModal();
  if (!confirm("Remove this candidate?")) return;
  const response = await apiFetch(`/api/people/${uid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Removed: true }),
  });
  if (!response.ok) {
    alert("Unable to remove candidate.");
    return;
  }
  hideNeoModal();
  state.activeUid = null;
  updateCardSelection();
  updateDetailsPanel();
  loadData();
  loadRemovedList();
};

const renderCard = (item) => {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.uid = item.uid || "";
  // DEV: show payload for debugging missing job names
  console.debug('renderCard', { uid: item.uid, name: item.name, job: item.job, manager: item.manager, raw: item });

  const title = document.createElement("div");
  title.className = "card__title";
  title.textContent = item.name;

  // Badge: only show when there's a useful status to display
  if (item.status && item.status.trim()) {
    const badge = document.createElement("span");
    badge.className = badgeClass(item.badge);
    badge.textContent = item.status;
    card.append(title, badge);
  } else {
    card.append(title);
  }

  const meta = document.createElement("div");
  meta.className = "card__meta";

  // Left: job name + manager. Right: NEO date (kept visible)
  const left = document.createElement("div");
  left.className = "card__meta-left";
  const jobSpan = document.createElement("span");
  jobSpan.className = "card__job";
  // fallback to raw person data if server didn't include job
  let jobText = item.job || "";
  if (!jobText && state.people && state.people.length) {
    const p = state.people.find((x) => (x.uid || x.id) === item.uid);
    jobText = (p && (p["Job Name"] || p["Job Location"])) || jobText;
  }
  jobSpan.textContent = jobText || "";

  const managerSpan = document.createElement("span");
  managerSpan.className = "card__manager";
  managerSpan.textContent = item.manager || "";

  // Only show separator when both job and manager are present
  if (jobText && managerSpan.textContent) {
    const sep = document.createElement("span");
    sep.className = "card__sep";
    sep.textContent = " • ";
    left.append(jobSpan, sep, managerSpan);
  } else {
    left.append(jobSpan || managerSpan);
  }

  // no separate date on the subtitle — the status badge shows NEO date
  meta.append(left);
  card.append(meta);
  return card;
};

const renderColumns = (columns) => {
  Object.entries(columns).forEach(([column, items]) => {
    const container = document.getElementById(column);
    if (!container) return;
    container.innerHTML = "";
    items.forEach((item) => {
      const card = renderCard(item);
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCandidate(item.uid);
      });
      container.appendChild(card);
    });
  });
  updateCardSelection();
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
    if (state.activeUid && !state.people.find((item) => item.uid === state.activeUid)) {
      state.activeUid = null;
    }
    updateDetailsPanel();
  } catch (error) {
    renderColumns({});
    state.activeUid = null;
    updateDetailsPanel();
  }
};

const fetchSchema = async () => {
  console.log('Fetching schema...');
  const response = await apiFetch("/api/schema");
  if (!response.ok) throw new Error("Schema unavailable");
  console.log('Schema response received, parsing...');
  state.schema = await response.json();
  console.log('Schema parsed successfully:', state.schema);
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
    console.log('Branch filter populated');
  }
};

const fieldValue = (field, person) => {
  if (!person) return "";
  return person[field] ?? "";
};

const normalizeField = (field) => {
  if (typeof field === "string") {
    return { name: field, label: field };
  }
  return {
    name: field.name,
    label: field.label || field.name,
    placeholder: field.placeholder || "",
  };
};

const getFormatterType = (name = "") => {
  const normalized = String(name).toLowerCase();
  if (normalized.includes("phone")) return "phone";
  if (normalized.includes("exp.") || normalized.includes("expiration") || normalized.includes("dob")) return "date";
  if (normalized.includes("social") || normalized.includes("ssn")) return "ssn";
  if (normalized.includes("state")) return "state";
  return null;
};

const buildField = (field, person) => {
  const wrapper = document.createElement("div");
  wrapper.className = "field";

  const { name, label: labelText, placeholder } = normalizeField(field);
  const label = document.createElement("label");
  label.textContent = labelText;

  let input;
  const codeMap = state.schema?.code_maps?.[name];
  if (name === "Notes") {
    input = document.createElement("textarea");
    input.name = name;
    input.value = fieldValue(name, person);
    if (placeholder) input.placeholder = placeholder;
    wrapper.append(label, input);
    
    addInputFormatting(input, name);
  } else if (field.type === "multiselect") {
    // Hidden select to hold the actual values for form submission
    input = document.createElement("select");
    input.multiple = true;
    input.style.display = "none";
    input.name = name;

    // Custom UI container
    const customContainer = document.createElement("div");
    customContainer.className = "multi-select";

    // Trigger (display box)
    const trigger = document.createElement("div");
    trigger.className = "multi-select__trigger";
    // input styling match
    trigger.className += " input";

    // Dropdown menu
    const menu = document.createElement("div");
    menu.className = "multi-select__menu";
    menu.style.display = "none";

    const selectedValues = new Set((fieldValue(name, person) || "").split(", ").filter(Boolean));

    const updateTriggerText = () => {
      if (selectedValues.size === 0) {
        trigger.textContent = "Select options...";
        trigger.style.color = "var(--muted)";
      } else {
        trigger.textContent = Array.from(selectedValues).join(", ");
        trigger.style.color = "var(--text)";
      }
    };

    // Toggle menu
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = menu.style.display === "block";
      // Close all other instances first (optional, but good practice)
      document.querySelectorAll('.multi-select__menu').forEach(el => el.style.display = 'none');
      menu.style.display = isVisible ? "none" : "block";
    });

    // Close on click outside
    const closeMenu = (e) => {
      if (!customContainer.contains(e.target)) {
        menu.style.display = "none";
      }
    };
    document.addEventListener("click", closeMenu);

    // Populate options
    (field.options || []).forEach((optVal) => {
      // 1. Option for hidden select
      const option = document.createElement("option");
      option.value = optVal;
      option.textContent = optVal;
      if (selectedValues.has(optVal)) {
        option.selected = true;
      }
      input.appendChild(option);

      // 2. Option for custom UI
      const item = document.createElement("div");
      item.className = "multi-select__option";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedValues.has(optVal);

      const itemLabel = document.createElement("span");
      itemLabel.textContent = optVal;

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        cb.checked = !cb.checked;
        if (cb.checked) {
          selectedValues.add(optVal);
          option.selected = true;
        } else {
          selectedValues.delete(optVal);
          option.selected = false;
        }
        updateTriggerText();
      });

      // Prevent check click from bubbling twice if clicking checkbox directly
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) {
          selectedValues.add(optVal);
          option.selected = true;
        } else {
          selectedValues.delete(optVal);
          option.selected = false;
        }
        updateTriggerText();
      });

      item.append(cb, itemLabel);
      menu.appendChild(item);
    });

    updateTriggerText();
    customContainer.append(trigger, menu);
    wrapper.append(label, input, customContainer);
    // Be careful with event listeners leaking on extensive re-renders, 
    // but complexity is low here.
    return wrapper;

  } else if (codeMap) {
    input = document.createElement("select");
    codeMap.forEach(([labelText, value]) => {
      const option = document.createElement("option");
      option.value = labelText;
      option.textContent = labelText;
      const stored = fieldValue(name, person);
      if (labelText === stored || value === stored) {
        option.selected = true;
      }
      input.appendChild(option);
    });
    input.name = name;
    wrapper.append(label, input);
  } else if (name === "Branch" && state.schema?.branches?.length) {
    input = document.createElement("select");
    state.schema.branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch;
      option.textContent = branch;
      if (branch === fieldValue(name, person)) {
        option.selected = true;
      }
      input.appendChild(option);
    });
    input.name = name;
    input.setAttribute("data-field", name);
    wrapper.append(label, input);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.name = name;
    input.value = fieldValue(name, person);
    input.setAttribute("data-field", name);
    
    // Add field-specific attributes for validation and formatting
    if (name.includes("Exp.") || name.includes("Expiration")) {
      input.maxLength = 10;
      input.placeholder = "MM/DD/YYYY";
    } else if (name.includes("DOB")) {
      input.maxLength = 10;
      input.placeholder = "MM/DD/YYYY";
    } else if (name.includes("Social") || name.includes("SSN")) {
      input.maxLength = 11;
      input.placeholder = "###-##-####";
    } else if (name.includes("State")) {
      input.maxLength = 2;
      input.placeholder = "ST";
    } else if (name.includes("Phone")) {
      input.maxLength = 14;
      input.placeholder = "###-###-####";
    }
    
    if (placeholder) input.placeholder = placeholder;
    wrapper.append(label, input);
    
    addInputFormatting(input, name);
  }

  return wrapper;
};

// Input formatting and validation functions
const formatPhoneNumber = (input) => {
  let value = input.value.replace(/\D/g, '');
  if (value.length <= 3) {
    input.value = value;
  } else if (value.length <= 6) {
    input.value = `${value.slice(0, 3)}-${value.slice(3)}`;
  } else {
    input.value = `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6, 10)}`;
  }
};

const formatDate = (input) => {
  let value = input.value.replace(/\D/g, '');
  if (value.length <= 2) {
    input.value = value;
  } else if (value.length <= 4) {
    input.value = `${value.slice(0, 2)}/${value.slice(2)}`;
  } else {
    input.value = `${value.slice(0, 2)}/${value.slice(2, 4)}/${value.slice(4, 8)}`;
  }
};

const formatSSN = (input) => {
  let value = input.value.replace(/\D/g, '');
  if (value.length <= 3) {
    input.value = value;
  } else if (value.length <= 5) {
    input.value = `${value.slice(0, 3)}-${value.slice(3)}`;
  } else {
    input.value = `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5, 9)}`;
  }
};

const formatState = (input) => {
  input.value = input.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2);
};

// Add input event listeners for formatting
const addInputFormatting = (input, name) => {
  const formatter = getFormatterType(name);
  if (!formatter) return;
  input.addEventListener('input', () => {
    if (formatter === "phone") {
      formatPhoneNumber(input);
    } else if (formatter === "date") {
      formatDate(input);
    } else if (formatter === "ssn") {
      formatSSN(input);
    } else if (formatter === "state") {
      formatState(input);
    }
  });
};

// Enhanced form building functions
const createSectionHeader = (title) => {
  const header = document.createElement("div");
  header.className = "edit-card__section edit-card__section--enhanced";
  header.textContent = title;
  return header;
};

const buildEnhancedField = (field, person) => {
  const wrapper = document.createElement("div");
  wrapper.className = "field field--enhanced";
  
  // Create icon container
  const iconContainer = document.createElement("div");
  iconContainer.className = "field__icon";
  iconContainer.textContent = field.icon || "";
  
  // Create field container
  const fieldContainer = document.createElement("div");
  fieldContainer.className = "field__content";
  
  // Create label
  const label = document.createElement("label");
  label.textContent = field.label;
  if (field.required) {
    label.innerHTML += ' <span class="required">*</span>';
  }
  fieldContainer.appendChild(label);
  
  // Create input based on type
  let input;
  if (field.type === "select") {
    input = document.createElement("select");
    // Add select options based on field
    addSelectOptions(input, field);
  } else if (field.type === "multiselect") {
    input = document.createElement("select");
    input.multiple = true;
    const options = field.options || ["MVR", "Amazon", "DOD Clearance"];
    options.forEach(option => {
      const optionEl = document.createElement("option");
      optionEl.value = option;
      optionEl.textContent = option;
      input.appendChild(optionEl);
    });
  } else {
    input = document.createElement("input");
    input.type = getInputType(field.type);
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }
    // Add contextual validation
    addInputValidation(input, field);
  }
  
  input.name = field.name;
  input.value = fieldValue(field.name, person);
  
  fieldContainer.appendChild(input);
  
  // Assemble field
  wrapper.appendChild(iconContainer);
  wrapper.appendChild(fieldContainer);
  
  // Add formatting listener
  addInputFormatting(input, field.name);
  
  return wrapper;
};

const getInputType = (fieldType) => {
  switch (fieldType) {
    case "email": return "email";
    case "phone": return "tel";
    case "date": return "text"; // We'll format dates manually
    case "ssn": return "text";
    case "routing": return "text";
    case "account": return "text";
    case "state": return "text";
    case "id": return "text";
    default: return "text";
  }
};

const addSelectOptions = (select, field) => {
  const options = getSelectOptions(field.name);
  options.forEach(option => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    select.appendChild(optionEl);
  });
};

const getSelectOptions = (fieldName) => {
  switch (fieldName) {
    case "ID Type":
      return [
        { value: "", label: "Select ID Type" },
        { value: "Driver's License", label: "Driver's License" },
        { value: "State ID", label: "State ID" },
        { value: "Passport", label: "Passport" },
        { value: "Military ID", label: "Military ID" },
        { value: "Other", label: "Other" }
      ];
    case "Deposit Account Type":
      return [
        { value: "", label: "Select Account Type" },
        { value: "Checking", label: "Checking" },
        { value: "Savings", label: "Savings" }
      ];
    case "CORI Status":
    case "NH GC Status":
    case "ME GC Status":
    case "BG Check Status":
      return [
        { value: "", label: "Select Status" },
        { value: "Not Started", label: "Not Started" },
        { value: "In Progress", label: "In Progress" },
        { value: "Cleared", label: "Cleared" },
        { value: "Rejected", label: "Rejected" }
      ];
    default:
      return [{ value: "", label: "Select an option" }];
  }
};

const addInputValidation = (input, field) => {
  switch (field.type) {
    case "phone":
      input.maxLength = 15;
      input.pattern = "[0-9\\-\\s\\(\\)]+";
      input.title = "Enter phone number (10-15 digits)";
      break;
    case "ssn":
      input.maxLength = 11;
      input.pattern = "[0-9\\-]+";
      input.title = "Enter SSN (XXX-XX-XXXX)";
      break;
    case "routing":
      input.maxLength = 9;
      input.pattern = "[0-9]+";
      input.title = "Enter 9-digit routing number";
      break;
    case "account":
      input.maxLength = 17;
      input.pattern = "[0-9]+";
      input.title = "Enter account number (up to 17 digits)";
      break;
    case "state":
      input.maxLength = 2;
      input.pattern = "[A-Z]{2}";
      input.title = "Enter 2-letter state abbreviation";
      break;
    case "date":
      input.maxLength = 10;
      input.pattern = "[0-9\\/]+";
      input.title = "Enter date (MM/DD/YYYY)";
      break;
  }
};

const buildEditCardForm = (person) => {
  const form = document.getElementById("candidate-form");
  const basics = document.getElementById("edit-card-basics");
  const job = document.getElementById("edit-card-job");
  const background = document.getElementById("edit-card-background");
  if (!form || !basics || !job || !background || !state.schema) return;
  
  // Clear existing content
  basics.innerHTML = "";
  job.innerHTML = "";
  background.innerHTML = "";

  // Pre-NEO Info (Column 1)
  const preNeoSection = createSectionHeader("Pre NEO Info");
  basics.appendChild(preNeoSection);

  // Phone/Email row
  const phoneEmailRow = document.createElement("div");
  phoneEmailRow.className = "field field--same-line field--enhanced";
  const phoneField = buildEnhancedField({ name: "Candidate Phone Number", label: "Phone", type: "phone" }, person);
  const emailField = buildEnhancedField({ name: "Candidate Email", label: "Email", type: "email" }, person);
  phoneEmailRow.appendChild(phoneField);
  phoneEmailRow.appendChild(emailField);
  basics.appendChild(phoneEmailRow);

  // Job ID/Name + Location row
  const jobRow = document.createElement("div");
  jobRow.className = "field field--same-line field--enhanced";
  const jobIdField = buildEnhancedField({ name: "Job Name", label: "Job ID/Name" }, person);
  const jobLocationField = buildEnhancedField({ name: "Job Location", label: "Job Location" }, person);
  jobRow.appendChild(jobIdField);
  jobRow.appendChild(jobLocationField);
  basics.appendChild(jobRow);

  // Manager + Branch row
  const managerBranchRow = document.createElement("div");
  managerBranchRow.className = "field field--same-line field--enhanced";
  const managerField = buildEnhancedField({ name: "Manager Name", label: "Manager" }, person);
  const branchField = buildEnhancedField({ name: "Branch", label: "Branch", type: "select" }, person);
  managerBranchRow.appendChild(managerField);
  managerBranchRow.appendChild(branchField);
  basics.appendChild(managerBranchRow);

  // Background & Clearance
  const bgSection = createSectionHeader("Background & Clearance");
  basics.appendChild(bgSection);

  const bgRow = document.createElement("div");
  bgRow.className = "field field--same-line field--enhanced";
  const bgStatusField = buildEnhancedField({ name: "BG Check Status", label: "Background Status", type: "select" }, person);
  const bgDateField = buildEnhancedField({ name: "Background Completion Date", label: "Background Completion Date", type: "date" }, person);
  bgRow.appendChild(bgStatusField);
  bgRow.appendChild(bgDateField);
  basics.appendChild(bgRow);

  const bgExtrasField = buildEnhancedField({ name: "Extras", label: "Background Extras", type: "multiselect" }, person);
  basics.appendChild(bgExtrasField);

  // Massachusetts CORI
  const coriSection = createSectionHeader("Massachusetts CORI");
  basics.appendChild(coriSection);

  const coriRow = document.createElement("div");
  coriRow.className = "field field--same-line field--enhanced";
  const coriStatusField = buildEnhancedField({ name: "CORI Status", label: "CORI Status", type: "select" }, person);
  const coriDateField = buildEnhancedField({ name: "CORI Submit Date", label: "CORI Date", type: "date" }, person);
  coriRow.appendChild(coriStatusField);
  coriRow.appendChild(coriDateField);
  basics.appendChild(coriRow);

  // Guard Card
  const guardSection = createSectionHeader("Guard Card");
  basics.appendChild(guardSection);

  const guardStateField = buildEnhancedField({ name: "Guard Card State", label: "Guard Card State Abbrev." }, person);
  basics.appendChild(guardStateField);

  const guardRow = document.createElement("div");
  guardRow.className = "field field--same-line field--enhanced";
  const guardStatusField = buildEnhancedField({ name: "Guard Card Status", label: "Guard Card Status", type: "select" }, person);
  const guardDateField = buildEnhancedField({ name: "Guard Card Date", label: "Guard Card Date", type: "date" }, person);
  guardRow.appendChild(guardStatusField);
  guardRow.appendChild(guardDateField);
  basics.appendChild(guardRow);

  const guardIdField = buildEnhancedField({ name: "Guard Card ID", label: "Guard Card ID" }, person);
  basics.appendChild(guardIdField);

  // Column 2: At NEO
  // License & Identification
  const licenseSection = createSectionHeader("License & Identification");
  job.appendChild(licenseSection);

  const idTypeField = buildEnhancedField({ name: "ID Type", label: "ID Type", type: "select" }, person);
  job.appendChild(idTypeField);

  const idRow = document.createElement("div");
  idRow.className = "field field--same-line field--enhanced";
  const idStateField = buildEnhancedField({ name: "State", label: "State Abbrev." }, person);
  const idNumberField = buildEnhancedField({ name: "ID No.", label: "ID#" }, person);
  idRow.appendChild(idStateField);
  idRow.appendChild(idNumberField);
  job.appendChild(idRow);

  const expDobRow = document.createElement("div");
  expDobRow.className = "field field--same-line field--enhanced";
  const expField = buildEnhancedField({ name: "Exp.", label: "Exp", type: "date" }, person);
  const dobField = buildEnhancedField({ name: "DOB", label: "DOB", type: "date" }, person);
  expDobRow.appendChild(expField);
  expDobRow.appendChild(dobField);
  job.appendChild(expDobRow);

  const ssnField = buildEnhancedField({ name: "Social", label: "SSN", type: "ssn" }, person);
  job.appendChild(ssnField);

  // Emergency Contact
  const emergencySection = createSectionHeader("Emergency Contact");
  job.appendChild(emergencySection);

  const emergencyNameField = buildEnhancedField({ name: "EC Name", label: "Name" }, person);
  job.appendChild(emergencyNameField);

  const emergencyPhoneRow = document.createElement("div");
  emergencyPhoneRow.className = "field field--same-line field--enhanced";
  const emergencyRelationshipField = buildEnhancedField({ name: "EC Relationship", label: "Relationship" }, person);
  const emergencyPhoneField = buildEnhancedField({ name: "EC Phone Number", label: "Phone", type: "phone" }, person);
  emergencyPhoneRow.appendChild(emergencyRelationshipField);
  emergencyPhoneRow.appendChild(emergencyPhoneField);
  job.appendChild(emergencyPhoneRow);

  // Direct Deposit Information
  const depositSection = createSectionHeader("Direct Deposit Information");
  job.appendChild(depositSection);

  const bankNameField = buildEnhancedField({ name: "Bank Name", label: "Bank Name" }, person);
  job.appendChild(bankNameField);

  const accountTypeField = buildEnhancedField({ name: "Deposit Account Type", label: "Account Type", type: "select" }, person);
  job.appendChild(accountTypeField);

  const routingField = buildEnhancedField({ name: "Routing Number", label: "Routing Number", type: "routing" }, person);
  job.appendChild(routingField);

  const accountField = buildEnhancedField({ name: "Account Number", label: "Account Number", type: "account" }, person);
  job.appendChild(accountField);

  // Column 3: Post NEO
  // Uniform Items
  const uniformSection = createSectionHeader("Uniform Items");
  background.appendChild(uniformSection);

  const uniformRow = document.createElement("div");
  uniformRow.className = "field field--same-line field--enhanced";
  const uniformStatusField = buildEnhancedField({ name: "Uniform Status", label: "Uniform Status", type: "select" }, person);
  const shirtSizeField = buildEnhancedField({ name: "Shirt Size", label: "Shirt Size", type: "select" }, person);
  uniformRow.appendChild(uniformStatusField);
  uniformRow.appendChild(shirtSizeField);
  background.appendChild(uniformRow);

  const pantsBootsRow = document.createElement("div");
  pantsBootsRow.className = "field field--same-line field--enhanced";
  const pantsSizeField = buildEnhancedField({ name: "Pants Size", label: "Pants" }, person);
  const bootsField = buildEnhancedField({ name: "Boots", label: "Boots" }, person);
  pantsBootsRow.appendChild(pantsSizeField);
  pantsBootsRow.appendChild(bootsField);
  background.appendChild(pantsBootsRow);

  // Initialize password toggles for new fields
  initPasswordToggles();
  observeNewPasswordFields();
};

const openEditPage = async (uid = null) => {
  console.log('openEditPage called', uid);
  if (!state.schema) {
    try {
      await fetchSchema();
    } catch (err) {
      console.error('fetchSchema failed in openEditPage', err);
      alert("Unable to load form schema. Please sign in or try again.");
      showAuthModal();
      return;
    }
  }

  // Show modal instead of switching pages
  const modal = document.getElementById('edit-modal');
  if (!modal) {
    console.error('Modal not found');
    return;
  }

  // Update modal title based on whether we're editing or creating
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  if (uid) {
    modalTitle.textContent = 'Edit Candidate';
    modalSubtitle.textContent = 'Update candidate information';
  } else {
    modalTitle.textContent = 'Add Candidate';
    modalSubtitle.textContent = 'Create a new candidate';
  }

  // Build the form
  const person = uid ? (findPersonByUid(uid) || {}) : {};
  buildEditCardForm(person);

  // Show modal with animation
  modal.style.display = 'flex';
  modal.classList.remove('modal--closing');
  modal.classList.add('modal--open');

  // Set active UID for form operations
  state.activeUid = uid ? String(uid) : null;
};

const closeEditPage = () => {
  const modal = document.getElementById('edit-modal');
  if (!modal) return;
  
  // Add closing animation
  modal.classList.add('modal--closing');
  modal.classList.remove('modal--open');
  
  // Hide after animation
  setTimeout(() => {
    modal.style.display = 'none';
    modal.classList.remove('modal--closing');
    updateCardSelection();
    updateDetailsPanel();
  }, 300);
  
  switchPage("dashboard");
};

const collectFormData = () => {
  const form = document.getElementById("candidate-form");
  if (!form) return {};
  const data = {};
  Array.from(form.elements).forEach((element) => {
    if (!element.name) return;
    if (element.tagName === "SELECT" && element.multiple) {
      const values = Array.from(element.selectedOptions).map(opt => opt.value);
      data[element.name] = values.join(", ");
    } else {
      data[element.name] = element.value;
    }
  });
  // Normalize NEO date: convert YYYY-MM-DD -> MM/DD/YYYY for compatibility
  if (data["NEO Scheduled Date"] && data["NEO Scheduled Date"].includes("-")) {
    const parts = data["NEO Scheduled Date"].split("-");
    if (parts.length === 3) {
      const yyyy = parts[0];
      const mm = parts[1];
      const dd = parts[2];
      data["NEO Scheduled Date"] = `${mm}/${dd}/${yyyy}`;
    }
  }
  return data;
};

const saveCandidate = async (event) => {
  event.preventDefault();
  const payload = collectFormData();
  const url = state.activeUid ? `/api/people/${state.activeUid}` : "/api/people";
  const method = state.activeUid ? "PUT" : "POST";
  try {
    const response = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error || errorData.detail || 'Unknown error';
      console.error('Save failed:', response.status, errorMsg);
      alert(`Save failed: ${errorMsg} (Status: ${response.status})`);
      return;
    }
    const payloadJson = await response.json();
    if (payloadJson?.person?.uid) {
      state.activeUid = payloadJson.person.uid;
    }
    closeEditPage();
    loadData();
  } catch (error) {
    console.error('Save error:', error);
    alert(`Save failed: ${error.message}`);
  }
};

const deleteCandidate = async () => {
  if (!state.activeUid) return;
  if (!confirm("Delete this candidate?")) return;
  const response = await apiFetch(`/api/people/${state.activeUid}`, { method: "DELETE" });
  if (!response.ok) {
    alert("Delete failed.");
    return;
  }
  closeEditPage();
  loadData();
};

const showAuthModal = async () => {
  const modal = document.getElementById("auth-modal");
  const title = document.getElementById("auth-title");
  if (!modal || !title) return false;
  try {
    const response = await apiFetch("/api/auth/status");
    if (!response.ok) return false;
    const status = await response.json();
    console.log('Auth status:', status);
    state.auth = status;
    title.textContent = status.configured ? "Sign In" : "Create Program Password";
    // If already authenticated, resolve immediately
    if (status.authenticated) {
      console.log('Already authenticated');
      return true;
    }
    modal.classList.remove("hidden");
    return await new Promise((resolve) => {
      const onSuccess = () => {
        window.removeEventListener('workflow:auth-success', onSuccess);
        window.removeEventListener('workflow:auth-cancel', onCancel);
        modal.classList.add("hidden");
        console.log('Authentication successful');
        resolve(true);
      };
      const onCancel = () => {
        window.removeEventListener('workflow:auth-success', onSuccess);
        window.removeEventListener('workflow:auth-cancel', onCancel);
        modal.classList.add("hidden");
        console.log('Authentication cancelled');
        resolve(false);
      };
      window.addEventListener('workflow:auth-success', onSuccess);
      window.addEventListener('workflow:auth-cancel', onCancel);
    });
  } catch (err) {
    console.error('showAuthModal error', err);
    return false;
  }
};

const hideAuthModal = () => {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.add("hidden");
  // If modal closed without authentication, notify waiters
  if (!state.auth || !state.auth.authenticated) {
    window.dispatchEvent(new Event('workflow:auth-cancel'));
  }
};

const showChangePasswordModal = () => {
  const modal = document.getElementById('change-password-modal');
  if (!modal) return;
  // clear fields
  const cur = document.getElementById('change-current');
  const nw = document.getElementById('change-new');
  const conf = document.getElementById('change-confirm');
  if (cur) cur.value = '';
  if (nw) nw.value = '';
  if (conf) conf.value = '';
  // ensure password eye toggles are initialized
  initPasswordToggles();
  modal.classList.remove('hidden');
};

const hideChangePasswordModal = () => {
  const modal = document.getElementById('change-password-modal');
  if (modal) modal.classList.add('hidden');
};

const handleChangePasswordSubmit = async (event) => {
  event.preventDefault();
  const current = document.getElementById('change-current').value;
  const nw = document.getElementById('change-new').value;
  const confirm = document.getElementById('change-confirm').value;
  if (!current || !nw) {
    alert('Please enter current and new password.');
    return;
  }
  if (nw !== confirm) {
    alert('New password and confirmation do not match.');
    return;
  }
  const response = await apiFetch('/api/auth/change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, new: nw }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = body && body.detail ? body.detail : 'Unable to change password.';
    alert(msg);
    return;
  }
  alert('Password changed successfully.');
  hideChangePasswordModal();
};

const handleAuthSubmit = async (event) => {
  event.preventDefault();
  const submitBtn = document.getElementById('auth-submit');
  if (submitBtn && submitBtn.dataset.submitting) return; // prevent double submits
  const passwordEl = document.getElementById("auth-password");
  const password = passwordEl ? passwordEl.value : '';
  console.log('Attempting authentication, configured:', Boolean(state.auth && state.auth.configured));
  const configured = Boolean(state.auth && state.auth.configured);
  const endpoint = configured ? "/api/auth/login" : "/api/auth/setup";
  try {
    if (submitBtn) {
      submitBtn.dataset.submitting = '1';
      submitBtn.disabled = true;
    }
    console.log('Sending auth request to:', endpoint);
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = body && body.detail ? body.detail : 'Authentication failed.';
      console.error('Auth failed:', response.status, msg);
      alert(msg);
      return;
    }
    // Mark authenticated and notify waiters
    if (!state.auth) state.auth = {};
    state.auth.authenticated = true;
    if (!state.auth.configured) {
      state.auth.configured = true;
    }
    
    await response.json();
    
    // Dispatch success event first
    window.dispatchEvent(new Event('workflow:auth-success'));
    hideAuthModal();
    
    // Then try to load data with error handling
    try {
      await fetchSchema();
      await loadData();
    } catch (err) {
      console.error('Error loading data after authentication:', err);
      alert('Successfully authenticated, but failed to load data. Please refresh the page.');
      // Don't return here - let the user see the error message
    }
  } catch (err) {
    console.error('Auth submit error', err);
    alert('Unable to contact server. Try again.');
  } finally {
    if (submitBtn) {
      submitBtn.dataset.submitting = '';
      submitBtn.disabled = false;
    }
  }
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
    loadData();
  } catch (err) {
    console.error('submitArchive error', err);
    await showMessageModal('Archive failed', 'Network or server error. Check logs.');
  }
};

const loadArchivesList = async () => {
  const response = await apiFetch("/api/archive/list");
  if (!response.ok) {
    alert("Unable to load archives.");
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
      state.archives.selectedFile = null;
      renderArchiveList();
      // Clear current preview and contents
      renderArchiveContents([]);
      const preview = document.getElementById('archive-preview');
      if (preview) preview.innerHTML = '<div class="muted">Select a file to view.</div>';
      updateArchiveButtons();
    });
    list.appendChild(item);
  });
  updateArchiveButtons();
};

const updateArchiveButtons = () => {
  const unlock = document.getElementById('archive-unlock');
  const del = document.getElementById('archive-delete');
  const dl = document.getElementById('archive-download');
  const has = !!state.archives.selected;
  if (unlock) unlock.disabled = !has;
  if (del) del.disabled = !has;
  if (dl) dl.disabled = !has;
};

const renderArchiveContents = (files) => {
  const list = document.getElementById("archives-contents");
  if (!list) return;
  list.innerHTML = "";
  files.forEach((file) => {
    const item = document.createElement("li");
    item.className = "archive-item";
    if (file === state.archives.selectedFile) item.classList.add("archive-item--active");

    const row = document.createElement("div");
    row.className = "archive-row";

    const name = document.createElement("span");
    name.className = "archive-file-name";
    name.textContent = file.split("/").pop();
    name.title = file;
    name.style.cursor = "pointer";
    name.addEventListener("click", () => { state.archives.selectedFile = file; viewArchiveFile(file); renderArchiveContents(files); });

    // Clicking the file name will select and open it (prompts for password if needed)
    row.append(name);
    item.appendChild(row);
    list.appendChild(item);
  });

  const preview = document.getElementById("archive-preview");
  if (preview) preview.innerHTML = '<div class="muted">Select a file to view.</div>';
};

const ARCHIVE_PW_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cache structure: { <archiveName>: { pw: string, expiresAt: number } }
state.archives.passwordCache = {};

const cacheArchivePassword = (archiveName, pw) => {
  if (!archiveName || !pw) return;
  state.archives.passwordCache[archiveName] = { pw, expiresAt: Date.now() + ARCHIVE_PW_TTL_MS };
};

// Unlock archive explicitly (prompts and caches password for TTL)
const unlockArchive = async () => {
  if (!state.archives.selected) { await showMessageModal('No archive selected', 'Select an archive to unlock.'); return; }
  const name = state.archives.selected;
  const unlockBtn = document.getElementById('archive-unlock');
  if (unlockBtn) unlockBtn.disabled = true;
  try {
    const pw = await getArchivePassword(name);
    if (!pw) return;
    await showMessageModal('Unlocked', `${name} unlocked for 10 minutes.`);
    // After unlocking, load the archive contents into the list
    await loadArchiveContents();
  } catch (err) {
    console.error('unlockArchive error', err);
    await showMessageModal('Error', 'Unable to unlock archive. Try again.');
  } finally {
    if (unlockBtn) unlockBtn.disabled = false;
  }
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

const promptPasswordModal = ({ modalId, formId, inputId, closeId, cancelId, onOpen }) => {
  return new Promise((resolve) => {
    const modal = document.getElementById(modalId);
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    const close = document.getElementById(closeId);
    const cancel = document.getElementById(cancelId);
    if (!modal || !form || !input) return resolve(null);
    if (typeof onOpen === 'function') onOpen();
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

const showArchivePasswordPrompt = async (archiveName) => {
  // Ensure authenticated first
  const authOk = await showAuthModal();
  if (!authOk) return null;
  return promptPasswordModal({
    modalId: 'archive-password-modal',
    formId: 'archive-password-form',
    inputId: 'archive-prompt-password',
    closeId: 'archive-password-close',
    cancelId: 'archive-password-cancel',
  });
};

// Get archive password, checking cache first and caching after prompt
const getArchivePassword = async (archiveName) => {
  if (!archiveName) return null;
  const cached = getCachedArchivePassword(archiveName);
  if (cached) return cached;
  const pw = await showArchivePasswordPrompt(archiveName);
  if (pw) cacheArchivePassword(archiveName, pw);
  return pw;
};

// Confirm delete modal: asks for program password and returns it, or null on cancel
const showDeleteArchiveModal = (archiveName) => {
  return promptPasswordModal({
    modalId: 'archive-delete-modal',
    formId: 'archive-delete-form',
    inputId: 'archive-delete-password',
    closeId: 'archive-delete-close',
    cancelId: 'archive-delete-cancel',
    onOpen: () => {
      const message = document.getElementById('archive-delete-message');
      if (message) {
        message.textContent = `Delete '${archiveName}' — this action cannot be undone.`;
      }
    },
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

const viewArchiveFile = async (internalPath) => {
  const password = await getArchivePassword(state.archives.selected);
  if (!password) return;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password, internal_path: internalPath }),
  });
  if (!response.ok) {
    await showMessageModal('Error', 'Unable to load file.');
    return;
  }
  const payload = await response.json().catch(() => ({}));
  const text = payload && typeof payload.content === 'string' ? payload.content : '';
  state.archives.selectedFile = internalPath;
  renderArchiveContents(state.archives.files);
  renderArchivePreview(internalPath, text);
};

const renderArchivePreview = (internalPath, text) => {
  const preview = document.getElementById("archive-preview");
  if (!preview) return;
  preview.innerHTML = "";

  const header = document.createElement("div");
  header.className = "preview-header";
  const title = document.createElement("h3");
  title.textContent = internalPath.split("/").pop();
  const actions = document.createElement("div");
  actions.className = "preview-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "button button--ghost";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    } catch (err) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    }
  });

  const dlBtn = document.createElement("button");
  dlBtn.className = "button button--ghost";
  dlBtn.textContent = "Download";
  dlBtn.addEventListener("click", () => {
    const blob = new Blob([text], { type: "text/plain" });
    downloadBlob(internalPath.split("/").pop(), blob);
  });

  actions.append(copyBtn, dlBtn);
  header.append(title, actions);
  preview.appendChild(header);

  const lines = text.split(/\r?\n/);
  let section = "File";
  let buffer = [];
  const sections = [];
  lines.forEach((line) => {
    const m = line.match(/^==\s*(.+?)\s*==$/);
    if (m) {
      if (buffer.length) sections.push({ section, content: buffer.join("\n") });
      section = m[1];
      buffer = [];
    } else {
      buffer.push(line);
    }
  });
  if (buffer.length) sections.push({ section, content: buffer.join("\n") });

  sections.forEach((s) => {
    const hdr = document.createElement("div");
    hdr.className = "archive-section-title";
    hdr.textContent = s.section;
    const pre = document.createElement("pre");
    pre.className = "archive-section-body";
    pre.textContent = s.content;
    preview.appendChild(hdr);
    preview.appendChild(pre);
  });
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
  const payload = await response.json().catch(() => ({}));
  const filename = internalPath.split("/").pop();
  if (payload && typeof payload.content === 'string') {
    downloadBlob(filename, new Blob([payload.content], { type: "text/plain" }));
    return;
  }
  if (payload && typeof payload.base64 === 'string') {
    const bin = atob(payload.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob(filename, new Blob([bytes]));
    return;
  }
  await showMessageModal('Error', 'Unable to download file.');
};

const downloadArchive = async () => {
  if (!state.archives.selected) { await showMessageModal('No archive selected', 'Select an archive to download.'); return; }
  const authOk = await showAuthModal();
  if (!authOk) return;
  await showMessageModal('Not available', 'Archive download is not available in desktop mode yet.');
};

const deleteArchive = async () => {
  if (!state.archives.selected) {
    await showMessageModal('No archive selected', 'Select an archive to delete.');
    return;
  }
  const name = state.archives.selected;
  // Ask for program password via our confirm modal
  const confirmBtn = document.getElementById('archive-delete-confirm');
  const pw = await showDeleteArchiveModal(name);
  if (!pw) return; // cancelled
  if (confirmBtn) confirmBtn.disabled = true;
  try {
    // Attempt program login with provided password
    const loginResp = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!loginResp.ok) {
      const body = await loginResp.json().catch(() => ({}));
      await showMessageModal('Authentication failed', (body && body.detail) || 'Incorrect program password.');
      return false;
    }

    // Mark authenticated and notify waiters
    if (!state.auth) state.auth = {};
    state.auth.authenticated = true;
    if (!state.auth.configured) {
      state.auth.configured = true;
    }

    // Dispatch success event for showAuthModal
    window.dispatchEvent(new CustomEvent('workflow:auth-success', { 
      authenticated: true 
    }));

    // Close auth modal
    const modal = document.getElementById('auth-modal');
    if (modal) {
      modal.classList.add('hidden');
    }

    // Now fetch schema and load data
    try {
      await fetchSchema();
      await loadData();
      // Don't switchPage here - let the normal app flow handle it
      return true;
    } catch (err) {
      console.error('Error after login:', err);
      alert('Error: Failed to load data after login. Please try again.');
      return false;
    }
  } catch (err) {
    console.error('Login error:', err);
    await showMessageModal('Error', 'Authentication failed. Please try again.');
    return false;
  }
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

const loadRemovedList = async () => {
  const response = await apiFetch("/api/removed");
  if (!response.ok) {
    alert("Unable to load removed candidates.");
    return;
  }
  const payload = await response.json();
  state.removed.list = payload.removed || [];
  renderRemovedList();
};

const renderRemovedList = () => {
  const list = document.getElementById("removed-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.removed.list.length) {
    const empty = document.createElement("div");
    empty.className = "removed-empty";
    empty.textContent = "No removed candidates.";
    list.appendChild(empty);
    return;
  }
  state.removed.list.forEach((person) => {
    const item = document.createElement("li");
    item.className = "removed-item";
    const name = document.createElement("strong");
    name.textContent = person.name || "Unnamed";
    item.appendChild(name);
    list.appendChild(item);
  });
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

  // Weekly and Todo are flyout panels on the dashboard, not separate pages
  if (page === 'weekly' || page === 'todo') {
    // Switch to dashboard first if not already there
    if (state.page !== 'dashboard') {
      state.page = 'dashboard';
      document.querySelectorAll(".page").forEach((section) => {
        section.classList.toggle("page--active", section.id === "page-dashboard");
      });
    }
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("nav-item--active", btn.dataset.page === page);
    });
    switchFlyoutPanel(page);
    return;
  }

  const target = document.getElementById(`page-${page}`) ? page : "dashboard";
  state.page = target;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("page--active", section.id === `page-${target}`);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.page === target);
  });
  // Close any open flyout when switching to a non-dashboard page
  if (target !== 'dashboard' && state.flyoutPanel) {
    const currentEl = document.getElementById(FLYOUT_PANELS[state.flyoutPanel]);
    if (currentEl) _hideFlyoutPanel(currentEl);
    if (state.flyoutPanel === 'details') {
      state.activeUid = null;
      updateCardSelection();
    }
    state.flyoutPanel = null;
  }
  updateDetailsPanel();
  if (target === "exports") {
    loadExportsList();
  }
  if (target === "archives") {
    loadArchivesList();
  }
  if (target === "removed") {
    loadRemovedList();
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

const removeCandidate = async () => {
  if (!state.activeUid) return;
  if (!confirm("Remove this candidate?")) return;
  const response = await apiFetch(`/api/people/${state.activeUid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Removed: true }),
  });
  if (!response.ok) {
    alert("Unable to remove candidate.");
    return;
  }
  state.activeUid = null;
  updateCardSelection();
  updateDetailsPanel();
  loadData();
  loadRemovedList();
};

const downloadSelectedExport = () => {
  if (!state.exports.selected) return;
  showMessageModal('Not available', 'Export download is not available in desktop mode yet.');
};

const setupEventListeners = () => {
  const addButton = document.getElementById("add-candidate");
  const cancelButton = document.getElementById("edit-cancel");
  const detailsArchive = document.getElementById("details-archive");
  const detailsRemove = document.getElementById("details-remove");
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
  const archiveUnlock = document.getElementById("archive-unlock");
  const archiveDeleteBtn = document.getElementById("archive-delete");
  const archiveDownloadBtn = document.getElementById("archive-download");
  const authForm = document.getElementById("auth-form");
  const authClose = document.getElementById('auth-close');
  const exportsRefresh = document.getElementById("exports-refresh");
  const exportsDelete = document.getElementById("exports-delete");
  const exportsDownload = document.getElementById("download-selected");
  const detailsEdit = document.getElementById("details-edit");
  const neoClose = document.getElementById("neo-close");
  const neoCancel = document.getElementById("neo-cancel");
  const neoMove = document.getElementById("neo-move");
  const neoRemoveBtn = document.getElementById("neo-remove");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const board = document.querySelector(".board");

  console.log('setupEventListeners: addButton present?', !!addButton);
  if (addButton) addButton.addEventListener("click", () => openEditPage().catch(err => { console.error('openEditPage error', err); alert('Unable to open editor. Check console for details.'); }));
  if (cancelButton) cancelButton.addEventListener("click", closeEditPage);
  if (detailsEdit) detailsEdit.addEventListener("click", () => openEditPage(state.activeUid));
  if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
    const appEl = document.querySelector('.app');
    const mini = document.querySelector('.sidebar__mini');
    const isCollapsed = appEl.classList.toggle('app--sidebar-collapsed');
    if (mini) {
      // When collapsed show the mini, otherwise hide it
      mini.setAttribute('aria-hidden', isCollapsed ? 'false' : 'true');
      // Manage focusability of children to avoid aria-hidden focused element warnings
      mini.querySelectorAll('.nav-item--mini').forEach((btn) => {
        if (isCollapsed) btn.removeAttribute('tabindex'); else btn.setAttribute('tabindex', '-1');
      });
    }
  });
  if (detailsArchive) detailsArchive.addEventListener("click", openArchiveModal);
  if (detailsRemove) detailsRemove.addEventListener("click", removeCandidate);
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
      showMessageModal('Not available', 'CSV export is not available in desktop mode yet.');
    });
  }
  if (weeklyButton) weeklyButton.addEventListener("click", () => switchFlyoutPanel('weekly'));
  const weeklyMini = document.getElementById('weekly-tracker-mini');
  if (weeklyMini) weeklyMini.addEventListener('click', () => switchFlyoutPanel('weekly'));
  if (weeklyClose) weeklyClose.addEventListener("click", closeWeeklyTracker);
  if (weeklyCancel) weeklyCancel.addEventListener("click", closeWeeklyTracker);
  if (weeklyForm) weeklyForm.addEventListener("submit", saveWeeklyTracker);
  if (weeklyExport) {
    weeklyExport.addEventListener("click", () => {
      showMessageModal('Not available', 'Weekly summary export is not available in desktop mode yet.');
    });
  }
  // Todo panel button
  const todoButton = document.getElementById('todo-tracker');
  if (todoButton) todoButton.addEventListener('click', () => switchFlyoutPanel('todo'));
  const todoMini = document.getElementById('todo-tracker-mini');
  if (todoMini) todoMini.addEventListener('click', () => switchFlyoutPanel('todo'));
  // Todo add button + Enter key
  const todoAddBtn = document.getElementById('todo-add');
  if (todoAddBtn) todoAddBtn.addEventListener('click', addTodo);
  const todoInput = document.getElementById('todo-input');
  if (todoInput) todoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } });
  // Weekly panel save
  const weeklyPanelSave = document.getElementById('weekly-panel-save');
  if (weeklyPanelSave) weeklyPanelSave.addEventListener('click', saveWeeklyPanel);
  if (archiveModalClose) archiveModalClose.addEventListener("click", closeArchiveModal);
  if (archiveModalCancel) archiveModalCancel.addEventListener("click", closeArchiveModal);
  if (archiveForm) archiveForm.addEventListener("submit", submitArchive);
  if (archivesLoad) archivesLoad.addEventListener("click", loadArchiveContents);
  if (archiveUnlock) archiveUnlock.addEventListener('click', unlockArchive);
  if (archiveDeleteBtn) archiveDeleteBtn.addEventListener('click', deleteArchive);
  if (archiveDownloadBtn) archiveDownloadBtn.addEventListener('click', downloadArchive);
  if (authForm) authForm.addEventListener("submit", handleAuthSubmit);
  if (authClose) authClose.addEventListener('click', hideAuthModal);
  const changeBtn = document.getElementById('change-password-button');
  const changeModalClose = document.getElementById('change-password-close');
  const changeForm = document.getElementById('change-password-form');
  if (changeBtn) changeBtn.addEventListener('click', showChangePasswordModal);
  if (changeModalClose) changeModalClose.addEventListener('click', hideChangePasswordModal);
  if (changeForm) changeForm.addEventListener('submit', handleChangePasswordSubmit);
  if (exportsRefresh) exportsRefresh.addEventListener("click", loadExportsList);
  if (exportsDelete) exportsDelete.addEventListener("click", deleteSelectedExport);
  if (exportsDownload) exportsDownload.addEventListener("click", downloadSelectedExport);
  if (neoClose) neoClose.addEventListener("click", hideNeoModal);
  if (neoCancel) neoCancel.addEventListener("click", hideNeoModal);
  if (neoMove) neoMove.addEventListener("click", neoMoveToInProgress);
  if (neoRemoveBtn) neoRemoveBtn.addEventListener("click", neoRemoveCandidate);
  if (detailsEdit) {
    detailsEdit.addEventListener("click", () => {
      if (state.activeUid) openEditPage(state.activeUid);
    });
  }
  if (board) {
    board.addEventListener("click", () => {
      // Close any open flyout panels (todo/weekly) when clicking on board
      if (state.flyoutPanel && state.flyoutPanel !== 'details') {
        const currentEl = document.getElementById(FLYOUT_PANELS[state.flyoutPanel]);
        if (currentEl) _hideFlyoutPanel(currentEl);
        state.flyoutPanel = null;
      }
      if (!state.activeUid) return;
      state.activeUid = null;
      updateCardSelection();
      updateDetailsPanel();
    });
  }
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
  // Render days in a fixed Monday->Sunday order inside a 7-column grid
  const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  const grid = document.createElement('div');
  grid.className = 'weekly__grid';
  days.forEach((day) => {
    const info = (data.entries && data.entries[day]) ? data.entries[day] : { start: '', end: '', content: '' };

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
    textarea.placeholder = ""; // open text area
    textarea.value = info.content || "";

    container.append(header, textarea);
    grid.appendChild(container);
  });
  form.appendChild(grid);
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

// ============================================================================
// FLYOUT PANEL SYSTEM (continued — switchFlyoutPanel + panel openers)
// ============================================================================

const switchFlyoutPanel = (targetName) => {
  // If clicking the same panel, close it
  if (state.flyoutPanel === targetName) {
    const currentEl = document.getElementById(FLYOUT_PANELS[state.flyoutPanel]);
    _hideFlyoutPanel(currentEl);
    state.flyoutPanel = null;
    // If closing details, clear selection
    if (targetName === 'details') {
      state.activeUid = null;
      updateCardSelection();
    }
    return;
  }

  // If a panel is currently open, hide it first, then show the new one after transition
  if (state.flyoutPanel) {
    const currentEl = document.getElementById(FLYOUT_PANELS[state.flyoutPanel]);
    _hideFlyoutPanel(currentEl);
    // If leaving details, clear selection
    if (state.flyoutPanel === 'details') {
      state.activeUid = null;
      updateCardSelection();
    }
    setTimeout(() => {
      _openFlyoutTarget(targetName);
    }, FLYOUT_TRANSITION_MS);
  } else {
    _openFlyoutTarget(targetName);
  }
};

const _openFlyoutTarget = async (targetName) => {
  state.flyoutPanel = targetName;
  const panelEl = document.getElementById(FLYOUT_PANELS[targetName]);
  if (!panelEl) return;

  // Load content before showing
  if (targetName === 'weekly') {
    await loadWeeklyPanel();
  } else if (targetName === 'todo') {
    await loadTodoPanel();
  }

  _showFlyoutPanel(panelEl);
};

// ============================================================================
// TODO LIST PANEL
// ============================================================================

const loadTodoPanel = async () => {
  try {
    const response = await apiFetch('/api/todos');
    if (!response.ok) return;
    const payload = await response.json();
    state.todos.list = payload.todos || [];
    renderTodoList();
  } catch (err) {
    console.error('loadTodoPanel error', err);
  }
};

const renderTodoList = () => {
  const list = document.getElementById('todo-list');
  if (!list) return;
  list.innerHTML = '';
  state.todos.list.forEach((todo) => {
    const li = document.createElement('li');
    li.className = 'todo__item' + (todo.completed ? ' todo__item--completed' : '');

    const text = document.createElement('span');
    text.className = 'todo__item-text';
    text.textContent = todo.text;

    const actions = document.createElement('div');
    actions.className = 'todo__item-actions';

    if (!todo.completed) {
      const completeBtn = document.createElement('button');
      completeBtn.className = 'todo__btn todo__btn--complete';
      completeBtn.textContent = '\u2714';
      completeBtn.title = 'Complete (adds to weekly tracker)';
      completeBtn.addEventListener('click', () => completeTodo(todo.id));
      actions.appendChild(completeBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'todo__btn todo__btn--delete';
    deleteBtn.textContent = '\u2716';
    deleteBtn.title = 'Delete';
    deleteBtn.addEventListener('click', () => deleteTodo(todo.id));
    actions.appendChild(deleteBtn);

    li.append(text, actions);
    list.appendChild(li);
  });
};

const addTodo = async () => {
  const input = document.getElementById('todo-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  try {
    const response = await apiFetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.todo) {
      state.todos.list.unshift(payload.todo);
      renderTodoList();
    }
    input.value = '';
    input.focus();
  } catch (err) {
    console.error('addTodo error', err);
  }
};

const completeTodo = async (id) => {
  try {
    const response = await apiFetch(`/api/todos/${id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) return;
    // Update local state
    const todo = state.todos.list.find((t) => t.id === id);
    if (todo) {
      todo.completed = true;
      todo.completed_at = new Date().toISOString();
    }
    renderTodoList();
    // Refresh weekly panel if it's open
    if (state.flyoutPanel === 'weekly') {
      await loadWeeklyPanel();
    }
  } catch (err) {
    console.error('completeTodo error', err);
  }
};

const deleteTodo = async (id) => {
  try {
    const response = await apiFetch(`/api/todos/${id}`, { method: 'DELETE' });
    if (!response.ok) return;
    state.todos.list = state.todos.list.filter((t) => t.id !== id);
    renderTodoList();
  } catch (err) {
    console.error('deleteTodo error', err);
  }
};

// ============================================================================
// WEEKLY TRACKER PANEL (fly-out version)
// ============================================================================

const loadWeeklyPanel = async () => {
  try {
    const response = await apiFetch('/api/weekly/current');
    if (!response.ok) return;
    const data = await response.json();
    renderWeeklyPanel(data);
  } catch (err) {
    console.error('loadWeeklyPanel error', err);
  }
};

const renderWeeklyPanel = (data) => {
  const body = document.getElementById('weekly-panel-body');
  const range = document.getElementById('weekly-panel-range');
  if (!body) return;
  if (range) {
    range.textContent = `${data.week_start} to ${data.week_end}`;
  }
  body.innerHTML = '';
  const days = ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];
  days.forEach((day) => {
    const info = (data.entries && data.entries[day]) ? data.entries[day] : { start: '', end: '', content: '' };
    const card = document.createElement('div');
    card.className = 'weekly-panel__day';

    const header = document.createElement('div');
    header.className = 'weekly-panel__day-header';
    const title = document.createElement('div');
    title.className = 'weekly-panel__day-title';
    title.textContent = day;

    const timeWrap = document.createElement('div');
    timeWrap.className = 'weekly-panel__time';
    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.name = `${day}__start`;
    startInput.placeholder = 'In';
    startInput.value = info.start || '';
    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.name = `${day}__end`;
    endInput.placeholder = 'Out';
    endInput.value = info.end || '';
    timeWrap.append(startInput, endInput);
    header.append(title, timeWrap);

    const textarea = document.createElement('textarea');
    textarea.name = `${day}__content`;
    textarea.placeholder = '';
    textarea.value = info.content || '';

    card.append(header, textarea);
    body.appendChild(card);
  });
};

const saveWeeklyPanel = async () => {
  const body = document.getElementById('weekly-panel-body');
  if (!body) return;
  const entries = {};
  body.querySelectorAll('input, textarea').forEach((el) => {
    if (!el.name) return;
    const [day, field] = el.name.split('__');
    if (!day || !field) return;
    entries[day] = entries[day] || { content: '', start: '', end: '' };
    entries[day][field] = el.value;
  });
  try {
    const response = await apiFetch('/api/weekly/current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      alert('Unable to save weekly tracker.');
      return;
    }
    // Brief visual feedback
    const saveBtn = document.getElementById('weekly-panel-save');
    if (saveBtn) {
      const orig = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      setTimeout(() => { saveBtn.textContent = orig; }, 1200);
    }
  } catch (err) {
    console.error('saveWeeklyPanel error', err);
    alert('Unable to save weekly tracker.');
  }
};

initTheme();
setupEventListeners();
initPasswordToggles();
observeNewPasswordFields();

// Set up modal event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Modal close button
  const modalClose = document.getElementById('modal-close');
  if (modalClose) {
    modalClose.addEventListener('click', closeEditPage);
  }

  // Modal overlay click to close
  const modalOverlay = document.querySelector('.modal__overlay');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', closeEditPage);
  }

  // Cancel button
  const editCancel = document.getElementById('edit-cancel');
  if (editCancel) {
    editCancel.addEventListener('click', closeEditPage);
  }

  // ESC key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('edit-modal');
      if (modal && modal.style.display === 'flex') {
        closeEditPage();
      }
    }
  });
});
