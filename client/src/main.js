import "./styles.css";
import { registerServiceWorker } from "./startup/registerServiceWorker.js";

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

function getToken() {
  return localStorage.getItem(AUTH.tokenKey) || "";
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  const currentToken = token ?? getToken();
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;

  const res = await fetch(`${AUTH.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore non-JSON error bodies
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

let dashboardChunkPrefetched = false;
function prefetchDashboardRouteChunks() {
  if (dashboardChunkPrefetched) return;
  dashboardChunkPrefetched = true;
  runWhenIdle(() => {
    import("./features/dashboard/createClassroomPage.js").catch(() => {});
    import("./features/dashboard/joinClassroomPage.js").catch(() => {});
    import("./features/dashboard/roomPage.js").catch(() => {});
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

async function startSocketClassroom({ role, roomCode }) {
  const [{ io }, { startClassroom }] = await Promise.all([
    loadSocketClientModule(),
    import("./classroom.js"),
  ]);

  const socket = io({
    path: "/socket.io",
    transports: ["websocket"],
    auth: { role, roomCode },
    query: { role, roomCode },
    reconnection: true,
  });

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    const onConnect = () => {
      cleanup();
      // Ensure the role here correctly dictates canWriteBlackboard
      startClassroom(socket, role, {
        canWriteBlackboard: role === "teacher",
        lowBandwidth: isLowBandwidthConnection(),
        strictLowBandwidth: isLowBandwidthConnection(),
      });
      resolve({ socket });
    };

    const onError = (error) => {
      cleanup();
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      reject(error || new Error("Socket connection failed"));
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

function navigate(path) {
  if (window.location.hash === `#${path}`) {
    renderRoute();
    return;
  }
  window.location.hash = path;
}

function rememberRoom(entry) {
  const rooms = (() => {
    try {
      const raw = localStorage.getItem("delta-my-rooms");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  })();
  const normalizedCode = String(entry.code || "")
    .trim()
    .toLowerCase();
  const next = rooms.filter((room) => String(room.code || "").toLowerCase() !== normalizedCode);
  next.unshift({ ...entry, code: normalizedCode });
  localStorage.setItem("delta-my-rooms", JSON.stringify(next.slice(0, 20)));
}

function readSavedRooms() {
  try {
    const raw = localStorage.getItem("delta-my-rooms");
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function resolveExistingRooms() {
  const rooms = readSavedRooms();
  if (!rooms.length) return [];

  const checks = await Promise.all(
    rooms.map(async (room) => {
      const code = String(room.code || "").trim().toLowerCase();
      if (!code) return null;
      try {
        const data = await api(`/classrooms/${encodeURIComponent(code)}`);
        if (data?.exists === false) {
          return null;
        }

        if (data?.exists) {
          return {
            ...room,
            code,
            canDelete: Boolean(data?.canDelete),
            host: Boolean(data?.canDelete) || Boolean(room.host),
            subject: data?.subject ?? room.subject ?? "",
            timing: data?.timing ?? room.timing ?? "",
          };
        }

        // Unknown payload shape: keep local room instead of losing it.
        return { ...room, code };
      } catch {
        // Temporary API/DNS issues should not wipe the user's saved classrooms.
        return { ...room, code };
      }
    }),
  );

  const valid = checks.filter(Boolean);
  localStorage.setItem("delta-my-rooms", JSON.stringify(valid));
  return valid;
}

function parseHash() {
  const raw = window.location.hash || "#/dashboard";
  const noHash = raw.replace(/^#/, "");
  const [path, query = ""] = noHash.split("?");
  return { path, params: new URLSearchParams(query) };
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

  const page = renderClassroomPage(appRoot);
  const session = createRuntimeSession(params);

  const classroomLoader = createClassroomLoader({
    loadButton: page.loadButton,
    setStatus: page.setStatus,
    role: session.role,
    canWriteBlackboard: session.canWriteBlackboard,
    roomCode: params.get("roomCode") || params.get("code") || "",
  });

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

  if (path === "/classroom") {
    const roomCode = params.get("code") || "";
    const roomRole = params.get("role") === "teacher" ? "teacher" : "student";
    
    if (roomCode) {
      const [
        { renderClassroomPage },
        { createRuntimeSession },
        { createClassroomLoader },
      ] = await Promise.all([
        import("./classroomPage.js"),
        import("./config/runtimeSession.js"),
        import("./startup/classroomLoader.js"),
      ]);

      const page = renderClassroomPage(appRoot);
      const session = createRuntimeSession(new URLSearchParams(`role=${roomRole}&roomCode=${roomCode}`));
      
      const classroomLoader = createClassroomLoader({
        loadButton: page.loadButton,
        setStatus: page.setStatus,
        role: session.role,
        canWriteBlackboard: session.role === "teacher",
        roomCode,
      });
      
      page.loadButton.addEventListener("click", classroomLoader.handleLoadClick);
      page.loadButton.addEventListener("mouseenter", () => classroomLoader.warmup().catch(() => {}), { once: true });
      page.setStatus("Ready to load the classroom.", "Idle");
      return;
    }
    await mountLegacyClassroom(params);
    return;
  }

  const role = params.get("role") === "teacher" ? "teacher" : "student";
  const mode = params.get("mode") === "signup" ? "signup" : params.get("mode") === "login" ? "login" : "";
  const next = String(params.get("next") || "").trim();

  if (path === "/login") {
    const { mountLogin } = await import("./features/auth/login.js");
    mountLogin(appRoot, {
      api,
      role,
      mode,
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
      api,
      role,
      mode,
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
        if (!data?.exists) {
          return { ok: false, message: "Classroom code not found." };
        }
        rememberRoom({ code: room, host: false, at: Date.now() });
        localStorage.setItem("delta-active-room", room);
        navigate(`/dashboard?role=${role}`);
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
        await api("/classrooms", {
          method: "POST",
          body: { ...payload, code: normalized },
        });
        rememberRoom({ ...payload, code: normalized, host: true, at: Date.now() });
        localStorage.setItem("delta-active-room", normalized);
        
        // Ensure teacher role is explicitly set on navigation
        navigate(`/room?role=teacher&code=${encodeURIComponent(normalized)}`);
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

    if (!getToken()) {
      const roomPath = `/room?role=${roomRole}&code=${encodeURIComponent(roomCode)}`;
      navigate(`/login?role=${roomRole}&mode=login&next=${encodeNextPath(roomPath)}`);
      return;
    }

    mountRoomPage(appRoot, {
      roomCode,
      role: roomRole,
      onBack: () => navigate(`/dashboard?role=${roomRole}`),
    });

    try {
      await startSocketClassroom({ roomCode, role: roomRole });
      localStorage.setItem("delta-active-room", roomCode);
    } catch (e) {
      console.error(e);
      alert("Could not enter classroom. Check code/server and try again.");
      navigate(`/join?role=${roomRole}`);
    }
    return;
  }

  // Dashboard must receive 'api' to handle the modular Delete button logic
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
renderRoute();