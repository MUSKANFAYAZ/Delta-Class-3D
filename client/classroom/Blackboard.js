import * as THREE from "./three-cdn.js";

const BOARD_COLOR = "#f8fafc";
const DEFAULT_PEN_COLOR = "#111827";
const PEN_COLORS = ["#111827", "#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c"];
const PEN_SIZES = [3, 5, 8, 12];

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

  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;

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
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = String(connection?.effectiveType || "").toLowerCase();
  const isLowBandwidth = Boolean(lowBandwidth) || Boolean(connection?.saveData) || networkType === "slow-2g" || networkType === "2g" || networkType === "3g";
  const isStrictLowBandwidth = Boolean(strictLowBandwidth) || networkType === "slow-2g" || networkType === "2g";

  let drawing = false;
  let lastDrawnPoint = null;
  let lastSentAt = 0;
  let activeTool = "pen";
  let activeColor = DEFAULT_PEN_COLOR;
  let activeThickness = 5;
  let flushTimer = null;
  const pendingRemoteStrokes = [];

  const emitIntervalMs = isStrictLowBandwidth ? 180 : (isLowBandwidth ? 110 : 32);
  const minDistance = isStrictLowBandwidth ? 0.015 : (isLowBandwidth ? 0.008 : 0.002);

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
    texture.needsUpdate = true;
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

    drawing = true;
    lastDrawnPoint = point;
    lastSentAt = performance.now();
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!drawing || !canWrite || !lastDrawnPoint) return;

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
    const ops = Array.isArray(snapshot.ops) ? snapshot.ops : [];
    for (const op of ops) {
      applyStroke(op);
    }
  }

  function buildPanel() {
    const existing = document.getElementById("blackboard-tools-root");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "blackboard-tools-root";

    Object.assign(panel.style, {
      position: "absolute",
      right: "16px",
      top: "84px",
      zIndex: "11",
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
        colorButton.title = color;
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
      eraserButton.addEventListener("click", () => {
        activeTool = activeTool === "eraser" ? "pen" : "eraser";
        eraserButton.style.background = activeTool === "eraser" ? "#f59e0b" : "rgba(241, 245, 249, 0.12)";
        eraserButton.style.color = activeTool === "eraser" ? "#111827" : "#e2e8f0";
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

      if (colorButtons.length) {
        colorButtons[0].style.outline = "2px solid #f8fafc";
      }
    } else {
      panel.textContent = "Whiteboard view only";
    }

    container.appendChild(panel);
    return panel;
  }

  clearBoard(false);
  const toolsPanel = buildPanel();

  if (canWrite) {
    renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: true });
    renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  socket.on("blackboard-stroke", onBlackboardStroke);
  socket.on("blackboard-clear", onBlackboardClear);
  socket.on("blackboard-snapshot", onBlackboardSnapshot);

  return {
    dispose: () => {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      socket.off("blackboard-stroke", onBlackboardStroke);
      socket.off("blackboard-clear", onBlackboardClear);
      socket.off("blackboard-snapshot", onBlackboardSnapshot);

      pendingRemoteStrokes.length = 0;
      if (flushTimer) {
        window.clearTimeout(flushTimer);
      }

      if (toolsPanel?.parentElement) {
        toolsPanel.parentElement.removeChild(toolsPanel);
      }
    },
  };
}