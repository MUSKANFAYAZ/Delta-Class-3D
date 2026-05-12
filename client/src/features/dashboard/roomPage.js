export function mountRoomPage(root, { roomCode, role, onExit }) {

  root.innerHTML = "";



  const wrap = document.createElement("div");

  wrap.className = "dc-root";

  wrap.innerHTML = `

    <main class="dc-room-shell">

      <header class="dc-room-topbar">

        <button type="button" class="dc-btn dc-btn-ghost" id="dc-room-exit">Exit (${role === "teacher" ? "Teacher" : "Student"})</button>

        <div class="dc-room-meta">

          <span class="dc-room-code">Room ${roomCode}</span>

          <span class="dc-room-role">${role === "teacher" ? "Teacher" : "Student"}</span>

        </div>

        <div class="voice-controls dc-room-voice-controls">
          ${role === "student" ? `
            <button id="raise-hand-button" type="button" class="dc-btn dc-btn-ghost dc-room-icon-btn" data-tooltip="Raise Hand">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
                <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
                <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
                <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
                <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
              </svg>
            </button>
          ` : ""}
          <button id="mute-button" type="button" class="dc-btn dc-btn-ghost dc-room-icon-btn" data-tooltip="Unmute Mic">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="1" y1="1" x2="23" y2="23"></line>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
        </div>

      </header>

      <main id="canvas-container" class="canvas-container"></main>

      ${role === "teacher" ? `
        <aside id="raise-hand-panel" class="dc-raise-hand-panel" aria-live="polite">
          <h3 class="dc-raise-hand-title">Raised Hands</h3>
          <p class="dc-muted dc-small">Students who raised hands will appear here.</p>
          <ul id="raise-hand-list" class="dc-raise-hand-list"></ul>
        </aside>
      ` : ""}

    </main>

    
    <div id="exit-modal-backdrop" class="dc-modal-backdrop dc-room-exit-backdrop" style="display: none;">
      <div class="dc-modal dc-exit-modal dc-room-exit-modal">
        <h3 class="dc-room-exit-title">Exit Confirmation</h3>
        <p class="dc-room-exit-copy">Are you sure you want to exit?</p>
        <div class="dc-modal-actions dc-room-exit-actions">
          ${role === "teacher" ? `
            <button id="take-break-btn" class="dc-btn dc-btn-secondary">Take a Break</button>
            <button id="end-call-btn" class="dc-btn dc-btn-primary">End Call</button>
          ` : `
            <button id="cancel-exit-btn" class="dc-btn dc-btn-secondary">Cancel</button>
            <button id="confirm-exit-btn" class="dc-btn dc-btn-primary">Exit</button>
          `}
        </div>
      </div>
    </div>
  `;



  root.appendChild(wrap);



  // Voice System Integration
  let voiceSystem = null;
  const muteButton = wrap.querySelector("#mute-button");
  const raiseHandButton = wrap.querySelector("#raise-hand-button");
  const raiseHandPanel = wrap.querySelector("#raise-hand-panel");
  const raiseHandList = wrap.querySelector("#raise-hand-list");
  let raiseHandListenersBound = false;
  const raiseHandState = new Map();

  // Initialize Voice System when socket becomes available
  const initializeVoiceSystem = async () => {
    if (window.activeClassroomSocket && !voiceSystem) {
      try {
        const { VoiceSystem } = await import("../../../classroom/VoiceSystem.js");
        voiceSystem = new VoiceSystem(window.activeClassroomSocket, window.activeClassroomSocket.id, role);
        window.activeVoiceSystem = voiceSystem;
        
        // Initialize local stream
        const micAvailable = await voiceSystem.initLocalStream();
        if (!micAvailable) {
          console.log("Microphone not available");
        }

        // Set up button event handlers
        setupVoiceControls();
        
        console.log("Voice System initialized successfully");
      } catch (error) {
        console.error("Failed to initialize Voice System:", error);
      }
    }
  };

  const setupVoiceControls = () => {
    if (!voiceSystem) return;
    let isHandRaised = false;

    if (raiseHandButton && role === "student") {
      raiseHandButton.addEventListener("click", () => {
        if (window.activeClassroomSocket) {
          if (!isHandRaised) {
            window.activeClassroomSocket.emit("raise-hand");
            window.activeClassroomSocket.emit("request-unmute");
            isHandRaised = true;
            raiseHandButton.setAttribute("aria-pressed", "true");
            raiseHandButton.setAttribute("data-tooltip", "Lower Hand");
            raiseHandButton.style.color = "#7c3aed";
            raiseHandButton.classList.add("dc-raise-hand-button--active");
            return;
          }

          window.activeClassroomSocket.emit("clear-raise-hand", { userId: window.activeClassroomSocket.id });
          isHandRaised = false;
          raiseHandButton.setAttribute("aria-pressed", "false");
          raiseHandButton.setAttribute("data-tooltip", "Raise Hand");
          raiseHandButton.style.color = "";
          raiseHandButton.classList.remove("dc-raise-hand-button--active");
        }
      });
    }

    // Mute/Unmute button
    if (muteButton) {
      muteButton.addEventListener("click", () => {
        const isMuted = voiceSystem.toggleMute();
        muteButton.innerHTML = isMuted
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>' // mic-off
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'; // mic-on
        
        muteButton.setAttribute("data-tooltip", isMuted ? "Unmute Mic" : "Mute Mic");
        muteButton.style.color = isMuted ? "#dc2626" : "#16a34a";
      });
    }

  };

  // Check for socket availability and initialize voice system
  const checkAndInitializeVoice = () => {
    if (window.activeClassroomSocket) {
      setupRaiseHandListeners();
      initializeVoiceSystem();
    } else {
      // Retry after a short delay
      setTimeout(checkAndInitializeVoice, 500);
    }
  };

  const setupRaiseHandListeners = () => {
    if (raiseHandListenersBound || role !== "teacher" || !raiseHandList || !window.activeClassroomSocket) return;
    raiseHandListenersBound = true;

    const renderRaiseHands = (list) => {
      raiseHandList.innerHTML = "";
      (list || []).forEach((entry) => {
        const userId = typeof entry === "string" ? entry : entry.userId;
        const displayName = (entry && entry.displayName) ? entry.displayName : userId;
        const isMuted = Boolean(entry && entry.muted);
        const li = document.createElement("li");
        li.className = "dc-raise-hand-item";
        li.dataset.userId = userId;
        li.dataset.muted = isMuted ? "true" : "false";

        const user = document.createElement("span");
        user.className = "dc-raise-hand-user";
        user.textContent = displayName;

        const actions = document.createElement("div");
        actions.className = "dc-raise-hand-actions";

        const micBtn = document.createElement("button");
        micBtn.type = "button";
        micBtn.className = "dc-btn dc-btn-small dc-mic-toggle-btn";
        micBtn.dataset.userId = userId;
        micBtn.innerHTML = isMuted
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path></svg><span>Unmute</span>'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path></svg><span>Mute</span>';
        micBtn.addEventListener("click", () => {
          const nextMuted = !(raiseHandState.get(userId)?.muted ?? isMuted);
          raiseHandState.set(userId, { muted: nextMuted });
          window.activeClassroomSocket.emit("teacher-set-audio-state", { target: userId, muted: nextMuted });
        });

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "dc-btn dc-btn-ghost dc-clear-btn";
        clearBtn.textContent = "Clear";
        clearBtn.addEventListener("click", () => {
          window.activeClassroomSocket.emit("clear-raise-hand", { userId });
        });

        actions.appendChild(micBtn);
        actions.appendChild(clearBtn);
        li.appendChild(user);
        li.appendChild(actions);
        raiseHandList.appendChild(li);
      });
    };

    window.activeClassroomSocket.on("raise-hand-list", renderRaiseHands);
    window.activeClassroomSocket.on("audio-state-change", ({ userId, muted }) => {
      const item = raiseHandList.querySelector(`[data-user-id="${userId}"]`);
      if (!item) return;
      const micBtn = item.querySelector(".dc-mic-toggle-btn");
      if (!micBtn) return;
      const isMuted = Boolean(muted);
      item.dataset.muted = isMuted ? "true" : "false";
      raiseHandState.set(userId, { muted: isMuted });
      micBtn.innerHTML = isMuted
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path></svg><span>Unmute</span>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path></svg><span>Mute</span>';
    });
    window.activeClassroomSocket.on("unmute-request", ({ userId, displayName }) => {
      const current = Array.from(raiseHandList.querySelectorAll("li")).map((li) => ({
        userId: li.dataset.userId,
        displayName: li.querySelector(".dc-raise-hand-user")?.textContent || li.dataset.userId,
        muted: li.dataset.muted === "true",
      }));
      if (!current.some((entry) => entry.userId === userId)) {
        renderRaiseHands([...current, { userId, displayName }]);
      }
    });

    window.activeClassroomSocket.emit("request-raise-hand-list");
  };

  // Start checking for socket connection
  checkAndInitializeVoice();
  // Modal functionality
  const exitBtn = wrap.querySelector("#dc-room-exit");
  const modalBackdrop = wrap.querySelector("#exit-modal-backdrop");
  const modalActions = wrap.querySelector("#exit-modal-actions");



  const showModal = () => {
    modalBackdrop.style.display = "flex";
    document.body.style.overflow = "hidden";
  };



  const hideModal = () => {

    modalBackdrop.style.display = "none";

    document.body.style.overflow = "";

  };



  // Exit button click

  console.log("Setting up exit button listener", exitBtn);

  exitBtn.addEventListener("click", showModal);



  // Modal backdrop click to close

  modalBackdrop.addEventListener("click", (e) => {

    if (e.target === modalBackdrop) {

      hideModal();

    }

  });



  if (role === "teacher") {

    // Teacher-specific actions

    const takeBreakBtn = wrap.querySelector("#take-break-btn");

    const endCallBtn = wrap.querySelector("#end-call-btn");



    takeBreakBtn.addEventListener("click", () => {

      hideModal();

      onExit?.({ action: "take_break" });

    });



    endCallBtn.addEventListener("click", () => {

      hideModal();

      onExit?.({ action: "end_call" });

    });

  } else {

    // Student-specific actions

    const cancelBtn = wrap.querySelector("#cancel-exit-btn");

    const confirmBtn = wrap.querySelector("#confirm-exit-btn");



    cancelBtn.addEventListener("click", hideModal);



    confirmBtn.addEventListener("click", () => {

      hideModal();

      onExit?.({ action: "exit" });

    });

  }

  // Cleanup function for VoiceSystem
  const cleanupVoiceSystem = () => {
    if (voiceSystem) {
      try {
        voiceSystem.destroy();
        voiceSystem = null;
        window.activeVoiceSystem = null;
        console.log("Voice System cleaned up");
      } catch (error) {
        console.error("Error cleaning up Voice System:", error);
      }
    }
  };

  // Expose cleanup function for external use
  return {
    cleanupVoiceSystem,
    muteButton,
    raiseHandButton,
    raiseHandPanel,
    raiseHandList,
  };
}

