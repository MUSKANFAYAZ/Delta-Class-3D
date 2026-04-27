function normalizeCode(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-");
}

export function mountJoinClassroomPage(root, { onSubmit, onBack, defaultCode = "" }) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>
    <main class="dc-join-shell">
      <section class="dc-join-card">
        <p class="dc-hero-tag">Join an existing room</p>
        <h1 class="dc-join-title">Enter classroom code</h1>
        <p class="dc-muted">Use code format like <strong>abc-defg-hij</strong>.</p>

        <label class="dc-field-label" for="dc-join-code">Classroom code</label>
        <input id="dc-join-code" class="dc-input dc-code-input" placeholder="abc-defg-hij" value="${defaultCode}" />

        <p id="dc-join-status" class="dc-muted dc-small"></p>

        <div class="dc-auth-actions dc-auth-actions-row">
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-join-back">Back</button>
          <button type="button" class="dc-btn dc-btn-primary" id="dc-join-enter">Enter classroom</button>
        </div>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  const input = wrap.querySelector("#dc-join-code");
  const status = wrap.querySelector("#dc-join-status");
  const enter = wrap.querySelector("#dc-join-enter");

  const submit = async () => {
    const code = normalizeCode(input.value);
    if (!code || code.length < 9) {
      status.textContent = "Please enter a valid code.";
      return;
    }

    status.textContent = "Checking room...";
    enter.disabled = true;

    try {
      const result = await onSubmit?.(code);
      if (result?.ok === false) {
        status.textContent = result.message || "Code is invalid or room does not exist.";
      }
    } catch (e) {
      status.textContent = e?.message || "Could not verify room code.";
    } finally {
      enter.disabled = false;
    }
  };

  wrap.querySelector("#dc-join-back").addEventListener("click", () => onBack?.());
  enter.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
}
