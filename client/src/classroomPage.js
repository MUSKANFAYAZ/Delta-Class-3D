export function renderClassroomPage(appRoot, { role = "student", onExit } = {}) {
  if (!appRoot) {
    throw new Error("Missing app root element");
  }

  appRoot.innerHTML = `
    <div class="dc-root dc-room-shell" style="overflow: hidden;">
      <div class="dc-grid-bg" aria-hidden="true"></div>
      <header class="dc-topbar" style="position: absolute; top: 12px; left: 12px; right: 12px; z-index: 20;">
        <div>
          <h1 class="dc-brand" style="text-align: left; font-size: 20px; margin: 0;">DeltaClass3D</h1>
          <p id="connection-status" class="dc-muted dc-small" style="margin: 3px 0 0;">Preparing lightweight classroom shell.</p>
        </div>
        <div class="dc-topbar-actions">
          <span id="connection-badge" class="connection">Starting</span>
          <div class="voice-controls item-group" style="display: flex; gap: 8px;">
            ${role === "student" ? `
              <button id="deafen-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn" title="Mute Teacher" style="padding: 0; display: flex; align-items: center; justify-content: center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="icon-headph"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
              </button>
            ` : `
              <button id="presentation-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn" title="Start Presentation" style="padding: 0; display: flex; align-items: center; justify-content: center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              </button>
            `}
            <button id="mute-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn" title="Unmute Mic" style="padding: 0; display: flex; align-items: center; justify-content: center;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="icon-mic-off"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </button>
          </div>
          <button id="classroom-exit-button" type="button" class="dc-btn dc-btn-ghost">
            ${role === "teacher" ? "Exit (Teacher)" : "Exit"}
          </button>
        </div>
      </header>
      <section id="bandwidth-panel" class="bandwidth-panel" style="position: absolute; left: 12px; top: 88px; z-index: 20; width: min(320px, calc(100% - 24px)); background: var(--dc-card); border: 1px solid var(--dc-border); border-radius: 14px; padding: 14px; display: grid; gap: 8px; box-shadow: var(--dc-shadow);">
        <label class="dc-field-label">3D classroom</label>
        <p class="dc-muted dc-small">Tap to load the 3D scene. On slow connections, it will not start until you choose.</p>
        <button id="load-classroom-button" type="button" class="dc-btn dc-btn-primary dc-btn-large">Load 3D classroom</button>
      </section>
      <main id="canvas-container" class="canvas-container" style="position: absolute; inset: 0; z-index: 10;"></main>
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
  const loadButton = document.getElementById("load-classroom-button");
  const exitButton = document.getElementById("classroom-exit-button");
  const muteButton = document.getElementById("mute-button");
  const deafenButton = document.getElementById("deafen-button");
  const modalBackdrop = document.getElementById("exit-modal-backdrop");
  const cancelExitBtn = document.getElementById("cancel-exit-btn");

  if (!connectionStatus || !connectionBadge || !bandwidthPanel || !loadButton || !exitButton) {
    throw new Error("Missing classroom UI elements");
  }

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
    setStatus,
  };
}