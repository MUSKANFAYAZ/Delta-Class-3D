function isLowBandwidthConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType);
}

function isStrictLowBandwidthConnection() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = String(connection?.effectiveType || "").toLowerCase();
  return Boolean(connection?.saveData) || networkType === "slow-2g" || networkType === "2g";
}

async function loadSocketClientModule() {
  return import("socket.io-client");
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

        if (activeSocket) {
          activeSocket.disconnect();
          activeSocket = null;
        }

        const socket = io({
          path: "/socket.io",
          // Allow polling fallback on constrained networks, then upgrade when possible.
          transports: ["polling", "websocket"],
          auth: { role, roomCode, canWriteBlackboard },
          query: { role, roomCode, canWriteBlackboard: String(canWriteBlackboard) },
          reconnection: true,
        });

        activeSocket = socket;
        window.activeClassroomSocket = socket;

        if (!classroomStarted) {
          classroomStarted = true;
          const elapsedMs = Math.max(0, performance.now() - bootStartedAtMs);
          const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
          setStatus(`3D classroom loaded in ${elapsedSeconds}s. Connecting live sync...`, "Loaded");
          loadButton.textContent = "3D classroom loaded";
          loadButton.disabled = true;
          startClassroom(socket, role, {
            canWriteBlackboard,
            lowBandwidth,
            strictLowBandwidth,
          });
        }

        socket.on("connect", () => {
          const elapsedMs = Math.max(0, performance.now() - bootStartedAtMs);
          const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
          setStatus(`Live sync connected in ${elapsedSeconds}s.`, "Connected", true);
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
      } catch (error) {
        bootPromise = null;
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
    if (classroomStarted || bootRequested) return;

    bootClassroom().catch((error) => {
      console.error("Failed to load classroom:", error);
      setStatus("Unable to load the classroom right now.", "Offline");
      loadButton.disabled = false;
      loadButton.textContent = "Retry load";
      bootPromise = null;
      bootRequested = false;
    });
  }

  function disconnect() {
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