export function mountRoomToolPage(root, { role = "student", roomCode = "", onBack, onDashboard } = {}) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>
    <main class="dc-tool-shell">
      <section class="dc-tool-card">
        <p class="dc-hero-tag">Classroom tool</p>
        <h1 class="dc-tool-title">Notes Sharing</h1>
        <p class="dc-muted">Room: <strong>${roomCode}</strong></p>
        <p class="dc-tool-copy">${role === "teacher" ? "Teacher notes workspace." : "Student notes workspace."} Share lesson notes and references here without leaving the classroom context.</p>
        <div class="dc-tool-placeholder">Notes panel can be expanded here later.</div>
        <div class="dc-auth-actions dc-auth-actions-row">
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-tool-back">Back to classroom</button>
          <button type="button" class="dc-btn dc-btn-secondary" id="dc-tool-dashboard">Dashboard</button>
        </div>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  wrap.querySelector("#dc-tool-back")?.addEventListener("click", () => onBack?.());
  wrap.querySelector("#dc-tool-dashboard")?.addEventListener("click", () => onDashboard?.());
}
