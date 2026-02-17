const existingApi = window.workflowApi;
if (existingApi) {
  // Electron provides the API via preload; do nothing.
} else {
  const STORAGE_FOLDER = "Workflow";
  const AUTH_FILE = "auth.json";
  const DATA_FILE = "workflow.enc";
  const META_FILE = "meta.json";
  const EMAIL_TEMPLATES_FILE = "email_templates.json";

  const DB_VERSION = 3;
  const RECYCLE_LIMIT = 20;
  const RECYCLE_TTL_MS = 15 * 60 * 1000;
  const MAX_FIELD_LEN = 200;
  const MAX_NOTE_LEN = 2000;
  const MAX_TODO_LEN = 200;
  const MAX_COLUMN_NAME_LEN = 60;
  const MAX_ID_LEN = 128;
  const MAX_UNIFORM_ALTERATION_LEN = 80;
  const MAX_UNIFORM_TYPE_LEN = 40;
  const MAX_UNIFORM_SIZE_LEN = 40;
  const MAX_UNIFORM_BRANCH_LEN = 40;
  const MAX_EMAIL_TEMPLATE_TYPE_LEN = 64;
  const MAX_EMAIL_TEMPLATE_TO_LEN = 320;
  const MAX_EMAIL_TEMPLATE_CC_LEN = 1200;
  const MAX_EMAIL_TEMPLATE_SUBJECT_LEN = 500;
  const MAX_EMAIL_TEMPLATE_BODY_LEN = 40000;

  const AUTH_MAX_ATTEMPTS = 5;
  const AUTH_LOCK_MS = 30 * 1000;
  const AUTH_WINDOW_MS = 5 * 60 * 1000;
  const BIOMETRIC_STORAGE_KEY = "workflow.biometric_password";

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const isCapacitor = !!window.Capacitor;
  const platform =
    isCapacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "web";
  const isAndroid = platform === "android";

  const filesystem =
    isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem
      ? window.Capacitor.Plugins.Filesystem
      : null;
  const filePicker =
    isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FilePicker
      ? window.Capacitor.Plugins.FilePicker
      : null;
  const biometricAuth =
    isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuth
      ? window.Capacitor.Plugins.BiometricAuth
      : null;
  const secureStorage =
    isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SecureStoragePlugin
      ? window.Capacitor.Plugins.SecureStoragePlugin
      : null;

  const storageState = {
    mode: filesystem ? "filesystem" : "localStorage",
    directory: "DOCUMENTS",
    ready: false,
    readyPromise: null,
    fallback: false,
  };

  const authLimiter = { failures: 0, lockUntil: 0, lastFailureAt: 0 };

  let authState = { configured: false, authenticated: false };
  let activePassword = null;
  let dbCache = null;
  let metaCache = null;

  const bytesToBase64 = (bytes) => {
    let binary = "";
    const len = bytes.length;
    for (let i = 0; i < len; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const base64ToBytes = (base64) => {
    const binary = atob(base64 || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const base64ToText = (base64) => {
    if (!base64) return "";
    return textDecoder.decode(base64ToBytes(base64));
  };

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

  const ensureStorageReady = async () => {
    if (storageState.readyPromise) return storageState.readyPromise;
    storageState.readyPromise = (async () => {
      if (storageState.mode !== "filesystem" || !filesystem) {
        storageState.ready = true;
        return;
      }
      try {
        await filesystem.mkdir({
          path: STORAGE_FOLDER,
          directory: "DOCUMENTS",
          recursive: true,
        });
        await filesystem.mkdir({
          path: `${STORAGE_FOLDER}/dbs`,
          directory: "DOCUMENTS",
          recursive: true,
        });
        storageState.directory = "DOCUMENTS";
        storageState.ready = true;
        return;
      } catch (err) {
        try {
          await filesystem.mkdir({
            path: STORAGE_FOLDER,
            directory: "DATA",
            recursive: true,
          });
          await filesystem.mkdir({
            path: `${STORAGE_FOLDER}/dbs`,
            directory: "DATA",
            recursive: true,
          });
          storageState.directory = "DATA";
          storageState.fallback = true;
          storageState.ready = true;
          return;
        } catch (err2) {
          storageState.mode = "localStorage";
          storageState.ready = true;
        }
      }
    })();
    return storageState.readyPromise;
  };

  const storageKey = (name) => `workflow:${name}`;

  const readText = async (name) => {
    await ensureStorageReady();
    if (storageState.mode === "filesystem" && filesystem) {
      try {
        const result = await filesystem.readFile({
          path: `${STORAGE_FOLDER}/${name}`,
          directory: storageState.directory,
          encoding: "utf8",
        });
        return typeof result.data === "string" ? result.data : "";
      } catch (err) {
        return null;
      }
    }
    return localStorage.getItem(storageKey(name));
  };

  const writeText = async (name, text) => {
    await ensureStorageReady();
    if (storageState.mode === "filesystem" && filesystem) {
      await filesystem.writeFile({
        path: `${STORAGE_FOLDER}/${name}`,
        directory: storageState.directory,
        data: text,
        encoding: "utf8",
      });
      return true;
    }
    localStorage.setItem(storageKey(name), text);
    return true;
  };

  const readJson = async (name) => {
    const raw = await readText(name);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  };

  const writeJson = async (name, value) => {
    return writeText(name, JSON.stringify(value, null, 2));
  };

  const getStorageLabel = () => {
    if (storageState.mode !== "filesystem") return "Browser Storage";
    return storageState.directory === "DOCUMENTS" ? "Documents/Workflow" : "App Data/Workflow";
  };

  const deriveBits = async (password, salt, iterations = 200000) => {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"],
    );
    return crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      256,
    );
  };

  const deriveKey = async (password, salt, iterations = 200000) => {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  };

  const hashPassword = async (password, salt, iterations = 200000) => {
    const bits = await deriveBits(password, salt, iterations);
    return bytesToBase64(new Uint8Array(bits));
  };

  const encryptPayload = async (payload, password) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const encoded = textEncoder.encode(JSON.stringify(payload));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
    const tag = encrypted.slice(encrypted.length - 16);
    const data = encrypted.slice(0, encrypted.length - 16);
    return {
      v: 1,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      tag: bytesToBase64(tag),
      data: bytesToBase64(data),
    };
  };

  const decryptPayload = async (payload, password) => {
    try {
      if (!payload || !payload.salt || !payload.iv || !payload.tag || !payload.data) return null;
      const salt = base64ToBytes(payload.salt);
      const iv = base64ToBytes(payload.iv);
      const tag = base64ToBytes(payload.tag);
      const data = base64ToBytes(payload.data);
      const combined = new Uint8Array(data.length + tag.length);
      combined.set(data);
      combined.set(tag, data.length);
      const key = await deriveKey(password, salt);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
      return JSON.parse(textDecoder.decode(decrypted));
    } catch (err) {
      return null;
    }
  };

  const clampString = (value, maxLen, { trim = false } = {}) => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (trim) text = text.trim();
    if (text) {
      text = Array.from(text)
        .filter((ch) => {
          const code = ch.charCodeAt(0);
          return code >= 32 && code !== 127;
        })
        .join("");
    }
    if (text.length > maxLen) text = text.slice(0, maxLen);
    return text;
  };

  const clampId = (value) => clampString(value, MAX_ID_LEN, { trim: true });

  const createId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const sanitizeRecord = (record, limits) => {
    const out = {};
    if (!record || typeof record !== "object") return out;
    Object.keys(limits).forEach((key) => {
      if (record[key] !== undefined) {
        out[key] = clampString(record[key], limits[key]);
      }
    });
    return out;
  };

  const sanitizeCardPayload = (payload) => {
    const limits = {
      candidate_name: 120,
      icims_id: 64,
      employee_id: 64,
      job_id: 64,
      req_id: 64,
      job_name: 120,
      job_location: 120,
      manager: 80,
      branch: 80,
      contact_phone: 32,
      contact_email: 120,
      column_id: MAX_ID_LEN,
    };
    return sanitizeRecord(payload, limits);
  };

  const KANBAN_CANDIDATE_FIELDS = [
    "Candidate Name",
    "Hire Date",
    "ICIMS ID",
    "Employee ID",
    "Neo Arrival Time",
    "Neo Departure Time",
    "Total Neo Hours",
    "REQ ID",
    "Job ID Name",
    "Job Location",
    "Manager",
    "Branch",
    "Contact Phone",
    "Contact Email",
    "Background Provider",
    "Background Cleared Date",
    "Background MVR Flag",
    "License Type",
    "MA CORI Status",
    "MA CORI Date",
    "NH GC Status",
    "NH GC Expiration Date",
    "NH GC ID Number",
    "ME GC Status",
    "ME GC Expiration Date",
    "ID Type",
    "State Abbreviation",
    "ID Number",
    "DOB",
    "EXP",
    "Other ID Type",
    "Social",
    "Bank Name",
    "Account Type",
    "Routing Number",
    "Account Number",
    "Shirt Size",
    "Waist",
    "Inseam",
    "Issued Shirt Size",
    "Issued Waist",
    "Issued Inseam",
    "Issued Pants Size",
    "Issued Shirt Type",
    "Issued Shirts Given",
    "Issued Pants Type",
    "Issued Pants Given",
    "Uniforms Issued",
    "Shirt Type",
    "Shirts Given",
    "Pants Type",
    "Pants Given",
    "Pants Size",
    "Boots Size",
    "Emergency Contact Name",
    "Emergency Contact Relationship",
    "Emergency Contact Phone",
    "Additional Details",
    "Additional Notes",
    "candidate UUID",
  ];

  const sanitizePiiPayload = (data) => {
    const limits = {};
    KANBAN_CANDIDATE_FIELDS.forEach((field) => {
      if (field === "Additional Details" || field === "Additional Notes") {
        limits[field] = MAX_NOTE_LEN;
      } else {
        limits[field] = MAX_FIELD_LEN;
      }
    });
    const sanitized = sanitizeRecord(data, limits);
    const shirtSize = normalizeUniformShirtSize(sanitized["Shirt Size"]);
    const waist = normalizeUniformText(sanitized.Waist, 2);
    const inseam = normalizeUniformText(sanitized.Inseam, 2);
    const issuedShirtSize = normalizeUniformShirtSize(sanitized["Issued Shirt Size"]);
    const issuedWaist = normalizeUniformText(sanitized["Issued Waist"], 2);
    const issuedInseam = normalizeUniformText(sanitized["Issued Inseam"], 2);
    const uniformsIssued = normalizeIssuedUniformFlag(sanitized["Uniforms Issued"]);
    const shirtTypes = normalizeIssuedAlterationList(
      sanitized["Issued Shirt Type"] || sanitized["Shirt Type"],
    );
    const shirtsGiven = parseIssuedUniformQuantity(
      sanitized["Issued Shirts Given"] || sanitized["Shirts Given"],
    );
    const pantsType = normalizeUniformAlteration(
      sanitized["Issued Pants Type"] || sanitized["Pants Type"],
    );
    const pantsGiven = parseIssuedUniformQuantity(
      sanitized["Issued Pants Given"] || sanitized["Pants Given"],
    );
    sanitized["Shirt Size"] = UNIFORM_SHIRT_SIZE_OPTIONS.has(shirtSize) ? shirtSize : "";
    sanitized.Waist = UNIFORM_WAIST_OPTIONS.has(waist) ? waist : "";
    sanitized.Inseam = UNIFORM_INSEAM_OPTIONS.has(inseam) ? inseam : "";
    sanitized["Issued Shirt Size"] =
      UNIFORM_SHIRT_SIZE_OPTIONS.has(issuedShirtSize) ? issuedShirtSize : "";
    sanitized["Issued Waist"] = UNIFORM_WAIST_OPTIONS.has(issuedWaist) ? issuedWaist : "";
    sanitized["Issued Inseam"] = UNIFORM_INSEAM_OPTIONS.has(issuedInseam) ? issuedInseam : "";
    sanitized["Uniforms Issued"] = uniformsIssued;
    if (uniformsIssued) {
      sanitized["Issued Shirt Type"] = serializeIssuedAlterationList(shirtTypes);
      sanitized["Issued Shirts Given"] = shirtsGiven > 0 ? String(shirtsGiven) : "";
      sanitized["Issued Pants Type"] = pantsType;
      sanitized["Issued Pants Given"] = pantsGiven > 0 ? String(pantsGiven) : "";
      sanitized["Shirt Type"] = serializeIssuedAlterationList(shirtTypes);
      sanitized["Shirts Given"] = shirtsGiven > 0 ? String(shirtsGiven) : "";
      sanitized["Pants Type"] = pantsType;
      sanitized["Pants Given"] = pantsGiven > 0 ? String(pantsGiven) : "";
      sanitized["Issued Pants Size"] = buildPantsSize(sanitized["Issued Waist"], sanitized["Issued Inseam"]);
    } else {
      sanitized["Issued Shirt Type"] = "";
      sanitized["Issued Shirts Given"] = "";
      sanitized["Issued Pants Type"] = "";
      sanitized["Issued Pants Given"] = "";
      sanitized["Shirt Type"] = "";
      sanitized["Shirts Given"] = "";
      sanitized["Pants Type"] = "";
      sanitized["Pants Given"] = "";
      sanitized["Issued Shirt Size"] = "";
      sanitized["Issued Waist"] = "";
      sanitized["Issued Inseam"] = "";
      sanitized["Issued Pants Size"] = "";
    }
    sanitized["Pants Size"] = buildPantsSize(sanitized.Waist, sanitized.Inseam);
    return sanitized;
  };

  const sanitizeWeeklyEntries = (entries) => {
    const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
    const sanitized = {};
    if (!entries || typeof entries !== "object") return sanitized;
    days.forEach((day) => {
      const entry = entries[day] || {};
      sanitized[day] = {
        start: clampString(entry.start, 16),
        end: clampString(entry.end, 16),
        content: clampString(entry.content, MAX_NOTE_LEN),
      };
    });
    return sanitized;
  };

  const sanitizeTodos = (todos) => {
    if (!Array.isArray(todos)) return [];
    return todos.slice(0, 500).map((todo) => ({
      id: clampId(todo && todo.id ? todo.id : ""),
      text: clampString(todo && todo.text ? todo.text : "", MAX_TODO_LEN),
      done: !!(todo && todo.done),
      createdAt: clampString(todo && todo.createdAt ? todo.createdAt : "", 64),
    }));
  };

  const sanitizeEmailTemplateType = (value) =>
    clampString(value, MAX_EMAIL_TEMPLATE_TYPE_LEN, { trim: true });

  const sanitizeEmailTemplateRecord = (record) => {
    const payload = record && typeof record === "object" ? record : {};
    return {
      toTemplate: clampString(payload.toTemplate, MAX_EMAIL_TEMPLATE_TO_LEN),
      ccTemplate: clampString(payload.ccTemplate, MAX_EMAIL_TEMPLATE_CC_LEN),
      subjectTemplate: clampString(payload.subjectTemplate, MAX_EMAIL_TEMPLATE_SUBJECT_LEN),
      bodyTemplate: clampString(payload.bodyTemplate, MAX_EMAIL_TEMPLATE_BODY_LEN),
    };
  };

  const sanitizeEmailTemplateMap = (templates) => {
    const out = {};
    if (!templates || typeof templates !== "object" || Array.isArray(templates)) return out;
    Object.keys(templates)
      .slice(0, 64)
      .forEach((type) => {
        const safeType = sanitizeEmailTemplateType(type);
        if (!safeType) return;
        out[safeType] = sanitizeEmailTemplateRecord(templates[type]);
      });
    return out;
  };

  const sanitizeEmailTemplateCustomTypes = (customTypes) => {
    const out = {};
    if (!customTypes || typeof customTypes !== "object" || Array.isArray(customTypes)) return out;
    Object.keys(customTypes)
      .slice(0, 64)
      .forEach((key) => {
        const safeKey = sanitizeEmailTemplateType(key)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "");
        const safeLabel = clampString(customTypes[key], 80, { trim: true });
        if (!safeKey || !safeLabel || !safeKey.startsWith("custom-")) return;
        out[safeKey] = safeLabel;
      });
    return out;
  };

  const sanitizeRowIds = (rowIds) => {
    if (!Array.isArray(rowIds)) return [];
    return rowIds.map((id) => clampId(id)).filter((id) => id);
  };

  const UNIFORM_WAIST_OPTIONS = new Set(
    Array.from({ length: 36 }, (_value, index) => String(20 + index)),
  );
  const UNIFORM_INSEAM_OPTIONS = new Set(
    Array.from({ length: 10 }, (_value, index) => String(27 + index)),
  );
  const UNIFORM_SHIRT_SIZE_OPTIONS = new Set([
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
  ]);

  const parseIssuedAlterationsJson = (text) => {
    if (!text || text[0] !== "[" || text[text.length - 1] !== "]") return null;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return null;
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    } catch (_error) {
      return null;
    }
  };

  const splitIssuedAlterations = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    const text = String(value || "").trim();
    if (!text) return [];
    const parsedJson = parseIssuedAlterationsJson(text);
    if (parsedJson) return parsedJson;
    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const normalizeIssuedAlterationList = (value, allowedOptions = null) => {
    const text = String(value || "").trim();
    const allowed = new Set(
      Array.from(allowedOptions || [])
        .map((item) => normalizeUniformAlteration(item))
        .filter(Boolean),
    );
    const seen = new Set();
    let normalized = splitIssuedAlterations(value)
      .map((item) => normalizeUniformAlteration(item))
      .filter((item) => {
        if (!item) return false;
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      });
    if (allowed.size) {
      const whole = normalizeUniformAlteration(text);
      const hasInvalid = normalized.some((item) => !allowed.has(item));
      if (whole && allowed.has(whole) && (!normalized.length || hasInvalid)) {
        normalized = [whole];
      } else {
        normalized = normalized.filter((item) => allowed.has(item));
      }
    }
    return normalized;
  };

  const serializeIssuedAlterationList = (value) => {
    const normalized = normalizeIssuedAlterationList(value);
    if (!normalized.length) return "";
    return JSON.stringify(normalized);
  };

  const normalizeUniformAlteration = (value) =>
    normalizeUniformText(value, MAX_UNIFORM_ALTERATION_LEN);

  const normalizeIssuedUniformFlag = (value) => {
    const text = normalizeUniformText(value, 8).toLowerCase();
    if (text === "yes") return "Yes";
    return "";
  };

  const buildPantsSize = (waist, inseam) => {
    if (!waist || !inseam) return "";
    return `${waist}x${inseam}`;
  };

  const parsePantsSize = (value) => {
    const text = String(value || "").trim();
    if (!text) return { waist: "", inseam: "" };
    const strictMatch = text.match(/^(\d{1,2})\s*[xX]\s*(\d{1,2})$/);
    if (strictMatch) return { waist: strictMatch[1], inseam: strictMatch[2] };
    const looseMatch = text.match(/(\d{1,2})\D+(\d{1,2})/);
    if (looseMatch) return { waist: looseMatch[1], inseam: looseMatch[2] };
    return { waist: "", inseam: "" };
  };

  const parseIssuedUniformQuantity = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const whole = Math.floor(num);
    if (whole < 1 || whole > 4) return 0;
    return whole;
  };

  const parseUniformQuantity = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const whole = Math.floor(num);
    if (whole < 0) return 0;
    return Math.min(whole, 1000000);
  };

  const normalizeUniformText = (value, maxLen) => clampString(value, maxLen, { trim: true });
  const normalizeUniformMeasurement = (value) => normalizeUniformText(value, 2);
  const normalizeUniformShirtSize = (value) => {
    const text = normalizeUniformText(value, MAX_UNIFORM_SIZE_LEN).toUpperCase();
    if (!text) return "";
    if (UNIFORM_SHIRT_SIZE_OPTIONS.has(text)) return text;
    if (text === "XXL") return "2XL";
    if (text === "XXXL") return "3XL";
    return text;
  };

  const normalizeUniformType = (value) => {
    const type = normalizeUniformText(value, MAX_UNIFORM_TYPE_LEN);
    if (!type) return "";
    if (type.toLowerCase() === "shirts") return "Shirt";
    if (type.toLowerCase() === "pants") return "Pants";
    return type;
  };

  const normalizeUniformBranch = (value) => normalizeUniformText(value, MAX_UNIFORM_BRANCH_LEN);

  const uniformKey = ({ alteration, type, size, waist, inseam, branch }) =>
    [branch, type, size || buildPantsSize(waist, inseam), alteration]
      .map((part) => String(part || "").trim().toLowerCase())
      .join("|");

  const sanitizeUniformPayload = (payload) => {
    const alteration = normalizeUniformAlteration(payload && payload.alteration);
    const type = normalizeUniformType(payload && payload.type);
    let size = normalizeUniformText(payload && payload.size, MAX_UNIFORM_SIZE_LEN);
    let waist = normalizeUniformMeasurement(payload && (payload.waist ?? payload.Waist));
    let inseam = normalizeUniformMeasurement(payload && (payload.inseam ?? payload.Inseam));
    const branch = normalizeUniformBranch(payload && payload.branch);
    const quantity = parseUniformQuantity(payload && payload.quantity);
    if (type === "Pants") {
      const parsed = parsePantsSize(size);
      if (!waist) waist = parsed.waist;
      if (!inseam) inseam = parsed.inseam;
      waist = UNIFORM_WAIST_OPTIONS.has(waist) ? waist : "";
      inseam = UNIFORM_INSEAM_OPTIONS.has(inseam) ? inseam : "";
      size = buildPantsSize(waist, inseam);
    } else if (type === "Shirt") {
      size = normalizeUniformShirtSize(size);
      waist = "";
      inseam = "";
    } else {
      waist = "";
      inseam = "";
    }
    return { alteration, type, size, waist, inseam, branch, quantity };
  };

  const sanitizeUniformEntry = (entry) => {
    const payload = sanitizeUniformPayload(entry || {});
    return {
      id: clampId(entry && entry.id ? entry.id : "") || createId(),
      alteration: payload.alteration,
      type: payload.type,
      size: payload.size,
      waist: payload.waist,
      inseam: payload.inseam,
      quantity: payload.quantity,
      branch: payload.branch,
    };
  };

  const upsertUniformStock = (db, payload) => {
    ensureDbShape(db);
    const normalized = sanitizeUniformPayload(payload);
    if (!normalized.type || !normalized.size || !normalized.branch || normalized.quantity <= 0) {
      return null;
    }
    const key = uniformKey(normalized);
    const existing = (db.uniforms || []).find(
      (item) => uniformKey(item || {}) === key,
    );
    if (existing) {
      existing.quantity = parseUniformQuantity(existing.quantity) + normalized.quantity;
      return existing;
    }
    const row = {
      id: createId(),
      alteration: normalized.alteration,
      type: normalized.type,
      size: normalized.size,
      waist: normalized.waist,
      inseam: normalized.inseam,
      quantity: normalized.quantity,
      branch: normalized.branch,
    };
    db.uniforms.push(row);
    return row;
  };

  const decrementUniformStock = (db, payload) => {
    ensureDbShape(db);
    const normalized = sanitizeUniformPayload(payload);
    if (!normalized.type || !normalized.size || !normalized.branch || normalized.quantity <= 0) {
      return 0;
    }
    const key = uniformKey(normalized);
    const item = (db.uniforms || []).find((entry) => uniformKey(entry || {}) === key);
    if (!item) return 0;
    const available = parseUniformQuantity(item.quantity);
    if (available <= 0) return 0;
    const deducted = Math.min(available, normalized.quantity);
    item.quantity = available - deducted;
    if (item.quantity <= 0) {
      db.uniforms = (db.uniforms || []).filter((entry) => entry && entry.id !== item.id);
    }
    return deducted;
  };

  const appendUniformAdjustment = (adjustments, payload, quantity) => {
    const normalized = sanitizeUniformPayload({ ...(payload || {}), quantity });
    if (!normalized.type || !normalized.size || !normalized.branch || normalized.quantity <= 0) {
      return;
    }
    const key = uniformKey(normalized);
    const existing = adjustments.find((entry) => uniformKey(entry || {}) === key);
    if (existing) {
      existing.quantity = parseUniformQuantity(existing.quantity) + normalized.quantity;
      return;
    }
    adjustments.push({
      alteration: normalized.alteration,
      type: normalized.type,
      size: normalized.size,
      quantity: normalized.quantity,
      branch: normalized.branch,
    });
  };

  const listUniformAlterationsForStock = (db, payload) => {
    const type = normalizeUniformType(payload && payload.type);
    const waist = normalizeUniformMeasurement(payload && payload.waist);
    const inseam = normalizeUniformMeasurement(payload && payload.inseam);
    const size =
      normalizeUniformText(payload && payload.size, MAX_UNIFORM_SIZE_LEN) ||
      buildPantsSize(waist, inseam);
    const branch = normalizeUniformBranch(payload && payload.branch);
    if (!type || !size || !branch) return [];
    const seen = new Set();
    (db && Array.isArray(db.uniforms) ? db.uniforms : []).forEach((entry) => {
      const item = sanitizeUniformEntry(entry);
      if (normalizeUniformType(item.type) !== type) return;
      if (normalizeUniformText(item.size, MAX_UNIFORM_SIZE_LEN) !== size) return;
      if (normalizeUniformBranch(item.branch) !== branch) return;
      if (parseUniformQuantity(item.quantity) <= 0) return;
      const alteration = normalizeUniformAlteration(item.alteration);
      if (!alteration || seen.has(alteration)) return;
      seen.add(alteration);
    });
    return [...seen];
  };

  const deductUniformsAcrossAlterations = (db, payload) => {
    const normalizedQuantity = parseIssuedUniformQuantity(payload && payload.quantity);
    const type = normalizeUniformType(payload && payload.type);
    const waist = normalizeUniformMeasurement(payload && payload.waist);
    const inseam = normalizeUniformMeasurement(payload && payload.inseam);
    const size =
      normalizeUniformText(payload && payload.size, MAX_UNIFORM_SIZE_LEN) ||
      buildPantsSize(waist, inseam);
    const branch = normalizeUniformBranch(payload && payload.branch);
    const alterations = normalizeIssuedAlterationList(payload && payload.alterations);
    if (!normalizedQuantity || !type || !size || !branch) return [];
    const targets = alterations.length ? alterations : [normalizeUniformAlteration(payload && payload.alteration)];
    const cleanTargets = targets.filter((item) => item !== null && item !== undefined);
    if (!cleanTargets.length) cleanTargets.push("");
    const adjustments = [];

    if (cleanTargets.length === 1) {
      const alteration = cleanTargets[0];
      const deducted = decrementUniformStock(db, {
        alteration,
        type,
        size,
        branch,
        quantity: normalizedQuantity,
      });
      if (deducted > 0) {
        appendUniformAdjustment(adjustments, { alteration, type, size, branch }, deducted);
      }
      return adjustments;
    }

    let remaining = normalizedQuantity;
    let idx = 0;
    let misses = 0;
    while (remaining > 0 && misses < cleanTargets.length) {
      const alteration = cleanTargets[idx % cleanTargets.length];
      const deducted = decrementUniformStock(db, {
        alteration,
        type,
        size,
        branch,
        quantity: 1,
      });
      if (deducted > 0) {
        remaining -= deducted;
        misses = 0;
        appendUniformAdjustment(adjustments, { alteration, type, size, branch }, deducted);
      } else {
        misses += 1;
      }
      idx += 1;
    }
    return adjustments;
  };

  const normalizeTodos = (todos = []) => {
    let changed = false;
    todos.forEach((todo) => {
      if (!todo.id) {
        todo.id = createId();
        changed = true;
      }
      if (typeof todo.done !== "boolean") {
        todo.done = !!todo.done;
        changed = true;
      }
    });
    return changed;
  };

  const parseDateValue = (value) => {
    const text = String(value || "").trim();
    if (!text) return null;
    const ts = Date.parse(text);
    return Number.isNaN(ts) ? null : ts;
  };

  const sortCandidateRowsByHireDate = (rows) => {
    return rows.sort((a, b) => {
      const aTime = parseDateValue(a["Hire Date"]);
      const bTime = parseDateValue(b["Hire Date"]);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      if (aTime !== bTime) return aTime - bTime;
      const aName = String(a["Candidate Name"] || "");
      const bName = String(b["Candidate Name"] || "");
      return aName.localeCompare(bName);
    });
  };

  const orderColumns = (columns = []) => {
    return [...columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  };

  const pickFallbackColumn = (columns, removedId) => {
    const ordered = orderColumns(columns);
    const index = ordered.findIndex((col) => col.id === removedId);
    const remaining = ordered.filter((col) => col.id !== removedId);
    if (!remaining.length) return null;
    if (index === -1) return remaining[0];
    const after = ordered.slice(index + 1).find((col) => col.id !== removedId);
    if (after) return after;
    const before = [...ordered.slice(0, index)].reverse().find((col) => col.id !== removedId);
    return before || remaining[0];
  };

  const moveCardsToColumn = (db, fromColumnIds, targetColumnId) => {
    if (!db || !targetColumnId || !fromColumnIds || fromColumnIds.size === 0) return;
    const moving = db.kanban.cards.filter((card) => fromColumnIds.has(card.column_id));
    if (!moving.length) return;
    const now = new Date().toISOString();
    const targetCards = db.kanban.cards.filter((card) => card.column_id === targetColumnId);
    let nextOrder = Math.max(0, ...targetCards.map((c) => c.order || 0)) + 1;
    moving
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((card) => {
        card.column_id = targetColumnId;
        card.order = nextOrder++;
        card.updated_at = now;
      });
  };

  const LAST_COLUMN_MESSAGE =
    "Please remove candidate cards from the last remaining column before deleting it.";

  const removeKanbanColumns = (db, columnIds, { recordUndo = true } = {}) => {
    const ids = new Set(columnIds || []);
    const removedColumns = db.kanban.columns.filter((col) => ids.has(col.id));
    const remaining = db.kanban.columns.filter((col) => !ids.has(col.id));
    const removedCards = db.kanban.cards.filter((card) => ids.has(card.column_id));
    if (remaining.length === 0 && removedCards.length) {
      return { ok: false, error: "last_column", message: LAST_COLUMN_MESSAGE };
    }
    const removedColumnsSnapshot = removedColumns.map((col) => ({ ...col }));
    const removedCardsSnapshot = removedCards.map((card) => ({ ...card }));

    if (remaining.length > 0 && removedCards.length) {
      const target = pickFallbackColumn(db.kanban.columns, removedColumns[0]?.id);
      if (target) {
        moveCardsToColumn(db, new Set(removedColumns.map((col) => col.id)), target.id);
      }
    }
    db.kanban.columns = remaining;

    let undoId = null;
    if (recordUndo && removedColumnsSnapshot.length) {
      undoId = pushRecycleItem(db, {
        type: "kanban_columns",
        columns: removedColumnsSnapshot,
        cards: removedCardsSnapshot,
      });
    }

    return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards, undoId };
  };

  const sanitizeFilename = (name) => {
    const safe = String(name || "")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "_");
    return safe || "export";
  };

  const shouldNeutralizeCsv = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    const trimmed = text.trimStart();
    if (!trimmed) return false;
    if (trimmed.startsWith("'")) return false;
    return /^[=+\-@]/.test(trimmed);
  };

  const neutralizeCsvFormula = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return shouldNeutralizeCsv(text) ? `'${text}` : text;
  };

  const csvEscape = (value) => {
    const str = neutralizeCsvFormula(value);
    if (/[,"\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rowsToCsv = (columns, rows) => {
    let cols = Array.isArray(columns) ? columns.filter((col) => col && col !== "__rowId") : [];
    const dataRows = Array.isArray(rows) ? rows : [];
    if (!cols.length && dataRows.length) {
      cols = Object.keys(dataRows[0]).filter((col) => col !== "__rowId");
    }
    const lines = [];
    if (cols.length) {
      lines.push(cols.map(csvEscape).join(","));
    }
    dataRows.forEach((row) => {
      const line = cols.map((col) => csvEscape(row ? row[col] : "")).join(",");
      lines.push(line);
    });
    return lines.join("\n");
  };

  const SENSITIVE_PII_FIELDS = [
    "Contact Phone",
    "Contact Email",
    "Background Provider",
    "Background Cleared Date",
    "Background MVR Flag",
    "License Type",
    "MA CORI Status",
    "MA CORI Date",
    "NH GC Status",
    "NH GC Expiration Date",
    "NH GC ID Number",
    "ME GC Status",
    "ME GC Expiration Date",
    "ID Type",
    "State Abbreviation",
    "ID Number",
    "DOB",
    "EXP",
    "Other ID Type",
    "Social",
    "Bank Name",
    "Account Type",
    "Routing Number",
    "Account Number",
    "Emergency Contact Name",
    "Emergency Contact Relationship",
    "Emergency Contact Phone",
    "Additional Details",
    "Additional Notes",
  ];

  const SENSITIVE_CARD_FIELDS = ["icims_id", "employee_id"];

  const parseMilitaryTime = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length !== 4) return null;
    const hours = Number(digits.slice(0, 2));
    const minutes = Number(digits.slice(2, 4));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const roundToQuarterHour = (minutes) => {
    if (minutes === null || minutes === undefined) return null;
    const rounded = Math.round(minutes / 15) * 15;
    const maxMinutes = 23 * 60 + 45;
    return Math.min(Math.max(rounded, 0), maxMinutes);
  };

  const formatMilitaryTime = (minutes) => {
    if (minutes === null || minutes === undefined) return "";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  };

  const formatTotalHours = (minutes) => {
    if (minutes === null || minutes === undefined) return "";
    const hours = minutes / 60;
    return Number.isFinite(hours) ? hours.toFixed(2) : "";
  };

  const TABLE_DEFS = {
    kanban_columns: {
      name: "Kanban Columns",
      columns: ["id", "name", "order", "created_at", "updated_at"],
      rows: (db) =>
        (db.kanban.columns || []).map((col) => ({
          __rowId: col.id,
          id: col.id,
          name: col.name,
          order: col.order ?? "",
          created_at: col.created_at ?? "",
          updated_at: col.updated_at ?? "",
        })),
    },
    kanban_cards: {
      name: "Kanban Cards",
      columns: [
        "uuid",
        "candidate_name",
        "icims_id",
        "employee_id",
        "job_id",
        "req_id",
        "job_name",
        "job_location",
        "manager",
        "branch",
        "column_id",
        "order",
        "created_at",
        "updated_at",
      ],
      rows: (db) =>
        (db.kanban.cards || []).map((card) => ({
          __rowId: card.uuid,
          uuid: card.uuid,
          candidate_name: card.candidate_name || "",
          icims_id: card.icims_id || "",
          employee_id: card.employee_id || "",
          job_id: card.job_id || "",
          req_id: card.req_id || "",
          job_name: card.job_name || "",
          job_location: card.job_location || "",
          manager: card.manager || "",
          branch: card.branch || "",
          column_id: card.column_id || "",
          order: card.order ?? "",
          created_at: card.created_at || "",
          updated_at: card.updated_at || "",
        })),
    },
    candidate_data: {
      name: "Onboarding Candidate Data",
      columns: [...KANBAN_CANDIDATE_FIELDS],
      rows: (db) => {
        const rows = (db.kanban.candidates || []).map((row) => ({
          __rowId: row["candidate UUID"] || row["Candidate Name"] || createId(),
          ...KANBAN_CANDIDATE_FIELDS.reduce((acc, key) => {
            acc[key] = row[key] ?? "";
            return acc;
          }, {}),
        }));
        return sortCandidateRowsByHireDate(rows);
      },
    },
    uniform_inventory: {
      name: "Uniform Inventory",
      columns: ["Alteration", "Type", "Size", "Waist", "Inseam", "Quantity", "Branch"],
      rows: (db) =>
        (db.uniforms || [])
          .map((entry) => sanitizeUniformEntry(entry))
          .sort((a, b) => {
            const branchCompare = a.branch.localeCompare(b.branch);
            if (branchCompare !== 0) return branchCompare;
            const typeCompare = a.type.localeCompare(b.type);
            if (typeCompare !== 0) return typeCompare;
            const alterationCompare = String(a.alteration || "").localeCompare(
              String(b.alteration || ""),
            );
            if (alterationCompare !== 0) return alterationCompare;
            return a.size.localeCompare(b.size);
          })
          .map((entry) => ({
            __rowId: entry.id,
            Alteration: entry.alteration || "",
            Type: entry.type,
            Size: entry.size,
            Waist: entry.waist || "",
            Inseam: entry.inseam || "",
            Quantity: String(parseUniformQuantity(entry.quantity)),
            Branch: entry.branch,
          })),
    },
    weekly_entries: {
      name: "Weekly Tracker Entries",
      columns: ["week_start", "week_end", "day", "start", "end", "content"],
      rows: (db) => {
        const rows = [];
        const weeks = db.weekly || {};
        Object.values(weeks).forEach((week) => {
          const entries = week.entries || {};
          Object.keys(entries).forEach((day) => {
            const entry = entries[day] || {};
            rows.push({
              __rowId: `${week.week_start}-${day}`,
              week_start: week.week_start || "",
              week_end: week.week_end || "",
              day,
              start: entry.start || "",
              end: entry.end || "",
              content: entry.content || "",
            });
          });
        });
        return rows;
      },
    },
    todos: {
      name: "Todos",
      columns: ["id", "text", "done", "createdAt"],
      rows: (db) => {
        const todos = db.todos || [];
        return todos.map((todo) => ({
          __rowId: todo.id,
          id: todo.id,
          text: todo.text || "",
          done: !!todo.done,
          createdAt: todo.createdAt || "",
        }));
      },
    },
  };

  const buildTable = (tableId, db) => {
    const def = TABLE_DEFS[tableId];
    if (!def) return null;
    return {
      id: tableId,
      name: def.name,
      columns: def.columns,
      rows: def.rows(db),
    };
  };

  const ensureCandidateRow = (db, candidateId) => {
    let row = db.kanban.candidates.find((item) => item["candidate UUID"] === candidateId);
    if (!row) {
      row = {};
      KANBAN_CANDIDATE_FIELDS.forEach((field) => {
        row[field] = "";
      });
      row["candidate UUID"] = candidateId;
      const card = db.kanban.cards.find((c) => c.uuid === candidateId);
      if (card) {
        row["Candidate Name"] = card.candidate_name || "";
        row["REQ ID"] = card.req_id || "";
      }
      db.kanban.candidates.push(row);
    } else {
      KANBAN_CANDIDATE_FIELDS.forEach((field) => {
        if (row[field] === undefined) row[field] = "";
      });
      if (!row["candidate UUID"]) row["candidate UUID"] = candidateId;
    }
    return row;
  };

  const jobIdName = (jobId, jobName) => {
    return [jobId, jobName].filter(Boolean).join(" ").trim();
  };

  const ensureDbShape = (db) => {
    if (!db || typeof db !== "object") return defaultDb();
    if (!db.kanban || typeof db.kanban !== "object") {
      db.kanban = { columns: [], cards: [], candidates: [] };
    }
    if (!Array.isArray(db.kanban.columns)) db.kanban.columns = [];
    if (!Array.isArray(db.kanban.cards)) db.kanban.cards = [];
    if (!Array.isArray(db.kanban.candidates)) db.kanban.candidates = [];
    if (!Array.isArray(db.uniforms)) db.uniforms = [];
    if (!db.weekly || typeof db.weekly !== "object") db.weekly = {};
    if (!Array.isArray(db.todos)) db.todos = [];
    if (!db.recycle || typeof db.recycle !== "object") db.recycle = { items: [], redo: [] };
    if (!Array.isArray(db.recycle.items)) db.recycle.items = [];
    if (!Array.isArray(db.recycle.redo)) db.recycle.redo = [];
    return db;
  };

  const migrateDb = (db) => {
    const next = ensureDbShape(db);
    let version = Number.isFinite(next.version) ? Number(next.version) : 0;
    if (!version) version = 1;
    if (version < 2) {
      if (!next.recycle) next.recycle = { items: [], redo: [] };
      if (!Array.isArray(next.recycle.items)) next.recycle.items = [];
      if (!Array.isArray(next.recycle.redo)) next.recycle.redo = [];
    }
    if (version < 3) {
      if (!Array.isArray(next.uniforms)) next.uniforms = [];
    }
    next.version = DB_VERSION;
    return next;
  };

  const pruneRecycleList = (items) => {
    if (!Array.isArray(items)) return [];
    const now = Date.now();
    const filtered = items.filter((item) => {
      if (!item || !item.deleted_at) return false;
      const ts = Date.parse(item.deleted_at);
      if (Number.isNaN(ts)) return false;
      return now - ts <= RECYCLE_TTL_MS;
    });
    if (filtered.length > RECYCLE_LIMIT) {
      return filtered.slice(-RECYCLE_LIMIT);
    }
    return filtered;
  };

  const pruneRecycleBin = (db) => {
    if (!db || !db.recycle) return;
    db.recycle.items = pruneRecycleList(db.recycle.items);
    db.recycle.redo = pruneRecycleList(db.recycle.redo);
  };

  const pushRecycleItem = (db, item) => {
    if (!db || !item) return null;
    ensureDbShape(db);
    const entry = {
      id: createId(),
      deleted_at: new Date().toISOString(),
      ...item,
    };
    db.recycle.items.push(entry);
    pruneRecycleBin(db);
    return entry.id;
  };

  const popRecycleItem = (db, id) => {
    if (!db || !db.recycle || !Array.isArray(db.recycle.items)) return null;
    const idx = db.recycle.items.findIndex((item) => item && item.id === id);
    if (idx === -1) return null;
    const [item] = db.recycle.items.splice(idx, 1);
    return item || null;
  };

  const pushRedoItem = (db, item) => {
    if (!db || !item) return null;
    ensureDbShape(db);
    const entry = {
      id: createId(),
      deleted_at: new Date().toISOString(),
      ...item,
    };
    db.recycle.redo.push(entry);
    pruneRecycleBin(db);
    return entry.id;
  };

  const popRedoItem = (db, id) => {
    if (!db || !db.recycle || !Array.isArray(db.recycle.redo)) return null;
    const idx = db.recycle.redo.findIndex((item) => item && item.id === id);
    if (idx === -1) return null;
    const [item] = db.recycle.redo.splice(idx, 1);
    return item || null;
  };

  const restoreRecycleItem = (db, item) => {
    if (!db || !item || !item.type) return false;
    ensureDbShape(db);
    switch (item.type) {
      case "kanban_cards": {
        const cards = Array.isArray(item.cards) ? item.cards : [];
        const rows = Array.isArray(item.candidates) ? item.candidates : [];
        const uniformAdjustments = Array.isArray(item.uniformAdjustments) ? item.uniformAdjustments : [];
        const existingCardIds = new Set(db.kanban.cards.map((card) => card.uuid));
        const existingRowIds = new Set(db.kanban.candidates.map((row) => row["candidate UUID"]));
        cards.forEach((card) => {
          if (card && card.uuid && !existingCardIds.has(card.uuid)) {
            db.kanban.cards.push(card);
          }
        });
        rows.forEach((row) => {
          const rowId = row && row["candidate UUID"];
          if (rowId && !existingRowIds.has(rowId)) {
            db.kanban.candidates.push(row);
          }
        });
        uniformAdjustments.forEach((entry) => {
          const safeEntry = sanitizeUniformPayload(entry);
          if (safeEntry.quantity > 0) upsertUniformStock(db, safeEntry);
        });
        return true;
      }
      case "kanban_columns": {
        const columns = Array.isArray(item.columns) ? item.columns : [];
        const cards = Array.isArray(item.cards) ? item.cards : [];
        const existingColumnIds = new Set(db.kanban.columns.map((col) => col.id));
        columns.forEach((col) => {
          if (col && col.id && !existingColumnIds.has(col.id)) {
            db.kanban.columns.push(col);
          }
        });
        const cardIds = new Set(cards.map((card) => card && card.uuid).filter(Boolean));
        db.kanban.cards = db.kanban.cards.filter((card) => !cardIds.has(card.uuid));
        cards.forEach((card) => {
          if (card && card.uuid) db.kanban.cards.push(card);
        });
        return true;
      }
      case "candidate_rows": {
        const rows = Array.isArray(item.candidates) ? item.candidates : [];
        const existingRowIds = new Set(db.kanban.candidates.map((row) => row["candidate UUID"]));
        rows.forEach((row) => {
          const rowId = row && row["candidate UUID"];
          if (rowId && !existingRowIds.has(rowId)) {
            db.kanban.candidates.push(row);
          }
        });
        return true;
      }
      case "weekly_entries": {
        const entries = Array.isArray(item.entries) ? item.entries : [];
        entries.forEach((entry) => {
          if (!entry || !entry.week_start || !entry.day) return;
          if (!db.weekly[entry.week_start]) {
            db.weekly[entry.week_start] = {
              week_start: entry.week_start,
              week_end: entry.week_end || "",
              entries: {},
            };
          }
          db.weekly[entry.week_start].entries[entry.day] = entry.payload || {};
        });
        return true;
      }
      case "todos": {
        const todos = Array.isArray(item.todos) ? item.todos : [];
        const existingIds = new Set(db.todos.map((todo) => todo.id));
        todos.forEach((todo) => {
          if (todo && todo.id && !existingIds.has(todo.id)) {
            db.todos.push(todo);
          }
        });
        return true;
      }
      case "uniform_rows": {
        const uniforms = Array.isArray(item.uniforms) ? item.uniforms : [];
        const existingIds = new Set((db.uniforms || []).map((entry) => entry.id));
        uniforms.forEach((entry) => {
          const safeEntry = sanitizeUniformEntry(entry);
          if (!safeEntry.type || !safeEntry.size || !safeEntry.branch) return;
          if (existingIds.has(safeEntry.id)) return;
          db.uniforms.push(safeEntry);
          existingIds.add(safeEntry.id);
        });
        return true;
      }
      default:
        return false;
    }
  };

  const reapplyRecycleItem = (db, item) => {
    if (!db || !item || !item.type) return false;
    ensureDbShape(db);
    switch (item.type) {
      case "kanban_cards": {
        const cards = Array.isArray(item.cards) ? item.cards : [];
        const rows = Array.isArray(item.candidates) ? item.candidates : [];
        const uniformAdjustments = Array.isArray(item.uniformAdjustments) ? item.uniformAdjustments : [];
        const cardIds = new Set(cards.map((card) => card && card.uuid).filter(Boolean));
        const rowIds = new Set(rows.map((row) => row && row["candidate UUID"]).filter(Boolean));
        db.kanban.cards = db.kanban.cards.filter((card) => !cardIds.has(card.uuid));
        db.kanban.candidates = db.kanban.candidates.filter(
          (row) => !rowIds.has(row["candidate UUID"]),
        );
        uniformAdjustments.forEach((entry) => {
          const safeEntry = sanitizeUniformPayload(entry);
          if (safeEntry.quantity > 0) decrementUniformStock(db, safeEntry);
        });
        return true;
      }
      case "kanban_columns": {
        const columnIds = new Set(
          (Array.isArray(item.columns) ? item.columns : [])
            .map((col) => col && col.id)
            .filter(Boolean),
        );
        if (!columnIds.size) return false;
        const result = removeKanbanColumns(db, columnIds, { recordUndo: false });
        return !!(result && result.ok);
      }
      case "candidate_rows": {
        const rows = Array.isArray(item.candidates) ? item.candidates : [];
        const rowIds = new Set(rows.map((row) => row && row["candidate UUID"]).filter(Boolean));
        db.kanban.candidates = db.kanban.candidates.filter(
          (row) => !rowIds.has(row["candidate UUID"]),
        );
        return true;
      }
      case "weekly_entries": {
        const entries = Array.isArray(item.entries) ? item.entries : [];
        const weeks = db.weekly || {};
        entries.forEach((entry) => {
          if (!entry || !entry.week_start || !entry.day) return;
          if (weeks[entry.week_start] && weeks[entry.week_start].entries) {
            delete weeks[entry.week_start].entries[entry.day];
          }
        });
        db.weekly = weeks;
        return true;
      }
      case "todos": {
        const todos = Array.isArray(item.todos) ? item.todos : [];
        const ids = new Set(todos.map((todo) => todo && todo.id).filter(Boolean));
        db.todos = (db.todos || []).filter((todo) => !ids.has(todo.id));
        return true;
      }
      case "uniform_rows": {
        const uniforms = Array.isArray(item.uniforms) ? item.uniforms : [];
        const ids = new Set(
          uniforms
            .map((entry) => clampId(entry && entry.id ? entry.id : ""))
            .filter(Boolean),
        );
        db.uniforms = (db.uniforms || []).filter((entry) => !ids.has(entry && entry.id));
        return true;
      }
      default:
        return false;
    }
  };

  const isPlainObject = (value) =>
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

  const SUSPICIOUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const hasSuspiciousKey = (obj) =>
    isPlainObject(obj) && Object.keys(obj).some((key) => SUSPICIOUS_KEYS.has(key));

  const hasBlockedControlChars = (text) => {
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
        return true;
      }
    }
    return false;
  };

  const hasSuspiciousText = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (hasBlockedControlChars(text)) return true;
    return /(;--|\/\*|\*\/|drop\s+table|alter\s+table|union\s+select|insert\s+into|delete\s+from)/i.test(
      text,
    );
  };

  const validateText = (value, maxLen, label) => {
    const text = value === null || value === undefined ? "" : String(value);
    if (text.length > maxLen) {
      return {
        ok: false,
        code: "broken",
        message: `${label} exceeds the maximum allowed length.`,
      };
    }
    if (hasSuspiciousText(text)) {
      return {
        ok: false,
        code: "fraud",
        message: `${label} contains suspicious content.`,
      };
    }
    return { ok: true };
  };

  const validateDb = (db) => {
    if (!isPlainObject(db)) {
      return { ok: false, code: "broken", message: "Database payload is not an object." };
    }
    if (hasSuspiciousKey(db)) {
      return { ok: false, code: "fraud", message: "Database contains suspicious keys." };
    }
    if (Number.isFinite(db.version) && db.version > DB_VERSION) {
      return {
        ok: false,
        code: "broken",
        message: "Database version is newer than this app supports.",
      };
    }

    if (!isPlainObject(db.kanban)) {
      return { ok: false, code: "broken", message: "Kanban data is missing or invalid." };
    }
    if (!Array.isArray(db.kanban.columns)) {
      return { ok: false, code: "broken", message: "Kanban columns are missing." };
    }
    if (!Array.isArray(db.kanban.cards)) {
      return { ok: false, code: "broken", message: "Kanban cards are missing." };
    }
    if (!Array.isArray(db.kanban.candidates)) {
      return { ok: false, code: "broken", message: "Candidate rows are missing." };
    }

    for (const column of db.kanban.columns) {
      if (!isPlainObject(column) || hasSuspiciousKey(column)) {
        return { ok: false, code: "fraud", message: "Column data looks suspicious." };
      }
      if (!column.id || typeof column.id !== "string") {
        return { ok: false, code: "broken", message: "Column IDs are invalid." };
      }
      const nameCheck = validateText(column.name, MAX_COLUMN_NAME_LEN, "Column name");
      if (!nameCheck.ok) return nameCheck;
      if (column.order !== undefined && column.order !== null && !Number.isFinite(column.order)) {
        return { ok: false, code: "broken", message: "Column order values are invalid." };
      }
    }

    for (const card of db.kanban.cards) {
      if (!isPlainObject(card) || hasSuspiciousKey(card)) {
        return { ok: false, code: "fraud", message: "Card data looks suspicious." };
      }
      if (!card.uuid || typeof card.uuid !== "string") {
        return { ok: false, code: "broken", message: "Card IDs are invalid." };
      }
      if (!card.column_id || typeof card.column_id !== "string") {
        return { ok: false, code: "broken", message: "Card column references are invalid." };
      }
      const fields = [
        ["Candidate name", card.candidate_name],
        ["ICIMS", card.icims_id],
        ["Employee", card.employee_id],
        ["Job ID", card.job_id],
        ["REQ ID", card.req_id],
        ["Job name", card.job_name],
        ["Job location", card.job_location],
        ["Manager", card.manager],
        ["Branch", card.branch],
      ];
      for (const [label, value] of fields) {
        const check = validateText(value, MAX_FIELD_LEN, label);
        if (!check.ok) return check;
      }
      if (card.order !== undefined && card.order !== null && !Number.isFinite(card.order)) {
        return { ok: false, code: "broken", message: "Card order values are invalid." };
      }
    }

    const allowedCandidateKeys = new Set(KANBAN_CANDIDATE_FIELDS);
    for (const row of db.kanban.candidates) {
      if (!isPlainObject(row) || hasSuspiciousKey(row)) {
        return { ok: false, code: "fraud", message: "Candidate rows look suspicious." };
      }
      const keys = Object.keys(row);
      for (const key of keys) {
        if (!allowedCandidateKeys.has(key)) {
          return {
            ok: false,
            code: "broken",
            message: "Candidate data columns do not match this app.",
          };
        }
        const limit = key === "Additional Notes" || key === "Additional Details" ? MAX_NOTE_LEN : MAX_FIELD_LEN;
        const check = validateText(row[key], limit, key);
        if (!check.ok) return check;
      }
      const rowId = row["candidate UUID"];
      if (!rowId || typeof rowId !== "string") {
        return { ok: false, code: "broken", message: "Candidate UUIDs are missing." };
      }
    }

    if (!Array.isArray(db.uniforms)) {
      return { ok: false, code: "broken", message: "Uniform inventory is invalid." };
    }
    for (const item of db.uniforms) {
      if (!isPlainObject(item) || hasSuspiciousKey(item)) {
        return { ok: false, code: "fraud", message: "Uniform rows look suspicious." };
      }
      if (!item.id || typeof item.id !== "string") {
        return { ok: false, code: "broken", message: "Uniform row IDs are invalid." };
      }
      const alterationCheck = validateText(
        item.alteration,
        MAX_UNIFORM_ALTERATION_LEN,
        "Uniform alteration",
      );
      if (!alterationCheck.ok) return alterationCheck;
      const typeCheck = validateText(item.type, MAX_UNIFORM_TYPE_LEN, "Uniform type");
      if (!typeCheck.ok) return typeCheck;
      const sizeCheck = validateText(item.size, MAX_UNIFORM_SIZE_LEN, "Uniform size");
      if (!sizeCheck.ok) return sizeCheck;
      const waistCheck = validateText(item.waist, 2, "Uniform waist");
      if (!waistCheck.ok) return waistCheck;
      const inseamCheck = validateText(item.inseam, 2, "Uniform inseam");
      if (!inseamCheck.ok) return inseamCheck;
      const branchCheck = validateText(item.branch, MAX_UNIFORM_BRANCH_LEN, "Uniform branch");
      if (!branchCheck.ok) return branchCheck;
      const normalizedType = normalizeUniformType(item.type);
      if (normalizedType === "Pants") {
        const parsed = parsePantsSize(item.size);
        const waist = normalizeUniformMeasurement(item.waist || parsed.waist);
        const inseam = normalizeUniformMeasurement(item.inseam || parsed.inseam);
        if (!UNIFORM_WAIST_OPTIONS.has(waist) || !UNIFORM_INSEAM_OPTIONS.has(inseam)) {
          return { ok: false, code: "broken", message: "Uniform pants measurements are invalid." };
        }
      }
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        return { ok: false, code: "broken", message: "Uniform quantity values are invalid." };
      }
    }

    if (!isPlainObject(db.weekly)) {
      return { ok: false, code: "broken", message: "Weekly data is invalid." };
    }
    for (const week of Object.values(db.weekly)) {
      if (!isPlainObject(week) || hasSuspiciousKey(week)) {
        return { ok: false, code: "fraud", message: "Weekly data looks suspicious." };
      }
      if (!isPlainObject(week.entries || {})) {
        return { ok: false, code: "broken", message: "Weekly entries are invalid." };
      }
      const weekStartCheck = validateText(week.week_start, MAX_FIELD_LEN, "Week start");
      if (!weekStartCheck.ok) return weekStartCheck;
      const weekEndCheck = validateText(week.week_end, MAX_FIELD_LEN, "Week end");
      if (!weekEndCheck.ok) return weekEndCheck;
      for (const entry of Object.values(week.entries || {})) {
        if (!isPlainObject(entry) || hasSuspiciousKey(entry)) {
          return { ok: false, code: "fraud", message: "Weekly entry looks suspicious." };
        }
        const startCheck = validateText(entry.start, MAX_FIELD_LEN, "Weekly start");
        if (!startCheck.ok) return startCheck;
        const endCheck = validateText(entry.end, MAX_FIELD_LEN, "Weekly end");
        if (!endCheck.ok) return endCheck;
        const contentCheck = validateText(entry.content, MAX_NOTE_LEN, "Weekly content");
        if (!contentCheck.ok) return contentCheck;
      }
    }

    if (!Array.isArray(db.todos)) {
      return { ok: false, code: "broken", message: "Todo data is invalid." };
    }
    for (const todo of db.todos) {
      if (!isPlainObject(todo) || hasSuspiciousKey(todo)) {
        return { ok: false, code: "fraud", message: "Todo data looks suspicious." };
      }
      if (!todo.id || typeof todo.id !== "string") {
        return { ok: false, code: "broken", message: "Todo IDs are invalid." };
      }
      if (typeof todo.done !== "boolean") {
        return { ok: false, code: "broken", message: "Todo status values are invalid." };
      }
      const textCheck = validateText(todo.text, MAX_TODO_LEN, "Todo text");
      if (!textCheck.ok) return textCheck;
      if (
        todo.createdAt !== undefined &&
        todo.createdAt !== null &&
        typeof todo.createdAt !== "number" &&
        typeof todo.createdAt !== "string"
      ) {
        return { ok: false, code: "broken", message: "Todo created date is invalid." };
      }
    }

    return { ok: true };
  };

  const defaultDb = () => ({
    version: DB_VERSION,
    kanban: {
      columns: [],
      cards: [],
      candidates: [],
    },
    uniforms: [],
    weekly: {},
    todos: [],
    recycle: {
      items: [],
      redo: [],
    },
  });

  const listDbSources = (meta) => {
    const sources = Array.isArray(meta.databases) ? meta.databases : [];
    return [
      { id: "current", name: "Current Database", readonly: false },
      ...sources.map((entry) => ({
        id: entry.id,
        name: entry.name || entry.filename || "Imported Database",
        readonly: true,
      })),
    ];
  };

  const getDbEntry = (meta, id) => {
    if (!meta || !Array.isArray(meta.databases)) return null;
    return meta.databases.find((entry) => entry && entry.id === id) || null;
  };

  const buildDbFilename = (id) => `${sanitizeFilename(id)}.enc`;

  const readDbFile = async (filename, password) => {
    const raw = await readText(`dbs/${filename}`);
    if (!raw) return null;
    let encrypted = null;
    try {
      encrypted = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    const decrypted = await decryptPayload(encrypted, password);
    if (!decrypted) return null;
    return migrateDb(decrypted);
  };

  const writeDbFile = async (filename, db, password) => {
    const encrypted = await encryptPayload(db, password);
    await writeJson(`dbs/${filename}`, encrypted);
    return true;
  };

  const loadDbBySource = async (sourceId) => {
    const id = sourceId || "current";
    if (id === "current") return loadDb();
    if (!activePassword) return null;
    const meta = await loadMeta();
    const entry = getDbEntry(meta, id);
    if (!entry || !entry.filename) return null;
    return readDbFile(entry.filename, activePassword);
  };

  const mergeDatabases = (target, incoming) => {
    ensureDbShape(target);
    ensureDbShape(incoming);
    const now = new Date().toISOString();

    const columnMap = new Map();
    const existingColumns = new Set(target.kanban.columns.map((col) => col.id));
    let maxColumnOrder = Math.max(0, ...target.kanban.columns.map((col) => col.order || 0));
    [...incoming.kanban.columns]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((col) => {
        if (!col || !col.id) return;
        let nextId = col.id;
        if (existingColumns.has(nextId)) {
          nextId = createId();
        }
        columnMap.set(col.id, nextId);
        existingColumns.add(nextId);
        maxColumnOrder += 1;
        target.kanban.columns.push({
          ...col,
          id: nextId,
          order: maxColumnOrder,
          updated_at: now,
        });
      });

    const cardIdMap = new Map();
    const existingCardIds = new Set(target.kanban.cards.map((card) => card.uuid));
    const existingRowIds = new Set(
      target.kanban.candidates.map((row) => row["candidate UUID"]).filter(Boolean),
    );
    const orderByColumn = new Map();
    target.kanban.cards.forEach((card) => {
      const colId = card.column_id;
      if (!colId) return;
      const currentMax = orderByColumn.get(colId) || 0;
      orderByColumn.set(colId, Math.max(currentMax, card.order || 0));
    });

    [...incoming.kanban.cards]
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach((card) => {
        if (!card || !card.uuid) return;
        let nextId = card.uuid;
        if (existingCardIds.has(nextId)) {
          nextId = createId();
        }
        const mappedColumn = columnMap.get(card.column_id) || card.column_id;
        const safeColumn =
          mappedColumn && existingColumns.has(mappedColumn)
            ? mappedColumn
            : target.kanban.columns[0]?.id || mappedColumn;
        const nextOrder = (orderByColumn.get(safeColumn) || 0) + 1;
        orderByColumn.set(safeColumn, nextOrder);
        target.kanban.cards.push({
          ...card,
          uuid: nextId,
          column_id: safeColumn,
          order: nextOrder,
          updated_at: now,
        });
        existingCardIds.add(nextId);
        cardIdMap.set(card.uuid, nextId);
      });

    incoming.kanban.candidates.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const mapped = cardIdMap.get(row["candidate UUID"]);
      let nextId = mapped || row["candidate UUID"];
      if (!nextId || existingRowIds.has(nextId)) {
        nextId = createId();
      }
      const nextRow = { ...row, "candidate UUID": nextId };
      KANBAN_CANDIDATE_FIELDS.forEach((field) => {
        if (nextRow[field] === undefined) nextRow[field] = "";
      });
      target.kanban.candidates.push(nextRow);
      existingRowIds.add(nextId);
    });

    const weeks = target.weekly || {};
    Object.values(incoming.weekly || {}).forEach((week) => {
      if (!week || !week.week_start) return;
      if (!weeks[week.week_start]) {
        weeks[week.week_start] = {
          week_start: week.week_start,
          week_end: week.week_end || "",
          entries: {},
        };
      }
      const targetEntries = weeks[week.week_start].entries || {};
      Object.keys(week.entries || {}).forEach((day) => {
        if (!targetEntries[day]) {
          targetEntries[day] = { ...(week.entries[day] || {}) };
        }
      });
      weeks[week.week_start].entries = targetEntries;
    });
    target.weekly = weeks;

    const todoIds = new Set((target.todos || []).map((todo) => todo.id));
    (incoming.todos || []).forEach((todo) => {
      if (!todo) return;
      let nextId = todo.id;
      if (!nextId || todoIds.has(nextId)) {
        nextId = createId();
      }
      todoIds.add(nextId);
      target.todos.push({ ...todo, id: nextId });
    });

    (incoming.uniforms || []).forEach((entry) => {
      const safeEntry = sanitizeUniformEntry(entry);
      if (!safeEntry.type || !safeEntry.size || !safeEntry.branch || safeEntry.quantity <= 0) return;
      upsertUniformStock(target, safeEntry);
    });
  };

  const storeImportedDatabase = async (db, fileName, password) => {
    const meta = await loadMeta();
    const id = createId();
    const filename = buildDbFilename(id);
    await writeDbFile(filename, db, password);
    const entry = {
      id,
      filename,
      name: fileName || `Imported ${new Date().toLocaleDateString()}`,
      imported_at: new Date().toISOString(),
    };
    meta.databases = Array.isArray(meta.databases) ? meta.databases : [];
    meta.databases.push(entry);
    await saveMeta(meta);
    return entry;
  };

  const loadDb = async () => {
    if (dbCache) return dbCache;
    if (!activePassword) return null;
    const raw = await readText(DATA_FILE);
    if (!raw) {
      dbCache = migrateDb(defaultDb());
      await saveDb(dbCache);
      return dbCache;
    }
    try {
      const encrypted = JSON.parse(raw);
      dbCache = migrateDb((await decryptPayload(encrypted, activePassword)) || defaultDb());
      pruneRecycleBin(dbCache);
      return dbCache;
    } catch (err) {
      dbCache = migrateDb(defaultDb());
      return dbCache;
    }
  };

  const saveDb = async (db) => {
    if (!activePassword) return;
    const encrypted = await encryptPayload(db, activePassword);
    await writeJson(DATA_FILE, encrypted);
  };

  const loadAuthData = async () => {
    return readJson(AUTH_FILE);
  };

  const saveAuthData = async (payload) => {
    await writeJson(AUTH_FILE, payload);
    return true;
  };

  const verifyPassword = async (password) => {
    const safePassword = clampString(password, 256, { trim: false });
    if (!safePassword) return false;
    const auth = await loadAuthData();
    if (!auth || !auth.salt || !auth.hash) return false;
    const salt = base64ToBytes(auth.salt);
    const iterations = auth.iterations || 200000;
    const hash = await hashPassword(safePassword, salt, iterations);
    return hash === auth.hash;
  };

  const ensureAuthState = async () => {
    const auth = await loadAuthData();
    authState.configured = !!auth;
    authState.authenticated = !!(auth && authState.authenticated && activePassword);
  };

  const requireAuth = () => {
    if (!authState.authenticated || !activePassword) {
      throw new Error("Not authenticated");
    }
  };

  const getCurrentWeek = () => {
    const today = new Date();
    const weekday = (today.getDay() + 6) % 7; // Monday=0
    let weekStart = new Date(today);
    if (weekday >= 4) {
      weekStart.setDate(today.getDate() - (weekday - 4));
    } else {
      weekStart.setDate(today.getDate() - (weekday + 3));
    }
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const toIso = (d) => d.toISOString().slice(0, 10);
    return { weekStart: toIso(weekStart), weekEnd: toIso(weekEnd) };
  };

  const parseWeeklyTime = (value) => {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
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

  const formatHours = (minutes) => {
    if (minutes === null || minutes === undefined) return "—";
    const hours = minutes / 60;
    return Number.isFinite(hours) ? hours.toFixed(2) : "—";
  };

  const buildWeeklySummary = (weekData) => {
    const { week_start, week_end, entries } = weekData;
    const now = new Date();
    const lines = [];
    const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
    let totalMinutes = 0;
    let hasTotals = false;

    const dayBlocks = days.map((day) => {
      const entry = entries[day] || { start: "", end: "", content: "" };
      const startText = String(entry.start || "").trim();
      const endText = String(entry.end || "").trim();
      const startMinutes = parseWeeklyTime(startText);
      const endMinutes = parseWeeklyTime(endText);
      let dayMinutes = null;
      if (startMinutes !== null && endMinutes !== null) {
        dayMinutes = endMinutes - startMinutes;
        if (dayMinutes < 0) dayMinutes += 24 * 60;
        totalMinutes += dayMinutes;
        hasTotals = true;
      }

      const contentLines = String(entry.content || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const activities = contentLines.length
        ? contentLines.map((line) => `- ${line}`)
        : ["_No activities entered._"];

      return {
        day,
        start: startText || "—",
        end: endText || "—",
        total: formatHours(dayMinutes),
        activities,
      };
    });

    lines.push(`# Weekly Summary`);
    lines.push("");
    lines.push(`Week of ${week_start || ""} to ${week_end || ""}`.trim());
    lines.push("");
    lines.push(`Generated ${now.toLocaleString()}`);
    lines.push("");

    if (hasTotals) {
      lines.push(`Total Hours: ${formatHours(totalMinutes)}`);
      lines.push("");
    }

    dayBlocks.forEach((block) => {
      lines.push(`## ${block.day}`);
      lines.push("");
      lines.push(`Start: ${block.start}`);
      lines.push(`End: ${block.end}`);
      lines.push(`Total: ${block.total}`);
      lines.push("");
      lines.push("Activities:");
      lines.push(...block.activities);
      lines.push("");
    });

    return lines.join("\n");
  };

  const ensureMetaShape = (meta) => {
    const next = meta && typeof meta === "object" ? meta : {};
    if (!Array.isArray(next.databases)) next.databases = [];
    if (typeof next.active_db !== "string") next.active_db = "current";
    if (typeof next.biometrics_enabled !== "boolean") next.biometrics_enabled = false;
    return next;
  };

  const loadMeta = async () => {
    if (metaCache) return metaCache;
    const meta = (await readJson(META_FILE)) || {};
    metaCache = ensureMetaShape(meta);
    return metaCache;
  };

  const saveMeta = async (meta) => {
    metaCache = ensureMetaShape(meta || {});
    await writeJson(META_FILE, metaCache);
  };

  const loadEmailTemplateConfig = async () => {
    const raw = (await readJson(EMAIL_TEMPLATES_FILE)) || {};
    const templates =
      raw && raw.templates && typeof raw.templates === "object" ? raw.templates : {};
    const customTypes =
      raw && raw.customTypes && typeof raw.customTypes === "object" ? raw.customTypes : {};
    return {
      templates: sanitizeEmailTemplateMap(templates),
      customTypes: sanitizeEmailTemplateCustomTypes(customTypes),
    };
  };

  const saveEmailTemplateConfig = async (templates, customTypes) => {
    const payload = {
      version: 1,
      updated_at: new Date().toISOString(),
      templates: sanitizeEmailTemplateMap(templates),
      customTypes: sanitizeEmailTemplateCustomTypes(customTypes),
    };
    await writeJson(EMAIL_TEMPLATES_FILE, payload);
    return payload;
  };

  const api = {
    platform,
    appVersion: async () => {
      return "local-dev";
    },
    storageInfo: async () => {
      await ensureStorageReady();
      return {
        mode: storageState.mode,
        directory: storageState.directory,
        pathLabel: getStorageLabel(),
        fallback: storageState.fallback,
      };
    },
    setupStatus: async () => {
      if (!isAndroid) return { needsSetup: false };
      const meta = await loadMeta();
      const info = await api.storageInfo();
      return {
        needsSetup: !meta.setup_completed,
        folder: info.pathLabel,
        mode: info.mode,
        fallback: info.fallback || info.mode !== "filesystem",
      };
    },
    setupComplete: async ({ donationChoice } = {}) => {
      const meta = await loadMeta();
      meta.setup_completed = true;
      if (donationChoice) {
        meta.donation_choice = donationChoice;
      }
      await saveMeta(meta);
      return true;
    },
    donationPreference: async () => {
      const meta = await loadMeta();
      return { choice: meta.donation_choice || "not_now" };
    },
    biometricStatus: async () => {
      if (!isAndroid || !biometricAuth || !secureStorage) {
        return { available: false, enabled: false };
      }
      let availability = null;
      try {
        availability = await biometricAuth.checkBiometry();
      } catch (err) {
        availability = null;
      }
      const meta = await loadMeta();
      return {
        available: !!(availability && availability.isAvailable),
        biometryType: availability ? availability.biometryType || "" : "",
        enabled: !!meta.biometrics_enabled,
      };
    },
    biometricEnable: async (password) => {
      if (!isAndroid || !biometricAuth || !secureStorage) {
        return { ok: false, error: "Biometrics unavailable." };
      }
      const valid = await verifyPassword(password);
      if (!valid) return { ok: false, error: "Invalid password." };
      try {
        await secureStorage.set({ key: BIOMETRIC_STORAGE_KEY, value: password });
        const meta = await loadMeta();
        meta.biometrics_enabled = true;
        await saveMeta(meta);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: "Unable to enable biometrics." };
      }
    },
    biometricDisable: async () => {
      if (!isAndroid || !secureStorage) {
        return { ok: false, error: "Biometrics unavailable." };
      }
      try {
        await secureStorage.remove({ key: BIOMETRIC_STORAGE_KEY });
        const meta = await loadMeta();
        meta.biometrics_enabled = false;
        await saveMeta(meta);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: "Unable to disable biometrics." };
      }
    },
    biometricUnlock: async () => {
      if (!isAndroid || !biometricAuth || !secureStorage) {
        return { ok: false, error: "Biometrics unavailable." };
      }
      const meta = await loadMeta();
      if (!meta.biometrics_enabled) {
        return { ok: false, error: "Biometrics not enabled." };
      }
      try {
        const result = await biometricAuth.authenticate({
          reason: "Unlock Workflow Tracker",
          cancelTitle: "Cancel",
        });
        if (!result || !result.success) {
          return { ok: false, error: "Biometric authentication failed." };
        }
        const stored = await secureStorage.get({ key: BIOMETRIC_STORAGE_KEY });
        const password = stored && stored.value ? stored.value : "";
        if (!password) {
          return { ok: false, error: "No saved password found." };
        }
        const valid = await verifyPassword(password);
        if (!valid) {
          const metaUpdate = await loadMeta();
          metaUpdate.biometrics_enabled = false;
          await saveMeta(metaUpdate);
          await secureStorage.remove({ key: BIOMETRIC_STORAGE_KEY });
          return { ok: false, error: "Saved password is no longer valid." };
        }
        return { ok: true, password };
      } catch (err) {
        return { ok: false, error: "Biometric authentication failed." };
      }
    },

    authStatus: async () => {
      await ensureAuthState();
      const rate = checkAuthRateLimit();
      return {
        ...authState,
        locked: !rate.ok,
        retryAfterMs: rate.ok ? 0 : rate.retryAfterMs,
      };
    },
    authSetup: async (password) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok) return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safePassword = clampString(password, 256, { trim: false });
      if (!safePassword) return { ok: false, error: "Password is required." };
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iterations = 200000;
      const hash = await hashPassword(safePassword, salt, iterations);
      await saveAuthData({ salt: bytesToBase64(salt), hash, iterations });
      authState = { configured: true, authenticated: true };
      activePassword = safePassword;
      dbCache = null;
      await loadDb();
      recordAuthSuccess();
      return { ok: true };
    },
    authLogin: async (password) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok) return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safePassword = clampString(password, 256, { trim: false });
      if (!safePassword) return { ok: false, error: "Password is required." };
      const auth = await loadAuthData();
      if (!auth || !auth.salt || !auth.hash) {
        return { ok: false, error: "Missing auth configuration." };
      }
      const salt = base64ToBytes(auth.salt);
      const iterations = auth.iterations || 200000;
      const hash = await hashPassword(safePassword, salt, iterations);
      if (hash !== auth.hash) {
        recordAuthFailure();
        return { ok: false, error: "Invalid password." };
      }
      authState.authenticated = true;
      activePassword = safePassword;
      dbCache = null;
      await loadDb();
      recordAuthSuccess();
      return { ok: true };
    },
    authChange: async (current, next) => {
      const rate = checkAuthRateLimit();
      if (!rate.ok) return { ok: false, error: "Too many attempts", retryAfterMs: rate.retryAfterMs };
      const safeCurrent = clampString(current, 256, { trim: false });
      const safeNext = clampString(next, 256, { trim: false });
      if (!safeCurrent || !safeNext) return { ok: false, error: "Missing password." };
      const auth = await loadAuthData();
      if (!auth || !auth.salt || !auth.hash) return { ok: false, error: "Missing auth." };
      const salt = base64ToBytes(auth.salt);
      const iterations = auth.iterations || 200000;
      const hash = await hashPassword(safeCurrent, salt, iterations);
      if (hash !== auth.hash) {
        recordAuthFailure();
        return { ok: false, error: "Invalid password." };
      }
      const newSalt = crypto.getRandomValues(new Uint8Array(16));
      const newHash = await hashPassword(safeNext, newSalt, iterations);
      await saveAuthData({ salt: bytesToBase64(newSalt), hash: newHash, iterations });
      activePassword = safeNext;
      authState.authenticated = true;
      if (dbCache) await saveDb(dbCache);
      dbCache = null;
      await loadDb();
      recordAuthSuccess();
      return { ok: true };
    },

    kanbanGet: async () => {
      requireAuth();
      const db = await loadDb();
      return { columns: db.kanban.columns, cards: db.kanban.cards };
    },
    kanbanAddColumn: async (name) => {
      requireAuth();
      const db = await loadDb();
      const safeName = clampString(name, MAX_COLUMN_NAME_LEN, { trim: true });
      if (!safeName) {
        return { ok: false, error: "Column name is required.", columns: db.kanban.columns };
      }
      const order = Math.max(0, ...db.kanban.columns.map((c) => c.order || 0)) + 1;
      const column = {
        id: createId(),
        name: safeName,
        order,
        created_at: new Date().toISOString(),
      };
      db.kanban.columns.push(column);
      await saveDb(db);
      return { ok: true, columns: db.kanban.columns };
    },
    kanbanRemoveColumn: async (columnId) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(columnId);
      const exists = db.kanban.columns.some((col) => col.id === safeId);
      if (!exists) {
        return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards };
      }
      const result = removeKanbanColumns(db, [safeId]);
      if (!result.ok) return result;
      await saveDb(db);
      return result;
    },
    kanbanAddCard: async (payload) => {
      requireAuth();
      const db = await loadDb();
      const safePayload = sanitizeCardPayload(payload || {});
      const columnId = clampId(safePayload.column_id || payload?.column_id);
      if (!columnId || !db.kanban.columns.some((col) => col.id === columnId)) {
        return { ok: false, error: "Invalid column." };
      }
      const order =
        Math.max(
          0,
          ...db.kanban.cards.filter((c) => c.column_id === columnId).map((c) => c.order || 0),
        ) + 1;
      const card = {
        uuid: createId(),
        column_id: columnId,
        order,
        candidate_name: safePayload.candidate_name || "",
        icims_id: safePayload.icims_id || "",
        employee_id: safePayload.employee_id || "",
        job_id: safePayload.job_id || "",
        req_id: safePayload.req_id || "",
        job_name: safePayload.job_name || "",
        job_location: safePayload.job_location || "",
        manager: safePayload.manager || "",
        branch: safePayload.branch || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      db.kanban.cards.push(card);

      const candidateRow = {};
      KANBAN_CANDIDATE_FIELDS.forEach((field) => {
        candidateRow[field] = "";
      });
      candidateRow["Candidate Name"] = card.candidate_name;
      candidateRow["ICIMS ID"] = card.icims_id;
      candidateRow["Employee ID"] = card.employee_id;
      candidateRow["REQ ID"] = card.req_id;
      candidateRow["Contact Phone"] = safePayload.contact_phone || "";
      candidateRow["Contact Email"] = safePayload.contact_email || "";
      candidateRow["Job ID Name"] = jobIdName(card.job_id, card.job_name);
      candidateRow["Job Location"] = card.job_location;
      candidateRow["Manager"] = card.manager;
      candidateRow["Branch"] = card.branch;
      candidateRow["candidate UUID"] = card.uuid;
      db.kanban.candidates.push(candidateRow);

      await saveDb(db);
      return { ok: true, card };
    },
    kanbanUpdateCard: async (id, payload) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(id);
      const card = db.kanban.cards.find((c) => c.uuid === safeId);
      if (!card) return { cards: db.kanban.cards };
      const updates = {};
      const allowed = new Set([
        "candidate_name",
        "icims_id",
        "employee_id",
        "job_id",
        "req_id",
        "job_name",
        "job_location",
        "manager",
        "branch",
        "column_id",
        "order",
      ]);
      const safePayload = sanitizeCardPayload(payload || {});
      if (payload && typeof payload === "object") {
        Object.keys(payload).forEach((key) => {
          if (allowed.has(key)) updates[key] = safePayload[key];
        });
      }
      if (updates.column_id && !db.kanban.columns.some((col) => col.id === updates.column_id)) {
        delete updates.column_id;
      }
      Object.assign(card, updates);
      card.updated_at = new Date().toISOString();

      const candidateRow = ensureCandidateRow(db, safeId);
      candidateRow["Candidate Name"] = card.candidate_name || "";
      candidateRow["ICIMS ID"] = card.icims_id || "";
      candidateRow["Employee ID"] = card.employee_id || "";
      candidateRow["REQ ID"] = card.req_id || "";
      if (payload && Object.prototype.hasOwnProperty.call(payload, "contact_phone")) {
        candidateRow["Contact Phone"] = safePayload.contact_phone || "";
      }
      if (payload && Object.prototype.hasOwnProperty.call(payload, "contact_email")) {
        candidateRow["Contact Email"] = safePayload.contact_email || "";
      }
      candidateRow["Job ID Name"] = jobIdName(card.job_id, card.job_name);
      candidateRow["Job Location"] = card.job_location || "";
      candidateRow["Manager"] = card.manager || "";
      candidateRow["Branch"] = card.branch || "";

      await saveDb(db);
      return { cards: db.kanban.cards };
    },
    piiGet: async (candidateId) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(candidateId);
      const row = ensureCandidateRow(db, safeId);
      const card = db.kanban.cards.find((c) => c.uuid === safeId);
      if (card) {
        row["Candidate Name"] = card.candidate_name || row["Candidate Name"] || "";
        row["REQ ID"] = card.req_id || row["REQ ID"] || "";
      }
      await saveDb(db);
      return { row, candidateName: row["Candidate Name"] || (card ? card.candidate_name : "") };
    },
    piiSave: async (candidateId, data) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(candidateId);
      const row = ensureCandidateRow(db, safeId);
      const blocked = new Set(["Candidate Name", "candidate UUID"]);
      const sanitized = sanitizePiiPayload(data || {});
      Object.keys(sanitized).forEach((key) => {
        if (blocked.has(key)) return;
        if (!KANBAN_CANDIDATE_FIELDS.includes(key)) return;
        row[key] = sanitized[key];
      });
      await saveDb(db);
      return true;
    },
    kanbanProcessCandidate: async ({ candidateId, arrival, departure, branch }) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(candidateId);
      if (!safeId) return { ok: false, message: "Missing candidate." };
      const card = db.kanban.cards.find((c) => c.uuid === safeId);
      if (!card) return { ok: false, message: "Candidate not found." };
      const selectedBranch = normalizeUniformBranch(branch || card.branch);
      if (!selectedBranch) {
        return { ok: false, message: "Branch is required." };
      }
      const preProcessCard = { ...card };
      const preProcessRow = { ...ensureCandidateRow(db, safeId) };

      const arrivalMinutes = roundToQuarterHour(parseMilitaryTime(arrival));
      const departureMinutes = roundToQuarterHour(parseMilitaryTime(departure));
      if (arrivalMinutes === null || departureMinutes === null) {
        return { ok: false, message: "Invalid time format. Use 4-digit 24H time." };
      }

      const arrivalText = formatMilitaryTime(arrivalMinutes);
      const departureText = formatMilitaryTime(departureMinutes);
      let totalMinutes = departureMinutes - arrivalMinutes;
      if (totalMinutes < 0) totalMinutes += 24 * 60;
      const totalHours = formatTotalHours(totalMinutes);

      const row = ensureCandidateRow(db, safeId);
      row["Candidate Name"] = card.candidate_name || row["Candidate Name"] || "";
      row["ICIMS ID"] = card.icims_id || row["ICIMS ID"] || "";
      row["Employee ID"] = card.employee_id || row["Employee ID"] || "";
      row["REQ ID"] = card.req_id || row["REQ ID"] || "";
      row["Job ID Name"] = jobIdName(card.job_id, card.job_name);
      row["Job Location"] = card.job_location || row["Job Location"] || "";
      row["Manager"] = card.manager || row["Manager"] || "";
      row["Branch"] = selectedBranch;
      row["Neo Arrival Time"] = arrivalText;
      row["Neo Departure Time"] = departureText;
      row["Total Neo Hours"] = totalHours;
      card.branch = selectedBranch;

      const uniformAdjustments = [];
      const uniformsIssued = normalizeIssuedUniformFlag(row["Uniforms Issued"]) === "Yes";
      if (uniformsIssued) {
        const shirtSizeRaw = normalizeUniformShirtSize(
          row["Issued Shirt Size"] || row["Shirt Size"],
        );
        const shirtSize = UNIFORM_SHIRT_SIZE_OPTIONS.has(shirtSizeRaw) ? shirtSizeRaw : "";
        const waist = normalizeUniformText(row["Issued Waist"] || row["Waist"], 2);
        const inseam = normalizeUniformText(row["Issued Inseam"] || row["Inseam"], 2);
        const pantsSize =
          buildPantsSize(
            UNIFORM_WAIST_OPTIONS.has(waist) ? waist : "",
            UNIFORM_INSEAM_OPTIONS.has(inseam) ? inseam : "",
          ) ||
          normalizeUniformText(
            row["Issued Pants Size"] || row["Pants Size"],
            MAX_UNIFORM_SIZE_LEN,
          );
        const shirtsGiven = parseIssuedUniformQuantity(
          row["Issued Shirts Given"] || row["Shirts Given"],
        );
        const pantsGiven = parseIssuedUniformQuantity(
          row["Issued Pants Given"] || row["Pants Given"],
        );
        const shirtAlterations = normalizeIssuedAlterationList(
          row["Issued Shirt Type"] || row["Shirt Type"],
          listUniformAlterationsForStock(db, {
            type: "Shirt",
            size: shirtSize,
            branch: selectedBranch,
          }),
        );
        const pantsAlteration = normalizeUniformAlteration(
          row["Issued Pants Type"] || row["Pants Type"],
        );
        row["Issued Shirt Size"] = shirtSize;
        row["Issued Waist"] = UNIFORM_WAIST_OPTIONS.has(waist) ? waist : "";
        row["Issued Inseam"] = UNIFORM_INSEAM_OPTIONS.has(inseam) ? inseam : "";
        row["Issued Pants Size"] = pantsSize;
        row["Issued Shirt Type"] = serializeIssuedAlterationList(shirtAlterations);
        row["Issued Shirts Given"] = shirtsGiven > 0 ? String(shirtsGiven) : "";
        row["Issued Pants Type"] = pantsAlteration;
        row["Issued Pants Given"] = pantsGiven > 0 ? String(pantsGiven) : "";
        row["Uniforms Issued"] = "Yes";
        row["Shirt Type"] = row["Issued Shirt Type"];
        row["Shirts Given"] = row["Issued Shirts Given"];
        row["Pants Type"] = row["Issued Pants Type"];
        row["Pants Given"] = row["Issued Pants Given"];
        if (shirtSize && shirtsGiven > 0) {
          const shirtDeductions = deductUniformsAcrossAlterations(db, {
            type: "Shirt",
            size: shirtSize,
            quantity: shirtsGiven,
            branch: selectedBranch,
            alterations: shirtAlterations,
          });
          shirtDeductions.forEach((entry) => uniformAdjustments.push(entry));
        }
        if (pantsSize && pantsGiven > 0) {
          const pantsDeductions = deductUniformsAcrossAlterations(db, {
            type: "Pants",
            size: pantsSize,
            quantity: pantsGiven,
            branch: selectedBranch,
            alteration: pantsAlteration,
          });
          pantsDeductions.forEach((entry) => uniformAdjustments.push(entry));
        }
      }

      SENSITIVE_PII_FIELDS.forEach((field) => {
        row[field] = "";
      });
      SENSITIVE_CARD_FIELDS.forEach((field) => {
        card[field] = "";
      });
      card.updated_at = new Date().toISOString();
      db.kanban.cards = db.kanban.cards.filter((c) => c.uuid !== safeId);

      const undoId = pushRecycleItem(db, {
        type: "kanban_cards",
        cards: [preProcessCard],
        candidates: [preProcessRow],
        uniformAdjustments,
      });

      await saveDb(db);
      return { ok: true, cards: db.kanban.cards, undoId };
    },
    kanbanRemoveCandidate: async (candidateId) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(candidateId);
      if (!safeId) return { ok: false, message: "Missing candidate." };
      const removedCards = db.kanban.cards.filter((card) => card.uuid === safeId);
      const removedRows = db.kanban.candidates.filter((row) => row["candidate UUID"] === safeId);
      db.kanban.cards = db.kanban.cards.filter((card) => card.uuid !== safeId);
      db.kanban.candidates = db.kanban.candidates.filter((row) => row["candidate UUID"] !== safeId);
      const undoId = pushRecycleItem(db, {
        type: "kanban_cards",
        cards: removedCards.map((card) => ({ ...card })),
        candidates: removedRows.map((row) => ({ ...row })),
      });
      await saveDb(db);
      return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards, undoId };
    },
    kanbanReorderColumn: async (columnId, cardIds) => {
      requireAuth();
      const db = await loadDb();
      const safeColumnId = clampId(columnId);
      const safeCardIds = sanitizeRowIds(cardIds);
      const columnCards = db.kanban.cards.filter((c) => c.column_id === safeColumnId);
      const map = new Map(columnCards.map((c) => [c.uuid, c]));
      const seen = new Set();
      const ordered = [];

      (safeCardIds || []).forEach((id) => {
        const card = map.get(id);
        if (card && !seen.has(id)) {
          ordered.push(card);
          seen.add(id);
        }
      });

      columnCards
        .filter((card) => !seen.has(card.uuid))
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((card) => ordered.push(card));

      ordered.forEach((card, index) => {
        card.order = index + 1;
        card.updated_at = new Date().toISOString();
      });

      await saveDb(db);
      return { cards: db.kanban.cards };
    },

    weeklyGet: async () => {
      requireAuth();
      const db = await loadDb();
      const { weekStart, weekEnd } = getCurrentWeek();
      if (!db.weekly[weekStart]) {
        db.weekly[weekStart] = { week_start: weekStart, week_end: weekEnd, entries: {} };
        await saveDb(db);
      }
      return db.weekly[weekStart];
    },
    weeklySave: async (entries) => {
      requireAuth();
      const db = await loadDb();
      const { weekStart, weekEnd } = getCurrentWeek();
      const safeEntries = sanitizeWeeklyEntries(entries);
      db.weekly[weekStart] = {
        week_start: weekStart,
        week_end: weekEnd,
        entries: safeEntries,
      };
      await saveDb(db);
      return true;
    },
    weeklySummary: async () => {
      requireAuth();
      const db = await loadDb();
      const { weekStart } = getCurrentWeek();
      const data = db.weekly[weekStart] || { week_start: weekStart, week_end: "", entries: {} };
      const content = buildWeeklySummary(data);
      return {
        filename: `Weekly_${weekStart}_Summary.md`,
        content,
      };
    },

    todosGet: async () => {
      requireAuth();
      const db = await loadDb();
      const changed = normalizeTodos(db.todos || []);
      if (changed) await saveDb(db);
      return db.todos || [];
    },
    todosSave: async (todos) => {
      requireAuth();
      const db = await loadDb();
      db.todos = sanitizeTodos(todos);
      normalizeTodos(db.todos);
      await saveDb(db);
      return true;
    },

    emailTemplatesGet: async () => {
      requireAuth();
      const config = await loadEmailTemplateConfig();
      return {
        ok: true,
        templates: config.templates || {},
        customTypes: config.customTypes || {},
      };
    },
    emailTemplatesSave: async (payload) => {
      requireAuth();
      const templates = sanitizeEmailTemplateMap(
        payload && payload.templates && typeof payload.templates === "object"
          ? payload.templates
          : {},
      );
      const customTypes = sanitizeEmailTemplateCustomTypes(
        payload && payload.customTypes && typeof payload.customTypes === "object"
          ? payload.customTypes
          : {},
      );
      const saved = await saveEmailTemplateConfig(templates, customTypes);
      return {
        ok: true,
        templates: saved.templates || {},
        customTypes: saved.customTypes || {},
      };
    },

    uniformsAddItem: async (payload) => {
      requireAuth();
      const db = await loadDb();
      const safePayload = sanitizeUniformPayload(payload || {});
      if (!safePayload.alteration || !safePayload.type || !safePayload.branch) {
        return { ok: false, error: "Alteration, type, and branch are required." };
      }
      if (safePayload.type === "Shirt" && !safePayload.size) {
        return { ok: false, error: "Shirt size is required for shirt inventory." };
      }
      if (safePayload.type === "Pants" && (!safePayload.waist || !safePayload.inseam)) {
        return { ok: false, error: "Waist and inseam are required for pants inventory." };
      }
      if (safePayload.quantity <= 0) {
        return { ok: false, error: "Quantity must be greater than 0." };
      }
      const row = upsertUniformStock(db, safePayload);
      if (!row) {
        return { ok: false, error: "Unable to add uniform inventory." };
      }
      await saveDb(db);
      return { ok: true, row };
    },

    dbSources: async () => {
      requireAuth();
      const meta = await loadMeta();
      const sources = listDbSources(meta);
      const activeId = sources.some((item) => item.id === meta.active_db)
        ? meta.active_db
        : "current";
      return { sources, activeId };
    },
    dbSetSource: async (sourceId) => {
      requireAuth();
      const meta = await loadMeta();
      const sources = listDbSources(meta);
      const nextId = sources.some((item) => item.id === sourceId) ? sourceId : "current";
      meta.active_db = nextId;
      await saveMeta(meta);
      return { ok: true, activeId: nextId };
    },
    dbListTables: async (sourceId) => {
      requireAuth();
      const db = await loadDbBySource(sourceId);
      if (!db) return [];
      return Object.keys(TABLE_DEFS).map((id) => {
        const def = TABLE_DEFS[id];
        const rows = def.rows(db);
        return { id, name: def.name, count: rows.length };
      });
    },
    dbGetTable: async (tableId, sourceId) => {
      requireAuth();
      const db = await loadDbBySource(sourceId);
      if (!db) {
        return { id: clampId(tableId), name: "Unknown", columns: [], rows: [] };
      }
      const safeTableId = clampId(tableId);
      const table = buildTable(safeTableId, db);
      return table || { id: safeTableId, name: "Unknown", columns: [], rows: [] };
    },
    dbDeleteRows: async (tableId, rowIds, sourceId) => {
      requireAuth();
      if (sourceId && sourceId !== "current") {
        return { ok: false, error: "Read-only database." };
      }
      const db = await loadDb();
      const safeTableId = clampId(tableId);
      const ids = new Set(sanitizeRowIds(rowIds));
      let undoId = null;

      switch (safeTableId) {
        case "kanban_columns": {
          const result = removeKanbanColumns(db, ids);
          if (!result.ok) return result;
          undoId = result.undoId;
          break;
        }
        case "kanban_cards": {
          const removedCards = db.kanban.cards.filter((card) => ids.has(card.uuid));
          const removedRows = db.kanban.candidates.filter((row) => ids.has(row["candidate UUID"]));
          db.kanban.cards = db.kanban.cards.filter((card) => !ids.has(card.uuid));
          db.kanban.candidates = db.kanban.candidates.filter((row) => !ids.has(row["candidate UUID"]));
          if (removedCards.length || removedRows.length) {
            undoId = pushRecycleItem(db, {
              type: "kanban_cards",
              cards: removedCards.map((card) => ({ ...card })),
              candidates: removedRows.map((row) => ({ ...row })),
            });
          }
          break;
        }
        case "candidate_data": {
          const removedRows = db.kanban.candidates.filter((row) => ids.has(row["candidate UUID"]));
          db.kanban.candidates = db.kanban.candidates.filter((row) => !ids.has(row["candidate UUID"]));
          if (removedRows.length) {
            undoId = pushRecycleItem(db, {
              type: "candidate_rows",
              candidates: removedRows.map((row) => ({ ...row })),
            });
          }
          break;
        }
        case "weekly_entries": {
          const weeks = db.weekly || {};
          const removedEntries = [];
          Object.values(weeks).forEach((week) => {
            const entries = week.entries || {};
            Object.keys(entries).forEach((day) => {
              const rowId = `${week.week_start}-${day}`;
              if (ids.has(rowId)) {
                removedEntries.push({
                  week_start: week.week_start,
                  week_end: week.week_end,
                  day,
                  payload: { ...entries[day] },
                });
                delete entries[day];
              }
            });
            week.entries = entries;
          });
          db.weekly = weeks;
          if (removedEntries.length) {
            undoId = pushRecycleItem(db, {
              type: "weekly_entries",
              entries: removedEntries,
            });
          }
          break;
        }
        case "uniform_inventory": {
          const removedRows = (db.uniforms || []).filter((entry) => ids.has(entry.id));
          db.uniforms = (db.uniforms || []).filter((entry) => !ids.has(entry.id));
          if (removedRows.length) {
            undoId = pushRecycleItem(db, {
              type: "uniform_rows",
              uniforms: removedRows.map((entry) => ({ ...entry })),
            });
          }
          break;
        }
        case "todos": {
          const removedTodos = (db.todos || []).filter((todo) => ids.has(todo.id));
          db.todos = (db.todos || []).filter((todo) => !ids.has(todo.id));
          if (removedTodos.length) {
            undoId = pushRecycleItem(db, {
              type: "todos",
              todos: removedTodos.map((todo) => ({ ...todo })),
            });
          }
          break;
        }
        default:
          return { ok: false, error: "Invalid table." };
      }

      await saveDb(db);
      return { ok: true, undoId };
    },
    dbExportCsv: async (payload) => {
      requireAuth();
      const { tableId, tableName, columns, rows, sourceId } = payload || {};
      let exportColumns = Array.isArray(columns) ? columns : [];
      let exportRows = Array.isArray(rows) ? rows : [];
      const safeTableId = clampId(tableId);
      const safeTableName = clampString(tableName, 80, { trim: true });
      if ((!exportColumns.length || !exportRows.length) && safeTableId) {
        const db = await loadDbBySource(sourceId);
        const table = buildTable(safeTableId, db);
        if (table) {
          if (!exportColumns.length) exportColumns = table.columns;
          if (!exportRows.length) exportRows = table.rows;
        }
      }
      exportColumns = exportColumns.map((col) => clampString(col, 80)).filter((col) => col);
      if (exportRows.length > 50000) exportRows = exportRows.slice(0, 50000);
      const baseName = sanitizeFilename(safeTableName || safeTableId || "table");
      const filename = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
      const csv = rowsToCsv(exportColumns, exportRows);

      if (storageState.mode === "filesystem" && filesystem) {
        await ensureStorageReady();
        const exportPath = `${STORAGE_FOLDER}/exports`;
        try {
          await filesystem.mkdir({
            path: exportPath,
            directory: storageState.directory,
            recursive: true,
          });
        } catch (err) {
          // ignore
        }
        await filesystem.writeFile({
          path: `${exportPath}/${filename}`,
          directory: storageState.directory,
          data: csv,
          encoding: "utf8",
        });
        return { ok: true, filename };
      }

      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return { ok: true, filename };
    },

    dbImportPick: async () => {
      requireAuth();
      if (!isAndroid || !filePicker) {
        return { ok: false, error: "File picker unavailable." };
      }
      try {
        const result = await filePicker.pickFiles({
          types: ["*/*"],
          limit: 1,
          readData: true,
        });
        const file = result && result.files && result.files[0] ? result.files[0] : null;
        if (!file) return { canceled: true };
        let data = file.data || "";
        if (!data && file.path && filesystem) {
          const read = await filesystem.readFile({ path: file.path });
          data = read && read.data ? read.data : "";
        }
        if (!data) return { ok: false, error: "Unable to read the selected file." };
        const text = base64ToText(data);
        return { ok: true, name: file.name || "imported-database.enc", data: text };
      } catch (err) {
        return { ok: false, error: "Unable to open the file picker." };
      }
    },
    dbImportApply: async ({ action, fileName, fileData, password } = {}) => {
      requireAuth();
      const safeAction = clampString(action, 20, { trim: true }).toLowerCase();
      if (!["append", "view", "replace"].includes(safeAction)) {
        return { ok: false, code: "broken", error: "Invalid import action." };
      }
      const validPassword = await verifyPassword(password);
      if (!validPassword) {
        return { ok: false, code: "password", error: "Invalid password." };
      }
      let encrypted = null;
      try {
        encrypted = JSON.parse(String(fileData || ""));
      } catch (err) {
        return { ok: false, code: "broken", error: "Import file is not valid JSON." };
      }
      const imported = await decryptPayload(encrypted, password);
      if (!imported) {
        return { ok: false, code: "broken", error: "Unable to decrypt the import file." };
      }
      const migrated = migrateDb(imported);
      const validation = validateDb(migrated);
      if (!validation.ok) {
        return { ok: false, code: validation.code, error: validation.message };
      }

      let viewEntry = null;
      if (safeAction === "append") {
        const db = await loadDb();
        mergeDatabases(db, migrated);
        await saveDb(db);
        viewEntry = await storeImportedDatabase(migrated, fileName, password);
      } else if (safeAction === "replace") {
        await saveDb(migrated);
      } else if (safeAction === "view") {
        viewEntry = await storeImportedDatabase(migrated, fileName, password);
      }

      return {
        ok: true,
        action: safeAction,
        viewId: viewEntry ? viewEntry.id : null,
        viewName: viewEntry ? viewEntry.name : null,
      };
    },
    dbValidateCurrent: async () => {
      requireAuth();
      const db = await loadDb();
      const validation = validateDb(db);
      return validation;
    },

    recycleUndo: async (id) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(id);
      const item = popRecycleItem(db, safeId);
      if (!item) return { ok: false, error: "Nothing to undo." };
      const restored = restoreRecycleItem(db, item);
      if (!restored) return { ok: false, error: "Unable to restore." };
      const redoId = pushRedoItem(db, item);
      await saveDb(db);
      return { ok: true, redoId };
    },
    recycleRedo: async (id) => {
      requireAuth();
      const db = await loadDb();
      const safeId = clampId(id);
      const item = popRedoItem(db, safeId);
      if (!item) return { ok: false, error: "Nothing to redo." };
      const reapplied = reapplyRecycleItem(db, item);
      if (!reapplied) return { ok: false, error: "Unable to redo." };
      const undoId = pushRecycleItem(db, item);
      await saveDb(db);
      return { ok: true, undoId };
    },

    donate: async ({ sku } = {}) => {
      const billing = window.Capacitor?.Plugins?.WorkflowBilling || null;
      if (!billing || !billing.purchase) {
        return { ok: false, message: "Billing unavailable." };
      }
      const safeSku = clampString(sku || "support_dev", 64, { trim: true }) || "support_dev";
      try {
        const result = await billing.purchase({ sku: safeSku });
        return result || { ok: true };
      } catch (err) {
        return { ok: false, message: err?.message || "Purchase failed." };
      }
    },
  };

  window.workflowApi = api;
}
