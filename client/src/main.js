import "./styles.css";
import { registerServiceWorker } from "./startup/registerServiceWorker.js";
import { showConfirmDialog } from "./utils/dialogs.js";

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
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }

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

  if (joinResult?.pending) {
    return { ok: true, pending: true, message: joinResult.message };
  }

  if (joinResult?.teacherPresent === false) {
    return {
      ok: false,
      message: "You are approved. Please wait for the teacher to enter the classroom.",
    };
  }

  return { ok: true, pending: false };
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
      navigate(`/dashboard?role=${role}`);
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
    };

    const onError = (error) => {
      cleanup();
      try { socket.disconnect(); } catch {}
      reject(error || new Error("Socket connection failed"));
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
    socket.on("room-error", onRoomError);
    
    socket.on("pending-requests-updated", (data) => {
      if (data && data.approved === socket.id) {
        window.location.reload();
      }
    });
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
    const confirmEnd = await showConfirmDialog("End Class", "End class now? This will delete the room.");
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

  if (path === "/classroom" || path === "/room") {
    const roomCode = params.get("code") || params.get("roomCode") || "";
    const roomRole = params.get("role") === "teacher" ? "teacher" : "student";
    
    if (roomCode) {
      const [
        { mountRoomPage }, // FIXED: Target mountRoomPage named export securely from your file component layout
      ] = await Promise.all([
        import("./features/dashboard/roomPage.js"),
      ]);

      let roomPageInstance = mountRoomPage(appRoot, {
        roomCode,
        role: roomRole,
        api,
        onExit: (exitAction) => {
          if (roomPageInstance && roomPageInstance.cleanupVoiceSystem) {
            roomPageInstance.cleanupVoiceSystem();
          }
          handleExitFromClassroom({
            role: roomRole,
            roomCode,
            isTeacher: roomRole === "teacher",
          }, exitAction).catch((error) => console.error(error));
        },
      });

      try {
        const { socket } = await startSocketClassroom({ roomCode, role: roomRole });
        activeClassroomSocket = socket;
        window.activeClassroomSocket = socket;
        localStorage.setItem("delta-active-room", roomCode);
      } catch (e) {
        console.error(e);
        alert("Could not initialize classroom socket pipe.");
        navigate(`/dashboard?role=${roomRole}`);
      }
      return;
    }
  }

  if (path === "/login") {
    const { mountLogin } = await import("./features/auth/login.js");
    mountLogin(appRoot, {
      api, role, mode,
      onDone: () => navigate(`/dashboard?role=${role}`),
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
        navigate(`/room?role=${role}&code=${encodeURIComponent(room)}`);
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

  if (path === "/group-discussion") {
    const routeRole = params.get("code") ? role : "student";
    const roomCode = String(params.get("code") || "").trim().toLowerCase();
    const { mountRoomToolPage } = await import("./features/dashboard/groupDiscussionPage.js");
    
    if (!window.activeClassroomSocket && getToken()) {
      try {
        const { socket } = await startRoomSocketOnly({ role: routeRole, roomCode });
        activeClassroomSocket = socket;
        window.activeClassroomSocket = socket;
      } catch {}
    }
    mountRoomToolPage(appRoot, {
      role: routeRole, roomCode, api,
      onBack: () => navigate(`/room?role=${routeRole}&code=${encodeURIComponent(roomCode)}`),
      onDashboard: () => navigate(`/dashboard?role=${routeRole}`),
    });
    return;
  }

  if (path === "/notes") {
    const routeRole = params.get("code") ? role : "student";
    const roomCode = String(params.get("code") || "").trim().toLowerCase();
    const { mountNotesPage } = await import("./features/dashboard/notesPage.js");
    mountNotesPage(appRoot, {
      role: routeRole, roomCode,
      onBack: () => navigate(`/room?role=${routeRole}&code=${encodeURIComponent(roomCode)}`),
      onDashboard: () => navigate(`/dashboard?role=${routeRole}`),
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
      navigate(`/room?role=${classroomRole}&code=${encodeURIComponent(roomCode)}`);
    },
    onResolveRooms: resolveExistingRooms,
  });
  prefetchDashboardRouteChunks();
}

window.addEventListener("hashchange", renderRoute);
ensureSessionValidity();
renderRoute();