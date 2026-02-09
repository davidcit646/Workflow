const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const APP_NAME = 'Workflow';
const AUTH_FILE = path.join(app.getPath('userData'), 'auth.json');
const DATA_FILE = path.join(app.getPath('userData'), 'workflow.enc');

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

const buildWeeklySummary = (weekData) => {
  const { week_start, week_end, entries } = weekData;
  const lines = [];
  const now = new Date();
  lines.push('='.repeat(60));
  lines.push('WEEKLY WORK TRACKER SUMMARY');
  lines.push(`Work Week: ${week_start} - ${week_end}`);
  lines.push(`Generated: ${now.toLocaleString()}`);
  lines.push('='.repeat(60));
  lines.push('');

  const days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
  days.forEach((day) => {
    const entry = entries[day] || { start: '', end: '', content: '' };
    lines.push(`--- ${day} ---`);
    if (entry.start && entry.end) {
      lines.push(`Time: ${entry.start} to ${entry.end}`);
    } else {
      lines.push('Time: (Not specified)');
    }
    lines.push('Activities:');
    lines.push(entry.content || '(No activities entered)');
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
    rows: (db) => (db.kanban.candidates || []).map((row) => ({
      __rowId: row['candidate UUID'] || row['Candidate Name'] || crypto.randomUUID(),
      ...KANBAN_CANDIDATE_FIELDS.reduce((acc, key) => {
        acc[key] = row[key] ?? '';
        return acc;
      }, {}),
    })),
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
  db.kanban.columns = db.kanban.columns.filter((col) => col.id !== columnId);
  const removedCards = db.kanban.cards.filter((card) => card.column_id === columnId);
  db.kanban.cards = db.kanban.cards.filter((card) => card.column_id !== columnId);
  const removedIds = new Set(removedCards.map((card) => card.uuid));
  db.kanban.candidates = db.kanban.candidates.filter((row) => !removedIds.has(row['candidate UUID']));
  saveDb(db);
  return { columns: db.kanban.columns, cards: db.kanban.cards };
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
  Object.assign(card, payload);
  card.updated_at = new Date().toISOString();

  const candidateRow = ensureCandidateRow(db, id);
  candidateRow['Candidate Name'] = card.candidate_name || '';
  candidateRow['ICIMS ID'] = card.icims_id || '';
  candidateRow['Employee ID'] = card.employee_id || '';
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
      if (!KANBAN_CANDIDATE_FIELDS.includes(key)) return;
      row[key] = data[key];
    });
  }
  saveDb(db);
  return true;
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
    filename: `Weekly_${weekStart}_Summary.txt`,
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

ipcMain.handle('db:deleteRows', (_event, { tableId, rowIds }) => {
  requireAuth();
  const db = loadDb();
  const ids = new Set(rowIds || []);

  switch (tableId) {
    case 'kanban_columns': {
      const removed = db.kanban.columns.filter((col) => ids.has(col.id));
      db.kanban.columns = db.kanban.columns.filter((col) => !ids.has(col.id));
      const removedColumnIds = new Set(removed.map((col) => col.id));
      const removedCards = db.kanban.cards.filter((card) => removedColumnIds.has(card.column_id));
      db.kanban.cards = db.kanban.cards.filter((card) => !removedColumnIds.has(card.column_id));
      const removedCardIds = new Set(removedCards.map((card) => card.uuid));
      db.kanban.candidates = db.kanban.candidates.filter((row) => !removedCardIds.has(row['candidate UUID']));
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
  return true;
});
