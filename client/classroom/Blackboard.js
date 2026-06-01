import * as THREE from "./three-cdn.js";

const BOARD_COLOR = "#f8fafc";
const DEFAULT_PEN_COLOR = "#111827";
const PEN_COLORS = ["#111827", "#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c"];
const PEN_SIZES = [3, 5, 8, 12];
const LASER_THROTTLE_MS = 90;
const LASER_HIDE_DELAY_MS = 650;

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function asFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function setupBlackboardSystem({ container, renderer, camera, blackboard, socket, canWrite, lowBandwidth = false, strictLowBandwidth = false }) {
  if (!container || !renderer || !camera || !blackboard || !socket) {
    return { dispose: () => {} };
  }

  // Connection detection (used to tune canvas / emission sizes)
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = String(connection?.effectiveType || "").toLowerCase();
  const isLowBandwidth = Boolean(lowBandwidth) || Boolean(connection?.saveData) || networkType === "slow-2g" || networkType === "2g" || networkType === "3g";
  const isStrictLowBandwidth = Boolean(strictLowBandwidth) || networkType === "slow-2g" || networkType === "2g";

  const canvas = document.createElement("canvas");
  // Reduce resolution on low-bandwidth connections to speed initial load and texture updates
  if (isStrictLowBandwidth) {
    canvas.width = 1024;
    canvas.height = 512;
  } else if (isLowBandwidth) {
    canvas.width = 1536;
    canvas.height = 768;
  } else {
    canvas.width = 2048;
    canvas.height = 1024;
  }

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    return { dispose: () => {} };
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  blackboard.material.map = texture;
  blackboard.material.needsUpdate = true;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  

  let drawing = false;
  let lastDrawnPoint = null;
  let lastSentAt = 0;
  let activeTool = "pen";
  let activeColor = DEFAULT_PEN_COLOR;
  let activeThickness = 5;
  let laserModeEnabled = false;
  let laserButton = null;
  let presentationActive = false;
  let flushTimer = null;
  let laserHideTimer = null;
  let lastLaserSentAt = 0;
  let laserDot = null;
  const pendingRemoteStrokes = [];
  let currentPointerId = null;
  let textureDirty = false;
  let textureUpdateTimer = null;

  const emitIntervalMs = isStrictLowBandwidth ? 180 : (isLowBandwidth ? 110 : 32);
  const minDistance = isStrictLowBandwidth ? 0.015 : (isLowBandwidth ? 0.008 : 0.002);

  function syncLaserButtonState() {
    if (!laserButton) return;

    if (laserModeEnabled) {
      laserButton.textContent = isStrictLowBandwidth ? "Laser 2G" : "Laser On";
      laserButton.style.background = "#f59e0b";
      laserButton.style.color = "#111827";
    } else {
      laserButton.textContent = "Laser";
      laserButton.style.background = "rgba(241, 245, 249, 0.12)";
      laserButton.style.color = "#0f172a";
    }
  }

  function setLaserMode(enabled) {
    laserModeEnabled = Boolean(enabled);
    syncLaserButtonState();
    try {
      updateToolsVisibility();
    } catch (e) {
      // ignore until tools panel exists
    }
  }

  function updateToolsVisibility() {
    const panel = document.getElementById("blackboard-tools-root");
    if (!panel) return;
    if (presentationActive) {
      panel.style.display = "none";
    } else {
      panel.style.display = "";
    }
  }

  function flushRemoteStrokes() {
    if (!pendingRemoteStrokes.length) return;
    const nextBatch = pendingRemoteStrokes.splice(0, pendingRemoteStrokes.length);
    for (const stroke of nextBatch) {
      applyStroke(stroke);
    }
  }

  function queueRemoteStroke(stroke) {
    if (!isStrictLowBandwidth) {
      applyStroke(stroke);
      return;
    }

    pendingRemoteStrokes.push(stroke);
    if (flushTimer) return;

    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushRemoteStrokes();
    }, 140);
  }

  function clearBoard(shouldEmit = false) {
    context.fillStyle = BOARD_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    texture.needsUpdate = true;

    if (shouldEmit) {
      socket.emit("blackboard-clear");
    }
  }

  function ensureLaserDot() {
    if (laserDot) return laserDot;

    laserDot = document.createElement("div");
    laserDot.id = "blackboard-laser-dot";
    Object.assign(laserDot.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "18px",
      height: "18px",
      borderRadius: "999px",
      transform: "translate(-50%, -50%) scale(0)",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "10045",
      background: "radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(251,191,36,0.95) 35%, rgba(249,115,22,0.72) 72%, rgba(249,115,22,0.06) 100%)",
      boxShadow: "0 0 0 2px rgba(255,255,255,0.18), 0 0 18px rgba(249,115,22,0.75)",
      transition: "opacity 120ms ease, transform 120ms ease",
      willChange: "transform, opacity, left, top",
    });

    const host = document.getElementById("app") || document.body;
    host.appendChild(laserDot);
    return laserDot;
  }

  function hideLaser() {
    if (!laserDot) return;
    laserDot.style.opacity = "0";
    laserDot.style.transform = "translate(-50%, -50%) scale(0)";
  }

  function showLaser(clientX, clientY) {
    const dot = ensureLaserDot();
    dot.style.left = `${clientX}px`;
    dot.style.top = `${clientY}px`;
    dot.style.opacity = "1";
    dot.style.transform = "translate(-50%, -50%) scale(1)";

    if (laserHideTimer) {
      window.clearTimeout(laserHideTimer);
    }

    laserHideTimer = window.setTimeout(() => {
      hideLaser();
    }, LASER_HIDE_DELAY_MS);
  }

  function emitLaserPointer(event) {
    if (!canWrite || !laserModeEnabled || !event) return;

    const now = performance.now();
    if (now - lastLaserSentAt < LASER_THROTTLE_MS) return;
    lastLaserSentAt = now;

    socket.emit("blackboard-laser", {
      x: event.clientX,
      y: event.clientY,
      active: true,
    });
  }

  function getDistance(a, b) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const du = a.u - b.u;
    const dv = a.v - b.v;
    return Math.sqrt(du * du + dv * dv);
  }

  function normalizeColor(colorValue, fallback) {
    if (typeof colorValue !== "string") return fallback;
    const value = colorValue.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) return fallback;
    return value;
  }

  function drawSegment(from, to, { color = DEFAULT_PEN_COLOR, thickness = 5, mode = "pen" } = {}) {
    const fromX = from.u * canvas.width;
    const fromY = (1 - from.v) * canvas.height;
    const toX = to.u * canvas.width;
    const toY = (1 - to.v) * canvas.height;

    context.strokeStyle = mode === "eraser" ? BOARD_COLOR : normalizeColor(color, DEFAULT_PEN_COLOR);
    context.lineWidth = thickness;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.lineTo(toX, toY);
    context.stroke();
    // throttle texture uploads to GPU to avoid blocking main thread
    textureDirty = true;
    if (!textureUpdateTimer) {
      textureUpdateTimer = window.setTimeout(() => {
        texture.needsUpdate = true;
        textureDirty = false;
        textureUpdateTimer = null;
      }, 40);
    }
  }

  function applyStroke(stroke) {
    const from = {
      u: clamp01(asFiniteNumber(stroke?.from?.u, 0)),
      v: clamp01(asFiniteNumber(stroke?.from?.v, 0)),
    };
    const to = {
      u: clamp01(asFiniteNumber(stroke?.to?.u, from.u)),
      v: clamp01(asFiniteNumber(stroke?.to?.v, from.v)),
    };
    const thickness = asFiniteNumber(stroke?.thickness, 5);
    const color = normalizeColor(stroke?.color, DEFAULT_PEN_COLOR);
    const mode = stroke?.mode === "eraser" ? "eraser" : "pen";
    drawSegment(from, to, {
      color,
      mode,
      thickness: Math.max(1, Math.min(20, thickness)),
    });
  }

  function resolveBoardPoint(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(blackboard, false);
    if (!intersects.length) return null;

    const uv = intersects[0].uv;
    if (!uv) return null;

    return {
      u: round3(clamp01(uv.x)),
      v: round3(clamp01(uv.y)),
    };
  }

  function onPointerDown(event) {
    if (!canWrite) return;

    const point = resolveBoardPoint(event);
    if (!point) return;

    window.dispatchEvent(new CustomEvent("dc-blackboard-draw-start"));

    drawing = true;
    lastDrawnPoint = point;
    lastSentAt = performance.now();
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!canWrite) return;

    emitLaserPointer(event);

    if (!drawing || !lastDrawnPoint) return;

    const point = resolveBoardPoint(event);
    if (!point) return;

    const now = performance.now();
    const segmentDistance = getDistance(lastDrawnPoint, point);
    const withinInterval = now - lastSentAt < emitIntervalMs;
    if (withinInterval && segmentDistance < minDistance) {
      return;
    }

    const stroke = {
      from: lastDrawnPoint,
      to: point,
      thickness: activeThickness,
      mode: activeTool,
      color: activeColor,
    };

    applyStroke(stroke);
    socket.emit("blackboard-stroke", stroke);
    lastDrawnPoint = point;
    lastSentAt = now;
  }

  function onPointerUp() {
    drawing = false;
    lastDrawnPoint = null;
    try {
      if (currentPointerId != null) {
        renderer.domElement.releasePointerCapture?.(currentPointerId);
      }
    } catch (e) {
      // ignore
    }
    currentPointerId = null;
  }

  function onPointerLeave() {
    drawing = false;
    lastDrawnPoint = null;
    socket.emit("blackboard-laser", { active: false });
  }

  function onBlackboardStroke(stroke) {
    queueRemoteStroke(stroke);
  }

  function onBlackboardClear() {
    pendingRemoteStrokes.length = 0;
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    clearBoard(false);
  }

  function onBlackboardSnapshot(snapshot = {}) {
    pendingRemoteStrokes.length = 0;
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    clearBoard(false);
    const strokes = Array.isArray(snapshot.strokes)
      ? snapshot.strokes
      : (Array.isArray(snapshot.ops) ? snapshot.ops : []);
    // Apply strokes in batches so the UI remains responsive
    if (!strokes.length) return;
    const batchSize = Math.max(60, Math.floor(strokes.length / 6));
    let idx = 0;
    const applyBatch = () => {
      const end = Math.min(idx + batchSize, strokes.length);
      for (; idx < end; idx++) {
        applyStroke(strokes[idx]);
      }
      // force a texture upload for this batch
      texture.needsUpdate = true;
      if (idx < strokes.length) {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(applyBatch, { timeout: 200 });
        } else {
          setTimeout(applyBatch, 0);
        }
      }
    };
    applyBatch();
  }

  function onBlackboardLaser(payload = {}) {
    const active = payload.active !== false;
    if (!active) {
      if (laserHideTimer) {
        window.clearTimeout(laserHideTimer);
        laserHideTimer = null;
      }
      hideLaser();
      return;
    }

    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    showLaser(x, y);
  }

  // Keep the whiteboard tools hidden when presenting and laser mode is active
  socket.on("presentation-start", () => {
    presentationActive = true;
    updateToolsVisibility();
  });

  socket.on("presentation-stop", () => {
    presentationActive = false;
    updateToolsVisibility();
  });

  const handlePresentationActive = (ev) => {
    presentationActive = Boolean(ev?.detail?.active);
    updateToolsVisibility();
  };
  window.addEventListener("dc-presentation-active", handlePresentationActive);

  function buildPanel() {
    const existing = document.getElementById("blackboard-tools-root");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "blackboard-tools-root";

    Object.assign(panel.style, {
      position: "fixed",
      right: "16px",
      top: "84px",
      zIndex: "10030",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      gap: "8px",
      padding: "10px",
      borderRadius: "12px",
      backdropFilter: "blur(8px)",
      border: "1px solid rgba(148, 163, 184, 0.45)",
      background: "rgba(15, 23, 42, 0.82)",
      color: "#e2e8f0",
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "12px",
      fontWeight: "600",
      pointerEvents: "auto",
      maxWidth: "min(320px, calc(100vw - 24px))",
      maxHeight: "min(46vh, 360px)",
      overflowY: "auto",
    });

    if (canWrite) {
      const title = document.createElement("div");
      title.textContent = isLowBandwidth ? "Whiteboard tools (data saver)" : "Whiteboard tools";
      Object.assign(title.style, {
        fontSize: "12px",
        letterSpacing: "0.2px",
      });

      const colorRow = document.createElement("div");
      Object.assign(colorRow.style, {
        display: "flex",
        gap: "6px",
        flexWrap: "wrap",
      });

      const colorButtons = [];
      for (const color of PEN_COLORS) {
        const colorButton = document.createElement("button");
        colorButton.type = "button";
        colorButton.setAttribute("data-tooltip", color);
        Object.assign(colorButton.style, {
          width: "20px",
          height: "20px",
          borderRadius: "999px",
          border: "2px solid rgba(15, 23, 42, 0.22)",
          background: color,
          cursor: "pointer",
          padding: "0",
        });
        colorButton.addEventListener("click", () => {
          activeTool = "pen";
          activeColor = color;
          for (const btn of colorButtons) {
            btn.style.outline = "none";
          }
          colorButton.style.outline = "2px solid #f8fafc";
        });
        colorRow.appendChild(colorButton);
        colorButtons.push(colorButton);
      }

      const sizeRow = document.createElement("div");
      Object.assign(sizeRow.style, {
        display: "flex",
        gap: "6px",
        flexWrap: "wrap",
      });

      for (const size of PEN_SIZES) {
        const sizeButton = document.createElement("button");
        sizeButton.type = "button";
        sizeButton.textContent = `${size}px`;
        Object.assign(sizeButton.style, {
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: size === activeThickness ? "#e2e8f0" : "rgba(241, 245, 249, 0.12)",
          color: size === activeThickness ? "#0f172a" : "#e2e8f0",
          borderRadius: "999px",
          padding: "4px 8px",
          cursor: "pointer",
          fontWeight: "600",
          fontSize: "11px",
        });
        sizeButton.addEventListener("click", () => {
          activeThickness = size;
          activeTool = "pen";
          updateEraserControlVisibility();
          for (const btn of sizeRow.querySelectorAll("button")) {
            btn.style.background = "rgba(241, 245, 249, 0.12)";
            btn.style.color = "#e2e8f0";
          }
          sizeButton.style.background = "#e2e8f0";
          sizeButton.style.color = "#0f172a";
        });
        sizeRow.appendChild(sizeButton);
      }

      const actionRow = document.createElement("div");
      Object.assign(actionRow.style, {
        display: "flex",
        gap: "8px",
      });

      const eraserButton = document.createElement("button");
      eraserButton.type = "button";
      eraserButton.textContent = "Eraser";
      Object.assign(eraserButton.style, {
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(241, 245, 249, 0.12)",
        color: "#e2e8f0",
        borderRadius: "999px",
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: "600",
        fontSize: "11px",
      });
      // Eraser toggles and exposes a dynamic size control when active
      let eraserSize = Math.max(12, activeThickness);
      const eraserSizeControl = document.createElement("div");
      Object.assign(eraserSizeControl.style, {
        display: "none",
        marginTop: "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      });

      const eraserSizeLabel = document.createElement("div");
      eraserSizeLabel.textContent = "Eraser size:";
      Object.assign(eraserSizeLabel.style, {
        fontSize: "11px",
        color: "#e2e8f0",
        whiteSpace: "nowrap",
      });

      const eraserRange = document.createElement("input");
      eraserRange.type = "range";
      eraserRange.min = "4";
      eraserRange.max = "64";
      eraserRange.step = "1";
      eraserRange.value = String(eraserSize);
      Object.assign(eraserRange.style, {
        width: "120px",
      });

      const eraserValue = document.createElement("div");
      eraserValue.textContent = String(eraserSize);
      Object.assign(eraserValue.style, {
        minWidth: "30px",
        textAlign: "right",
        color: "#e2e8f0",
        fontSize: "12px",
        fontWeight: "600",
      });

      eraserRange.addEventListener("input", (e) => {
        const v = Number(e.target.value) || 4;
        eraserSize = v;
        eraserValue.textContent = String(v);
        if (activeTool === "eraser") {
          activeThickness = Math.max(1, Math.min(64, v));
        }
      });

      eraserSizeControl.appendChild(eraserSizeLabel);
      eraserSizeControl.appendChild(eraserRange);
      eraserSizeControl.appendChild(eraserValue);

      function updateEraserControlVisibility() {
        if (eraserSizeControl) {
          eraserSizeControl.style.display = activeTool === "eraser" ? "flex" : "none";
        }
      }

      eraserButton.addEventListener("click", () => {
        activeTool = activeTool === "eraser" ? "pen" : "eraser";
        if (activeTool === "eraser") {
          activeThickness = Math.max(1, Math.min(64, eraserSize));
        }
        eraserButton.style.background = activeTool === "eraser" ? "#f59e0b" : "rgba(241, 245, 249, 0.12)";
        eraserButton.style.color = activeTool === "eraser" ? "#111827" : "#e2e8f0";
        updateEraserControlVisibility();
      });

      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.textContent = "Clear board";
      Object.assign(clearButton.style, {
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(241, 245, 249, 0.98)",
        color: "#0f172a",
        borderRadius: "999px",
        padding: "6px 10px",
        cursor: "pointer",
        fontWeight: "600",
      });
      clearButton.addEventListener("click", () => {
        clearBoard(true);
      });

      actionRow.appendChild(eraserButton);
      actionRow.appendChild(clearButton);

      panel.appendChild(title);
      panel.appendChild(colorRow);
      panel.appendChild(sizeRow);
      panel.appendChild(actionRow);
      // place eraser size control under the action row
      panel.appendChild(eraserSizeControl);

      if (colorButtons.length) {
        colorButtons[0].style.outline = "2px solid #f8fafc";
      }
    } else {
      panel.textContent = "Whiteboard view only";
    }

    const overlayHost = document.getElementById("app") || document.body;
    overlayHost.appendChild(panel);
    return panel;
  }

  function positionToolsPanel(panel) {
    if (!panel) return;

    const topbar = document.querySelector(".dc-room-topbar-shell");
    const bandwidthPanel = document.querySelector(".dc-bandwidth-panel");

    let blockerBottom = 72;
    if (topbar) {
      const rect = topbar.getBoundingClientRect();
      blockerBottom = Math.max(blockerBottom, Math.round(rect.bottom));
    }
    if (bandwidthPanel && !bandwidthPanel.hasAttribute("hidden")) {
      const rect = bandwidthPanel.getBoundingClientRect();
      if (rect.height > 0) {
        blockerBottom = Math.max(blockerBottom, Math.round(rect.bottom));
      }
    }

    const preferredTop = blockerBottom + 10;
    const compact = window.innerWidth <= 760;
    const estimatedHeight = compact ? Math.min(panel.offsetHeight || 180, 220) : Math.min(panel.offsetHeight || 220, 300);
    const enoughSpaceAtTop = window.innerHeight - preferredTop - 86 >= estimatedHeight;

    if (enoughSpaceAtTop) {
      panel.style.top = `${preferredTop}px`;
      panel.style.bottom = "";

      if (compact) {
        panel.style.left = "";
        panel.style.right = "12px";
        panel.style.maxWidth = "min(300px, calc(100vw - 24px))";
        panel.style.maxHeight = "min(34vh, 240px)";
      } else {
        panel.style.left = "";
        panel.style.right = "16px";
        panel.style.maxWidth = "min(320px, calc(100vw - 24px))";
        panel.style.maxHeight = "min(46vh, 360px)";
      }
    } else {
      // Short viewport fallback to keep it visible above camera controls.
      panel.style.top = "";
      panel.style.bottom = compact ? "82px" : "94px";
      panel.style.left = "";
      panel.style.right = compact ? "12px" : "16px";
      panel.style.maxWidth = compact ? "min(300px, calc(100vw - 24px))" : "min(320px, calc(100vw - 24px))";
      panel.style.maxHeight = compact ? "min(34vh, 240px)" : "min(42vh, 320px)";
    }
  }

  clearBoard(false);
  const toolsPanel = buildPanel();
  positionToolsPanel(toolsPanel);

  const onWindowResize = () => {
    positionToolsPanel(toolsPanel);
  };

  const topbar = document.querySelector(".dc-room-topbar-shell");
  const bandwidthPanel = document.querySelector(".dc-bandwidth-panel");
  const panelResizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          positionToolsPanel(toolsPanel);
        })
      : null;

  if (panelResizeObserver && topbar) {
    panelResizeObserver.observe(topbar);
  }
  if (panelResizeObserver && bandwidthPanel) {
    panelResizeObserver.observe(bandwidthPanel);
  }

  window.addEventListener("resize", onWindowResize);

  const handleLaserModeChange = (event) => {
    setLaserMode(Boolean(event?.detail?.enabled));
  };
  window.addEventListener("dc-blackboard-laser-mode", handleLaserModeChange);

  if (canWrite) {
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: true });
    renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  // If the tab is hidden while drawing, release pointer capture and stop drawing so UI buttons remain interactive
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      try {
        onPointerUp();
      } catch (e) {
        // ignore
      }
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  socket.on("blackboard-stroke", onBlackboardStroke);
  socket.on("blackboard-clear", onBlackboardClear);
  socket.on("blackboard-snapshot", onBlackboardSnapshot);

  return {
    dispose: () => {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      socket.off("blackboard-stroke", onBlackboardStroke);
      socket.off("blackboard-clear", onBlackboardClear);
      socket.off("blackboard-snapshot", onBlackboardSnapshot);

      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("dc-blackboard-laser-mode", handleLaserModeChange);
      panelResizeObserver?.disconnect();

      pendingRemoteStrokes.length = 0;
      if (flushTimer) {
        window.clearTimeout(flushTimer);
      }
      if (laserHideTimer) {
        window.clearTimeout(laserHideTimer);
      }

      if (toolsPanel?.parentElement) {
        toolsPanel.parentElement.removeChild(toolsPanel);
      }
      if (laserDot?.parentElement) {
        laserDot.parentElement.removeChild(laserDot);
      }
    },
  };
}