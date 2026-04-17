import "./styles.css";

registerServiceWorker();

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing app root element");
}

app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div>
        <h1>DeltaClass3D</h1>
        <p id="connection-status">Preparing lightweight classroom shell.</p>
      </div>
      <span id="connection-badge" class="connection">Starting</span>
    </header>
    <section id="bandwidth-panel" class="controls bandwidth-panel">
      <label>3D classroom</label>
      <p class="hint">Tap to load the 3D scene. On slow connections, it will not start until you choose.</p>
      <button id="load-classroom-button" type="button">Load 3D classroom</button>
    </section>
    <main id="canvas-container" class="canvas-container"></main>
  </div>
`;

const serverUrl = resolveServerUrl();
const role = new URLSearchParams(window.location.search).get("role") || "student";
const connectionStatus = document.getElementById("connection-status");
const connectionBadge = document.getElementById("connection-badge");
const bandwidthPanel = document.getElementById("bandwidth-panel");
const loadButton = document.getElementById("load-classroom-button");

if (!connectionStatus || !connectionBadge || !bandwidthPanel || !loadButton) {
  throw new Error("Missing bootstrap UI elements");
}

const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const lowBandwidth = Boolean(connection?.saveData) || ["slow-2g", "2g"].includes(connection?.effectiveType);

let bootPromise = null;
let classroomStarted = false;
let activeSocket = null;
let bootRequested = false;

function setStatus(message, badgeText, badgeConnected = false) {
  connectionStatus.textContent = message;
  connectionBadge.textContent = badgeText;
  connectionBadge.classList.toggle("connected", badgeConnected);
}

async function bootClassroom() {
  if (bootPromise) return bootPromise;
  bootRequested = true;

  bootPromise = (async () => {
    try {
      if (!serverUrl) {
        setStatus("Socket server URL is not configured for production.", "Config error");
        loadButton.disabled = false;
        loadButton.textContent = "Configure server URL";
        bootPromise = null;
        bootRequested = false;
        return;
      }

      loadButton.disabled = true;
      loadButton.textContent = "Loading...";
      setStatus("Loading classroom modules.", "Loading");

      const [{ io }, { startClassroom }] = await Promise.all([
        loadSocketClientModule(),
        import("./classroom.js"),
      ]);

      if (activeSocket) {
        activeSocket.disconnect();
        activeSocket = null;
      }

      const socket = io(serverUrl, {
        transports: ["websocket"],
        auth: { role },
        query: { role },
        reconnection: true,
      });

      activeSocket = socket;

      socket.on("connect", () => {
        if (classroomStarted) return;

        classroomStarted = true;
        setStatus("Classroom ready.", "Connected", true);
        loadButton.textContent = "3D classroom loaded";
        loadButton.disabled = true;
        startClassroom(socket, role);
      });

      socket.on("connect_error", () => {
        if (activeSocket === socket) {
          socket.disconnect();
          activeSocket = null;
        }

        setStatus("Connection failed. Check your network and try again.", "Offline");
        loadButton.disabled = false;
        loadButton.textContent = "Retry load";
        bootPromise = null;
        bootRequested = false;
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

async function loadSocketClientModule() {
  try {
    return await import("https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/dist/socket.io.esm.min.js");
  } catch {
    return import("socket.io-client");
  }
}

function resolveServerUrl() {
  const queryServer = new URLSearchParams(window.location.search).get("server");
  if (queryServer) return queryServer;

  const envServer = import.meta.env.VITE_SOCKET_SERVER_URL;
  if (envServer) return envServer;

  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalhost) return `${window.location.protocol}//${window.location.hostname}:3001`;

  return "";
}

loadButton.addEventListener("click", () => {
  if (classroomStarted || bootRequested) return;

  bootClassroom().catch((error) => {
    console.error("Failed to load classroom:", error);
    setStatus("Unable to load the classroom right now.", "Offline");
    loadButton.disabled = false;
    loadButton.textContent = "Retry load";
    bootPromise = null;
    bootRequested = false;
  });
});

if (lowBandwidth) {
  setStatus("Low bandwidth detected. 3D is paused to keep the app responsive.", "Low bandwidth");
} else {
  setStatus("Ready to load the classroom.", "Idle");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}
