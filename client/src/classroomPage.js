export function renderClassroomPage(appRoot, { role = "student", onExit } = {}) {
  if (!appRoot) {
    throw new Error("Missing app root element");
  }

  appRoot.innerHTML = `
    <div class="dc-root dc-room-shell">
      <div class="dc-grid-bg" aria-hidden="true"></div>
      <header class="dc-topbar dc-room-topbar-shell">
        <div>
          <h1 class="dc-brand dc-room-brand">DeltaClass3D</h1>
          <p id="connection-status" class="dc-muted dc-small dc-room-status">Preparing lightweight classroom shell.</p>
        </div>
        <div class="dc-topbar-actions">
          <span id="connection-badge" class="connection">Starting</span>
          <div class="voice-controls item-group dc-room-voice-controls">
            ${role === "student" ? `
                <button id="raise-hand-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Raise Hand">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3v10"></path>
                    <path d="M8 7l4-4 4 4"></path>
                    <path d="M6 21h12"></path>
                  </svg>
                </button>
                <button id="deafen-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Mute Teacher">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="icon-headph"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
              </button>
            ` : `
              <button id="presentation-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Start Presentation">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              </button>
            `}
            <button id="mute-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Unmute Mic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="icon-mic-off"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
          </div>
          <button id="classroom-exit-button" type="button" class="dc-btn dc-btn-ghost">
            ${role === "teacher" ? "Exit (Teacher)" : "Exit"}
          </button>
          <button id="reload-button" type="button" class="dc-btn dc-btn-ghost dc-reload-btn" data-tooltip="Reload classroom (F5, Shift+F5, Ctrl/Cmd+R, Ctrl/Cmd+Shift+R)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg>
            Reload
          </button>
          <button id="layout-hide-button" type="button" class="dc-btn dc-btn-ghost dc-layout-toggle-btn">
            Hide Layout
          </button>
        </div>
      </header>
      <section id="bandwidth-panel" class="bandwidth-panel dc-bandwidth-panel">
        <label class="dc-field-label">3D classroom</label>
        <p class="dc-muted dc-small">Tap to load the 3D scene. On slow connections, it will not start until you choose.</p>
        <button id="load-classroom-button" type="button" class="dc-btn dc-btn-primary dc-btn-large">Load 3D classroom</button>
      </section>
      <button id="layout-show-button" type="button" class="dc-btn dc-btn-secondary dc-layout-show-btn" style="display: none;">
        Show Layout
      </button>
      <main id="canvas-container" class="canvas-container dc-classroom-canvas"></main>
      ${role === "teacher" ? `
      <aside id="raise-hand-panel" class="dc-raise-hand-panel" aria-live="polite">
        <h3 class="dc-raise-hand-title">Raised Hands</h3>
        <p class="dc-muted dc-small">Students who raised hands will appear here.</p>
        <ul id="raise-hand-list" class="dc-raise-hand-list"></ul>
      </aside>
      ` : ``}
    </div>

    <!-- Reload Warning Modal -->
    <div id="reload-modal-backdrop" class="dc-modal-backdrop" style="display: none;">
      <div class="dc-modal dc-reload-modal">
        <h2>Reload Classroom?</h2>
        <p class="dc-reload-warning">You may have to reload the classroom.</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-primary" id="confirm-reload-btn">Reload</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="cancel-reload-btn">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Exit Modal -->
    <div id="exit-modal-backdrop" class="dc-modal-backdrop" style="display: none;">
      <div class="dc-modal dc-exit-modal">
        <h2>Exit Classroom</h2>
        <p class="dc-exit-warning">Are you sure you want to leave?</p>
        <div class="dc-modal-actions" id="exit-modal-actions">
          ${role === "teacher" ? `
            <button type="button" class="dc-btn dc-btn-secondary" id="take-break-btn">Take a Break</button>
            <button type="button" class="dc-btn dc-btn-primary" id="end-call-btn">End Class</button>
            <button type="button" class="dc-btn dc-btn-ghost" id="cancel-exit-btn">Cancel</button>
          ` : `
            <button type="button" class="dc-btn dc-btn-primary" id="confirm-exit-btn">Exit</button>
            <button type="button" class="dc-btn dc-btn-ghost" id="cancel-exit-btn">Cancel</button>
          `}
        </div>
      </div>
    </div>
  `;

  const connectionStatus = document.getElementById("connection-status");
  const connectionBadge = document.getElementById("connection-badge");
  const bandwidthPanel = document.getElementById("bandwidth-panel");
  const roomShell = appRoot.querySelector(".dc-room-shell");
  const loadButton = document.getElementById("load-classroom-button");
  const exitButton = document.getElementById("classroom-exit-button");
  const reloadButton = document.getElementById("reload-button");
  const layoutHideButton = document.getElementById("layout-hide-button");
  const layoutShowButton = document.getElementById("layout-show-button");
  const muteButton = document.getElementById("mute-button");
  const raiseHandButton = document.getElementById("raise-hand-button");
  const deafenButton = document.getElementById("deafen-button");
  const modalBackdrop = document.getElementById("exit-modal-backdrop");
  const cancelExitBtn = document.getElementById("cancel-exit-btn");
  const reloadModalBackdrop = document.getElementById("reload-modal-backdrop");
  const confirmReloadBtn = document.getElementById("confirm-reload-btn");
  const cancelReloadBtn = document.getElementById("cancel-reload-btn");

  if (!connectionStatus || !connectionBadge || !bandwidthPanel || !loadButton || !exitButton) {
    throw new Error("Missing classroom UI elements");
  }

  const raiseHandPanel = document.getElementById("raise-hand-panel");
  const raiseHandList = document.getElementById("raise-hand-list");

  const showModal = () => {
    modalBackdrop.style.display = "flex";
  };

  const hideModal = () => {
    modalBackdrop.style.display = "none";
  };

  if (cancelExitBtn) {
    cancelExitBtn.addEventListener("click", hideModal);
  }

  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) hideModal();
  });

  if (typeof onExit === "function") {
    exitButton.addEventListener("click", showModal);
    
    if (role === "teacher") {
      const takeBreakBtn = document.getElementById("take-break-btn");
      const endCallBtn = document.getElementById("end-call-btn");
      
      if (takeBreakBtn) {
        takeBreakBtn.addEventListener("click", () => {
          hideModal();
          onExit({ action: "take_break" });
        });
      }
      
      if (endCallBtn) {
        endCallBtn.addEventListener("click", () => {
          hideModal();
          onExit({ action: "end_call" });
        });
      }
    } else {
      const confirmExitBtn = document.getElementById("confirm-exit-btn");
      
      if (confirmExitBtn) {
        confirmExitBtn.addEventListener("click", () => {
          hideModal();
          onExit({ action: "exit" });
        });
      }
    }
  }

  if (roomShell && layoutHideButton && layoutShowButton) {
    layoutHideButton.addEventListener("click", () => {
      roomShell.classList.add("dc-room-layout-hidden");
      layoutShowButton.style.display = "inline-flex";
    });

    layoutShowButton.addEventListener("click", () => {
      roomShell.classList.remove("dc-room-layout-hidden");
      layoutShowButton.style.display = "none";
    });
  }

  if (reloadModalBackdrop && confirmReloadBtn && cancelReloadBtn) {
    confirmReloadBtn.addEventListener("click", () => {
      reloadModalBackdrop.style.display = "none";
      window.location.reload();
    });

    cancelReloadBtn.addEventListener("click", () => {
      reloadModalBackdrop.style.display = "none";
    });

    reloadModalBackdrop.addEventListener("click", (e) => {
      if (e.target === reloadModalBackdrop) {
        reloadModalBackdrop.style.display = "none";
      }
    });
  }

  if (reloadButton) {
    reloadButton.addEventListener("click", () => {
      if (reloadModalBackdrop) reloadModalBackdrop.style.display = "flex";
    });
  }

  if (raiseHandButton && role === "student") {
    raiseHandButton.addEventListener("click", () => {
      if (window.activeClassroomSocket) {
        window.activeClassroomSocket.emit("raise-hand");
        window.activeClassroomSocket.emit("request-unmute");
      }
      raiseHandButton.setAttribute("data-tooltip", "Raised hand");
      raiseHandButton.style.color = "#7c3aed";
    });
  }

  // Show the app's styled reload overlay when a native beforeunload is triggered
  // This runs alongside the native browser dialog; the native dialog cannot
  // be styled, but this ensures the page behind it matches our UI colors.
  window.addEventListener("beforeunload", (e) => {
    if (reloadModalBackdrop) {
      try {
        reloadModalBackdrop.style.display = "flex";
      } catch (err) {
        // ignore errors during unload
      }
    }
  });

  // Intercept common keyboard reload shortcuts (F5, Ctrl/Cmd+R) and show
  // the app's custom reload modal instead of allowing an immediate reload.
  // Note: reloads triggered via the browser UI (toolbar menu, close tab button)
  // cannot be intercepted without triggering the native beforeunload prompt.
  const handleReloadShortcut = (e) => {
    const key = e.key;
    const isF5 = key === "F5";
    const isShiftF5 = isF5 && e.shiftKey;
    const isCtrlR = (key === "r" || key === "R") && (e.ctrlKey || e.metaKey) && !e.shiftKey;
    const isCtrlShiftR = (key === "r" || key === "R") && (e.ctrlKey || e.metaKey) && e.shiftKey;

    if (isF5 || isShiftF5 || isCtrlR || isCtrlShiftR) {
      e.preventDefault();
      if (reloadModalBackdrop) reloadModalBackdrop.style.display = "flex";
    }
  };

  window.addEventListener("keydown", handleReloadShortcut, { passive: false });

  function setStatus(message, badgeText, badgeConnected = false) {
    connectionStatus.textContent = message;
    connectionBadge.textContent = badgeText;
    connectionBadge.classList.toggle("connected", badgeConnected);
  }

  return {
    connectionStatus,
    connectionBadge,
    bandwidthPanel,
    loadButton,
    muteButton,
    deafenButton,
    raiseHandPanel,
    raiseHandList,
    setStatus,
  };
}