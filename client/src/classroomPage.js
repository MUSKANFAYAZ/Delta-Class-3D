export function renderClassroomPage(appRoot) {
  if (!appRoot) {
    throw new Error("Missing app root element");
  }

  appRoot.innerHTML = `
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

  const connectionStatus = document.getElementById("connection-status");
  const connectionBadge = document.getElementById("connection-badge");
  const bandwidthPanel = document.getElementById("bandwidth-panel");
  const loadButton = document.getElementById("load-classroom-button");

  if (!connectionStatus || !connectionBadge || !bandwidthPanel || !loadButton) {
    throw new Error("Missing classroom UI elements");
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
    setStatus,
  };
}