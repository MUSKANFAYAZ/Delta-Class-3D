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
let activeClassroomSocket = null;
let activeClassroomLoader = null;
let activeVoiceSystem = null;

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

function cleanupActiveClassroomConnection() {
  if (activeVoiceSystem) {
    try {
      activeVoiceSystem.destroy();
    } catch(e) { console.error(e); }
    activeVoiceSystem = null;
  }

  if (activeClassroomLoader) {
    activeClassroomLoader.disconnect();
    activeClassroomLoader = null;
  }

  if (activeClassroomSocket) {
    try {
      activeClassroomSocket.disconnect();
    } catch {
      // ignore disconnect issues
    }
    activeClassroomSocket = null;
    window.activeClassroomSocket = null;
  }
}

function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    // Remove any existing confirm modal
    const existing = document.getElementById("dc-confirm-modal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "dc-confirm-modal";
    backdrop.className = "dc-modal-backdrop";
    backdrop.style.display = "flex";
    
    backdrop.innerHTML = `
      <div class="dc-modal">
        <h2>${title}</h2>
        <p class="dc-exit-warning" style="margin: 1rem 0; color: var(--text-secondary);">${message}</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-danger" id="dc-confirm-btn">Confirm</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-cancel-btn">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
    
    const confirmBtn = backdrop.querySelector("#dc-confirm-btn");
    const cancelBtn = backdrop.querySelector("#dc-cancel-btn");
    
    const cleanup = () => {
      backdrop.remove();
    };
    
    confirmBtn.addEventListener("click", () => {
      cleanup();
      resolve(true);
    });
    
    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(false);
    });
    
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve(false);
      }
    });
  });
}

async function handleExitFromClassroom({ role, roomCode, isTeacher }, exitAction) {
  if (!isTeacher) {
    if (exitAction?.action !== "exit") return false;
    cleanupActiveClassroomConnection();
    navigate(`/dashboard?role=${role}`);
    return true;
  }

  // Teacher-specific logic
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
    removeSavedRoom(roomCode);
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

function removeSavedRoom(roomCode) {
  const normalizedCode = String(roomCode || "").trim().toLowerCase();
  if (!normalizedCode) return;
  const rooms = readSavedRooms();
  const nextRooms = rooms.filter(
    (room) => String(room.code || "").trim().toLowerCase() !== normalizedCode,
  );
  localStorage.setItem("delta-my-rooms", JSON.stringify(nextRooms));
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
      }, exitAction).catch((error) => {
        console.error("Exit failed:", error);
      });
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
  if (path !== "/classroom" && path !== "/room") {
    cleanupActiveClassroomConnection();
  }

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

      const page = renderClassroomPage(appRoot, {
        role: roomRole,
        onExit: (exitAction) => {
          handleExitFromClassroom({
            role: roomRole,
            roomCode,
            isTeacher: roomRole === "teacher",
          }, exitAction).catch((error) => {
            console.error("Exit failed:", error);
          });
        },
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
            await activeVoiceSystem.initLocalStream();

            if (page.muteButton) {
              page.muteButton.addEventListener("click", () => {
                const isMuted = activeVoiceSystem.toggleMute();
                page.muteButton.innerHTML = isMuted
                  ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>'
                  : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
                page.muteButton.title = isMuted ? "Unmute Mic" : "Mute Mic";
                page.muteButton.style.color = isMuted ? "#dc2626" : "#16a34a";
              });
            }

            if (page.deafenButton && roomRole === "student") {
              page.deafenButton.addEventListener("click", () => {
                const isDeafened = activeVoiceSystem.toggleDeafen();
                page.deafenButton.innerHTML = isDeafened
                  ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
                  : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>';
                page.deafenButton.title = isDeafened ? "Unmute Teacher" : "Mute Teacher";
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
      
      page.loadButton.addEventListener("click", () => {
        classroomLoader.handleLoadClick();
        checkAndInitVoice();
      });
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

    let roomPageInstance = mountRoomPage(appRoot, {
      roomCode,
      role: roomRole,
      onExit: (exitAction) => {
        // Cleanup VoiceSystem before exiting
        if (roomPageInstance && roomPageInstance.cleanupVoiceSystem) {
          roomPageInstance.cleanupVoiceSystem();
        }
        
        handleExitFromClassroom({
          role: roomRole,
          roomCode,
          isTeacher: roomRole === "teacher",
        }, exitAction).catch((error) => {
          console.error("Exit failed:", error);
        });
      },
    });

    try {
      const { socket } = await startSocketClassroom({ roomCode, role: roomRole });
      activeClassroomSocket = socket;
      window.activeClassroomSocket = socket;
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