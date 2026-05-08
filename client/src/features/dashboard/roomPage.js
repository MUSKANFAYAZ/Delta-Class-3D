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
            <button id="deafen-button" type="button" class="dc-btn dc-btn-ghost dc-room-icon-btn" title="Mute Teacher">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
              </svg>
            </button>
          ` : ""}
          <button id="mute-button" type="button" class="dc-btn dc-btn-ghost dc-room-icon-btn" title="Unmute Mic">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
  const deafenButton = wrap.querySelector("#deafen-button");

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

    // Mute/Unmute button
    if (muteButton) {
      muteButton.addEventListener("click", () => {
        const isMuted = voiceSystem.toggleMute();
        muteButton.innerHTML = isMuted
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>' // mic-off
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'; // mic-on
        
        muteButton.title = isMuted ? "Unmute Mic" : "Mute Mic";
        muteButton.style.color = isMuted ? "#dc2626" : "#16a34a";
      });
    }

    // Deafen/Undeafen button (students only)
    if (deafenButton && role === "student") {
      deafenButton.addEventListener("click", () => {
        const isDeafened = voiceSystem.toggleDeafen();
        deafenButton.innerHTML = isDeafened
          ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>' // disabled headphone
          : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>'; // regular headphone
        
        deafenButton.title = isDeafened ? "Unmute Teacher" : "Mute Teacher";
        deafenButton.style.color = isDeafened ? "#dc2626" : "#64748b";
      });
    }
  };

  // Check for socket availability and initialize voice system
  const checkAndInitializeVoice = () => {
    if (window.activeClassroomSocket) {
      initializeVoiceSystem();
    } else {
      // Retry after a short delay
      setTimeout(checkAndInitializeVoice, 500);
    }
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
    deafenButton
  };
}

