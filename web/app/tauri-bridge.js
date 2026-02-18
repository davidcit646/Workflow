(() => {
  const tauriGlobal = window.__TAURI__ || null;
  const tauriInternals = window.__TAURI_INTERNALS__ || null;
  const invoke =
    (tauriGlobal &&
      tauriGlobal.core &&
      typeof tauriGlobal.core.invoke === "function" &&
      tauriGlobal.core.invoke.bind(tauriGlobal.core)) ||
    (tauriGlobal &&
      typeof tauriGlobal.invoke === "function" &&
      tauriGlobal.invoke.bind(tauriGlobal)) ||
    (tauriInternals &&
      typeof tauriInternals.invoke === "function" &&
      tauriInternals.invoke.bind(tauriInternals));

  if (!invoke) return;

  const detectPlatform = () => {
    const raw = String(
      navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "",
    )
      .toLowerCase()
      .trim();
    if (raw.includes("win")) return "win32";
    if (raw.includes("mac") || raw.includes("darwin")) return "darwin";
    return "linux";
  };

  const call = async (command, payload = {}) => {
    try {
      return await invoke(command, payload);
    } catch (error) {
      throw new Error(error && error.message ? error.message : String(error || "Unknown error"));
    }
  };

  const bridge = {
    isTauri: true,
    platform: detectPlatform(),
    appVersion: async () => call("app_version"),
    platformName: async () => call("platform_name"),
    setupStatus: async () => {
      try {
        return await call("setup_status");
      } catch (error) {
        return { needsSetup: false, folder: "", fallback: false };
      }
    },
    setupComplete: async ({ donationChoice } = {}) => {
      try {
        return await call("setup_complete", {
          payload: { donation_choice: donationChoice ?? null },
        });
      } catch (error) {
        return false;
      }
    },
    donationPreference: async () => {
      try {
        return await call("donation_preference");
      } catch (error) {
        return { choice: "not_now" };
      }
    },
    biometricStatus: async () => {
      try {
        return await call("biometric_status");
      } catch (error) {
        return { available: false, enabled: false };
      }
    },
    biometricEnable: async (password) => {
      try {
        return await call("biometric_enable", {
          payload: { password },
        });
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : "Biometrics unavailable.",
        };
      }
    },
    biometricDisable: async () => {
      try {
        return await call("biometric_disable");
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : "Biometrics unavailable.",
        };
      }
    },
    biometricUnlock: async () => {
      try {
        return await call("biometric_unlock");
      } catch (error) {
        return {
          ok: false,
          password: null,
          error: error && error.message ? error.message : "Biometrics unavailable.",
        };
      }
    },
    donate: async () => {
      try {
        return await call("donate");
      } catch (error) {
        return {
          ok: false,
          message: error && error.message ? error.message : "Billing unavailable.",
        };
      }
    },
    clipboardWrite: async (text) => {
      try {
        return await call("clipboard_write", { payload: { text } });
      } catch (error) {
        return false;
      }
    },
    openExternal: async (url) => {
      try {
        return await call("open_external", { payload: { url } });
      } catch (error) {
        return false;
      }
    },
    openEmailDraft: async ({ filename, content }) => {
      try {
        return await call("open_email_draft", { payload: { filename, content } });
      } catch (error) {
        return false;
      }
    },
    windowControls: {
      minimize: async () => call("window_minimize"),
      maximize: async () => call("window_maximize"),
      unmaximize: async () => call("window_unmaximize"),
      toggleMaximize: async () => call("window_toggle_maximize"),
      isMaximized: async () => call("window_is_maximized"),
      close: async () => call("window_close"),
      onMaximized: () => {},
      onUnmaximized: () => {},
    },
    pickTextFile: async () => {
      try {
        return await call("pick_text_file");
      } catch (error) {
        return {
          ok: false,
          canceled: false,
          error: error && error.message ? error.message : "Unable to open file picker.",
        };
      }
    },
    saveCsvFile: async ({ filename, content }) => {
      try {
        return await call("save_csv_file", { payload: { filename, content } });
      } catch (error) {
        return {
          ok: false,
          canceled: false,
          filename,
          error: error && error.message ? error.message : "Unable to save CSV file.",
        };
      }
    },
    dbExportCsv: async ({ filename, columns, rows }) => {
      try {
        return await call("db_export_csv", {
          payload: { filename, columns, rows },
        });
      } catch (error) {
        return null;
      }
    },
    storageInfo: async () => {
      try {
        return await call("storage_info");
      } catch (error) {
        return { ok: false, path_label: "" };
      }
    },
    readText: async (name) => {
      try {
        return await call("storage_read_text", { payload: { name } });
      } catch (error) {
        return null;
      }
    },
    writeText: async (name, text) => {
      try {
        return await call("storage_write_text", { payload: { name, text } });
      } catch (error) {
        return false;
      }
    },
    readJson: async (name) => {
      try {
        return await call("storage_read_json", { payload: { name } });
      } catch (error) {
        return null;
      }
    },
    writeJson: async (name, value) => {
      try {
        return await call("storage_write_json", { payload: { name, value } });
      } catch (error) {
        return false;
      }
    },
    readEncryptedJson: async (name, password) => {
      try {
        return await call("storage_read_encrypted_json", {
          payload: { name, password },
        });
      } catch (error) {
        return null;
      }
    },
    writeEncryptedJson: async (name, password, text) => {
      try {
        return await call("storage_write_encrypted_json", {
          payload: { name, password, text },
        });
      } catch (error) {
        return false;
      }
    },
    dbTodosGet: async (password) => {
      try {
        return await call("db_todos_get", {
          payload: { password },
        });
      } catch (error) {
        return null;
      }
    },
    dbDashboardGet: async (password) => {
      try {
        return await call("db_dashboard_get", {
          payload: { password },
        });
      } catch (error) {
        return null;
      }
    },
    dbTodosSet: async (password, todos) => {
      try {
        return await call("db_todos_set", {
          payload: { password, todos },
        });
      } catch (error) {
        return false;
      }
    },
    dbWeeklyGet: async ({ password, weekStart, weekEnd }) => {
      try {
        return await call("db_weekly_get", {
          payload: { password, week_start: weekStart, week_end: weekEnd },
        });
      } catch (error) {
        return null;
      }
    },
    dbWeeklySet: async ({ password, weekStart, weekEnd, entries }) => {
      try {
        return await call("db_weekly_set", {
          payload: {
            password,
            week_start: weekStart,
            week_end: weekEnd,
            entries,
          },
        });
      } catch (error) {
        return false;
      }
    },
    dbWeeklySummary: async ({ password, weekStart, weekEnd }) => {
      try {
        return await call("db_weekly_summary", {
          payload: { password, week_start: weekStart, week_end: weekEnd },
        });
      } catch (error) {
        return null;
      }
    },
    dbWeeklySummarySave: async ({ password, weekStart, weekEnd }) => {
      try {
        return await call("db_weekly_summary_save", {
          payload: { password, week_start: weekStart, week_end: weekEnd },
        });
      } catch (error) {
        return null;
      }
    },
    dbListTables: async (password) => {
      try {
        return await call("db_list_tables", {
          payload: { password },
        });
      } catch (error) {
        return null;
      }
    },
    dbGetTable: async ({ password, tableId }) => {
      try {
        return await call("db_get_table", {
          payload: { password, table_id: tableId },
        });
      } catch (error) {
        return null;
      }
    },
    dbSources: async (password) => {
      try {
        return await call("db_sources_get", {
          payload: { password },
        });
      } catch (error) {
        return null;
      }
    },
    dbSetSource: async ({ password, sourceId }) => {
      try {
        return await call("db_set_source", {
          payload: { password, source_id: sourceId },
        });
      } catch (error) {
        return null;
      }
    },
    dbListTablesSource: async ({ password, sourceId }) => {
      try {
        return await call("db_list_tables_source", {
          payload: { password, source_id: sourceId },
        });
      } catch (error) {
        return null;
      }
    },
    dbGetTableSource: async ({ password, sourceId, tableId }) => {
      try {
        return await call("db_get_table_source", {
          payload: { password, source_id: sourceId, table_id: tableId },
        });
      } catch (error) {
        return null;
      }
    },
    dbImportApply: async ({ action, fileName, fileData, password }) => {
      try {
        return await call("db_import_apply", {
          payload: {
            action,
            file_name: fileName,
            file_data: fileData,
            password,
          },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanGet: async (password) => {
      try {
        return await call("db_kanban_get", { payload: { password } });
      } catch (error) {
        return null;
      }
    },
    dbKanbanAddColumn: async ({ password, name }) => {
      try {
        return await call("db_kanban_add_column", {
          payload: { password, name },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanRemoveColumn: async ({ password, columnId }) => {
      try {
        return await call("db_kanban_remove_column", {
          payload: { password, column_id: columnId },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanAddCard: async ({ password, payload }) => {
      try {
        return await call("db_kanban_add_card", {
          payload: { password, payload },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanUpdateCard: async ({ password, id, payload }) => {
      try {
        return await call("db_kanban_update_card", {
          payload: { password, id, payload },
        });
      } catch (error) {
        return null;
      }
    },
    dbPiiGet: async ({ password, candidateId }) => {
      try {
        return await call("db_pii_get", {
          payload: { password, candidate_id: candidateId },
        });
      } catch (error) {
        return null;
      }
    },
    dbPiiSave: async ({ password, candidateId, data }) => {
      try {
        return await call("db_pii_save", {
          payload: { password, candidate_id: candidateId, data },
        });
      } catch (error) {
        return false;
      }
    },
    dbKanbanProcessCandidate: async ({ password, candidateId, arrival, departure, branch }) => {
      try {
        return await call("db_kanban_process_candidate", {
          payload: {
            password,
            candidate_id: candidateId,
            arrival,
            departure,
            branch,
          },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanRemoveCandidate: async ({ password, candidateId }) => {
      try {
        return await call("db_kanban_remove_candidate", {
          payload: { password, candidate_id: candidateId },
        });
      } catch (error) {
        return null;
      }
    },
    dbKanbanReorderColumn: async ({ password, columnId, cardIds }) => {
      try {
        return await call("db_kanban_reorder_column", {
          payload: { password, column_id: columnId, card_ids: cardIds },
        });
      } catch (error) {
        return null;
      }
    },
    dbUniformsAddItem: async ({ password, payload }) => {
      try {
        return await call("db_uniforms_add_item", {
          payload: { password, payload },
        });
      } catch (error) {
        return null;
      }
    },
    dbDeleteRows: async ({ password, tableId, rowIds }) => {
      try {
        return await call("db_delete_rows", {
          payload: { password, table_id: tableId, row_ids: rowIds },
        });
      } catch (error) {
        return null;
      }
    },
    dbValidateCurrent: async (password) => {
      try {
        return await call("db_validate_current", { payload: { password } });
      } catch (error) {
        return null;
      }
    },
    dbRecycleUndo: async ({ password, id }) => {
      try {
        return await call("db_recycle_undo", {
          payload: { password, id },
        });
      } catch (error) {
        return null;
      }
    },
    dbRecycleRedo: async ({ password, id }) => {
      try {
        return await call("db_recycle_redo", {
          payload: { password, id },
        });
      } catch (error) {
        return null;
      }
    },
    emailTemplatesGetRaw: async () => {
      try {
        return await call("email_templates_get");
      } catch (error) {
        return null;
      }
    },
    emailTemplatesSetRaw: async (value) => {
      try {
        return await call("email_templates_set", {
          payload: { value },
        });
      } catch (error) {
        return false;
      }
    },
    authRead: async () => {
      try {
        return await call("auth_read");
      } catch (error) {
        return null;
      }
    },
    authSetup: async ({ password, iterations }) => {
      try {
        return await call("auth_setup", {
          payload: { password, iterations },
        });
      } catch (error) {
        return null;
      }
    },
    authVerify: async ({ password }) => {
      try {
        return await call("auth_verify", {
          payload: { password },
        });
      } catch (error) {
        return false;
      }
    },
    authChange: async ({ current, next, iterations }) => {
      try {
        return await call("auth_change", {
          payload: { current, next, iterations },
        });
      } catch (error) {
        return false;
      }
    },
    hashPassword: async ({ password, salt, iterations }) => {
      try {
        return await call("crypto_hash_password", {
          payload: { password, salt, iterations },
        });
      } catch (error) {
        return null;
      }
    },
    encryptJson: async ({ text, password }) => {
      try {
        return await call("crypto_encrypt_json", { payload: { text, password } });
      } catch (error) {
        return null;
      }
    },
    decryptJson: async ({ password, salt, iv, tag, data }) => {
      try {
        return await call("crypto_decrypt_json", {
          payload: { password, salt, iv, tag, data },
        });
      } catch (error) {
        return null;
      }
    },
  };

  window.__workflowTauriBridge = bridge;

  if (typeof bridge.platformName === "function") {
    bridge
      .platformName()
      .then((value) => {
        if (value) bridge.platform = String(value);
      })
      .catch(() => {});
  }
})();
