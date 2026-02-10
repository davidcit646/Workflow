const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = 'Workflow';
const ICON_NAME = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
const ICON_PATH = path.join(__dirname, 'assets', ICON_NAME);
const AUTH_FILE = path.join(app.getPath('userData'), 'auth.json');
const DATA_FILE = path.join(app.getPath('userData'), 'workflow.enc');
const LAST_COLUMN_MESSAGE = 'Please remove candidate cards from the last remaining column before deleting it.';

let authState = { configured: false, authenticated: false };
let activePassword = null;
let dbCache = null;

const ensureDir = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    // ignore
  }
};

const loadAuthFile = () => {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const raw = fs.readFileSync(AUTH_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
};

const saveAuthFile = (payload) => {
  ensureDir(path.dirname(AUTH_FILE));
  fs.writeFileSync(AUTH_FILE, JSON.stringify(payload, null, 2));
};

const deriveKey = (password, salt, iterations = 200000) => {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
};

const hashPassword = (password, salt, iterations = 200000) => {
  const key = deriveKey(password, salt, iterations);
  return key.toString('base64');
};

const encryptPayload = (payload, password) => {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
};

const decryptPayload = (payload, password) => {
  if (!payload || !payload.salt || !payload.iv || !payload.tag || !payload.data) return null;
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const encrypted = Buffer.from(payload.data, 'base64');
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
};

const defaultDb = () => ({
  version: 1,
  kanban: {
    columns: [],
    cards: [],
    candidates: [],
  },
  weekly: {},
  todos: [],
});

const loadDb = () => {
  if (dbCache) return dbCache;
  if (!activePassword) return null;
  if (!fs.existsSync(DATA_FILE)) {
    dbCache = defaultDb();
    saveDb(dbCache);
    return dbCache;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const encrypted = JSON.parse(raw);
    dbCache = decryptPayload(encrypted, activePassword) || defaultDb();
    return dbCache;
  } catch (err) {
    dbCache = defaultDb();
    return dbCache;
  }
};

const saveDb = (db) => {
  if (!activePassword) return;
  ensureDir(path.dirname(DATA_FILE));
  const encrypted = encryptPayload(db, activePassword);
  fs.writeFileSync(DATA_FILE, JSON.stringify(encrypted, null, 2));
};

const ensureAuthState = () => {
  const auth = loadAuthFile();
  authState.configured = !!auth;
  authState.authenticated = !!(auth && authState.authenticated && activePassword);
};

const requireAuth = () => {
  if (!authState.authenticated || !activePassword) {
    throw new Error('Not authenticated');
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
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const meridiemMatch = raw.match(/\b([ap])(?:\.?m\.?)?\b/);
  const meridiem = meridiemMatch ? meridiemMatch[1] : null;
  const cleaned = raw.replace(/[^\d:]/g, '');
  if (!cleaned) return null;

  let hours = null;
  let minutes = null;

  if (cleaned.includes(':')) {
    const [h, m] = cleaned.split(':');
    if (!/^\d{1,2}$/.test(h || '') || !/^\d{1,2}$/.test(m || '')) return null;
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
    if (meridiem === 'a') {
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
  if (minutes === null || minutes === undefined) return '—';
  const hours = minutes / 60;
  return Number.isFinite(hours) ? hours.toFixed(2) : '—';
};

const buildWeeklySummary = (weekData) => {
  const { week_start, week_end, entries } = weekData;
  const now = new Date();
  const lines = [];
  const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  let totalMinutes = 0;
  let hasTotals = false;

  const dayBlocks = days.map((day) => {
    const entry = entries[day] || { start: '', end: '', content: '' };
    const startText = String(entry.start || '').trim();
    const endText = String(entry.end || '').trim();
    const startMinutes = parseWeeklyTime(startText);
    const endMinutes = parseWeeklyTime(endText);
    let dayMinutes = null;
    if (startMinutes !== null && endMinutes !== null) {
      dayMinutes = endMinutes - startMinutes;
      if (dayMinutes < 0) dayMinutes += 24 * 60;
      totalMinutes += dayMinutes;
      hasTotals = true;
    }

    const contentLines = String(entry.content || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const activities = contentLines.length
      ? contentLines.map((line) => `- ${line}`)
      : ['_No activities entered._'];

    return {
      day,
      startText: startText || '—',
      endText: endText || '—',
      hoursText: formatHours(dayMinutes),
      activities,
    };
  });

  const totalHoursText = hasTotals ? formatHours(totalMinutes) : '—';

  lines.push('# Weekly Work Tracker');
  lines.push('');
  lines.push(`**Work Week:** ${week_start} – ${week_end}`);
  lines.push(`**Generated:** ${now.toLocaleString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Total Hours | **${totalHoursText}** |`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push('| Day | Start | End | Hours |');
  lines.push('| --- | --- | --- | --- |');
  dayBlocks.forEach((block) => {
    lines.push(`| ${block.day} | ${block.startText} | ${block.endText} | ${block.hoursText} |`);
  });
  lines.push('');

  dayBlocks.forEach((block) => {
    lines.push(`## ${block.day}`);
    lines.push('');
    lines.push('**Activities**');
    lines.push(...block.activities);
    lines.push('');
  });

  return lines.join('\n');
};

const KANBAN_CANDIDATE_FIELDS = [
  'Candidate Name',
  'Hire Date',
  'ICIMS ID',
  'Employee ID',
  'Neo Arrival Time',
  'Neo Departure Time',
  'Total Neo Hours',
  'Job ID Name',
  'Job Location',
  'Manager',
  'Branch',
  'Contact Phone',
  'Contact Email',
  'Background Provider',
  'Background Cleared Date',
  'Background MVR Flag',
  'License Type',
  'MA CORI Status',
  'MA CORI Date',
  'NH GC Status',
  'NH GC Expiration Date',
  'NH GC ID Number',
  'ME GC Status',
  'ME GC Expiration Date',
  'ID Type',
  'State Abbreviation',
  'ID Number',
  'DOB',
  'EXP',
  'Other ID Type',
  'Social',
  'Bank Name',
  'Account Type',
  'Routing Number',
  'Account Number',
  'Shirt Size',
  'Pants Size',
  'Boots Size',
  'Emergency Contact Name',
  'Emergency Contact Relationship',
  'Emergency Contact Phone',
  'Additional Details',
  'Additional Notes',
  'candidate UUID',
];

const normalizeTodos = (todos = []) => {
  let changed = false;
  todos.forEach((todo) => {
    if (!todo.id) {
      todo.id = crypto.randomUUID();
      changed = true;
    }
    if (typeof todo.done !== 'boolean') {
      todo.done = !!todo.done;
      changed = true;
    }
  });
  return changed;
};

const parseDateValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const ts = Date.parse(text);
  return Number.isNaN(ts) ? null : ts;
};

const sortCandidateRowsByHireDate = (rows) => {
  return rows.sort((a, b) => {
    const aTime = parseDateValue(a['Hire Date']);
    const bTime = parseDateValue(b['Hire Date']);
    if (aTime === null && bTime === null) return 0;
    if (aTime === null) return 1;
    if (bTime === null) return -1;
    if (aTime !== bTime) return aTime - bTime;
    const aName = String(a['Candidate Name'] || '');
    const bName = String(b['Candidate Name'] || '');
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

const sanitizeFilename = (name) => {
  const safe = String(name || '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return safe || 'export';
};

const csvEscape = (value) => {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const rowsToCsv = (columns, rows) => {
  let cols = Array.isArray(columns) ? columns.filter((col) => col && col !== '__rowId') : [];
  const dataRows = Array.isArray(rows) ? rows : [];
  if (!cols.length && dataRows.length) {
    cols = Object.keys(dataRows[0]).filter((col) => col !== '__rowId');
  }
  const lines = [];
  if (cols.length) {
    lines.push(cols.map(csvEscape).join(','));
  }
  dataRows.forEach((row) => {
    const line = cols.map((col) => csvEscape(row ? row[col] : '')).join(',');
    lines.push(line);
  });
  return lines.join('\n');
};

const SENSITIVE_PII_FIELDS = [
  'Contact Phone',
  'Contact Email',
  'Background Provider',
  'Background Cleared Date',
  'Background MVR Flag',
  'License Type',
  'MA CORI Status',
  'MA CORI Date',
  'NH GC Status',
  'NH GC Expiration Date',
  'NH GC ID Number',
  'ME GC Status',
  'ME GC Expiration Date',
  'ID Type',
  'State Abbreviation',
  'ID Number',
  'DOB',
  'EXP',
  'Other ID Type',
  'Social',
  'Bank Name',
  'Account Type',
  'Routing Number',
  'Account Number',
  'Shirt Size',
  'Pants Size',
  'Boots Size',
  'Emergency Contact Name',
  'Emergency Contact Relationship',
  'Emergency Contact Phone',
  'Additional Details',
  'Additional Notes',
];

const SENSITIVE_CARD_FIELDS = ['icims_id', 'employee_id'];

const parseMilitaryTime = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
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
  if (minutes === null || minutes === undefined) return '';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const formatTotalHours = (minutes) => {
  if (minutes === null || minutes === undefined) return '';
  const hours = minutes / 60;
  return Number.isFinite(hours) ? hours.toFixed(2) : '';
};

const TABLE_DEFS = {
  kanban_columns: {
    name: 'Kanban Columns',
    columns: ['id', 'name', 'order', 'created_at', 'updated_at'],
    rows: (db) => (db.kanban.columns || []).map((col) => ({
      __rowId: col.id,
      id: col.id,
      name: col.name,
      order: col.order ?? '',
      created_at: col.created_at ?? '',
      updated_at: col.updated_at ?? '',
    })),
  },
  kanban_cards: {
    name: 'Kanban Cards',
    columns: [
      'uuid',
      'candidate_name',
      'icims_id',
      'employee_id',
      'job_id',
      'job_name',
      'job_location',
      'manager',
      'branch',
      'column_id',
      'order',
      'created_at',
      'updated_at',
    ],
    rows: (db) => (db.kanban.cards || []).map((card) => ({
      __rowId: card.uuid,
      uuid: card.uuid,
      candidate_name: card.candidate_name || '',
      icims_id: card.icims_id || '',
      employee_id: card.employee_id || '',
      job_id: card.job_id || '',
      job_name: card.job_name || '',
      job_location: card.job_location || '',
      manager: card.manager || '',
      branch: card.branch || '',
      column_id: card.column_id || '',
      order: card.order ?? '',
      created_at: card.created_at || '',
      updated_at: card.updated_at || '',
    })),
  },
  candidate_data: {
    name: 'Onboarding Candidate Data',
    columns: [...KANBAN_CANDIDATE_FIELDS],
    rows: (db) => {
      const rows = (db.kanban.candidates || []).map((row) => ({
        __rowId: row['candidate UUID'] || row['Candidate Name'] || crypto.randomUUID(),
        ...KANBAN_CANDIDATE_FIELDS.reduce((acc, key) => {
          acc[key] = row[key] ?? '';
          return acc;
        }, {}),
      }));
      return sortCandidateRowsByHireDate(rows);
    },
  },
  weekly_entries: {
    name: 'Weekly Tracker Entries',
    columns: ['week_start', 'week_end', 'day', 'start', 'end', 'content'],
    rows: (db) => {
      const rows = [];
      const weeks = db.weekly || {};
      Object.values(weeks).forEach((week) => {
        const entries = week.entries || {};
        Object.keys(entries).forEach((day) => {
          const entry = entries[day] || {};
          rows.push({
            __rowId: `${week.week_start}-${day}`,
            week_start: week.week_start || '',
            week_end: week.week_end || '',
            day,
            start: entry.start || '',
            end: entry.end || '',
            content: entry.content || '',
          });
        });
      });
      return rows;
    },
  },
  todos: {
    name: 'Todos',
    columns: ['id', 'text', 'done', 'createdAt'],
    rows: (db) => {
      const todos = db.todos || [];
      return todos.map((todo) => ({
        __rowId: todo.id,
        id: todo.id,
        text: todo.text || '',
        done: !!todo.done,
        createdAt: todo.createdAt || '',
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
  let row = db.kanban.candidates.find((item) => item['candidate UUID'] === candidateId);
  if (!row) {
    row = {};
    KANBAN_CANDIDATE_FIELDS.forEach((field) => { row[field] = ''; });
    row['candidate UUID'] = candidateId;
    const card = db.kanban.cards.find((c) => c.uuid === candidateId);
    if (card) {
      row['Candidate Name'] = card.candidate_name || '';
    }
    db.kanban.candidates.push(row);
  } else {
    KANBAN_CANDIDATE_FIELDS.forEach((field) => {
      if (row[field] === undefined) row[field] = '';
    });
    if (!row['candidate UUID']) row['candidate UUID'] = candidateId;
  }
  return row;
};

const jobIdName = (jobId, jobName) => {
  return [jobId, jobName].filter(Boolean).join(' ').trim();
};

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#f6f7fb',
    title: APP_NAME,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
};

app.whenReady().then(() => {
  ensureAuthState();
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_NAME);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('auth:status', () => {
  ensureAuthState();
  return { ...authState };
});

ipcMain.handle('auth:setup', (_event, password) => {
  if (!password) return false;
  const salt = crypto.randomBytes(16);
  const iterations = 200000;
  const hash = hashPassword(password, salt, iterations);
  saveAuthFile({ salt: salt.toString('base64'), hash, iterations });
  authState = { configured: true, authenticated: true };
  activePassword = password;
  dbCache = null;
  loadDb();
  return true;
});

ipcMain.handle('auth:login', (_event, password) => {
  const auth = loadAuthFile();
  if (!auth || !password) return false;
  const salt = Buffer.from(auth.salt, 'base64');
  const iterations = auth.iterations || 200000;
  const hash = hashPassword(password, salt, iterations);
  if (hash !== auth.hash) return false;
  authState = { configured: true, authenticated: true };
  activePassword = password;
  dbCache = null;
  loadDb();
  return true;
});

ipcMain.handle('auth:change', (_event, { current, next }) => {
  const auth = loadAuthFile();
  if (!auth || !current || !next) return false;
  const salt = Buffer.from(auth.salt, 'base64');
  const iterations = auth.iterations || 200000;
  const hash = hashPassword(current, salt, iterations);
  if (hash !== auth.hash) return false;
  const newSalt = crypto.randomBytes(16);
  const newHash = hashPassword(next, newSalt, iterations);
  saveAuthFile({ salt: newSalt.toString('base64'), hash: newHash, iterations });
  activePassword = next;
  authState.authenticated = true;
  if (dbCache) saveDb(dbCache);
  dbCache = null;
  loadDb();
  return true;
});

ipcMain.handle('kanban:get', () => {
  requireAuth();
  const db = loadDb();
  return { columns: db.kanban.columns, cards: db.kanban.cards };
});

ipcMain.handle('kanban:addColumn', (_event, name) => {
  requireAuth();
  const db = loadDb();
  const order = Math.max(0, ...db.kanban.columns.map((c) => c.order || 0)) + 1;
  const column = {
    id: crypto.randomUUID(),
    name: String(name || '').trim(),
    order,
    created_at: new Date().toISOString(),
  };
  db.kanban.columns.push(column);
  saveDb(db);
  return { columns: db.kanban.columns };
});

ipcMain.handle('kanban:removeColumn', (_event, columnId) => {
  requireAuth();
  const db = loadDb();
  const exists = db.kanban.columns.some((col) => col.id === columnId);
  if (!exists) {
    return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards };
  }
  const remaining = db.kanban.columns.filter((col) => col.id !== columnId);
  const cardsInColumn = db.kanban.cards.filter((card) => card.column_id === columnId);
  if (remaining.length === 0) {
    if (cardsInColumn.length) {
      return { ok: false, error: 'last_column', message: LAST_COLUMN_MESSAGE };
    }
    db.kanban.columns = remaining;
    saveDb(db);
    return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards };
  }

  const target = pickFallbackColumn(db.kanban.columns, columnId);
  if (target) {
    moveCardsToColumn(db, new Set([columnId]), target.id);
  }
  db.kanban.columns = remaining;
  saveDb(db);
  return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards };
});

ipcMain.handle('kanban:addCard', (_event, payload) => {
  requireAuth();
  const db = loadDb();
  const columnId = payload.column_id;
  const order = Math.max(0, ...db.kanban.cards.filter((c) => c.column_id === columnId).map((c) => c.order || 0)) + 1;
  const card = {
    uuid: crypto.randomUUID(),
    column_id: columnId,
    order,
    candidate_name: payload.candidate_name || '',
    icims_id: payload.icims_id || '',
    employee_id: payload.employee_id || '',
    job_id: payload.job_id || '',
    job_name: payload.job_name || '',
    job_location: payload.job_location || '',
    manager: payload.manager || '',
    branch: payload.branch || '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  db.kanban.cards.push(card);

  const candidateRow = {};
  KANBAN_CANDIDATE_FIELDS.forEach((field) => { candidateRow[field] = ''; });
  candidateRow['Candidate Name'] = card.candidate_name;
  candidateRow['ICIMS ID'] = card.icims_id;
  candidateRow['Employee ID'] = card.employee_id;
  candidateRow['Contact Phone'] = payload.contact_phone || '';
  candidateRow['Contact Email'] = payload.contact_email || '';
  candidateRow['Job ID Name'] = jobIdName(card.job_id, card.job_name);
  candidateRow['Job Location'] = card.job_location;
  candidateRow['Manager'] = card.manager;
  candidateRow['Branch'] = card.branch;
  candidateRow['candidate UUID'] = card.uuid;
  db.kanban.candidates.push(candidateRow);

  saveDb(db);
  return { card };
});

ipcMain.handle('kanban:updateCard', (_event, { id, payload }) => {
  requireAuth();
  const db = loadDb();
  const card = db.kanban.cards.find((c) => c.uuid === id);
  if (!card) return { cards: db.kanban.cards };
  const updates = {};
  const allowed = new Set([
    'candidate_name',
    'icims_id',
    'employee_id',
    'job_id',
    'job_name',
    'job_location',
    'manager',
    'branch',
    'column_id',
    'order',
  ]);
  if (payload && typeof payload === 'object') {
    Object.keys(payload).forEach((key) => {
      if (allowed.has(key)) updates[key] = payload[key];
    });
  }
  Object.assign(card, updates);
  card.updated_at = new Date().toISOString();

  const candidateRow = ensureCandidateRow(db, id);
  candidateRow['Candidate Name'] = card.candidate_name || '';
  candidateRow['ICIMS ID'] = card.icims_id || '';
  candidateRow['Employee ID'] = card.employee_id || '';
  if (payload.contact_phone !== undefined) {
    candidateRow['Contact Phone'] = payload.contact_phone || '';
  }
  if (payload.contact_email !== undefined) {
    candidateRow['Contact Email'] = payload.contact_email || '';
  }
  candidateRow['Job ID Name'] = jobIdName(card.job_id, card.job_name);
  candidateRow['Job Location'] = card.job_location || '';
  candidateRow['Manager'] = card.manager || '';
  candidateRow['Branch'] = card.branch || '';

  saveDb(db);
  return { cards: db.kanban.cards };
});

ipcMain.handle('candidate:getPII', (_event, candidateId) => {
  requireAuth();
  const db = loadDb();
  const row = ensureCandidateRow(db, candidateId);
  const card = db.kanban.cards.find((c) => c.uuid === candidateId);
  if (card && card.candidate_name) {
    row['Candidate Name'] = card.candidate_name;
  }
  saveDb(db);
  return { row, candidateName: row['Candidate Name'] || (card ? card.candidate_name : '') };
});

ipcMain.handle('candidate:savePII', (_event, { candidateId, data }) => {
  requireAuth();
  const db = loadDb();
  const row = ensureCandidateRow(db, candidateId);
  const blocked = new Set(['Candidate Name', 'candidate UUID']);
  if (data && typeof data === 'object') {
    Object.keys(data).forEach((key) => {
      if (blocked.has(key)) return;
      row[key] = data[key];
    });
  }
  saveDb(db);
  return true;
});

ipcMain.handle('kanban:processCandidate', (_event, { candidateId, arrival, departure }) => {
  requireAuth();
  const db = loadDb();
  if (!candidateId) return { ok: false, message: 'Missing candidate.' };
  const card = db.kanban.cards.find((c) => c.uuid === candidateId);
  if (!card) return { ok: false, message: 'Candidate not found.' };

  const arrivalMinutes = roundToQuarterHour(parseMilitaryTime(arrival));
  const departureMinutes = roundToQuarterHour(parseMilitaryTime(departure));
  if (arrivalMinutes === null || departureMinutes === null) {
    return { ok: false, message: 'Invalid time format. Use 4-digit 24H time.' };
  }

  const arrivalText = formatMilitaryTime(arrivalMinutes);
  const departureText = formatMilitaryTime(departureMinutes);
  let totalMinutes = departureMinutes - arrivalMinutes;
  if (totalMinutes < 0) totalMinutes += 24 * 60;
  const totalHours = formatTotalHours(totalMinutes);

  const row = ensureCandidateRow(db, candidateId);
  row['Candidate Name'] = card.candidate_name || row['Candidate Name'] || '';
  row['ICIMS ID'] = card.icims_id || row['ICIMS ID'] || '';
  row['Employee ID'] = card.employee_id || row['Employee ID'] || '';
  row['Job ID Name'] = jobIdName(card.job_id, card.job_name);
  row['Job Location'] = card.job_location || row['Job Location'] || '';
  row['Manager'] = card.manager || row['Manager'] || '';
  row['Branch'] = card.branch || row['Branch'] || '';
  row['Neo Arrival Time'] = arrivalText;
  row['Neo Departure Time'] = departureText;
  row['Total Neo Hours'] = totalHours;

  SENSITIVE_PII_FIELDS.forEach((field) => { row[field] = ''; });
  SENSITIVE_CARD_FIELDS.forEach((field) => { card[field] = ''; });
  card.updated_at = new Date().toISOString();

  saveDb(db);
  return { ok: true, card };
});

ipcMain.handle('kanban:removeCandidate', (_event, candidateId) => {
  requireAuth();
  const db = loadDb();
  if (!candidateId) return { ok: false, message: 'Missing candidate.' };
  db.kanban.cards = db.kanban.cards.filter((card) => card.uuid !== candidateId);
  db.kanban.candidates = db.kanban.candidates.filter(
    (row) => row['candidate UUID'] !== candidateId
  );
  saveDb(db);
  return { ok: true, columns: db.kanban.columns, cards: db.kanban.cards };
});

ipcMain.handle('kanban:reorderColumn', (_event, { columnId, cardIds }) => {
  requireAuth();
  const db = loadDb();
  const columnCards = db.kanban.cards.filter((c) => c.column_id === columnId);
  const map = new Map(columnCards.map((c) => [c.uuid, c]));
  const seen = new Set();
  const ordered = [];

  (cardIds || []).forEach((id) => {
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

  ordered.forEach((card, idx) => {
    card.order = idx + 1;
    card.updated_at = new Date().toISOString();
  });

  saveDb(db);
  return { cards: db.kanban.cards };
});

ipcMain.handle('weekly:get', () => {
  requireAuth();
  const db = loadDb();
  const { weekStart, weekEnd } = getCurrentWeek();
  if (!db.weekly[weekStart]) {
    db.weekly[weekStart] = { week_start: weekStart, week_end: weekEnd, entries: {} };
    saveDb(db);
  }
  return db.weekly[weekStart];
});

ipcMain.handle('weekly:save', (_event, entries) => {
  requireAuth();
  const db = loadDb();
  const { weekStart, weekEnd } = getCurrentWeek();
  db.weekly[weekStart] = {
    week_start: weekStart,
    week_end: weekEnd,
    entries: entries || {},
  };
  saveDb(db);
  return true;
});

ipcMain.handle('weekly:summary', () => {
  requireAuth();
  const db = loadDb();
  const { weekStart } = getCurrentWeek();
  const data = db.weekly[weekStart] || { week_start: weekStart, week_end: '', entries: {} };
  const content = buildWeeklySummary(data);
  return {
    filename: `Weekly_${weekStart}_Summary.md`,
    content,
  };
});

ipcMain.handle('todos:get', () => {
  requireAuth();
  const db = loadDb();
  const changed = normalizeTodos(db.todos || []);
  if (changed) saveDb(db);
  return db.todos || [];
});

ipcMain.handle('todos:save', (_event, todos) => {
  requireAuth();
  const db = loadDb();
  db.todos = Array.isArray(todos) ? todos : [];
  const changed = normalizeTodos(db.todos);
  saveDb(db);
  return true;
});

ipcMain.handle('db:listTables', () => {
  requireAuth();
  const db = loadDb();
  return Object.keys(TABLE_DEFS).map((id) => {
    const def = TABLE_DEFS[id];
    const rows = def.rows(db);
    return { id, name: def.name, count: rows.length };
  });
});

ipcMain.handle('db:getTable', (_event, tableId) => {
  requireAuth();
  const db = loadDb();
  const table = buildTable(tableId, db);
  return table || { id: tableId, name: 'Unknown', columns: [], rows: [] };
});

ipcMain.handle('db:exportCsv', async (_event, payload) => {
  requireAuth();
  const { tableId, tableName, columns, rows } = payload || {};
  let exportColumns = Array.isArray(columns) ? columns : [];
  let exportRows = Array.isArray(rows) ? rows : [];
  if ((!exportColumns.length || !exportRows.length) && tableId) {
    const db = loadDb();
    const table = buildTable(tableId, db);
    if (table) {
      if (!exportColumns.length) exportColumns = table.columns;
      if (!exportRows.length) exportRows = table.rows;
    }
  }
  const baseName = sanitizeFilename(tableName || tableId || 'table');
  const defaultFilename = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
  const defaultPath = path.join(app.getPath('documents'), defaultFilename);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export CSV',
    defaultPath,
    buttonLabel: 'Save CSV',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const csv = rowsToCsv(exportColumns, exportRows);
  fs.writeFileSync(filePath, csv, 'utf-8');
  return { ok: true, filePath };
});

ipcMain.handle('db:deleteRows', (_event, { tableId, rowIds }) => {
  requireAuth();
  const db = loadDb();
  const ids = new Set(rowIds || []);

  switch (tableId) {
    case 'kanban_columns': {
      const removed = db.kanban.columns.filter((col) => ids.has(col.id));
      const remaining = db.kanban.columns.filter((col) => !ids.has(col.id));
      const removedColumnIds = new Set(removed.map((col) => col.id));
      const removedCards = db.kanban.cards.filter((card) => removedColumnIds.has(card.column_id));
      if (remaining.length === 0 && removedCards.length) {
        return { ok: false, error: 'last_column', message: LAST_COLUMN_MESSAGE };
      }
      if (remaining.length > 0 && removedCards.length) {
        const target = orderColumns(remaining)[0];
        if (target) {
          moveCardsToColumn(db, removedColumnIds, target.id);
        }
      }
      db.kanban.columns = remaining;
      break;
    }
    case 'kanban_cards': {
      db.kanban.cards = db.kanban.cards.filter((card) => !ids.has(card.uuid));
      db.kanban.candidates = db.kanban.candidates.filter((row) => !ids.has(row['candidate UUID']));
      break;
    }
    case 'candidate_data': {
      db.kanban.candidates = db.kanban.candidates.filter((row) => !ids.has(row['candidate UUID']));
      break;
    }
    case 'weekly_entries': {
      const weeks = db.weekly || {};
      Object.values(weeks).forEach((week) => {
        const entries = week.entries || {};
        Object.keys(entries).forEach((day) => {
          const rowId = `${week.week_start}-${day}`;
          if (ids.has(rowId)) {
            delete entries[day];
          }
        });
        week.entries = entries;
      });
      db.weekly = weeks;
      break;
    }
    case 'todos': {
      db.todos = (db.todos || []).filter((todo) => !ids.has(todo.id));
      break;
    }
    default:
      break;
  }

  saveDb(db);
  return { ok: true };
});
