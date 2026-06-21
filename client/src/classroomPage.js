import { showApproveDenyDialog } from "./utils/dialogs.js";

export function renderClassroomPage(appRoot, { role = "student", onExit, api } = {}) {
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
                <button id="raise-hand-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Raise Hand" aria-label="Raise your hand">
                  <span class="dc-raise-hand-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
                      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
                      <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
                      <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
                      <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
                    </svg>
                  </span>
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
          ${role === "teacher" ? `
            <button id="raise-hand-toggle-button" type="button" class="dc-btn dc-btn-ghost dc-icon-btn dc-room-icon-btn" data-tooltip="Show raised hands">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2C8 5 6 7 6 11v5a5 5 0 0 0 10 0v-5c0-4-2-6-4-9z"></path>
                <path d="M8 10h8"></path>
              </svg>
            </button>
          ` : ``}
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
      <aside id="raise-hand-panel" class="dc-raise-hand-panel" aria-live="polite" style="display: none;">
        <h3 class="dc-raise-hand-title">Raised Hands</h3>
        <p class="dc-muted dc-small">Students who raised hands will appear here.</p>
        <details id="participants-panel" class="dc-room-participants" open>
          <summary class="dc-room-participants-summary">Participants (<span id="participants-count">0</span>)</summary>
          <ul id="participants-list" class="dc-room-participants-list"></ul>
        </details>
        <section id="pending-requests-panel" class="dc-pending-requests-panel">
          <h3 class="dc-pending-requests-title">
            Pending Join Requests
            <span id="pending-request-count" class="dc-pending-request-count" style="margin-left: 0.75rem; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; display: none; align-items: center;">
              0
            </span>
          </h3>
          <div id="pending-requests-empty" class="dc-muted dc-small">No pending join requests</div>
          <ul id="pending-requests-list" class="dc-pending-requests-list"></ul>
        </section>
        <ul id="raise-hand-list" class="dc-raise-hand-list"></ul>
      </aside>
      ` : ``}

      <div class="dc-classroom-tools">
        <button id="discussion-button" type="button" class="dc-classroom-tool-btn" title="Open chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
      </div>
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
  const raiseHandToggleButton = document.getElementById("raise-hand-toggle-button");
  const modalBackdrop = document.getElementById("exit-modal-backdrop");
  const cancelExitBtn = document.getElementById("cancel-exit-btn");
  const reloadModalBackdrop = document.getElementById("reload-modal-backdrop");
  const confirmReloadBtn = document.getElementById("confirm-reload-btn");
  const cancelReloadBtn = document.getElementById("cancel-reload-btn");
  const discussionButton = document.getElementById("discussion-button");

  if (!connectionStatus || !connectionBadge || !bandwidthPanel || !loadButton || !exitButton) {
    throw new Error("Missing classroom UI elements");
  }

  const raiseHandPanel = document.getElementById("raise-hand-panel");
  const raiseHandList = document.getElementById("raise-hand-list");
  const classroomQuery = new URLSearchParams((window.location.hash.split("?")[1] || ""));
  const classroomCode = classroomQuery.get("code") || classroomQuery.get("roomCode") || "";
  const raiseHandState = new Map();
  let boundRaiseHandSocket = null;
  let boundPendingSocket = null;

  if (discussionButton && classroomCode) {
    discussionButton.addEventListener("click", () => {
      window.location.hash = `/group-discussion?role=${role}&code=${encodeURIComponent(classroomCode)}`;
    });
  }

  const participantsCount = document.getElementById("participants-count");
  const participantsList = document.getElementById("participants-list");
  const pendingRequestsPanel = document.getElementById("pending-requests-panel");
  const pendingRequestsList = document.getElementById("pending-requests-list");
  const pendingRequestsEmpty = document.getElementById("pending-requests-empty");
  const pendingRequestCount = document.getElementById("pending-request-count");

  const renderParticipants = (participants = [], count) => {
    const list = Array.isArray(participants) ? participants : [];
    const displayCount = Number.isInteger(count) ? count : list.length;
    if (participantsCount) participantsCount.textContent = String(displayCount || 0);
    if (!participantsList) return;
    participantsList.innerHTML = list.length
      ? list.map((participant) => `<li>${String(participant.displayName || participant.userId || "Unknown")}</li>`).join("")
      : "<li>No participants yet</li>";
  };

  const updatePendingRequestsUI = (requests) => {
    const list = Array.isArray(requests) ? requests : [];
    if (!pendingRequestsPanel || !pendingRequestsList || !pendingRequestsEmpty || !pendingRequestCount) return;

    pendingRequestsList.innerHTML = list.length
      ? list.map((entry) => `
          <li class="dc-pending-request-item" data-user-id="${String(entry.userId || "").trim()}">
            <span class="dc-pending-request-user">${String(entry.displayName || entry.userId || "Unknown").trim()}</span>
            <div class="dc-pending-request-actions">
              <button type="button" class="dc-btn dc-btn-primary dc-pending-approve-btn">Allow</button>
              <button type="button" class="dc-btn dc-btn-ghost dc-pending-deny-btn">Deny</button>
            </div>
          </li>`)
        .join("")
      : "";

    pendingRequestsEmpty.style.display = list.length ? "none" : "block";
    pendingRequestsPanel.style.display = list.length ? "block" : "none";
    pendingRequestCount.textContent = String(list.length);
    pendingRequestCount.style.display = list.length ? "inline-flex" : "none";
  };

  const loadPendingRequests = async () => {
    if (role !== "teacher" || !api || !classroomCode) return;
    try {
      const response = await api(`/classrooms/${encodeURIComponent(classroomCode)}/pending-requests`);
      const pendingRequests = Array.isArray(response?.pendingRequests) ? response.pendingRequests : [];
      updatePendingRequestsUI(pendingRequests);
      return pendingRequests;
    } catch (error) {
      console.error("Failed to load pending requests:", error);
      return [];
    }
  };

  const processPendingDecision = async (studentId, approved) => {
    if (!classroomCode || !api || !studentId) return;
    try {
      if (approved) {
        await api(`/classrooms/${encodeURIComponent(classroomCode)}/pending-requests/${encodeURIComponent(studentId)}/approve`, {
          method: "POST",
        });
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit("student-join-approved", { studentId });
        }
      } else {
        await api(`/classrooms/${encodeURIComponent(classroomCode)}/pending-requests/${encodeURIComponent(studentId)}`, {
          method: "DELETE",
        });
        if (window.activeClassroomSocket) {
          window.activeClassroomSocket.emit("student-join-denied", { studentId });
        }
      }
      loadPendingRequests();
    } catch (error) {
      console.error("Failed to process pending request:", error);
    }
  };

  const handlePendingRequestAction = (event) => {
    const target = event.target;
    if (!target) return;
    const listItem = target.closest(".dc-pending-request-item");
    if (!listItem) return;
    const studentId = String(listItem.dataset.userId || "").trim();
    if (!studentId) return;

    if (target.classList.contains("dc-pending-approve-btn")) {
      processPendingDecision(studentId, true);
      return;
    }

    if (target.classList.contains("dc-pending-deny-btn")) {
      processPendingDecision(studentId, false);
      return;
    }
  };

  const showPendingRequestModal = async (request) => {
    if (!request || !classroomCode) return;
    const displayName = String(request.displayName || request.name || request.userId || request.studentId || "Student");
    const decision = await showApproveDenyDialog(
      "Pending Join Request",
      `${displayName} wants to join ${classroomCode}. Allow or deny this request?`
    );

    if (decision === "approve") {
      await processPendingDecision(String(request.userId || request.studentId || "").trim(), true);
    } else if (decision === "deny") {
      await processPendingDecision(String(request.userId || request.studentId || "").trim(), false);
    }
  };

  const setupPendingListeners = () => {
    const socket = window.activeClassroomSocket;
    if (!socket || role !== "teacher" || boundPendingSocket === socket) return;
    boundPendingSocket = socket;
    socket.on("pending-requests-updated", (data) => {
      loadPendingRequests();
      if (data?.request) {
        showPendingRequestModal(data.request);
      }
    });
    loadPendingRequests();
  };

  const attachPendingRequestHandlers = () => {
    if (pendingRequestsList) {
      pendingRequestsList.addEventListener("click", handlePendingRequestAction);
    }
  };

  attachPendingRequestHandlers();

  const setupRaiseHandListeners = () => {
    const socket = window.activeClassroomSocket;
    if (role !== "teacher" || !raiseHandList || !socket || boundRaiseHandSocket === socket) return;
    boundRaiseHandSocket = socket;

    const renderRaiseHands = (list) => {      raiseHandList.innerHTML = "";
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

    socket.on("raise-hand-list", renderRaiseHands);
    socket.on("participants-state", ({ participants = [], count } = {}) => {
      renderParticipants(Array.isArray(participants) ? participants : [], count);
    });
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
      connectionStatus.textContent = `${displayName || "Student"} requested microphone access.`;
      connectionBadge.textContent = "Mic request";
    });

    socket.emit("request-raise-hand-list");
    socket.emit("request-discussion-state");
  };

  const ensureClassroomSocketBindings = () => {
    if (role === "teacher") {
      setupRaiseHandListeners();
      setupPendingListeners();
    }
  };

  const waitForRaiseHandSocket = () => {
    ensureClassroomSocketBindings();
    setTimeout(waitForRaiseHandSocket, 250);
  };

  waitForRaiseHandSocket();
  window.addEventListener("delta-classroom-socket-ready", ensureClassroomSocketBindings);

  const updateRaiseHandToggleButton = (open) => {
    if (!raiseHandToggleButton) return;
    raiseHandToggleButton.setAttribute("data-tooltip", open ? "Hide raised hands" : "Show raised hands");
    raiseHandToggleButton.style.color = open ? "#2563eb" : "";
  };

  const toggleRaiseHandPanel = () => {
    if (!raiseHandPanel || !raiseHandToggleButton) return;
    const isHidden = raiseHandPanel.style.display === "none";
    raiseHandPanel.style.display = isHidden ? "block" : "none";
    updateRaiseHandToggleButton(isHidden);
  };

  if (raiseHandToggleButton) {
    raiseHandToggleButton.addEventListener("click", toggleRaiseHandPanel);
  }

  const showModal = () => {
    modalBackdrop.style.display = "flex";
  };

  let isHandRaised = false;

  const updateRaiseHandIcon = (raised) => {
    if (!raiseHandButton) return;

    const iconContent = raised
      ? `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
          <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
          <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
          <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
          <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
          <path d="M12 3v4"></path>
          <path d="M9 6l3 3 3-3"></path>
        </svg>
      `
      : `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"></path>
          <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11"></path>
          <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.31-2.69 6-6 6s-6-2.69-6-6v-2"></path>
          <path d="M6 12.5v-1a1.5 1.5 0 0 1 3 0V14"></path>
          <path d="M8 19c1.2 1.2 2.7 2 4 2s2.8-.8 4-2"></path>
          <path d="M12 21v-4"></path>
          <path d="M9 19l3 3 3-3"></path>
        </svg>
      `;

    raiseHandButton.innerHTML = `<span class="dc-raise-hand-icon">${iconContent}</span>`;
    raiseHandButton.setAttribute("aria-label", raised ? "Lower your hand" : "Raise your hand");
  };

  if (raiseHandButton) {
    updateRaiseHandIcon(false);
  }

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
        if (!isHandRaised) {
          const displayName = localStorage.getItem("delta-user-display") || "";
          window.activeClassroomSocket.emit("raise-hand", { displayName });
          window.activeClassroomSocket.emit("request-unmute", { displayName });
          isHandRaised = true;
          updateRaiseHandIcon(true);
          raiseHandButton.setAttribute("aria-pressed", "true");
          raiseHandButton.setAttribute("data-tooltip", "Lower Hand");
          raiseHandButton.style.color = "#7c3aed";
          raiseHandButton.classList.add("dc-raise-hand-button--active");
          return;
        }

        window.activeClassroomSocket.emit("clear-raise-hand", { userId: window.activeClassroomSocket.id });
        isHandRaised = false;
        updateRaiseHandIcon(false);
        raiseHandButton.setAttribute("aria-pressed", "false");
        raiseHandButton.setAttribute("data-tooltip", "Raise Hand");
        raiseHandButton.style.color = "";
        raiseHandButton.classList.remove("dc-raise-hand-button--active");
        raiseHandButton.classList.add("dc-raise-hand-button--transitioning");
        window.setTimeout(() => {
          raiseHandButton.classList.remove("dc-raise-hand-button--transitioning");
        }, 1000);
      }
    });

    const resetRaisedHandUI = () => {
      if (!isHandRaised) return;
      isHandRaised = false;
      updateRaiseHandIcon(false);
      raiseHandButton.setAttribute("aria-pressed", "false");
      raiseHandButton.setAttribute("data-tooltip", "Raise Hand");
      raiseHandButton.style.color = "";
      raiseHandButton.classList.remove("dc-raise-hand-button--active");
      raiseHandButton.classList.add("dc-raise-hand-button--transitioning");
      window.setTimeout(() => {
        raiseHandButton.classList.remove("dc-raise-hand-button--transitioning");
      }, 1000);
    };

    window.addEventListener("delta-student-lowered-hand", resetRaisedHandUI);

    const attachRaiseHandClearedListener = () => {
      if (!window.activeClassroomSocket) {
        window.setTimeout(attachRaiseHandClearedListener, 250);
        return;
      }
      window.activeClassroomSocket.on("raise-hand-cleared", ({ userId }) => {
        if (userId !== window.activeClassroomSocket.id) return;
        resetRaisedHandUI();
      });
    };

    attachRaiseHandClearedListener();
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

  if (window.activeClassroomSocket) {
    window.activeClassroomSocket.on("participants-state", ({ participants = [], count } = {}) => {
      renderParticipants(Array.isArray(participants) ? participants : [], count);
    });
    window.activeClassroomSocket.emit("request-discussion-state");
    if (role === "teacher") {
      setupPendingListeners();
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
    raiseHandPanel,
    raiseHandList,
    setStatus,
  };
}
