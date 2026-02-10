const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workflowApi', {
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authSetup: (password) => ipcRenderer.invoke('auth:setup', password),
  authLogin: (password) => ipcRenderer.invoke('auth:login', password),
  authChange: (current, next) => ipcRenderer.invoke('auth:change', { current, next }),

  kanbanGet: () => ipcRenderer.invoke('kanban:get'),
  kanbanAddColumn: (name) => ipcRenderer.invoke('kanban:addColumn', name),
  kanbanRemoveColumn: (columnId) => ipcRenderer.invoke('kanban:removeColumn', columnId),
  kanbanAddCard: (payload) => ipcRenderer.invoke('kanban:addCard', payload),
  kanbanUpdateCard: (id, payload) => ipcRenderer.invoke('kanban:updateCard', { id, payload }),
  kanbanReorderColumn: (columnId, cardIds) => ipcRenderer.invoke('kanban:reorderColumn', { columnId, cardIds }),
  kanbanProcessCandidate: (payload) => ipcRenderer.invoke('kanban:processCandidate', payload),
  kanbanRemoveCandidate: (candidateId) => ipcRenderer.invoke('kanban:removeCandidate', candidateId),

  weeklyGet: () => ipcRenderer.invoke('weekly:get'),
  weeklySave: (entries) => ipcRenderer.invoke('weekly:save', entries),
  weeklySummary: () => ipcRenderer.invoke('weekly:summary'),

  todosGet: () => ipcRenderer.invoke('todos:get'),
  todosSave: (todos) => ipcRenderer.invoke('todos:save', todos),

  dbListTables: () => ipcRenderer.invoke('db:listTables'),
  dbGetTable: (tableId) => ipcRenderer.invoke('db:getTable', tableId),
  dbDeleteRows: (tableId, rowIds) => ipcRenderer.invoke('db:deleteRows', { tableId, rowIds }),
  dbExportCsv: (payload) => ipcRenderer.invoke('db:exportCsv', payload),

  piiGet: (candidateId) => ipcRenderer.invoke('candidate:getPII', candidateId),
  piiSave: (candidateId, data) => ipcRenderer.invoke('candidate:savePII', { candidateId, data }),
});
