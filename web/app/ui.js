import { workflowApi } from "./state.js";

export const $ = (id) => document.getElementById(id);

export const debounce = (fn, delay = 200) => {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
};

export const showToast = ({ message, actionLabel, onAction, duration = 5000 }) => {
  const root = $("toast-root");
  if (!root) return;
  const toast = document.createElement("div");
  toast.className = "toast";

  const text = document.createElement("div");
  text.className = "toast__text";
  text.textContent = message || "";
  toast.appendChild(text);

  if (actionLabel && typeof onAction === "function") {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast__action";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        await onAction();
      } finally {
        toast.remove();
      }
    });
    toast.appendChild(actionBtn);
  }

  root.appendChild(toast);
  const timer = window.setTimeout(() => {
    toast.remove();
  }, duration);

  toast.addEventListener("mouseenter", () => window.clearTimeout(timer), { once: true });
};

export const withOptimisticUpdate = async ({
  apply,
  rollback,
  request,
  onSuccess,
  onErrorMessage,
  onRetry,
}) => {
  const attempt = async () => {
    if (typeof apply === "function") apply();
    try {
      const result = await request();
      if (result && result.ok === false) {
        throw new Error(result.message || result.error || "Request failed");
      }
      if (typeof onSuccess === "function") onSuccess(result);
      return result;
    } catch (error) {
      if (typeof rollback === "function") rollback();
      if (onErrorMessage) {
        showToast({
          message: onErrorMessage,
          actionLabel: "Retry",
          onAction: typeof onRetry === "function" ? onRetry : attempt,
        });
      }
      return null;
    }
  };
  return attempt();
};

export const positionFlyout = (panel) => {
  if (!panel) return;
  const header = document.querySelector(".page--active .topbar");
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const top = Math.max(24, Math.round(headerBottom + 16));
  panel.style.top = `${top}px`;
  panel.style.height = `calc(100% - ${top + 24}px)`;
};

export const setPanelVisibility = (panel, isOpen) => {
  if (!panel) return;
  if (panel.dataset.animTimer) {
    clearTimeout(Number(panel.dataset.animTimer));
    delete panel.dataset.animTimer;
  }
  if (isOpen) {
    panel.classList.remove("hidden");
    requestAnimationFrame(() => {
      panel.classList.add("is-open");
    });
    panel.setAttribute("aria-hidden", "false");
    return;
  }
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  const onEnd = (event) => {
    if (event.propertyName !== "opacity") return;
    panel.classList.add("hidden");
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
  const timer = window.setTimeout(() => {
    if (!panel.classList.contains("is-open")) {
      panel.classList.add("hidden");
    }
    panel.removeEventListener("transitionend", onEnd);
    delete panel.dataset.animTimer;
  }, 280);
  panel.dataset.animTimer = String(timer);
};

export const showMessageModal = (title, message) => {
  const modal = $("action-result-modal");
  const titleEl = $("action-result-title");
  const messageEl = $("action-result-message");
  const ok = $("action-result-ok");
  const close = $("action-result-close");
  if (!modal || !titleEl || !messageEl || !ok) return Promise.resolve();
  titleEl.textContent = title || "";
  messageEl.textContent = message || "";
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const onClose = (e) => {
      e && e.preventDefault();
      modal.classList.add("hidden");
      ok.removeEventListener("click", onClose);
      if (close) close.removeEventListener("click", onClose);
      resolve();
    };
    ok.addEventListener("click", onClose);
    if (close) close.addEventListener("click", onClose);
  });
};

export const initWindowControls = () => {
  const body = document.body;
  const platform = workflowApi && workflowApi.platform ? workflowApi.platform : "";
  const platformClass =
    platform === "darwin"
      ? "platform-mac"
      : platform === "win32"
        ? "platform-win"
        : "platform-linux";
  body.classList.add(platformClass);

  const controls = workflowApi && workflowApi.windowControls ? workflowApi.windowControls : null;
  const closeBtn = $("window-close");
  const minBtn = $("window-min");
  const maxBtn = $("window-max");
  if (!controls || !closeBtn || !minBtn || !maxBtn) return;

  closeBtn.addEventListener("click", () => controls.close());
  minBtn.addEventListener("click", () => controls.minimize());
  maxBtn.addEventListener("click", () => controls.toggleMaximize());

  const titlebar = document.querySelector(".titlebar");
  if (titlebar) {
    titlebar.addEventListener("dblclick", (event) => {
      if ((event.target && event.target.closest(".window-control")) || !controls) return;
      controls.toggleMaximize();
    });
  }
};

export const initPasswordToggles = () => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.pwToggle) return;
    input.dataset.pwToggle = "1";
    const wrapper = document.createElement("div");
    wrapper.className = "password-wrapper";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-toggle";
    btn.title = "Show password";
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = "👁️";
    btn.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? "🙈" : "👁️";
      btn.title = show ? "Hide password" : "Show password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
    });

    wrapper.appendChild(btn);
  });
};

export const observeNewPasswordFields = () => {
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
