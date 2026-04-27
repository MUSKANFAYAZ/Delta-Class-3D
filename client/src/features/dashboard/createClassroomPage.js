import { generateMeetingCode } from "./utils/meetingCode.js";

export function mountCreateClassroomPage(root, { onSave, onBack }) {
  root.innerHTML = "";

  const code = generateMeetingCode();

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>
    <main class="dc-join-shell">
      <section class="dc-join-card" style="padding-top: 16px; padding-bottom: 16px;">
        <p class="dc-hero-tag">Create a new classroom</p>
        <h1 class="dc-join-title" style="margin-bottom: 4px; font-size: 26px;">Class details</h1>
        
        <div class="dc-code-output" id="dc-code-output" style="margin-top: 10px; font-size: 22px; padding: 10px;">${code}</div>
        
        <label class="dc-field-label" for="dc-room-subject">Subject</label>
        <input id="dc-room-subject" class="dc-input" placeholder="e.g., Mathematics, Physics" />

        <div class="dc-stat-grid" style="margin-bottom: 0;">
          <div>
            <label class="dc-field-label" for="dc-room-timing">Date & Time</label>
            <input id="dc-room-timing" type="datetime-local" class="dc-input" />
          </div>
          <div>
            <label class="dc-field-label" for="dc-room-capacity">Students Count</label>
            <input id="dc-room-capacity" type="number" class="dc-input" placeholder="Max students" value="25" />
          </div>
        </div>

        <label class="dc-field-label" for="dc-room-info">Other info (Optional)</label>
        <input id="dc-room-info" class="dc-input" placeholder="Notes, topics to cover, etc." />

        <p id="dc-create-status" class="dc-muted dc-small" style="min-height: 18px; margin: 4px 0;"></p>

        <div class="dc-auth-actions dc-auth-actions-row" style="margin-top: 8px;">
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-create-back">Back</button>
          <button type="button" class="dc-btn dc-btn-secondary" id="dc-code-copy">Copy code</button>
          <button type="button" class="dc-btn dc-btn-primary" id="dc-code-save">Create & Save</button>
        </div>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  const status = wrap.querySelector("#dc-create-status");

  wrap.querySelector("#dc-create-back").addEventListener("click", () => onBack?.());

  wrap.querySelector("#dc-code-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      status.textContent = "Code copied.";
    } catch {
      status.textContent = "Could not copy automatically. Please copy manually.";
    }
  });

  wrap.querySelector("#dc-code-save").addEventListener("click", async () => {
    const subject = wrap.querySelector("#dc-room-subject").value.trim();
    if (!subject) {
      status.textContent = "Please provide a subject.";
      return;
    }

    status.textContent = "Saving...";
    const payload = {
      code,
      subject,
      timing: wrap.querySelector("#dc-room-timing").value,
      capacity: parseInt(wrap.querySelector("#dc-room-capacity").value, 10) || 25,
      info: wrap.querySelector("#dc-room-info").value.trim()
    };

    try {
      await onSave?.(payload);
    } catch (e) {
      status.textContent = e?.message || "Could not save room.";
    }
  });
}
