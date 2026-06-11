export function showConfirmDialog(title, message) {
  return new Promise((resolve) => {
    // Remove any existing confirm modal
    const existing = document.getElementById("dc-confirm-modal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "dc-confirm-modal";
    backdrop.className = "dc-modal-backdrop";
    backdrop.style.display = "flex";
    
    backdrop.innerHTML = `
      <div class="dc-modal">
        <h2>${title}</h2>
        <p class="dc-exit-warning" style="margin: 1rem 0; color: var(--text-secondary);">${message}</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-primary" id="dc-confirm-btn">Confirm</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-cancel-btn">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
    
    const confirmBtn = backdrop.querySelector("#dc-confirm-btn");
    const cancelBtn = backdrop.querySelector("#dc-cancel-btn");
    
    const cleanup = () => {
      backdrop.remove();
    };
    
    confirmBtn.addEventListener("click", () => {
      cleanup();
      resolve(true);
    });
    
    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve(false);
    });
    
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve(false);
      }
    });
  });
}

export function showAlertDialog(title, message) {
  return new Promise((resolve) => {
    // Remove any existing confirm modal
    const existing = document.getElementById("dc-alert-modal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "dc-alert-modal";
    backdrop.className = "dc-modal-backdrop";
    backdrop.style.display = "flex";
    
    backdrop.innerHTML = `
      <div class="dc-modal">
        <h2>${title}</h2>
        <p class="dc-exit-warning" style="margin: 1rem 0; color: var(--text-secondary);">${message}</p>
        <div class="dc-modal-actions" style="justify-content: center;">
          <button type="button" class="dc-btn dc-btn-primary" id="dc-ok-btn">OK</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(backdrop);
    
    const okBtn = backdrop.querySelector("#dc-ok-btn");
    
    const cleanup = () => {
      backdrop.remove();
    };
    
    okBtn.addEventListener("click", () => {
      cleanup();
      resolve(true);
    });
    
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve(true);
      }
    });
  });
}

export function showApproveDenyDialog(title, message) {
  return new Promise((resolve) => {
    const existing = document.getElementById("dc-approve-deny-modal");
    if (existing) existing.remove();

    const backdrop = document.createElement("div");
    backdrop.id = "dc-approve-deny-modal";
    backdrop.className = "dc-modal-backdrop";
    backdrop.style.display = "flex";

    backdrop.innerHTML = `
      <div class="dc-modal">
        <h2>${title}</h2>
        <p class="dc-exit-warning" style="margin: 1rem 0; color: var(--text-secondary);">${message}</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-primary" id="dc-approve-btn">Allow</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-deny-btn">Deny</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const approveBtn = backdrop.querySelector("#dc-approve-btn");
    const denyBtn = backdrop.querySelector("#dc-deny-btn");

    const cleanup = () => {
      backdrop.remove();
    };

    approveBtn.addEventListener("click", () => {
      cleanup();
      resolve("approve");
    });

    denyBtn.addEventListener("click", () => {
      cleanup();
      resolve("deny");
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        cleanup();
        resolve("cancel");
      }
    });
  });
}
