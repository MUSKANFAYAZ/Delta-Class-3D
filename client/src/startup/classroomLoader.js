function isLowBandwidthConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType);
}

function isStrictLowBandwidthConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = String(connection?.effectiveType || "").toLowerCase();
  return Boolean(connection?.saveData) || networkType === "slow-2g" || networkType === "2g";
}

import { socketTransports, socketServerUrl, socketPath } from "../socketTransport.js";

async function loadSocketClientModule() {
  return import("socket.io-client");
}

function createSocketInstance(io, options = {}) {
  const socketOptions = {
    path: socketPath,
    transports: socketTransports,
    ...options,
  };

  return socketServerUrl ? io(socketServerUrl, socketOptions) : io(socketOptions);
}

function notifyClassroomSocketReady(socket) {
  if (!socket || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent("delta-classroom-socket-ready", { detail: { socket } }));
}

export function createClassroomLoader({
  loadButton,
  setStatus,
  role,
  canWriteBlackboard,
  roomCode = "",
}) {
  const lowBandwidth = isLowBandwidthConnection();
  const strictLowBandwidth = isStrictLowBandwidthConnection();
  let bootPromise = null;
  let classroomStarted = false;
  let activeSocket = null;
  let bootRequested = false;
  let classroomModulesPromise = null;
  let bootStartedAtMs = 0;
  let removeSocketRecoveryHandlers = () => {};

  function warmup() {
    if (!classroomModulesPromise) {
      classroomModulesPromise = Promise.all([
        loadSocketClientModule(),
        import("../classroom.js"),
      ]);
    }

    return classroomModulesPromise;
  }

  async function bootClassroom() {
    if (bootPromise) return bootPromise;
    bootRequested = true;
    bootStartedAtMs = performance.now();

    bootPromise = (async () => {
      try {
        loadButton.disabled = true;
        loadButton.textContent = "Loading...";
        setStatus("Loading classroom modules.", "Loading");

        const [{ io }, { startClassroom }] = await warmup();

        const priorSocket = window.activeClassroomSocket && window.activeClassroomSocket !== activeSocket
          ? window.activeClassroomSocket
          : null;

        const retainVoiceSystem = window.activeVoiceSystem
          && typeof window.activeVoiceSystem.transferSocket === "function"
          && window.activeVoiceSystem.currentRole === role
          && window.activeVoiceSystem.useServerVoiceRelay;

        if (!retainVoiceSystem && window.activeVoiceSystem) {
          console.log("[ClassroomLoader] Destroying old voice system before socket switch");
          try {
            window.activeVoiceSystem.destroy();
          } catch (e) {
            console.warn("[ClassroomLoader] Voice cleanup before socket switch failed:", e);
          }
          window.activeVoiceSystem = null;
        }

        if (activeSocket) {
          activeSocket.disconnect();
          activeSocket = null;
        }

        // Helper to create a fresh socket instance (used for forced clean reconnects)
        const createSocket = () => createSocketInstance(io, {
          auth: {
            role,
            roomCode,
            canWriteBlackboard,
            token: localStorage.getItem("delta-access-token") || "",
            displayName: localStorage.getItem("delta-user-display") || "",
          },
          query: {
            role,
            roomCode,
            canWriteBlackboard: String(canWriteBlackboard),
            token: localStorage.getItem("delta-access-token") || "",
          },
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 500,
          reconnectionDelayMax: 4000,
          timeout: 20000,
        });

        let socket = createSocket();
        activeSocket = socket;
        window.activeClassroomSocket = socket;

        const disconnectPriorSocket = () => {
          if (priorSocket && priorSocket !== socket) {
            try {
              priorSocket.disconnect();
            } catch {
              // ignore stale socket cleanup issues
            }
          }
        };

        const resumeSocket = () => {
          if (activeSocket !== socket) {
            return;
          }

          if (document.visibilityState === "visible" && socket.disconnected) {
            try {
              socket.connect();
            } catch (err) {
              console.warn("Unable to resume classroom socket:", err);
            }
          }
        };

        const handleVisibilityChange = () => resumeSocket();
        const handleOnline = () => resumeSocket();
        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("online", handleOnline);
        removeSocketRecoveryHandlers = () => {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          window.removeEventListener("online", handleOnline);
        };

        // Track consecutive connect errors and perform a forced clean reconnect
        const setupConnectErrorHandler = (skt) => {
          skt.on("reconnect_attempt", (attempt) => {
            if (activeSocket === skt) {
              setStatus(`Reconnecting live sync (attempt ${attempt}).`, "Connecting");
            }
          });

          skt.on("reconnect", () => {
            if (activeSocket === skt) {
              setStatus("Live sync restored.", "Connected", true);
            }
          });

          skt.on("reconnect_error", (err) => {
            if (activeSocket === skt) {
              console.warn("Socket reconnect_error", err);
              setStatus("Live sync is retrying after a network interruption.", "Connecting");
            }
          });

          skt.on("reconnect_failed", () => {
            if (activeSocket === skt) {
              setStatus("Live sync could not reconnect yet. Keep the tab open and try again.", "Offline");
            }
          });

          skt.on("connect_error", (err) => {
            if (activeSocket === skt) {
              console.warn("Socket connect_error", err);
              setStatus("Live sync is reconnecting after a temporary disconnect.", "Connecting");
            }
          });
        };

        setupConnectErrorHandler(socket);

        if (!classroomStarted) {
          classroomStarted = true;
          const elapsedMs = Math.max(0, performance.now() - bootStartedAtMs);
          const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
          setStatus(`3D classroom loaded in ${elapsedSeconds}s. Connecting live sync...`, "Loaded");
          loadButton.textContent = "3D classroom loaded";
          loadButton.disabled = true;
          const stopClassroom = startClassroom(socket, role, {
            canWriteBlackboard,
            lowBandwidth,
            strictLowBandwidth,
          });
          window.stopActiveClassroom = stopClassroom;
        }

        socket.on("connect", () => {
          disconnectPriorSocket();
          notifyClassroomSocketReady(socket);
          const elapsedMs = Math.max(0, performance.now() - bootStartedAtMs);
          const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
          setStatus(`Live sync connected in ${elapsedSeconds}s.`, "Connected", true);
          if (activeSocket === socket && classroomStarted) {
            loadButton.textContent = "3D classroom loaded";
            loadButton.disabled = true;
          }
        });

        socket.on("connect_error", () => {
          if (activeSocket === socket) {
            setStatus("3D loaded. Live sync is retrying on this network.", "Connecting");

            // Before classroom startup, keep old retry behavior.
            if (!classroomStarted) {
              socket.disconnect();
              activeSocket = null;
              loadButton.disabled = false;
              loadButton.textContent = "Retry load";
              bootPromise = null;
              bootRequested = false;
            }
          }
        });

        socket.on("room-error", (payload = {}) => {
          if (activeSocket !== socket) return;
          const message = String(payload?.message || "Live sync could not join this classroom.");
          setStatus(message, "Offline");
          loadButton.disabled = false;
          loadButton.textContent = "Retry load";
        });
      } catch (error) {
        bootPromise = null;
        removeSocketRecoveryHandlers();
        loadButton.disabled = false;
        loadButton.textContent = "Retry load";
        setStatus("Unable to load the classroom right now.", "Offline");
        bootRequested = false;
        throw error;
      }
    })();

    return bootPromise;
  }

  function handleLoadClick() {
    if (bootRequested) return;

    if (classroomStarted && loadButton.textContent !== "Retry load") {
      return;
    }

    const promise = bootClassroom().catch((error) => {
      console.error("Failed to load classroom:", error);
      setStatus("Unable to load the classroom right now.", "Offline");
      loadButton.disabled = false;
      loadButton.textContent = "Retry load";
      bootPromise = null;
      bootRequested = false;
      throw error;
    });

    return promise;
  }

  function disconnect() {
    removeSocketRecoveryHandlers();
    if (typeof window.stopActiveClassroom === "function") {
      try {
        window.stopActiveClassroom();
      } catch {
        // ignore
      }
      window.stopActiveClassroom = null;
    }
    if (activeSocket) {
      try {
        activeSocket.disconnect();
      } catch {
        // ignore disconnect issues
      }
      activeSocket = null;
    }
    bootPromise = null;
    bootRequested = false;
    classroomStarted = false;
  }

  return {
    handleLoadClick,
    warmup,
    disconnect,
    lowBandwidth,
    strictLowBandwidth,
  };
}
