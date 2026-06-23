import { showApproveDenyDialog } from "../../utils/dialogs.js";

export function mountRoomPage(root, { roomCode, role, api, onExit }) {

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
          ` : ``}
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

        ${role === "teacher" ? `
          <details class="dc-room-participants dc-room-participants--topbar" id="participants-panel" open>
            <summary class="dc-room-participants-summary">Participants (<span id="participants-count">0</span>)</summary>
            <ul class="dc-room-participants-list" id="participants-list"></ul>
          </details>
          <section class="dc-pending-requests-panel" id="pending-requests-panel">
            <h3 class="dc-pending-requests-title">
              Pending Join Requests
              <span id="pending-request-count" class="dc-pending-request-count" style="margin-left: 0.75rem; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; display: none; align-items: center;">
                0
              </span>
            </h3>
            <div id="pending-requests-empty" class="dc-muted dc-small">No pending join requests</div>
            <ul class="dc-pending-requests-list" id="pending-requests-list"></ul>
          </section>
        ` : ""}

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

    <div class="dc-classroom-tools">
      <button id="discussion-button" type="button" class="dc-classroom-tool-btn" title="Open chat">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    </div>

    <div id="exit-modal-backdrop" class="dc-modal-backdrop dc-room-exit-backdrop" style="display: none;">
      <div class="dc-modal dc-exit-modal dc-room-exit-modal">
        <h3 class="dc-room-exit-title">Exit Confirmation</h3>
        <p class="dc-room-exit-copy">Are you sure you want to exit?</p>
        <div class="dc-modal-actions dc-room-exit-actions">
          ${role === "teacher" ? `
            <button id="take-break-btn" class="dc-btn dc-btn-secondary">Take a Break</button>
            <button id="end-call-btn" class="dc-btn dc-btn-primary">End Class</button>
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
  // collapsed left-side tab shown when no raised hands
  let raiseHandTab = null;
  const participantsCount = wrap.querySelector("#participants-count");
  const participantsList = wrap.querySelector("#participants-list");
  const pendingRequestsPanel = wrap.querySelector("#pending-requests-panel");
  const pendingRequestsList = wrap.querySelector("#pending-requests-list");
  const pendingRequestsEmpty = wrap.querySelector("#pending-requests-empty");
  const pendingRequestCount = wrap.querySelector("#pending-request-count");
  const discussionButton = wrap.querySelector("#discussion-button");
  const handUpIcon = `
    <span class="dc-raise-hand-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
        <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
        <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
      </svg>
    </span>
  `;
  const handDownIcon = `
    <span class="dc-raise-hand-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
        <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
        <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
        <path d="M20 4v6"></path>
        <path d="M17 7l3 3 3-3"></path>
      </svg>
    </span>
  `;
  const noticeBanner = document.createElement("div");
  noticeBanner.className = "dc-room-notice";
  noticeBanner.hidden = true;
  wrap.appendChild(noticeBanner);
  let boundRaiseHandSocket = null;
  const raiseHandState = new Map();

  const loadPendingRequests = async () => {
    if (!pendingRequestsList || !pendingRequestsPanel || !roomCode || role !== "teacher") {
      return;
    }

    try {
      const response = await api(`/classrooms/${encodeURIComponent(roomCode)}/pending-requests`);
      const pendingRequests = Array.isArray(response?.pendingRequests) ? response.pendingRequests : [];
      pendingRequestsList.innerHTML = pendingRequests.length
        ? pendingRequests.map((entry) => `
            <li class="dc-pending-request-item" data-user-id="${String(entry.userId || "").trim()}">
              <span class="dc-pending-request-user">${String(entry.displayName || entry.userId || "Unknown").trim()}</span>
              <div class="dc-pending-request-actions">
                <button type="button" class="dc-btn dc-btn-primary dc-pending-approve-btn">Allow</button>
                <button type="button" class="dc-btn dc-btn-ghost dc-pending-deny-btn">Deny</button>
              </div>
            </li>`)
          .join("")
        : "";
      pendingRequestsEmpty.style.display = pendingRequests.length ? "none" : "block";
      pendingRequestsPanel.style.display = pendingRequests.length ? "grid" : "none";
      if (pendingRequestCount) {
        pendingRequestCount.textContent = String(pendingRequests.length);
        pendingRequestCount.style.display = pendingRequests.length ? "inline-flex" : "none";
      }

      if (pendingRequests.length) {
        showNotice(`New join request${pendingRequests.length > 1 ? "s" : ""}.`);
      }
    } catch (error) {
      console.error("Failed to load pending requests:", error);
    }
  };

  const handlePendingRequestAction = async (event) => {
    const target = event.target;
    if (!target) return;
    const listItem = target.closest(".dc-pending-request-item");
    if (!listItem || !roomCode) return;
    const studentId = String(listItem.dataset.userId || "").trim();
    if (!studentId) return;

    const isApprove = target.classList.contains("dc-pending-approve-btn");
    const isDeny = target.classList.contains("dc-pending-deny-btn");
    if (!isApprove && !isDeny) return;

    try {
      if (isApprove) {
        await api(`/classrooms/${encodeURIComponent(roomCode)}/pending-requests/${encodeURIComponent(studentId)}/approve`, {
          method: "POST",
        });
        // Notify the student that they were approved
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit("student-join-approved", { studentId });
        }
        showNotice("Student approved.");
      } else {
        await api(`/classrooms/${encodeURIComponent(roomCode)}/pending-requests/${encodeURIComponent(studentId)}`, {
          method: "DELETE",
        });
        // Notify the student that they were denied
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit("student-join-denied", { studentId });
        }
        showNotice("Student denied.");
      }
      await loadPendingRequests();
    } catch (error) {
      console.error("Failed to process pending request:", error);
      showNotice("Unable to complete request.");
    }
  };

  const setMuteButtonState = (isMuted) => {
    if (!muteButton) return;
    muteButton.innerHTML = isMuted
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
    muteButton.setAttribute("data-tooltip", isMuted ? "Unmute Mic" : "Mute Mic");
    muteButton.style.color = isMuted ? "#dc2626" : "#16a34a";
  };

  const showNotice = (message) => {
    if (!noticeBanner) return;
    noticeBanner.textContent = message;
    noticeBanner.hidden = !message;
    if (!message) return;
    window.clearTimeout(showNotice._timer);
    showNotice._timer = window.setTimeout(() => {
      if (noticeBanner.isConnected) noticeBanner.hidden = true;
    }, 3500);
  };

  const renderParticipants = (participants = [], count) => {
    const list = Array.isArray(participants) ? participants : [];
    const displayCount = Number.isInteger(count) ? count : list.length;
    const html = list.length
      ? list.map((participant) => `<li>${escapeHtml(String(participant.displayName || participant.userId || "Unknown"))}</li>`).join("")
      : "<li>No participants yet</li>";

    if (participantsCount) participantsCount.textContent = String(displayCount);
    if (participantsList) participantsList.innerHTML = html;
  };

  const escapeHtml = (str) => {
    return String(str).replace(/[&<>\"'`]/g, (s) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '`': '&#96;'
    }[s]));
  };

  const showPendingRequestModal = (roomCode, request) => {
    if (!roomCode || !request) return;
    if (document.querySelector('.dc-pending-approval-backdrop')) return;

    const displayName = String(request.displayName || request.userId || request.user || request.studentId || 'Student');
    const backdrop = document.createElement('div');
    backdrop.className = 'dc-modal-backdrop dc-pending-approval-backdrop';
    backdrop.style.display = 'flex';
    backdrop.style.zIndex = 10001;
    backdrop.innerHTML = `
      <div class="dc-modal">
        <h3>Join Request</h3>
        <p style="margin: 1rem 0; color: var(--text-secondary);">${escapeHtml(displayName)} requested access to <strong>${escapeHtml(roomCode)}</strong>.</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-primary" id="dc-approve-request">Allow</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-deny-request">Deny</button>
          <button type="button" class="dc-btn" id="dc-close-request">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();

    backdrop.querySelector('#dc-close-request')?.addEventListener('click', close);
    backdrop.querySelector('#dc-approve-request')?.addEventListener('click', async () => {
      try {
        const studentId = String(request.userId || request.user || request.studentId || '').trim();
        if (!studentId) throw new Error('Missing student id');
        await api(`/classrooms/${encodeURIComponent(roomCode)}/pending-requests/${encodeURIComponent(studentId)}/approve`, { method: 'POST' });
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit('student-join-approved', { studentId });
        }
        showNotice('Student approved.');
      } catch (err) {
        console.error('Failed to approve pending request', err);
        showNotice('Failed to approve request.');
      } finally {
        close();
        await loadPendingRequests();
      }
    });
    backdrop.querySelector('#dc-deny-request')?.addEventListener('click', async () => {
      try {
        const studentId = String(request.userId || request.user || request.studentId || '').trim();
        if (!studentId) throw new Error('Missing student id');
        await api(`/classrooms/${encodeURIComponent(roomCode)}/pending-requests/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit('student-join-denied', { studentId });
        }
        showNotice('Student denied.');
      } catch (err) {
        console.error('Failed to deny pending request', err);
        showNotice('Failed to deny request.');
      } finally {
        close();
        await loadPendingRequests();
      }
    });
  };

  // Initialize Voice System when socket becomes available
  const initializeVoiceSystem = async () => {
    const socket = window.activeClassroomSocket;
    if (!socket) return;

    if (voiceSystem && voiceSystem.socket !== socket) {
      try {
        voiceSystem.destroy();
      } catch (err) {
        console.warn("Failed to destroy stale voice system:", err);
      }
      voiceSystem = null;
      window.activeVoiceSystem = null;
    }

    if (!voiceSystem) {
      try {
        const { VoiceSystem } = await import("../../../classroom/VoiceSystem.js");
        voiceSystem = new VoiceSystem(socket, socket.id, role);
        window.activeVoiceSystem = voiceSystem;

        const micAvailable = await voiceSystem.initLocalStream();
        if (!micAvailable) {
          console.log("Microphone not available");
        }

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
      raiseHandButton.innerHTML = handUpIcon;
      raiseHandButton.addEventListener("click", () => {
        if (window.activeClassroomSocket) {
          if (!isHandRaised) {
            const displayName = localStorage.getItem("delta-user-display") || "";
            window.activeClassroomSocket.emit("raise-hand", { displayName });
            window.activeClassroomSocket.emit("request-unmute", { displayName });
            isHandRaised = true;
            raiseHandButton.innerHTML = handDownIcon;
            raiseHandButton.setAttribute("aria-pressed", "true");
            raiseHandButton.setAttribute("data-tooltip", "Lower Hand");
            raiseHandButton.style.color = "#7c3aed";
            raiseHandButton.classList.add("dc-raise-hand-button--active");
            return;
          }

          window.activeClassroomSocket.emit("clear-raise-hand", { userId: window.activeClassroomSocket.id });
          isHandRaised = false;
          raiseHandButton.innerHTML = handUpIcon;
          raiseHandButton.setAttribute("aria-pressed", "false");
          raiseHandButton.setAttribute("data-tooltip", "Raise Hand");
          raiseHandButton.style.color = "";
          raiseHandButton.classList.remove("dc-raise-hand-button--active");
          raiseHandButton.classList.add("dc-raise-hand-button--transitioning");
          // show a brief notice so user knows hand was lowered
          showNotice("Hand lowered");
          window.setTimeout(() => {
            raiseHandButton.classList.remove("dc-raise-hand-button--transitioning");
          }, 1000);
        }
      });

      // Listen for teacher clearing the student's raised hand
      window.activeClassroomSocket?.on("raise-hand-cleared", ({ userId }) => {
        if (userId !== window.activeClassroomSocket.id) return;
        isHandRaised = false;
        if (raiseHandButton) {
          raiseHandButton.innerHTML = handUpIcon;
          raiseHandButton.setAttribute("aria-pressed", "false");
          raiseHandButton.setAttribute("data-tooltip", "Raise Hand");
          raiseHandButton.style.color = "";
          raiseHandButton.classList.remove("dc-raise-hand-button--active");
          raiseHandButton.classList.add("dc-raise-hand-button--transitioning");
          showNotice("Your hand was lowered by teacher.");
          window.setTimeout(() => {
            if (raiseHandButton) {
              raiseHandButton.classList.remove("dc-raise-hand-button--transitioning");
            }
          }, 1000);
        }
      });
    }

    // Mute/Unmute button is now initialized early above
    // No need to reinitialize here - the listener is already set

  };

  // Initialize mute button independently (works for both teacher and student)
  const initializeMuteButton = () => {
    if (muteButton && !muteButton._muted_initialized) {
      muteButton._muted_initialized = true;
      setMuteButtonState(false);
      muteButton.addEventListener("click", async () => {
        if (window.activeVoiceSystem) {
          const isMuted = window.activeVoiceSystem.toggleMute();
          setMuteButtonState(isMuted);
          showNotice(isMuted ? "Microphone muted." : "Microphone unmuted.");
        } else {
          showNotice("Voice system initializing...");
          // Keep trying to toggle mute if voice system isn't ready yet
          setTimeout(() => {
            if (window.activeVoiceSystem) {
              const isMuted = window.activeVoiceSystem.toggleMute();
              setMuteButtonState(isMuted);
              showNotice(isMuted ? "Microphone muted." : "Microphone unmuted.");
            }
          }, 500);
        }
      });

      // Listen for audio state changes from teacher
      window.activeClassroomSocket?.on("audio-state-change", ({ userId, muted, by }) => {
        if (userId !== window.activeClassroomSocket.id) return;
        const isMuted = Boolean(muted);
        setMuteButtonState(isMuted);
        if (by) {
          showNotice(isMuted ? "Teacher muted your microphone." : "Teacher unmuted your microphone.");
        }
      });
    }
  };

  // Initialize mute button immediately
  initializeMuteButton();

  const setupRaiseHandListeners = () => {
    const socket = window.activeClassroomSocket;
    if (role !== "teacher" || !raiseHandList || !socket || boundRaiseHandSocket === socket) return;
    boundRaiseHandSocket = socket;

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
          if (!nextMuted) {
            window.activeClassroomSocket.emit("clear-raise-hand", { userId });
          }
          try {
            if (window.activeVoiceSystem && typeof window.activeVoiceSystem.enableRemoteAudioWithGesture === 'function') {
              window.activeVoiceSystem.enableRemoteAudioWithGesture();
            }
          } catch (e) {
            // ignore
          }
        });

        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "dc-btn dc-btn-ghost dc-clear-btn";
        clearBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19c3.31 0 6-2.69 6-6V8"></path>
            <path d="M6 12v5c0 3.31 2.69 6 6 6"></path>
            <path d="M12 19v4"></path>
            <path d="M8 23h8"></path>
            <path d="M18.5 2a3 3 0 0 0-3 3v4"></path>
            <path d="M7.5 2a3 3 0 0 1 3 3v4"></path>
          </svg>
        `;
        clearBtn.addEventListener("click", () => {
          window.activeClassroomSocket.emit("clear-raise-hand", { userId });
        });

        actions.appendChild(micBtn);
        actions.appendChild(clearBtn);
        li.appendChild(user);
        li.appendChild(actions);
        raiseHandList.appendChild(li);
      });

      const hasHands = Array.isArray(list) && list.length > 0;
      try {
        if (raiseHandPanel) {
          raiseHandPanel.hidden = false;
          raiseHandPanel.setAttribute("data-visible", hasHands ? "true" : "false");
        }
      } catch (e) {
        // ignore
      }

      try {
        if (raiseHandTab) {
          raiseHandTab.hidden = !hasHands;
          raiseHandTab.classList.toggle("dc-raise-hand-tab--active", hasHands);
        }
      } catch (e) {
        // ignore
      }
    };

    socket.on("raise-hand-list", renderRaiseHands);
    socket.on("audio-state-change", ({ userId, muted }) => {
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
    socket.on("unmute-request", ({ userId, displayName }) => {
      const current = Array.from(raiseHandList.querySelectorAll("li")).map((li) => ({
        userId: li.dataset.userId,
        displayName: li.querySelector(".dc-raise-hand-user")?.textContent || li.dataset.userId,
        muted: li.dataset.muted === "true",
      }));
      if (!current.some((entry) => entry.userId === userId)) {
        renderRaiseHands([...current, { userId, displayName, muted: true }]);
      }
      showNotice(`${displayName || "Student"} requested microphone access.`);
    });

    socket.on("participants-state", ({ participants = [], count } = {}) => {
      renderParticipants(Array.isArray(participants) ? participants : [], count);
    });

    if (role === "teacher") {
      socket.on("pending-requests-updated", (data) => {
        loadPendingRequests();
        if (data?.request) {
          showPendingRequestModal(roomCode, data.request);
        }
      });
      loadPendingRequests();
    }

    socket.emit("request-raise-hand-list");
    socket.emit("request-discussion-state");
  };

  const ensureClassroomSocketBindings = () => {
    setupRaiseHandListeners();
  };

  // Check for socket availability and initialize voice system
  const checkAndInitializeVoice = () => {
    ensureClassroomSocketBindings();
    if (window.activeClassroomSocket) {
      initializeVoiceSystem();
    } else {
      setTimeout(checkAndInitializeVoice, 500);
    }
  };

  checkAndInitializeVoice();
  window.addEventListener("delta-classroom-socket-ready", () => {
    ensureClassroomSocketBindings();
    initializeVoiceSystem();
  });

  if (role === "teacher" && pendingRequestsList) {
    pendingRequestsList.addEventListener("click", handlePendingRequestAction);
  }

  if (discussionButton) {
    discussionButton.addEventListener("click", () => {
      const chatChannel = document.querySelector("#chat-window") || document.querySelector("#discussion-panel");
      if (chatChannel) {
        chatChannel.classList.toggle("dc-chat-open", true);
        chatChannel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  // create right-side collapsed tab to show raised hands on hover
  if (role === "teacher") {
    raiseHandTab = document.createElement("button");
    raiseHandTab.className = "dc-raise-hand-tab dc-btn dc-btn-ghost";
    raiseHandTab.type = "button";
    raiseHandTab.title = "Raised Hands";
    raiseHandTab.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
        <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
        <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
        <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
      </svg>
    `;
    raiseHandTab.style.position = "fixed";
    raiseHandTab.style.right = "6px";
    raiseHandTab.style.top = "50%";
    raiseHandTab.style.transform = "translateY(-50%)";
    raiseHandTab.style.zIndex = "9998";
    raiseHandTab.style.padding = "8px 12px";
    
    // Hover to expand/collapse
    raiseHandTab.addEventListener("mouseenter", () => {
      if (raiseHandPanel) {
        raiseHandPanel.hidden = false;
        raiseHandPanel.style.transition = "all 0.3s ease";
      }
    });
    raiseHandTab.addEventListener("mouseleave", () => {
      if (raiseHandPanel && !raiseHandPanel.querySelector(":hover")) {
        raiseHandPanel.hidden = true;
      }
    });
    
    document.body.appendChild(raiseHandTab);
    if (raiseHandPanel) {
      raiseHandPanel.hidden = true;
      // Keep panel visible on hover
      raiseHandPanel.addEventListener("mouseenter", () => {
        raiseHandPanel.hidden = false;
      });
      raiseHandPanel.addEventListener("mouseleave", () => {
        raiseHandPanel.hidden = true;
      });
    }
  }
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
    // remove left-side tab if present
    try {
      if (raiseHandTab && raiseHandTab.parentElement) raiseHandTab.parentElement.removeChild(raiseHandTab);
    } catch (e) {
      // ignore
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

