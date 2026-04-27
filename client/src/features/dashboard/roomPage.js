export function mountRoomPage(root, { roomCode, role, onBack }) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <main class="dc-room-shell">
      <header class="dc-room-topbar">
        <button type="button" class="dc-btn dc-btn-ghost" id="dc-room-back">Back</button>
        <div class="dc-room-meta">
          <span class="dc-room-code">Room ${roomCode}</span>
          <span class="dc-room-role">${role === "teacher" ? "Teacher" : "Student"}</span>
        </div>
      </header>
      <main id="canvas-container" class="canvas-container"></main>
    </main>
  `;

  root.appendChild(wrap);
  wrap.querySelector("#dc-room-back").addEventListener("click", () => onBack?.());
}
