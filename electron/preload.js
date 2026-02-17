const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workflowApi", {
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke("app:version"),
  authStatus: () => ipcRenderer.invoke("auth:status"),
  authSetup: (password) => ipcRenderer.invoke("auth:setup", password),
  authLogin: (password) => ipcRenderer.invoke("auth:login", password),
  authChange: (current, next) => ipcRenderer.invoke("auth:change", { current, next }),

  kanbanGet: () => ipcRenderer.invoke("kanban:get"),
  kanbanAddColumn: (name) => ipcRenderer.invoke("kanban:addColumn", name),
  kanbanRemoveColumn: (columnId) => ipcRenderer.invoke("kanban:removeColumn", columnId),
  kanbanAddCard: (payload) => ipcRenderer.invoke("kanban:addCard", payload),
  kanbanUpdateCard: (id, payload) => ipcRenderer.invoke("kanban:updateCard", { id, payload }),
  kanbanReorderColumn: (columnId, cardIds) =>
    ipcRenderer.invoke("kanban:reorderColumn", { columnId, cardIds }),
  kanbanProcessCandidate: (payload) => ipcRenderer.invoke("kanban:processCandidate", payload),
  kanbanRemoveCandidate: (candidateId) => ipcRenderer.invoke("kanban:removeCandidate", candidateId),

  weeklyGet: () => ipcRenderer.invoke("weekly:get"),
  weeklySave: (entries) => ipcRenderer.invoke("weekly:save", entries),
  weeklySummary: () => ipcRenderer.invoke("weekly:summary"),

  todosGet: () => ipcRenderer.invoke("todos:get"),
  todosSave: (todos) => ipcRenderer.invoke("todos:save", todos),
  uniformsAddItem: (payload) => ipcRenderer.invoke("uniforms:addItem", payload),
  emailTemplatesGet: () => ipcRenderer.invoke("emailTemplates:get"),
  emailTemplatesSave: (payload) => ipcRenderer.invoke("emailTemplates:save", payload),

  dbSources: () => ipcRenderer.invoke("db:sources"),
  dbSetSource: (sourceId) => ipcRenderer.invoke("db:setSource", sourceId),
  dbListTables: (sourceId) => ipcRenderer.invoke("db:listTables", sourceId),
  dbGetTable: (tableId, sourceId) => ipcRenderer.invoke("db:getTable", tableId, sourceId),
  dbDeleteRows: (tableId, rowIds, sourceId) =>
    ipcRenderer.invoke("db:deleteRows", { tableId, rowIds, sourceId }),
  dbExportCsv: (payload) => ipcRenderer.invoke("db:exportCsv", payload),
  dbImportPick: () => ipcRenderer.invoke("db:importPick"),
  dbImportApply: (payload) => ipcRenderer.invoke("db:importApply", payload),
  dbValidateCurrent: () => ipcRenderer.invoke("db:validateCurrent"),

  recycleUndo: (id) => ipcRenderer.invoke("recycle:undo", id),
  recycleRedo: (id) => ipcRenderer.invoke("recycle:redo", id),

  piiGet: (candidateId) => ipcRenderer.invoke("candidate:getPII", candidateId),
  piiSave: (candidateId, data) => ipcRenderer.invoke("candidate:savePII", { candidateId, data }),

  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    unmaximize: () => ipcRenderer.invoke("window:unmaximize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onMaximized: (callback) => ipcRenderer.on("window:maximized", () => callback()),
    onUnmaximized: (callback) => ipcRenderer.on("window:unmaximized", () => callback()),
  },
});
