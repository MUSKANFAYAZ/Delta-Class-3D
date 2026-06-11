import { generateMeetingCode } from "./utils/meetingCode.js";
import { mountDeleteButton } from "./components/DeleteButton.js";

/**
 * Formats a timestamp into a localized date string.
 * @param {number|string} ts - The timestamp.
 * @returns {string} Formatted date.
 */
function formatDate(ts) {
  if (!ts) return "Just now";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "Just now";
  }
}

export { generateMeetingCode };

/**
 * Main function to mount the dashboard UI.
 */
export function mountDashboard(
  root,
  {
    onLoginRequested,
    onCreateRequested,
    onJoinRequested,
    onRoomSelected,
    onResolveRooms,
    api,
  },
) {
  const motivationQuotes = [
    "Small steps win.",
    "Ask, learn, repeat.",
    "Progress over perfect.",
    "Stay curious.",
    "Effort compounds.",
    "Keep showing up.",
    "You are improving.",
  ];

  root.innerHTML = "";
  const userName = localStorage.getItem("delta-user-display") || "";
  const isLoggedIn = Boolean(localStorage.getItem("delta-access-token"));
  const viewerRole = localStorage.getItem("delta-user-role") || "student";

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>

    <main class="dc-dashboard dc-dashboard--fullscreen">
      <header class="dc-topbar">
        <h1 class="dc-brand">Delta Class 3D</h1>
        <div class="dc-topbar-actions">
          <button type="button" class="dc-btn dc-btn-secondary" id="dc-create">Create classroom</button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-join">Join classroom</button>
          <div class="dc-user-wrap">
            <button type="button" class="dc-btn dc-btn-ghost dc-user-trigger" id="dc-login" aria-haspopup="menu" aria-expanded="false">
              ${isLoggedIn ? userName || "Logged in" : "Login"}
            </button>
          </div>
        </div>
      </header>

      <section class="dc-hero-banner">
        <p class="dc-hero-chip">Smart, low-bandwidth classroom launcher</p>
        <h2 class="dc-hero-heading">Create, share code, and enter from your room cards.</h2>
        <p class="dc-hero-copy">Classroom access is restricted to logged-in users only.</p>
        <p class="dc-muted dc-small" id="dc-dashboard-notice" hidden></p>
        <p class="dc-hero-quote" id="dc-hero-quote"></p>
      </section>

      <section class="dc-cards-wrap">
        <div class="dc-cards-head">
          <h2 class="dc-cards-title">Your classrooms</h2>
          <p class="dc-muted">Cards appear only after you create or join a classroom.</p>
        </div>
        <p class="dc-no-cards" id="dc-no-cards" hidden>No classrooms yet. Create or join to see cards here.</p>
        <div class="dc-cards-grid" id="dc-cards-grid"></div>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  // Background sockets for teacher dashboard notifications
  const backgroundSockets = new Map();
  async function loadSocketClientModule() {
    try {
      return await import("https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/dist/socket.io.esm.min.js");
    } catch {
      return import("socket.io-client");
    }
  }

  async function ensureRoomSocket(roomCode) {
    if (!roomCode || backgroundSockets.has(roomCode)) return;
    try {
      const { io } = await loadSocketClientModule();
      const token = localStorage.getItem("delta-access-token") || "";
      const socket = io({
        path: "/socket.io",
        transports: ["websocket", "polling"],
        auth: { role: "teacher", roomCode, token, displayName: localStorage.getItem("delta-user-display") || "" },
        query: { role: "teacher", roomCode, token },
      });

      socket.on("connect", () => {
        // connected as a background listener for this room
      });

      socket.on("pending-requests-updated", (data) => {
        try {
          const card = document.querySelector(`.dc-room-card[data-room-code="${roomCode}"]`);
          if (card) {
            const top = card.querySelector('.dc-room-card-top');
            let badge = card.querySelector('.dc-room-pending-badge');
            const count = Number(data?.requestCount || 0);
            if (count > 0) {
              if (!badge) {
                badge = document.createElement('div');
                badge.className = 'dc-room-pending-badge dc-room-card-status dc-room-card-status--pending dc-room-pending-badge';
                badge.style.cssText = 'background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 600;';
                top.appendChild(badge);
              }
              badge.textContent = `${count} request${count > 1 ? 's' : ''}`;
              showDashboardMessage(`${count} pending join request${count > 1 ? 's' : ''} for ${roomCode}`);
            } else if (badge) {
              badge.remove();
            }
          }
        } catch (e) {
          console.warn('pending-requests-updated handler error', e);
        }
      });

      socket.on("connect_error", () => {
        try { socket.disconnect(); } catch {};
      });

      backgroundSockets.set(roomCode, socket);
    } catch (err) {
      console.warn('Failed to establish background socket for room', roomCode, err);
    }
  }

  const dashboardNotice = wrap.querySelector("#dc-dashboard-notice");
  const pendingNotice = localStorage.getItem("delta-dashboard-notice") || "";
  const modalNotice = localStorage.getItem("delta-dashboard-modal") || "";
  if (dashboardNotice && pendingNotice) {
    dashboardNotice.textContent = pendingNotice;
    dashboardNotice.hidden = false;
    localStorage.removeItem("delta-dashboard-notice");
    window.setTimeout(() => {
      if (dashboardNotice.isConnected) dashboardNotice.hidden = true;
    }, 7000);
  }
  if (modalNotice) {
    localStorage.removeItem("delta-dashboard-modal");
    const backdrop = document.createElement("div");
    backdrop.className = "dc-modal-backdrop";
    backdrop.style.display = "flex";
    backdrop.innerHTML = `
      <div class="dc-modal">
        <h2>Class Ended</h2>
        <p style="margin: 1rem 0; color: var(--text-secondary);">${modalNotice}</p>
        <div class="dc-modal-actions">
          <button type="button" class="dc-btn dc-btn-primary" id="dc-class-ended-back">Go back</button>
        </div>
      </div>
    `;
    const close = () => {
      backdrop.remove();
      window.location.hash = `/dashboard?role=${viewerRole}`;
    };
    document.body.appendChild(backdrop);
    backdrop.querySelector("#dc-class-ended-back")?.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
  }

  // --- USER MENU LOGIC ---
  const loginBtn = wrap.querySelector("#dc-login");
  loginBtn.addEventListener("click", (e) => {
    if (!isLoggedIn) {
      onLoginRequested?.();
      return;
    }

    const existingMenu = wrap.querySelector(".dc-user-menu");
    if (existingMenu) {
      existingMenu.remove();
      loginBtn.setAttribute("aria-expanded", "false");
      return;
    }

    const menu = document.createElement("div");
    menu.className = "dc-user-menu";
    menu.innerHTML = `
      <button type="button" class="dc-user-menu-item" id="dc-menu-profile">View profile</button>
      <button type="button" class="dc-user-menu-item dc-user-menu-item--danger" id="dc-menu-logout">Logout</button>
    `;
    loginBtn.setAttribute("aria-expanded", "true");

    loginBtn.parentElement.appendChild(menu);

    menu.querySelector("#dc-menu-profile").onclick = () => {
      const role = localStorage.getItem("delta-user-role") || "student";
      window.location.hash = `/profile?role=${role}`;
      loginBtn.setAttribute("aria-expanded", "false");
      menu.remove();
    };

    menu.querySelector("#dc-menu-logout").onclick = () => {
      localStorage.removeItem("delta-access-token");
      localStorage.removeItem("delta-access-token-ts");
      localStorage.removeItem("delta-user-display");
      localStorage.removeItem("delta-user-role");
      localStorage.removeItem("delta-active-room");
      window.location.reload(); 
      loginBtn.setAttribute("aria-expanded", "false");
    };

    const closeHandler = (event) => {
      if (!menu.contains(event.target) && event.target !== loginBtn) {
        menu.remove();
        loginBtn.setAttribute("aria-expanded", "false");
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("click", closeHandler), 0);
  });

  /**
   * Renders classroom cards onto the grid.
   */
  function renderCards(rooms) {
    const cards = wrap.querySelector("#dc-cards-grid");
    const noCards = wrap.querySelector("#dc-no-cards");
    cards.innerHTML = "";

    if (!rooms.length) {
      noCards.hidden = false;
      return;
    }

    noCards.hidden = true;

    rooms.forEach((room) => {
      const canDelete = Boolean(room.canDelete);
      const host = Boolean(room.host || room.canDelete);
      const card = document.createElement("div");
      card.className = "dc-room-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      const participantNames = Array.isArray(room.participantNames) ? room.participantNames : [];
      const participantSummary = Number(room.participants || participantNames.length || 0);
      const participantListMarkup = participantNames.length
        ? participantNames.map((name) => `<li>${name}</li>`).join("")
        : "<li>No participant names available yet</li>";

      let extraInfo = "";
      if (room.subject || room.timing) {
        extraInfo =
          '<div style="text-align: left; margin: 8px 0; font-size: 0.9em; color: #555;">' +
          (room.subject ? "<div><strong>Sub:</strong> " + room.subject + "</div>" : "") +
          (room.timing ? "<div><strong>Time:</strong> " + room.timing + "</div>" : "") +
          "</div>";
      }
      
      // Update badge label styles to clearly prompt action
      const pendingBadge = room.pending
        ? `<div class="dc-room-card-status dc-room-card-status--pending" style="background: #fef3c7; color: #d97706; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 600;">Click to Request Entry</div>`
        : "";

      card.innerHTML = `
          <div class="dc-room-card-top">
            <span class="dc-room-badge ${host ? "dc-room-badge--teacher" : "dc-room-badge--student"}">
              ${host ? "Created - Teacher" : "Joined - Student"}
            </span>
            ${pendingBadge}
          </div>
          <h3 class="dc-room-code-lg">${room.code}</h3>
          ${extraInfo}
          <details class="dc-room-participants" ${participantSummary ? "" : "hidden"}>
            <summary class="dc-room-participants-summary">Participants (${participantSummary})</summary>
            <ul class="dc-room-participants-list">
              ${participantListMarkup}
            </ul>
          </details>
          <p class="dc-room-meta">Saved: ${formatDate(room.at)}</p>
        `;
        // Attach room code data attribute for background socket lookup
        card.dataset.roomCode = room.code;

        // --- FIX: Allow pending students to route through onRoomSelected to open connection handshake ---
      card.addEventListener("click", (e) => {
        if (e.target.closest(".btn-delete-room") || e.target.closest(".dc-room-participants")) return;
        
        if (room.pending) {
          showDashboardMessage("Sending entry request to teacher... Please wait for approval.");
        }
        
        onRoomSelected?.({
          roomCode: room.code,
          role: host ? "teacher" : "student",
        });
      });

      card.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        
        if (room.pending) {
          showDashboardMessage("Sending entry request to teacher... Please wait for approval.");
        }

        onRoomSelected?.({
          roomCode: room.code,
          role: host ? "teacher" : "student",
        });
      });

      cards.appendChild(card);

      // If teacher owns this room, ensure a background socket listens for pending requests
      if (viewerRole === "teacher" && host) {
        ensureRoomSocket(room.code).catch(() => {});
      }

      const toolWrap = document.createElement('div');
      toolWrap.style.display = 'flex';
      toolWrap.style.gap = '8px';
      toolWrap.style.marginTop = '10px';
      toolWrap.innerHTML = `
        <button type="button" class="dc-btn dc-btn-ghost dc-discussion-card-btn" title="Open discussion">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>Discussion
        </button>
        <button type="button" class="dc-btn dc-btn-ghost dc-notes-card-btn" title="Open notes">Notes</button>
      `;
      card.appendChild(toolWrap);

      toolWrap.querySelector('.dc-discussion-card-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        window.location.hash = `/group-discussion?role=${viewerRole}&code=${encodeURIComponent(room.code)}`;
      });
      toolWrap.querySelector('.dc-notes-card-btn')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        window.location.hash = `/notes?role=${viewerRole}&code=${encodeURIComponent(room.code)}`;
      });

      if (canDelete) {
        mountDeleteButton(card, {
          roomCode: room.code,
          api: api,
          onDeleteSuccess: () => {
            card.remove();
            if (!cards.childElementCount) {
              noCards.hidden = false;
              noCards.textContent = "No classrooms yet. Create or join to see cards here.";
            }
          },
        });
      }
    });
  }

  function showDashboardMessage(message) {
    if (!dashboardNotice) return;
    dashboardNotice.textContent = message;
    dashboardNotice.hidden = false;
    window.clearTimeout(showDashboardMessage._timer);
    showDashboardMessage._timer = window.setTimeout(() => {
      if (dashboardNotice.isConnected) dashboardNotice.hidden = true;
    }, 7000);
  }

  async function syncRooms() {
    if (!isLoggedIn) return;
    try {
      const rooms = typeof onResolveRooms === "function" ? await onResolveRooms() : [];
      renderCards(rooms);
      const noCards = wrap.querySelector("#dc-no-cards");
      if (noCards && !rooms.length) {
        noCards.hidden = false;
        noCards.textContent = "No classrooms yet. Create or join to see cards here.";
      }
    } catch (error) {
      console.error("Failed to sync classrooms:", error);
    }
  }

  async function initializeCards() {
    const noCards = wrap.querySelector("#dc-no-cards");
    noCards.hidden = false;
    noCards.textContent = "Loading classrooms...";

    if (!isLoggedIn) {
      renderCards([]);
      noCards.hidden = false;
      noCards.textContent = "Login to view your classrooms.";
      return;
    }

    let rooms = [];
    if (typeof onResolveRooms === "function") {
      try {
        rooms = await onResolveRooms();
      } catch {
        rooms = [];
      }
    }

    renderCards(rooms);
    if (!rooms.length) {
      noCards.textContent = "No classrooms yet. Create or join to see cards here.";
    }
  }

  // --- EVENT LISTENERS ---
  wrap.querySelector("#dc-create").addEventListener("click", () => {
    const userRole = localStorage.getItem("delta-user-role") || "student";
    if (userRole !== "teacher") {
      const existing = document.getElementById("dc-alert-modal");
      if (existing) existing.remove();

      const backdrop = document.createElement("div");
      backdrop.id = "dc-alert-modal";
      backdrop.className = "dc-modal-backdrop";
      backdrop.style.display = "flex";
      
      backdrop.innerHTML = `
        <div class="dc-modal">
          <h2>Access Denied</h2>
          <p style="margin: 1rem 0; color: var(--text-secondary);">Only teachers can create classrooms.</p>
          <div class="dc-modal-actions">
            <button type="button" class="dc-btn dc-btn-primary" id="dc-alert-ok-btn">OK</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(backdrop);
      
      const close = () => backdrop.remove();
      backdrop.querySelector("#dc-alert-ok-btn").addEventListener("click", close);
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) close();
      });
      return;
    }
    onCreateRequested?.();
  });
  wrap.querySelector("#dc-join").addEventListener("click", () => onJoinRequested?.());

  const quoteEl = wrap.querySelector("#dc-hero-quote");
  if (quoteEl) {
    let quoteIndex = Math.floor(Math.random() * motivationQuotes.length);
    quoteEl.textContent = `"${motivationQuotes[quoteIndex]}"`;

    const intervalId = window.setInterval(() => {
      if (!quoteEl.isConnected) {
        window.clearInterval(intervalId);
        return;
      }
      quoteEl.classList.add("dc-hero-quote--fade");
      window.setTimeout(() => {
        quoteIndex = (quoteIndex + 1) % motivationQuotes.length;
        quoteEl.textContent = `"${motivationQuotes[quoteIndex]}"`;
        quoteEl.classList.remove("dc-hero-quote--fade");
      }, 220);
    }, 4500);
  }

  initializeCards();

  const syncIntervalId = window.setInterval(() => {
    if (!wrap.isConnected) {
      window.clearInterval(syncIntervalId);
      return;
    }
    syncRooms();
  }, 15000);
}