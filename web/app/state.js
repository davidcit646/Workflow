export const workflowApi = window.workflowApi;

export const state = {
  kanban: {
    columns: [],
    cards: [],
    selectedColumnId: null,
    activeColumnId: null,
    editingCardId: null,
    draggingCardId: null,
    piiCandidateId: null,
    detailsCardId: null,
    detailsRow: null,
    neoDateCandidateId: null,
    loaded: false,
    cache: {
      columns: null,
      cardsByColumn: new Map(),
      dirty: true,
    },
    dom: {
      board: null,
      columns: new Map(),
    },
  },
  auth: {
    configured: false,
    authenticated: false,
  },
  todos: [],
  data: {
    tables: [],
    tableId: null,
    columns: [],
    rows: [],
    query: "",
    selectedRowIds: new Set(),
    page: 1,
    pageSize: 50,
  },
  flyouts: {
    weekly: false,
    todo: false,
  },
  page: "dashboard",
};
