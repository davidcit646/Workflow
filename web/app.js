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

/** Route API calls through Electron IPC to Python backend (no HTTP server when loading from file://) */
const apiFetch = async (url, options = {}) => {
  const method = (options.method || "GET").toUpperCase();
  let body = options.body ?? null;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { /* pass through */ }
  }
  const request = { method, url, body };
  const result = await window.electronAPI.apiRequest(request);
  if (result.status === 401) {
    await showAuthModal();
    throw new Error("Unauthorized");
  }
  const data = result.data;
  return {
    ok: result.ok,
    status: result.status,
    json: () => Promise.resolve(data !== undefined ? data : (result.error ? { detail: result.error } : null)),
    text: () => Promise.resolve(
      typeof data === "string" ? data : (data?.content ?? (data ? JSON.stringify(data) : ""))
    ),
    blob: () => {
      if (data?.base64) {
        const bin = atob(data.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return Promise.resolve(new Blob([arr]));
      }
      return Promise.resolve(new Blob([typeof data === "string" ? data : JSON.stringify(data ?? "")]));
    },
  };
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
    const response = await fetch(`/static/locales/${I18N.locale}.json`);
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
    btn.innerHTML = '👁️';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? '🙈' : '👁️';
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
      "Name",
      "ICIMS ID",
      "Employee ID",
      "Job Name",
      "Job Location",
      "Manager Name",
      "Branch",
      "Scheduled",
      "NEO Scheduled Date",
      { type: "title", text: "Candidate Contact Info" },
      "Candidate Phone Number",
      "Candidate Email",
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
      "NH GC Expiration Date",
      "NH GC ID Number",
      "ME GC Status",
      "ME GC Sent Date",
      "MVR",
      "DOD Clearance",
    ],
  },
  {
    title: "Uniforms & Emergency Contact",
    fields: [
      "Shirt Size",
      "Pants Size",
      "Boots",
      "Deposit Account Type",
      "Bank Name",
      "Routing Number",
      "Account Number",
      { type: "title", text: "Emergency Contact" },
      "EC Name",
      "EC Relationship",
      "EC Phone Number",
    ],
  },
  {
    title: "Personal ID",
    fields: ["Other ID", "State", "ID No.", "Exp.", "DOB", "Social"],
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
  return Object.values(state.columns)
    .flat()
    .find((item) => item.uid === uid);
};

const updateDetailsPanel = () => {
  const app = document.querySelector(".app");
  const panel = document.getElementById("details-panel");
  const title = document.getElementById("details-title");
  const subtitle = document.getElementById("details-subtitle");
  const status = document.getElementById("details-status");
  const body = document.getElementById("details-body");
  const notes = document.getElementById("details-notes");

  const person = state.people.find((item) => item.uid === state.activeUid) || null;
  const cardInfo = findCardInfo(state.activeUid);
  const showPanel = state.page === "dashboard" && person;

  if (panel) {
    panel.classList.toggle("details--hidden", !showPanel);
  }
  if (app) {
    app.classList.toggle("app--details-hidden", !showPanel);
  }
  if (!showPanel) {
    if (body) body.innerHTML = "";
    if (notes) notes.textContent = "";
    if (status) status.textContent = "";
    return;
  }

  if (title) title.textContent = person.Name || cardInfo?.name || "Candidate Details";
  if (subtitle) {
    const subtitleParts = [cardInfo?.manager, cardInfo?.date, person["Job Location"]].filter(Boolean);
    subtitle.textContent = subtitleParts.join(" • ");
  }
  if (status) {
    status.textContent = cardInfo?.status || "";
    status.className = badgeClass(cardInfo?.badge || "warning");
    status.style.display = cardInfo?.status ? "inline-flex" : "none";

    // If the status is a scheduled NEO, make the badge clickable so user can take manual actions
    if (cardInfo?.status && cardInfo.status.toLowerCase().startsWith("neo:")) {
      status.style.cursor = "pointer";
      status.title = "Click for NEO actions";
      status.onclick = (e) => {
        e.stopPropagation();
        showNeoModal(person?.uid);
      };
    } else {
      status.style.cursor = "";
      status.title = "";
      status.onclick = null;
    }
  }

  if (body) {
    body.innerHTML = "";

    const _sanitizeValue = (v) => {
      // Accept numbers and non-empty strings, and truthy booleans.
      if (v === null || v === undefined) return null;
      if (typeof v === 'boolean') return v ? t('details.yes', 'Yes') : null;
      const s = String(v).trim();
      if (!s) return null;
      const lower = s.toLowerCase();
      // Treat common placeholders as empty
      const emptyValues = new Set(['none', 'n/a', 'na', 'false', 'no', 'no date', '—', '-']);
      if (emptyValues.has(lower)) return null;
      return s;
    };

    const makeKV = (label, value) => {
      const sanitized = _sanitizeValue(value);
      if (sanitized === null && sanitized !== 0) return null;
      const row = document.createElement("div");
      row.className = "details__kv";
      const labelEl = document.createElement("div");
      labelEl.className = "details__kv-label";
      labelEl.textContent = label;
      const valEl = document.createElement("div");
      valEl.className = "details__kv-value";
      // If email, render as mailto link
      if (label.toLowerCase().includes("email")) {
        const a = document.createElement("a");
        a.href = `mailto:${sanitized}`;
        a.textContent = sanitized;
        a.style.color = "inherit";
        a.style.textDecoration = "underline";
        valEl.appendChild(a);
      } else {
        valEl.textContent = sanitized;
      }
      row.appendChild(labelEl);
      row.appendChild(valEl);
      return row;
    };

    const addSep = () => {
      const hr = document.createElement("hr");
      hr.className = "details__sep";
      body.appendChild(hr);
    };

    const appendIfExists = (container, el) => {
      if (!el) return false;
      container.appendChild(el);
      return true;
    };

    // helper: pick first available key from multiple possible names
    const getVal = (...keys) => {
      for (const k of keys) {
        if (person[k] || person[k] === 0) return person[k];
      }
      return "";
    };

    // Candidate IDs (ICIMS, EID) — always show both; Employee ID is editable inline
    const icims = getVal("ICIMS ID", "ICIMS", "ICIMS ID Number");
    const eid = getVal("Employee ID", "EID");

    const idRow = document.createElement("div");
    idRow.className = "details__ids";

    const left = document.createElement("div");
    left.className = "details__id";
    left.innerHTML = `<strong>${t('details.icims')}</strong> <span>${icims || ''}</span>`;
    idRow.appendChild(left);

    const right = document.createElement("div");
    right.className = "details__id";
    const label = document.createElement("strong");
    label.textContent = t('details.eid');
    const eidInput = document.createElement("input");
    eidInput.type = "text";
    eidInput.id = "details-employee-id";
    eidInput.className = "input input--header input--narrow input--inline";
    eidInput.value = eid || "";
    eidInput.placeholder = "";
    right.appendChild(label);
    right.appendChild(document.createTextNode(' '));
    right.appendChild(eidInput);
    idRow.appendChild(right);

    body.appendChild(idRow);
    addSep();

    // Save Employee ID on blur (silent save; reload data on success)
    eidInput.addEventListener('blur', async (ev) => {
      if (!state.activeUid) return;
      const newVal = ev.target.value.trim();
      const current = person["Employee ID"] || "";
      if (newVal === current) return;
      const response = await apiFetch(`/api/people/${state.activeUid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "Employee ID": newVal }),
      });
      if (!response.ok) {
        await showMessageModal('Error', 'Unable to save Employee ID.');
        eidInput.value = current;
        return;
      }
      // reflect change locally
      person["Employee ID"] = newVal;
      loadData();
      updateDetailsPanel();
    });


    // Contact (Phone, Email) - each on its own row
    const phoneRow = makeKV(t('details.phone'), getVal("Candidate Phone Number", "Candidate Phone"));
    const emailRow = makeKV(t('details.email'), getVal("Candidate Email", "Email"));
    if (appendIfExists(body, phoneRow) || appendIfExists(body, emailRow)) {
      addSep();
    }

    // Job details: Job Name, Job Location, Manager, Branch
    const jobWrap = document.createElement("div");
    jobWrap.className = "details__job";
    appendIfExists(jobWrap, makeKV(t('details.job_name'), getVal("Job Name", "Job Name/ID")));
    appendIfExists(jobWrap, makeKV(t('details.job_location'), getVal("Job Location")));
    appendIfExists(jobWrap, makeKV(t('details.manager'), getVal("Manager Name", "Manager")));
    appendIfExists(jobWrap, makeKV(t('details.branch'), getVal("Branch")));
    if (jobWrap.children.length) {
      body.appendChild(jobWrap);
      addSep();
    }

    // ID / Licenses (ID Type, State, ID No., Exp., DOB, Social, DOD)
    const idSection = document.createElement("div");
    idSection.className = "details__licenses";
    appendIfExists(idSection, makeKV(t('details.id_type'), getVal("ID Type", "Other ID")));
    appendIfExists(idSection, makeKV(t('details.state'), getVal("State", "State Abbreviation")));
    appendIfExists(idSection, makeKV(t('details.id_number'), getVal("ID No.", "License Number")));
    appendIfExists(idSection, makeKV(t('details.expiration'), getVal("Exp.", "Expiration Date")));
    appendIfExists(idSection, makeKV(t('details.dob'), getVal("DOB", "Date of Birth", "DOB")));
    appendIfExists(idSection, makeKV(t('details.ssn'), getVal("Social", "Social Security Number")));
    appendIfExists(idSection, makeKV(t('details.dod_clearance'), getVal("DOD Clearance")));
    if (idSection.children.length) {
      body.appendChild(idSection);
      addSep();
    }

    // State licensing: show if any related data present (status or date/id fields)
    const showStatus = (...keys) => {
      return keys.some((k) => !!getVal(k));
    };

    const licenses = document.createElement("div");
    licenses.className = "details__state-licenses";
    if (showStatus("NH GC Status", "NHGC Status", "NH GC Expiration Date", "NHGC Expiration Date", "NH GC ID Number", "NHGC ID Number")) {
      appendIfExists(licenses, makeKV(t('details.nh_gc_status'), getVal("NH GC Status", "NHGC Status")));
      appendIfExists(licenses, makeKV(t('details.nh_gc_status') + ' Exp', getVal("NH GC Expiration Date", "NHGC Expiration Date")));
      appendIfExists(licenses, makeKV(t('details.nh_gc_status') + ' ID', getVal("NH GC ID Number", "NHGC ID Number")));
    }
    if (showStatus("CORI Status", "CORI Submit Date", "CORI Date", "CORI Cleared Date")) {
      appendIfExists(licenses, makeKV(t('details.cori_status'), getVal("CORI Status")));
      appendIfExists(licenses, makeKV(t('details.cori_status') + ' Date', getVal("CORI Submit Date", "CORI Date")));
      appendIfExists(licenses, makeKV(t('details.cori_status') + ' Cleared', getVal("CORI Cleared Date")));
    }
    if (showStatus("ME GC Status", "Maine GC Status", "ME GC Sent Date", "ME GC Date")) {
      appendIfExists(licenses, makeKV(t('details.me_gc_status'), getVal("ME GC Status", "Maine GC Status")));
      appendIfExists(licenses, makeKV(t('details.me_gc_status') + ' Sent', getVal("ME GC Sent Date", "ME GC Date")));
    }
    appendIfExists(licenses, makeKV(t('details.mvr'), getVal("MVR")));
    if (licenses.children.length) {
      body.appendChild(licenses);
      addSep();
    }

    // Emergency Contact
    const ecName = person["EC Name"] || "";  // Using combined field
    const ecWrap = document.createElement("div");
    ecWrap.className = "details__emergency";
    appendIfExists(ecWrap, makeKV("Emergency Contact", ecName));
    appendIfExists(ecWrap, makeKV("Relationship", person["EC Relationship"]));
    appendIfExists(ecWrap, makeKV("EC Phone", person["EC Phone Number"]));
    if (ecWrap.children.length) {
      body.appendChild(ecWrap);
      addSep();
    }

    // Uniforms / Accounts
    const uni = document.createElement("div");
    uni.className = "details__uniforms";
    appendIfExists(uni, makeKV("Shirt", getVal("Shirt Size")));
    appendIfExists(uni, makeKV("Pants", getVal("Pants Size")));
    appendIfExists(uni, makeKV("Boots", getVal("Boots")));
    appendIfExists(uni, makeKV("Deposit Account", getVal("Deposit Account Type")));
    appendIfExists(uni, makeKV("Bank", getVal("Bank Name")));
    appendIfExists(uni, makeKV("Routing #", getVal("Routing Number")));
    appendIfExists(uni, makeKV("Account #", getVal("Account Number")));
    if (uni.children.length) body.appendChild(uni);
  }

  if (notes) {
    const noteValue = person.Notes || "";
    notes.textContent = noteValue;
    notes.style.display = noteValue ? "block" : "none";
  }
};

const selectCandidate = (uid) => {
  state.activeUid = state.activeUid === uid ? null : uid;
  updateCardSelection();
  updateDetailsPanel();
};

/* --- NEO action modal helpers --- */
const showNeoModal = (uid) => {
  const modal = document.getElementById("neo-modal");
  if (!modal) return;
  modal.dataset.uid = uid || "";
  const person = state.people.find((p) => p.uid === uid) || {};
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
  meta.innerHTML = `<span>${item.manager}</span><span>•</span><span>${item.date}</span>`;

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
  } else {
    input = document.createElement("input");
    input.type = "text";
  }

  input.name = name;
  input.value = fieldValue(name, person);
  if (placeholder) input.placeholder = placeholder;

  wrapper.append(label, input);
  return wrapper;
};

const buildEditCardForm = (person) => {
  const form = document.getElementById("candidate-form");
  const basics = document.getElementById("edit-card-basics");
  const job = document.getElementById("edit-card-job");
  const background = document.getElementById("edit-card-background");
  if (!form || !basics || !job || !background || !state.schema) return;
  basics.innerHTML = "";
  job.innerHTML = "";
  background.innerHTML = "";

  const fields = [
    // Employee ID removed per design; leave space for future fields
  ];

  const contactFields = [
    { name: "Candidate Phone Number", label: "Phone Number" , placeholder: "e.g. ###-###-####" , tooltip: "Candidate's phone number. Please include area code, e.g. 603-555-1234."},
    { name: "Candidate Email", label: "Email" , placeholder: "e.g. example@example.com" , tooltip: "Candidate's email address. Please enter a valid email address, e.g. example@example.com."},
  ];

  const licensingFields = [
    { name: "ID Type", label: "ID Type" , placeholder: "e.g. Driver's License, State ID, Passport, Other" , tooltip: "Primary form of identification for the candidate. Please specify the type of ID, such as Driver's License, State ID, Passport, or Other."},
    { name: "Other ID", label: "Other ID" , placeholder: "Specify if ID Type is 'Other'" , tooltip: "Additional details about the candidate's primary form of identification, if needed. Only fill out if 'ID Type' is set to 'Other' or if you have additional relevant information about the ID."},
    { name: "State", label: "State Abbreviation" , placeholder: "Only for Driver's License or State ID" , tooltip: "Two-letter state abbreviation for driver's license or state ID, e.g. NH, MA, ME. Leave blank if not applicable."},
    { name: "ID No.", label: "ID #" , placeholder: "e.g. License Number" , tooltip: "ID number from the candidate's primary form of identification, such as driver's license or passport. Please enter the ID number exactly as it appears on the ID."},
    { name: "Exp.", label: "Expiration", placeholder: "MM/DD/YYYY" , tooltip: "Expiration date of ID. Please enter in format MM/DD/YYYY."},
    { name: "DOB", label: "DOB", placeholder: "MM/DD/YYYY" , tooltip: "Date of Birth. Please enter in format MM/DD/YYYY."},
    { name: "Social", label: "SSN" , placeholder: "###-##-####" , tooltip: "Social Security Number. Please enter in format ###-##-####."},
  ];

  const jobFields = [
    { name: "Job Name", label: "ID/Name" , placeholder: "e.g. 12345FX" , tooltip: "Job ID and name for the position this candidate is being hired for. Please select the job that corresponds to the hiring manager."},
    { name: "Job Location", label: "Job Location" , placeholder: "e.g. Manchester, NH" , tooltip: "Location of the job this candidate is being hired for. Please select the location that corresponds to the hiring manager."},
    { name: "Manager Name", label: "Manager Name" , placeholder: "Full name of hiring manager" , tooltip: "Hiring manager for this candidate. Please select the manager that corresponds to the job location."},
    { name: "Branch", label: "Branch" , placeholder: "Select branch from dropdown" , tooltip: "Branch assignment for this candidate. Please select the branch that corresponds to the job location or hiring manager."},
  ];

  const bgFields = [
    { name: "Background Completion Date", label: "Background Completion Date", placeholder: "MM/DD/YYYY" , tooltip: "Date when background check was completed. Leave blank if not completed yet."},
    { name: "BG Check Status", label: "Background Check Status" , placeholder: "e.g. Clear, Consider, etc." , tooltip: "Overall status of background check. Leave blank if not completed yet."},
  ];

  const coriFields = [
    { name: "CORI Status", label: "CORI Status" , placeholder: "e.g. Clear, Consider, etc." , tooltip: "CORI status. Only applicable for candidates in Massachusetts."},
    { name: "CORI Submit Date", label: "CORI Submit Date", placeholder: "MM/DD/YYYY" , tooltip: "Date when CORI was submitted for processing. Leave blank if not submitted yet."},
    { name: "CORI Cleared Date", label: "CORI Cleared Date", placeholder: "MM/DD/YYYY" , tooltip: "Date when CORI was cleared. Leave blank if not cleared yet."},
  ];

  const nhgcFields = [
    { name: "NH GC Status", label: "NH GC Status" , placeholder: "e.g. Clear, Consider, etc." , tooltip: "NH GC status. Only applicable for candidates in New Hampshire."},
    { name: "NH GC Expiration Date", label: "NH GC Expiration Date", placeholder: "MM/DD/YYYY"  , tooltip: "Expiration date of NH GC. Leave blank if not applicable or unknown."},
    { name: "NH GC ID Number", label: "NH GC ID Number" , placeholder: "e.g. License or Certificate Number" , tooltip: "ID number associated with NH GC, if applicable."},
  ];

  const meGcFields = [
    { name: "ME GC Status", label: "ME GC Status" , placeholder: "e.g. Clear, Consider, etc.", tooltip: "Maine GC status. Only applicable for candidates in Maine."},
    { name: "ME GC Sent Date", label: "ME GC Sent Date", placeholder: "MM/DD/YYYY" , tooltip: "Date when Maine GC was sent for processing. Leave blank if not sent yet."},
  ];

  const emergencyFields = [
    { name: "EC Name", label: "Name" , placeholder: "Full name of emergency contact", tooltip: "Emergency contact information is required and recommended in case we need to reach someone on the candidate's behalf."},
    { name: "EC Relationship", label: "Relationship" , placeholder: "Relationship to candidate, e.g. Spouse, Parent, Friend, etc." ,tooltip: "Relationship of emergency contact to candidate"},
    { name: "EC Phone Number", label: "Phone Number", placeholder: "###-###-####" , tooltip: "Phone number of emergency contact. Please include area code."},
  ];

  const uniformsFields = [
    { name: "Shirt Size", label: "Shirt Size" , placeholder: "e.g. Small, Medium, Large" , tooltip: "Shirt size for uniform. If unsure, select closest size or leave blank."},
    { name: "Pants Size", label: "Pants Size" , placeholder: "Wasit/Inseem" , tooltip: "Pants size for uniform. If unsure, select closest size or leave blank."},
    { name: "Boots", label: "Boots" , placeholder: "Boot size or Yes/No" , tooltip: "Boot size for uniform, or indicate if boots are needed. If unsure, select closest size or leave blank."},
    { name: "Deposit Account Type", label: "Deposit Account Type" , tooltip: "Type of deposit account for payroll, e.g. Checking, Savings."},
    { name: "Bank Name", label: "Bank Name" , placeholder: "Name of bank for payroll deposit" , tooltip: "Name of bank where payroll will be deposited."},
    { name: "Routing Number", label: "Routing Number" , placeholder: "Bank routing number for payroll deposit" , tooltip: "Routing number for bank where payroll will be deposited."},
    { name: "Account Number", label: "Account Number" , placeholder: "Bank account number for payroll deposit" , tooltip: "Account number for bank where payroll will be deposited."},
  ];

  fields.forEach((field) => {
    const fieldEl = buildField(field, person);
    basics.appendChild(fieldEl);
  });

  // Only show divider if there were any basic fields (avoids empty separator when fields are removed)
  if (fields.length) {
    const basicsDivider = document.createElement("div");
    basicsDivider.className = "edit-card__divider";
    basics.appendChild(basicsDivider);
  }

  const contactTitle = document.createElement("div");
  contactTitle.className = "edit-card__section";
  contactTitle.textContent = "Contact Info";
  basics.appendChild(contactTitle);

  contactFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    basics.appendChild(fieldEl);
  });

  const licensingDivider = document.createElement("div");
  licensingDivider.className = "edit-card__divider";
  basics.appendChild(licensingDivider);

  const licensingTitle = document.createElement("div");
  licensingTitle.className = "edit-card__section";
  licensingTitle.textContent = "Licensing Info";
  basics.appendChild(licensingTitle);

  let idTypeSelect = null;
  let otherWrapper = null;
  let stateWrapper = null;
  let licenseWrapper = null;

  const syncIdTypeVisibility = () => {
    const value = idTypeSelect?.value || "";
    const showLicense = value === "Driver's License" || value === "State ID";
    if (stateWrapper) stateWrapper.style.display = showLicense ? "grid" : "none";
    if (licenseWrapper) licenseWrapper.style.display = showLicense ? "grid" : "none";
    if (otherWrapper) otherWrapper.style.display = value === "Other" ? "grid" : "none";
  };

  licensingFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    if (field.name === "ID Type") {
      fieldEl.classList.add("field--half");
      basics.appendChild(fieldEl);

      const stateAbbrev = document.createElement("div");
      stateAbbrev.className = "field field--half";

      const stateLabel = document.createElement("label");
      stateLabel.textContent = "State Abbreviation";

      const stateInput = document.createElement("input");
      stateInput.type = "text";
      stateInput.name = "State Abbreviation";
      stateInput.value = fieldValue("State Abbreviation", person);

      stateAbbrev.append(stateLabel, stateInput);
      stateAbbrev.style.display = "none";
      basics.appendChild(stateAbbrev);
      stateWrapper = stateAbbrev;

      const otherField = document.createElement("div");
      otherField.className = "field";

      const otherLabel = document.createElement("label");
      otherLabel.textContent = "Other ID Type";

      const otherInput = document.createElement("input");
      otherInput.type = "text";
      otherInput.name = "ID Type Other";
      otherInput.value = fieldValue("ID Type Other", person);

      otherField.append(otherLabel, otherInput);
      otherField.style.display = "none";
      basics.appendChild(otherField);
      otherWrapper = otherField;

      idTypeSelect = fieldEl.querySelector("select");
      if (idTypeSelect) {
        idTypeSelect.addEventListener("change", syncIdTypeVisibility);
      }
      return;
    }

    if (field.name === "License Number") {
      fieldEl.classList.add("field--half");
      basics.appendChild(fieldEl);
      licenseWrapper = fieldEl;
      return;
    }

    basics.appendChild(fieldEl);
  });

  syncIdTypeVisibility();

  jobFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    job.appendChild(fieldEl);
  });

  const bgTitle = document.createElement("div");
  bgTitle.className = "edit-card__section";
  bgTitle.textContent = "Background Check";
  background.appendChild(bgTitle);

  bgFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    background.appendChild(fieldEl);
  });

  const coriDivider = document.createElement("div");
  coriDivider.className = "edit-card__divider";
  background.appendChild(coriDivider);

  const coriTitle = document.createElement("div");
  coriTitle.className = "edit-card__section";
  coriTitle.textContent = "Criminal Offender Record Information Request (CORI)";
  background.appendChild(coriTitle);

  coriFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    background.appendChild(fieldEl);
  });

  const nhgcDivider = document.createElement("div");
  nhgcDivider.className = "edit-card__divider";
  background.appendChild(nhgcDivider);

  const nhgcTitle = document.createElement("div");
  nhgcTitle.className = "edit-card__section";
  nhgcTitle.textContent = "New Hampshire Guard Licensing (NHGC)";
  background.appendChild(nhgcTitle);

  nhgcFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    background.appendChild(fieldEl);
  });

  const meGcDivider = document.createElement("div");
  meGcDivider.className = "edit-card__divider";
  background.appendChild(meGcDivider);

  const meGcTitle = document.createElement("div");
  meGcTitle.className = "edit-card__section";
  meGcTitle.textContent = "Maine Guard Licensing";
  background.appendChild(meGcTitle);

  meGcFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    background.appendChild(fieldEl);
  });

  const emergencyTitle = document.createElement("div");
  emergencyTitle.className = "edit-card__section";
  emergencyTitle.textContent = "Emergency Contact";
  job.appendChild(emergencyTitle);

  emergencyFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    job.appendChild(fieldEl);
  });

  const uniformsDivider = document.createElement("div");
  uniformsDivider.className = "edit-card__divider";
  job.appendChild(uniformsDivider);

  const uniformsTitle = document.createElement("div");
  uniformsTitle.className = "edit-card__section";
  uniformsTitle.textContent = "Uniforms";
  job.appendChild(uniformsTitle);

  uniformsFields.forEach((field) => {
    const fieldEl = buildField(field, person);
    fieldEl.classList.add("field--half");
    job.appendChild(fieldEl);
  });
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
  const nameInput = document.getElementById("edit-name");
  const icimsInput = document.getElementById("edit-icims");
  const employeeInput = document.getElementById("edit-employee-id");
  const neoInput = document.getElementById("edit-neo-date");

  state.activeUid = uid;
  const person = state.people.find((item) => item.uid === uid) || null;

  buildEditCardForm(person);

  // Populate header fields (form-associated inputs)
  if (nameInput) nameInput.value = person?.Name || "";
  if (icimsInput) icimsInput.value = person?.["ICIMS ID"] || "";
  if (employeeInput) employeeInput.value = person?.["Employee ID"] || "";
  if (neoInput) {
    const raw = person?.["NEO Scheduled Date"] || "";
    // convert MM/DD/YYYY to YYYY-MM-DD for input type=date
    if (raw && raw.includes("/")) {
      const parts = raw.split("/");
      if (parts.length >= 3) {
        const mm = parts[0].padStart(2, "0");
        const dd = parts[1].padStart(2, "0");
        const yyyy = parts[2];
        neoInput.value = `${yyyy}-${mm}-${dd}`;
      } else {
        neoInput.value = raw;
      }
    } else {
      neoInput.value = raw;
    }
  }

  const editModal = document.getElementById("edit-modal");
  if (editModal) editModal.classList.remove("hidden");
  switchPage("edit");
};

const closeEditPage = () => {
  const editModal = document.getElementById("edit-modal");
  if (editModal) editModal.classList.add("hidden");
  switchPage("dashboard");
  updateCardSelection();
  updateDetailsPanel();
};

const collectFormData = () => {
  const form = document.getElementById("candidate-form");
  if (!form) return {};
  const data = {};
  Array.from(form.elements).forEach((element) => {
    if (!element.name) return;
    data[element.name] = element.value;
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
  const response = await apiFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    alert("Save failed. Check WORKFLOW_PASSWORD or try again.");
    return;
  }
  const payloadJson = await response.json();
  if (payloadJson?.person?.uid) {
    state.activeUid = payloadJson.person.uid;
  }
  closeEditPage();
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
    state.auth = status;
    title.textContent = status.configured ? "Sign In" : "Create Program Password";
    // If already authenticated, resolve immediately
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
  const endpoint = state.auth.configured ? "/api/auth/login" : "/api/auth/setup";
  try {
    if (submitBtn) {
      submitBtn.dataset.submitting = '1';
      submitBtn.disabled = true;
    }
    const response = await apiFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const msg = body && body.detail ? body.detail : 'Authentication failed.';
      alert(msg);
      return;
    }
    // Mark authenticated and notify waiters
    if (!state.auth) state.auth = {};
    state.auth.authenticated = true;
    if (!state.auth.configured) {
      state.auth.configured = true;
    }
    window.dispatchEvent(new Event('workflow:auth-success'));
    hideAuthModal();
    // Re-fetch status and data
    await fetchSchema();
    await loadData();
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
  const text = await response.text();
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = internalPath.split("/").pop();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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

const downloadArchive = async () => {
  if (!state.archives.selected) { await showMessageModal('No archive selected', 'Select an archive to download.'); return; }
  const authOk = await showAuthModal();
  if (!authOk) return;
  window.location.href = `/api/archive/${encodeURIComponent(state.archives.selected)}/download`;
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
    const loginResp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (!loginResp.ok) {
      const body = await loginResp.json().catch(() => ({}));
      await showMessageModal('Authentication failed', (body && body.detail) || 'Incorrect program password.');
      return;
    }

    // Now call delete endpoint
    const response = await apiFetch(`/api/archive/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      await showMessageModal('Delete failed', (body && body.detail) || 'Unable to delete archive.');
      return;
    }
    await showMessageModal('Deleted', `${name} was deleted. This action cannot be undone.`);
    loadArchivesList();
  } catch (err) {
    console.error('Delete error', err);
    await showMessageModal('Error', 'Unable to delete archive. Try again.');
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
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
  const target = document.getElementById(`page-${page}`) ? page : "dashboard";
  state.page = target;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("page--active", section.id === `page-${target}`);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("nav-item--active", btn.dataset.page === target);
  });
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
  window.location.href = `/api/exports/file?name=${encodeURIComponent(state.exports.selected)}`;
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
  const modalClose = document.getElementById("modal-close");
  const editModalOverlay = document.querySelector("#edit-modal .modal__overlay");
  if (modalClose) modalClose.addEventListener("click", closeEditPage);
  if (editModalOverlay) editModalOverlay.addEventListener("click", closeEditPage);
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
      window.location.href = "/api/export/csv";
      setTimeout(loadExportsList, 1200);
    });
  }
  if (weeklyButton) weeklyButton.addEventListener("click", openWeeklyTracker);
  const weeklyMini = document.getElementById('weekly-tracker-mini');
  if (weeklyMini) weeklyMini.addEventListener('click', openWeeklyTracker);
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
  const days = ["Friday","Saturday","Sunday","Monday","Tuesday","Wednesday","Thursday"];
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

initTheme();
setupEventListeners();
initPasswordToggles();
observeNewPasswordFields();
apiFetch("/api/auth/status")
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
