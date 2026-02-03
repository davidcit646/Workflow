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
      "EC First Name",
      "EC Last Name",
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

    const makeKV = (label, value) => {
      if (!value && value !== 0) return null;
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

    // Candidate IDs (ICIMS, EID)
    const icims = getVal("ICIMS ID", "ICIMS", "ICIMS ID Number");
    const eid = getVal("Employee ID", "EID");
    if (icims || eid) {
      const idRow = document.createElement("div");
      idRow.className = "details__ids";
      if (icims) {
        const left = document.createElement("div");
        left.className = "details__id";
        left.innerHTML = `<strong>ICIMS</strong> <span>${icims}</span>`;
        idRow.appendChild(left);
      }
      if (eid) {
        const right = document.createElement("div");
        right.className = "details__id";
        right.innerHTML = `<strong>EID</strong> <span>${eid}</span>`;
        idRow.appendChild(right);
      }
      body.appendChild(idRow);
      addSep();
    }

    // Contact (Phone, Email) - each on its own row
    const phoneRow = makeKV("Phone", getVal("Candidate Phone Number", "Candidate Phone"));
    const emailRow = makeKV("Email", getVal("Candidate Email", "Email"));
    if (appendIfExists(body, phoneRow) || appendIfExists(body, emailRow)) {
      addSep();
    }

    // Job details: Job Name, Job Location, Manager, Branch
    const jobWrap = document.createElement("div");
    jobWrap.className = "details__job";
    appendIfExists(jobWrap, makeKV("Job Name", getVal("Job Name", "Job Name/ID")));
    appendIfExists(jobWrap, makeKV("Job Location", getVal("Job Location")));
    appendIfExists(jobWrap, makeKV("Manager", getVal("Manager Name", "Manager")));
    appendIfExists(jobWrap, makeKV("Branch", getVal("Branch")));
    if (jobWrap.children.length) {
      body.appendChild(jobWrap);
      addSep();
    }

    // ID / Licenses (ID Type, State, ID No., Exp., DOB, Social, DOD)
    const idSection = document.createElement("div");
    idSection.className = "details__licenses";
    appendIfExists(idSection, makeKV("ID Type", getVal("ID Type", "Other ID")));
    appendIfExists(idSection, makeKV("State", getVal("State", "State Abbreviation")));
    appendIfExists(idSection, makeKV("ID #", getVal("ID No.", "License Number")));
    appendIfExists(idSection, makeKV("Expiration", getVal("Exp.", "Expiration Date")));
    appendIfExists(idSection, makeKV("DOB", getVal("DOB", "Date of Birth", "DOB")));
    appendIfExists(idSection, makeKV("SSN", getVal("Social", "Social Security Number")));
    appendIfExists(idSection, makeKV("DOD Clearance", getVal("DOD Clearance")));
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
      appendIfExists(licenses, makeKV("NH GC Status", getVal("NH GC Status", "NHGC Status")));
      appendIfExists(licenses, makeKV("NH GC Exp", getVal("NH GC Expiration Date", "NHGC Expiration Date")));
      appendIfExists(licenses, makeKV("NH GC ID", getVal("NH GC ID Number", "NHGC ID Number")));
    }
    if (showStatus("CORI Status", "CORI Submit Date", "CORI Date", "CORI Cleared Date")) {
      appendIfExists(licenses, makeKV("CORI Status", getVal("CORI Status")));
      appendIfExists(licenses, makeKV("CORI Date", getVal("CORI Submit Date", "CORI Date")));
      appendIfExists(licenses, makeKV("CORI Cleared", getVal("CORI Cleared Date")));
    }
    if (showStatus("ME GC Status", "Maine GC Status", "ME GC Sent Date", "ME GC Date")) {
      appendIfExists(licenses, makeKV("ME GC Status", getVal("ME GC Status", "Maine GC Status")));
      appendIfExists(licenses, makeKV("ME GC Sent", getVal("ME GC Sent Date", "ME GC Date")));
    }
    appendIfExists(licenses, makeKV("MVR", getVal("MVR")));
    if (licenses.children.length) {
      body.appendChild(licenses);
      addSep();
    }

    // Emergency Contact
    const ecName = `${person["EC First Name"] || ""} ${person["EC Last Name"] || ""}`.trim();
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
    { name: "Employee ID", label: "Employee Number" },
  ];

  const contactFields = [
    { name: "Candidate Phone Number", label: "Phone Number" },
    { name: "Candidate Email", label: "Email" },
  ];

  const licensingFields = [
    { name: "ID Type", label: "ID Type" },
    { name: "Other ID", label: "Other ID" },
    { name: "State", label: "State Abbreviation" },
    { name: "ID No.", label: "ID #" },
    { name: "Exp.", label: "Expiration", placeholder: "MM/DD/YYYY" },
    { name: "DOB", label: "DOB", placeholder: "MM/DD/YYYY" },
    { name: "Social", label: "SSN" },
  ];

  const jobFields = [
    { name: "Job Name", label: "Job Name/ID" },
    { name: "Job Location", label: "Job Location" },
    { name: "Manager Name", label: "Manager Name" },
    { name: "Branch", label: "Branch" },
  ];

  const bgFields = [
    { name: "Background Completion Date", label: "Background Completion Date", placeholder: "MM/DD/YYYY" },
    { name: "BG Check Status", label: "Background Check Status" },
  ];

  const coriFields = [
    { name: "CORI Status", label: "CORI Status" },
    { name: "CORI Submit Date", label: "CORI Submit Date", placeholder: "MM/DD/YYYY" },
    { name: "CORI Cleared Date", label: "CORI Cleared Date", placeholder: "MM/DD/YYYY" },
  ];

  const nhgcFields = [
    { name: "NH GC Status", label: "NH GC Status" },
    { name: "NH GC Expiration Date", label: "NH GC Expiration Date", placeholder: "MM/DD/YYYY" },
    { name: "NH GC ID Number", label: "NH GC ID Number" },
  ];

  const meGcFields = [
    { name: "ME GC Status", label: "ME GC Status" },
    { name: "ME GC Sent Date", label: "ME GC Sent Date", placeholder: "MM/DD/YYYY" },
  ];

  const emergencyFields = [
    { name: "EC First Name", label: "First Name" },
    { name: "EC Last Name", label: "Last Name" },
    { name: "EC Relationship", label: "Relationship" },
    { name: "EC Phone Number", label: "Phone Number", placeholder: "###-###-####" },
  ];

  const uniformsFields = [
    { name: "Shirt Size", label: "Shirt Size" },
    { name: "Pants Size", label: "Pants Size" },
    { name: "Boots", label: "Boots" },
    { name: "Deposit Account Type", label: "Deposit Account Type" },
    { name: "Bank Name", label: "Bank Name" },
    { name: "Routing Number", label: "Routing Number" },
    { name: "Account Number", label: "Account Number" },
  ];

  fields.forEach((field) => {
    const fieldEl = buildField(field, person);
    basics.appendChild(fieldEl);
  });

  const basicsDivider = document.createElement("div");
  basicsDivider.className = "edit-card__divider";
  basics.appendChild(basicsDivider);

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

  switchPage("edit");
};

const closeEditPage = () => {
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
  if (!modal || !title) return;
  const response = await fetch("/api/auth/status");
  if (!response.ok) return;
  const status = await response.json();
  state.auth = status;
  title.textContent = status.configured ? "Sign In" : "Create Program Password";
  modal.classList.remove("hidden");
};

const hideAuthModal = () => {
  const modal = document.getElementById("auth-modal");
  if (modal) modal.classList.add("hidden");
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
    alert("Archive failed.");
    return;
  }
  closeArchiveModal();
  loadData();
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
      renderArchiveList();
    });
    list.appendChild(item);
  });
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

    const actions = document.createElement("div");
    actions.className = "archive-actions";

    const viewBtn = document.createElement("button");
    viewBtn.className = "button button--ghost";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", (e) => { e.stopPropagation(); state.archives.selectedFile = file; renderArchiveContents(files); viewArchiveFile(file); });

    const dlBtn = document.createElement("button");
    dlBtn.className = "button button--ghost";
    dlBtn.textContent = "Download";
    dlBtn.addEventListener("click", (e) => { e.stopPropagation(); downloadArchiveFile(file); });

    actions.append(viewBtn, dlBtn);
    row.append(name, actions);
    item.appendChild(row);
    list.appendChild(item);
  });

  const preview = document.getElementById("archive-preview");
  if (preview) preview.innerHTML = '<div class="muted">Select a file to view.</div>';
};

const viewArchiveFile = async (internalPath) => {
  const password = document.getElementById("archives-password").value;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password, internal_path: internalPath }),
  });
  if (!response.ok) {
    alert("Unable to load file.");
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
    alert("Select an archive first.");
    return;
  }
  const password = document.getElementById("archives-password").value;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/contents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password }),
  });
  if (!response.ok) {
    alert("Unable to load archive contents.");
    return;
  }
  const payload = await response.json();
  state.archives.files = payload.files || [];
  renderArchiveContents(state.archives.files);
};

const downloadArchiveFile = async (internalPath) => {
  const password = document.getElementById("archives-password").value;
  const response = await apiFetch(`/api/archive/${state.archives.selected}/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archive_password: password, internal_path: internalPath }),
  });
  if (!response.ok) {
    alert("Unable to download file.");
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
    const download = document.createElement("button");
    download.className = "button button--ghost";
    download.textContent = "Download";
    download.addEventListener("click", (event) => {
      event.stopPropagation();
      window.location.href = `/api/exports/file?name=${encodeURIComponent(file)}`;
    });
    row.append(name, download);
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
  const authForm = document.getElementById("auth-form");
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
  if (sidebarToggle) sidebarToggle.addEventListener('click', () => document.querySelector('.app').classList.toggle('app--sidebar-collapsed'));
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
