import "./styles.css";
import { registerServiceWorker } from "./startup/registerServiceWorker.js";
import { showConfirmDialog, showAlertDialog } from "./utils/dialogs.js";

registerServiceWorker();

const appRoot = document.getElementById("app");
if (!appRoot) throw new Error("Missing app root element");

const AUTH = {
  baseUrl: import.meta.env.VITE_AUTH_API_URL || "/auth",
  tokenKey: "delta-access-token",
};
const STORAGE = {
  network: "delta-network-profile",
};
const CLASS_ENDED_NOTICE = "Class ended by teacher.";
let activeClassroomSocket = null;
let activeClassroomLoader = null;
let activeVoiceSystem = null;

const CLASSROOM_REFRESH_WARNING = "You may have to reload the classroom.";
let classroomRefreshGuardEnabled = false;

function handleClassroomBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = CLASSROOM_REFRESH_WARNING;
  return CLASSROOM_REFRESH_WARNING;
}

function enableClassroomRefreshGuard() {
  if (classroomRefreshGuardEnabled) return;
  window.addEventListener("beforeunload", handleClassroomBeforeUnload);
  classroomRefreshGuardEnabled = true;
}

function disableClassroomRefreshGuard() {
  if (!classroomRefreshGuardEnabled) return;
  window.removeEventListener("beforeunload", handleClassroomBeforeUnload);
  classroomRefreshGuardEnabled = false;
}

function getToken() {
  return localStorage.getItem(AUTH.tokenKey) || "";
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  const currentToken = token ?? getToken();
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  const url = `${AUTH.baseUrl}${path}`;
  try {
    console.debug("[api] request", { method, url, tokenPresent: Boolean(currentToken) });
  } catch {}

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  try {
    console.debug("[api] response", { method, url, status: res.status });
  } catch {}

  let data = null;
  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    throw new Error(data?.message || `Request failed (${res.status})`);
  }

  return data;
}

async function loadSocketClientModule() {
  try {
    return await import("https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/dist/socket.io.esm.min.js");
  } catch {
    return import("socket.io-client");
  }
}

function runWhenIdle(task) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(task, { timeout: 1200 });
  } else {
    window.setTimeout(task, 250);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"'`]/g, (s) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  }[s]));
}

async function showStudentPendingModal(message) {
  try {
    await showAlertDialog('Join Request Pending', String(message || 'Your request is pending teacher approval.'));
  } catch (e) {
    console.warn('showStudentPendingModal error', e);
  }
}

async function showStudentDecisionModal(message, onClose) {
  try {
    await showAlertDialog('Classroom Update', String(message || 'Update'));
  } catch (e) {
    console.warn('showStudentDecisionModal error', e);
  }
  if (typeof onClose === 'function') onClose();
}

let dashboardChunkPrefetched = false;
function prefetchDashboardRouteChunks() {
  if (dashboardChunkPrefetched) return;
  dashboardChunkPrefetched = true;
  if (isLowBandwidthConnection()) return;

  runWhenIdle(() => {
    import("./features/dashboard/createClassroomPage.js").catch(() => {});
    import("./features/dashboard/joinClassroomPage.js").catch(() => {});
    import("./features/dashboard/roomPage.js").catch(() => {});
    import("./features/dashboard/groupDiscussionPage.js").catch(() => {});
    import("./features/dashboard/notesPage.js").catch(() => {});
    import("./features/profile/profilePage.js").catch(() => {});
    import("./classroomPage.js").catch(() => {});
    import("./startup/classroomLoader.js").catch(() => {});
    import("./config/runtimeSession.js").catch(() => {});
  });
}

function isLowBandwidthConnection() {
  const forcedProfile = localStorage.getItem(STORAGE.network);
  if (forcedProfile === "2g") return true;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = String(connection?.effectiveType || "").toLowerCase();
  return Boolean(connection?.saveData) || effectiveType === "slow-2g" || effectiveType === "2g";
}

async function ensureStudentCanEnterClassroom(roomCode) {
  const joinResult = await api(`/classrooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
  });

  // Keep tracking if the student is pending, but let them go to the page layout structure natively
  if (joinResult?.pending) {
    return { ok: true, pending: true, message: joinResult.message };
  }

  return {
    ok: true,
    pending: false,
    teacherPresent: joinResult?.teacherPresent !== false,
    message: joinResult?.teacherPresent === false
      ? "You are approved. Please wait for the teacher to enter the classroom."
      : undefined,
  };
}

function sendStudentBackToDashboard(role, message = CLASS_ENDED_NOTICE, showModal = false) {
  cleanupActiveClassroomConnection();
  localStorage.removeItem("delta-active-room");
  localStorage.setItem("delta-dashboard-notice", message);
  if (showModal && role === "student") {
    localStorage.setItem("delta-dashboard-modal", message);
  }
  navigate(`/dashboard?role=${role}`);
}

async function startSocketClassroom({ role, roomCode }) {
  const [{ io }, { startClassroom }] = await Promise.all([
    loadSocketClientModule(),
    import("./classroom.js"),
  ]);

  const socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: { role, roomCode, token: getToken(), displayName: localStorage.getItem("delta-user-display") || "" },
    query: { role, roomCode, token: getToken() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 20000,
  });

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    const handleRoomDeleted = (message) => {
      try {
        socket.disconnect();
      } catch {}
      cleanupActiveClassroomConnection();
      localStorage.removeItem("delta-active-room");
      sendStudentBackToDashboard(
        role,
        typeof message === "string" && /deleted|ended/i.test(message) ? CLASS_ENDED_NOTICE : "This classroom has been deleted.",
        true,
      );
    };

    const onConnect = () => {
      cleanup();
      startClassroom(socket, role, {
        canWriteBlackboard: role === "teacher",
        lowBandwidth: isLowBandwidthConnection(),
        strictLowBandwidth: isLowBandwidthConnection(),
      });
      resolve({ socket });
    };

    const onRoomError = (payload = {}) => {
      const message = String(payload?.message || "");
      if (/deleted|has been deleted|room does not exist/i.test(message)) {
        handleRoomDeleted(message);
        return;
      }

      if (/session is not started|wait for the teacher|teacher has not joined/i.test(message)) {
        try {
          socket.disconnect();
        } catch {}
        sendStudentBackToDashboard(
          role,
          message || "Class session is not started yet. Please wait for the teacher to enter the classroom.",
          false,
        );
      }
    };

    const onError = (error) => {
      cleanup();
      try { socket.disconnect(); } catch {}
      reject(error || new Error("Socket connection failed"));
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
    socket.on("room-error", onRoomError);
  });
}

async function startRoomSocketOnly({ role, roomCode }) {
  const { io } = await loadSocketClientModule();
  const socket = io({
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: {
      role,
      roomCode,
      token: getToken(),
      displayName: localStorage.getItem("delta-user-display") || "",
    },
    query: { role, roomCode, token: getToken() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 20000,
  });

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    const onConnect = () => {
      cleanup();
      resolve({ socket });
    };

    const onError = (error) => {
      cleanup();
      try { socket.disconnect(); } catch {}
      reject(error || new Error("Socket connection failed"));
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

function cleanupActiveClassroomConnection() {
  if (activeVoiceSystem) {
    try { activeVoiceSystem.destroy(); } catch(e) { console.error(e); }
    activeVoiceSystem = null;
    window.activeVoiceSystem = null;
  }

  if (activeClassroomLoader) {
    activeClassroomLoader.disconnect();
    activeClassroomLoader = null;
  }

  if (activeClassroomSocket) {
    try { activeClassroomSocket.disconnect(); } catch {}
    activeClassroomSocket = null;
    window.activeClassroomSocket = null;
  }
}

async function handleExitFromClassroom({ role, roomCode, isTeacher }, exitAction) {
  if (!isTeacher) {
    if (exitAction?.action !== "exit") return false;
    cleanupActiveClassroomConnection();
    navigate(`/dashboard?role=${role}`);
    return true;
  }

  if (exitAction?.action === "end_call") {
    const confirmEnd = await showConfirmDialog(
      "End Class",
      "End class now? This will delete the room and all students will be disconnected."
    );
    if (!confirmEnd) return false;

    try {
      await api(`/classrooms/${encodeURIComponent(roomCode)}`, { method: "DELETE" });
    } catch (error) {
      window.alert(error?.message || "Failed to end class.");
      return false;
    }
    cleanupActiveClassroomConnection();
    localStorage.removeItem("delta-active-room");
    navigate("/dashboard?role=teacher");
    return true;
  } else if (exitAction?.action === "take_break") {
    cleanupActiveClassroomConnection();
    localStorage.setItem("delta-active-room", roomCode);
    navigate("/dashboard?role=teacher");
    return true;
  }

  return false;
}

function navigate(path) {
  if (window.location.hash === `#${path}`) {
    renderRoute();
    return;
  }
  window.location.hash = path;
}

async function fetchSharedClassrooms() {
  try {
    const data = await api("/classrooms");
    return Array.isArray(data?.classrooms) ? data.classrooms : [];
  } catch {
    return null;
  }
}

async function resolveExistingRooms() {
  const sharedRooms = await fetchSharedClassrooms();
  if (!Array.isArray(sharedRooms)) return [];

  const viewerRole = localStorage.getItem("delta-user-role") || "student";
  return sharedRooms
    .filter((room) => room?.code)
    .map((room) => {
      const code = String(room.code).trim().toLowerCase();
      return {
        code,
        subject: room.subject || "",
        timing: room.timing || "",
        info: room.info || "",
        capacity: room.capacity || "",
        canDelete: Boolean(room.canDelete) && viewerRole === "teacher",
        host: viewerRole === "teacher" && Boolean(room.canDelete || room.host),
        teacherPresent: Boolean(room.teacherPresent),
        participants: Number(room.participants || 0),
        participantNames: Array.isArray(room.participantNames) ? room.participantNames : [],
        at: room.createdAt || room.at || Date.now(),
        pending: Boolean(room.pending),
      };
    });
}

function parseHash() {
  const raw = window.location.hash || "#/login";
  const noHash = raw.replace(/^#/, "");
  const [path, query = ""] = noHash.split("?");
  return { path, params: new URLSearchParams(query) };
}

const TOKEN_TS_KEY = "delta-access-token-ts";
const TOKEN_KEY = AUTH.tokenKey;

function isSessionExpired() {
  try {
    const ts = Number(localStorage.getItem(TOKEN_TS_KEY) || "0");
    if (!ts) return true;
    return (Date.now() - ts) > 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

function ensureSessionValidity() {
  const token = getToken();
  if (!token) return;
  if (isSessionExpired()) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_TS_KEY);
    localStorage.removeItem("delta-user-display");
    localStorage.removeItem("delta-user-role");
    localStorage.removeItem("delta-active-room");
    window.location.hash = `/login?mode=login`;
  }
}

function encodeNextPath(path) {
  return encodeURIComponent(path);
}

async function mountLegacyClassroom(params) {
  const [
    { renderClassroomPage },
    { createClassroomLoader },
    { createRuntimeSession },
  ] = await Promise.all([
    import("./classroomPage.js"),
    import("./startup/classroomLoader.js"),
    import("./config/runtimeSession.js"),
  ]);

  const session = createRuntimeSession(params);
  const role = session.role === "teacher" ? "teacher" : "student";
  const roomCode = params.get("roomCode") || params.get("code") || "";
  const page = renderClassroomPage(appRoot, {
    role,
    onExit: (exitAction) => {
      handleExitFromClassroom({
        role,
        roomCode,
        isTeacher: role === "teacher",
      }, exitAction).catch((error) => console.error("Exit failed:", error));
    },
  });
  const classroomLoader = createClassroomLoader({
    loadButton: page.loadButton,
    setStatus: page.setStatus,
    role: session.role,
    canWriteBlackboard: session.canWriteBlackboard,
    roomCode,
  });
  activeClassroomLoader = classroomLoader;

  const warmupClassroomModules = () => {
    classroomLoader.warmup().catch(() => {});
  };

  page.loadButton.addEventListener("click", classroomLoader.handleLoadClick);
  page.loadButton.addEventListener("mouseenter", warmupClassroomModules, { once: true });
  page.loadButton.addEventListener("touchstart", warmupClassroomModules, { once: true });
  page.loadButton.addEventListener("focus", warmupClassroomModules, { once: true });

  if (classroomLoader.lowBandwidth) {
    page.setStatus("Low bandwidth detected. 3D is paused to keep the app responsive.", "Low bandwidth");
  } else {
    page.setStatus("Ready to load the classroom.", "Idle");
    setTimeout(warmupClassroomModules, 900);
  }
}

async function renderRoute() {
  const { path, params } = parseHash();
  const isClassroomRoute = path === "/classroom" || path === "/room" || path === "/group-discussion";

  if (isClassroomRoute) {
    enableClassroomRefreshGuard();
  } else {
    disableClassroomRefreshGuard();
    cleanupActiveClassroomConnection();
  }

  const role = params.get("role") === "teacher" ? "teacher" : "student";
  const mode = params.get("mode") === "signup" ? "signup" : params.get("mode") === "login" ? "login" : "";
  const next = String(params.get("next") || "").trim();

  if (path === "/classroom") {
    const roomCode = params.get("code") || "";
    const roomRole = params.get("role") === "teacher" ? "teacher" : "student";
    
    if (roomCode) {
      let isPendingStudent = false;
      let pendingMessage = "";

      if (roomRole === "student") {
        try {
          const entry = await ensureStudentCanEnterClassroom(roomCode);
          
          if (entry.pending) {
            isPendingStudent = true;
            pendingMessage = entry.message || "Join request sent. Wait for teacher approval.";
          } else if (!entry.ok) {
            localStorage.setItem("delta-dashboard-notice", entry.message);
            navigate(`/dashboard?role=student`);
            return;
          }
        } catch (error) {
          localStorage.setItem("delta-dashboard-notice", error?.message || "Could not enter classroom.");
          navigate(`/dashboard?role=student`);
          return;
        }
      }

      // Render your intended interface template layout options cleanly
      const [
        { renderClassroomPage },
        { createRuntimeSession },
        { createClassroomLoader },
      ] = await Promise.all([
        import("./classroomPage.js"),
        import("./config/runtimeSession.js"),
        import("./startup/classroomLoader.js"),
      ]);

      const page = renderClassroomPage(appRoot, {
        role: roomRole,
        onExit: (exitAction) => {
          handleExitFromClassroom({
            role: roomRole,
            roomCode,
            isTeacher: roomRole === "teacher",
          }, exitAction).catch((error) => console.error("Exit failed:", error));
        },
        api,
      });
      const session = createRuntimeSession(new URLSearchParams(`role=${roomRole}&roomCode=${roomCode}`));
      
      const classroomLoader = createClassroomLoader({
        loadButton: page.loadButton,
        setStatus: page.setStatus,
        role: session.role,
        canWriteBlackboard: session.role === "teacher",
        roomCode,
      });
      activeClassroomLoader = classroomLoader;
      
      const checkAndInitVoice = async () => {
        if (window.activeClassroomSocket && !activeVoiceSystem) {
          try {
            const { VoiceSystem } = await import("../classroom/VoiceSystem.js");
            activeVoiceSystem = new VoiceSystem(window.activeClassroomSocket, window.activeClassroomSocket.id, roomRole);
            window.activeVoiceSystem = activeVoiceSystem;
            try {
              await activeVoiceSystem.initLocalStream();
            } catch (e) {
              console.error("Voice init err", e);
            }

            if (page.muteButton) {
              const setMuteButtonState = (isMuted) => {
                page.muteButton.innerHTML = isMuted
                  ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'
                  : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
                page.muteButton.setAttribute("data-tooltip", isMuted ? "Unmute Mic" : "Mute Mic");
                page.muteButton.style.color = isMuted ? "#dc2626" : "#16a34a";
              };

              setMuteButtonState(Boolean(activeVoiceSystem.isMuted));
              page.muteButton.addEventListener("click", () => {
                const isMuted = activeVoiceSystem.toggleMute();
                if (!isMuted) {
                  activeVoiceSystem.enableRemoteAudioWithGesture && activeVoiceSystem.enableRemoteAudioWithGesture();
                }
                setMuteButtonState(isMuted);
              });

              window.activeClassroomSocket.on("audio-state-change", ({ userId, muted, by }) => {
                if (userId !== window.activeClassroomSocket.id) return;
                const isMuted = Boolean(muted);
                setMuteButtonState(isMuted);
                if (by && !isMuted) {
                  page.setStatus("Teacher unmuted your microphone.", "Mic unmuted", true);
                  window.setTimeout(() => {
                    if (page?.setStatus) {
                      page.setStatus("Ready to load the classroom.", "Idle", true);
                    }
                  }, 3500);
                } else if (by && isMuted) {
                  page.setStatus("Teacher muted your microphone.", "Mic muted", false);
                }
              });
            }

            if (page.deafenButton && roomRole === "student") {
              page.deafenButton.addEventListener("click", () => {
                const isDeafened = activeVoiceSystem.toggleDeafen();
                page.deafenButton.innerHTML = isDeafened
                  ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
                  : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>';
                page.deafenButton.setAttribute("data-tooltip", isDeafened ? "Unmute Teacher" : "Mute Teacher");
                page.deafenButton.style.color = isDeafened ? "#dc2626" : "#64748b";
              });
            }
          } catch (e) {
            console.error("Voice load err", e);
          }
        } else {
          setTimeout(checkAndInitVoice, 500);
        }
      };
      
      const initRaiseHandWiring = () => {
        try {
          if (roomRole !== "teacher") return;
          if (!page.raiseHandList) return;
          const socket = window.activeClassroomSocket;
          if (!socket) return;

          const renderRaiseHands = (list) => {
            page.raiseHandList.innerHTML = "";
            (list || []).forEach(entry => {
              const userId = typeof entry === 'string' ? entry : entry.userId;
              const displayName = (entry && entry.displayName) ? entry.displayName : userId;
              const isMuted = entry?.muted !== false;
              const li = document.createElement("li");
              li.className = "dc-raise-hand-item";
              li.dataset.userId = userId;
              li.dataset.muted = isMuted ? "true" : "false";
              li.innerHTML = `
                <span class="dc-raise-hand-user">${escapeHtml(displayName)}</span>
                <div class="dc-raise-hand-actions">
                  <button type="button" class="dc-btn dc-btn-small dc-unmute-btn">${isMuted ? "Unmute" : "Mute"}</button>
                  <button type="button" class="dc-btn dc-btn-ghost dc-clear-btn">Clear</button>
                </div>
              `;
              const unmuteBtn = li.querySelector('.dc-unmute-btn');
              const clearBtn = li.querySelector('.dc-clear-btn');
              unmuteBtn.addEventListener('click', () => {
                const nextMuted = li.dataset.muted !== "true";
                li.dataset.muted = nextMuted ? "true" : "false";
                unmuteBtn.textContent = nextMuted ? "Unmute" : "Mute";
                socket.emit('teacher-set-audio-state', { target: userId, muted: nextMuted });
                try {
                  if (activeVoiceSystem && typeof activeVoiceSystem.enableRemoteAudioWithGesture === 'function') {
                    activeVoiceSystem.enableRemoteAudioWithGesture();
                  }
                } catch (e) {}
              });
              clearBtn.addEventListener('click', () => {
                socket.emit('clear-raise-hand', { userId });
              });
              page.raiseHandList.appendChild(li);
            });
          };

          socket.on('raise-hand-list', (list) => {
            try { renderRaiseHands(list); } catch (e) { console.warn('Render raise-hands failed', e); }
          });

          socket.on('unmute-request', ({ userId, displayName }) => {
            const existing = page.raiseHandList.querySelector(`[data-user-id="${userId}"]`);
            if (!existing) {
              const current = page.raiseHandList ? Array.from(page.raiseHandList.querySelectorAll('li')).map(li=>({ userId: li.dataset.userId, displayName: li.querySelector('.dc-raise-hand-user')?.textContent || li.dataset.userId })) : [];
              renderRaiseHands([...current, { userId, displayName, muted: true }]);
            }
            page.setStatus(`${displayName || "Student"} requested microphone access.`, "Mic request", true);
          });

          socket.emit('request-raise-hand-list');
        } catch (err) {
          console.warn('initRaiseHandWiring error', err);
        }
      };

      // --- CRITICAL FIXED IMPLEMENTATION HANDLER BLOCK ---
      // Intercept click event execution chains safely on the purple button element
      page.loadButton.addEventListener("click", (e) => {
        if (isPendingStudent) {
          // Block 3D boot entirely if they are pending, forcing them to remain on the clean loading layout interface
          e.stopImmediatePropagation();
          page.setStatus(pendingMessage, "Pending");
          return;
        }
        
        // Approved students continue down the original, optimized 2G/low-bandwidth runtime execution track cleanly
        classroomLoader.handleLoadClick();
        checkAndInitVoice();
        initRaiseHandWiring();
      });
      
      page.loadButton.addEventListener("mouseenter", () => {
        if (!isPendingStudent) classroomLoader.warmup().catch(() => {});
      }, { once: true });
      
      if (isPendingStudent) {
        page.setStatus(pendingMessage, "Pending");
        showStudentPendingModal(pendingMessage);
      } else if (entry?.teacherPresent === false) {
        page.setStatus("You are approved, but the teacher has not joined yet. Please wait or refresh when they arrive.", "Waiting");
      } else {
        page.setStatus("Ready to load the classroom.", "Idle");
      }
      
      // Setup the WebSocket stream to connect to the spectator channel room in the background
      // This immediately signals the teacher dashboard WITHOUT forcing the 3D modules to load on the student screen
      const initPendingWebsocketHandshake = async () => {
        const [{ io }] = await Promise.all([ loadSocketClientModule() ]);
        const socket = io({
          path: "/socket.io",
          transports: ["websocket", "polling"],
          auth: { role: roomRole, roomCode, token: getToken(), displayName: localStorage.getItem("delta-user-display") || "" },
          query: { role: roomRole, roomCode, token: getToken() }
        });
        
        activeClassroomSocket = socket;
        window.activeClassroomSocket = socket;
        localStorage.setItem("delta-active-room", roomCode);
        
        // Auto refresh student screen layout natively once approved live by the teacher
        socket.on('admission-approved', (payload = {}) => {
          showStudentDecisionModal(payload?.message || 'You were approved to join the classroom.', () => {
            isPendingStudent = false;
            page.setStatus('Approved by teacher. Loading classroom...', 'Approved', true);
            if (classroomLoader && typeof classroomLoader.handleLoadClick === 'function') {
              classroomLoader.handleLoadClick();
            }
            checkAndInitVoice();
            initRaiseHandWiring();
          });
        });

        socket.on('admission-denied', (payload = {}) => {
          showStudentDecisionModal(payload?.message || 'Your request was denied by the teacher.', () => {
            try { window.location.hash = `/dashboard?role=student`; } catch (e) {}
          });
        });
      };
      
      initPendingWebsocketHandshake().catch((err) => console.error(err));
      return;
    }
  }

  if (path === "/login") {
    const { mountLogin } = await import("./features/auth/login.js");
    mountLogin(appRoot, {
      api, role, mode,
      onDone: () => {
        if (next.startsWith("/")) {
          navigate(next);
          return;
        }
        navigate(`/dashboard?role=${role}`);
      },
      onGoRegister: (nextRole = role) => navigate(`/register?role=${nextRole}&mode=signup`),
      onChoose: ({ nextMode, nextRole }) => {
        if (nextMode === "signup") navigate(`/register?role=${nextRole}&mode=signup`);
        else navigate(`/login?role=${nextRole}&mode=login`);
      },
    });
    return;
  }

  if (path === "/register") {
    const { mountRegister } = await import("./features/auth/register.js");
    mountRegister(appRoot, {
      api, role, mode,
      onDone: () => navigate(`/login?role=${role}&mode=login`),
      onGoLogin: (nextRole = role) => navigate(`/login?role=${nextRole}&mode=login`),
      onChoose: ({ nextMode, nextRole }) => {
        if (nextMode === "signup") navigate(`/register?role=${nextRole}&mode=signup`);
        else navigate(`/login?role=${nextRole}&mode=login`);
      },
    });
    return;
  }

  if (path === "/join") {
    const { mountJoinClassroomPage } = await import("./features/dashboard/joinClassroomPage.js");
    mountJoinClassroomPage(appRoot, {
      defaultCode: localStorage.getItem("delta-active-room") || "",
      onBack: () => navigate(`/dashboard?role=${role}`),
      onSubmit: async (code) => {
        const room = String(code || "").toLowerCase();
        const data = await api(`/classrooms/${encodeURIComponent(room)}`);
        if (!data?.exists) return { ok: false, message: "Classroom not found." };

        await api(`/classrooms/${encodeURIComponent(room)}/join`, { method: "POST" });
        localStorage.setItem("delta-active-room", room);
        navigate(`/classroom?role=${role}&code=${encodeURIComponent(room)}`);
        return { ok: true };
      },
    });
    return;
  }

  if (path === "/create") {
    const { mountCreateClassroomPage } = await import("./features/dashboard/createClassroomPage.js");
    mountCreateClassroomPage(appRoot, {
      onBack: () => navigate(`/dashboard?role=${role}`),
      onSave: async (payload) => {
        const normalized = String(payload.code || "").trim().toLowerCase();
        await api("/classrooms", { method: "POST", body: { ...payload, code: normalized } });
        localStorage.setItem("delta-active-room", normalized);
        navigate(`/dashboard?role=teacher`);
      },
    });
    return;
  }

  if (path === "/room") {
    const { mountRoomPage } = await import("./features/dashboard/roomPage.js");
    const roomCode = String(params.get("code") || "").trim().toLowerCase();
    const roomRole = params.get("role") === "teacher" ? "teacher" : "student";

    if (!roomCode) {
      navigate(`/join?role=${roomRole}`);
      return;
    }

    mountRoomPage(appRoot, {
      roomCode,
      role: roomRole,
      api,
      onExit: () => navigate(`/dashboard?role=${roomRole}`)
    });
    return;
  }

  if (path === "/group-discussion") {
    const routeRole = params.get("role") === "teacher" ? "teacher" : "student";
    const roomCode = String(params.get("code") || "").trim().toLowerCase();

    if (!roomCode) {
      navigate(`/dashboard?role=${routeRole}`);
      return;
    }

    const { mountRoomToolPage } = await import("./features/dashboard/groupDiscussionPage.js");
    if (!window.activeClassroomSocket && getToken()) {
      try {
        const { socket } = await startRoomSocketOnly({ role: routeRole, roomCode });
        activeClassroomSocket = socket;
        window.activeClassroomSocket = socket;
      } catch (error) {
        console.warn("Discussion live socket unavailable; using saved discussion API.", error);
      }
    }
    mountRoomToolPage(appRoot, {
      role: routeRole,
      roomCode,
      api,
      onBack: () => navigate(`/classroom?role=${routeRole}&code=${encodeURIComponent(roomCode)}`),
      onDashboard: () => navigate(`/dashboard?role=${routeRole}`),
    });
    return;
  }

  if (path === "/notes") {
    const routeRole = params.get("role") === "teacher" ? "teacher" : "student";
    const roomCode = String(params.get("code") || "").trim().toLowerCase();

    if (!roomCode) {
      navigate(`/dashboard?role=${routeRole}`);
      return;
    }

    const { mountNotesPage } = await import("./features/dashboard/notesPage.js");
    mountNotesPage(appRoot, {
      role: routeRole,
      roomCode,
      onBack: () => navigate(`/classroom?role=${routeRole}&code=${encodeURIComponent(roomCode)}`),
      onDashboard: () => navigate(`/dashboard?role=${routeRole}`),
    });
    return;
  }

  if (path === "/profile") {
    const { mountProfilePage } = await import("./features/profile/profilePage.js");
    const currentRole = params.get("role") === "teacher" ? "teacher" : "student";

    mountProfilePage(appRoot, {
      api,
      role: currentRole,
      onBack: () => navigate(`/dashboard?role=${currentRole}`),
      onCreateRequested: () => navigate("/create?role=teacher"),
      onJoinRequested: () => navigate(`/join?role=${currentRole}`),
      onLogout: () => {
        localStorage.removeItem("delta-access-token");
        localStorage.removeItem("delta-user-display");
        localStorage.removeItem("delta-user-role");
        localStorage.removeItem("delta-active-room");
        navigate(`/login?role=${currentRole}&mode=login`);
      },
    });
    return;
  }

  const { mountDashboard } = await import("./features/dashboard/dashboardPage.js");
  mountDashboard(appRoot, {
    api,
    onLoginRequested: () => navigate(`/login?role=${role}`),
    onCreateRequested: () => navigate("/create?role=teacher"),
    onJoinRequested: () => navigate(`/join?role=student`),
    onRoomSelected: ({ roomCode, role: classroomRole }) => {
      navigate(`/classroom?role=${classroomRole}&code=${encodeURIComponent(roomCode)}`);
    },
    onResolveRooms: resolveExistingRooms,
  });
  prefetchDashboardRouteChunks();
}

window.addEventListener("hashchange", renderRoute);
ensureSessionValidity();
renderRoute();