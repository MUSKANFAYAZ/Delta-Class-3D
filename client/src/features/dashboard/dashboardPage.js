import { generateMeetingCode } from "./utils/meetingCode.js";
import { mountDeleteButton } from "./components/DeleteButton.js";

/**
 * Reads the list of classrooms from local storage.
 * @returns {Array} List of room objects.
 */
function readRooms() {
  try {
    const raw = localStorage.getItem("delta-my-rooms");
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function removeRoomFromStorage(roomCode) {
  const normalizedCode = String(roomCode || "").trim().toLowerCase();
  if (!normalizedCode) return;
  const rooms = readRooms();
  const nextRooms = rooms.filter(
    (room) => String(room.code || "").trim().toLowerCase() !== normalizedCode,
  );
  localStorage.setItem("delta-my-rooms", JSON.stringify(nextRooms));
}

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

  // --- USER MENU LOGIC (Dropdown for Profile/Logout) ---
  const loginBtn = wrap.querySelector("#dc-login");
  loginBtn.addEventListener("click", (e) => {
    if (!isLoggedIn) {
      onLoginRequested?.();
      return;
    }

    // Toggle Dropdown
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

    // Profile Action
    menu.querySelector("#dc-menu-profile").onclick = () => {
      const role = localStorage.getItem("delta-user-role") || "student";
      window.location.hash = `/profile?role=${role}`;
      loginBtn.setAttribute("aria-expanded", "false");
      menu.remove();
    };

    // Logout Action
    menu.querySelector("#dc-menu-logout").onclick = () => {
      localStorage.removeItem("delta-access-token");
      localStorage.removeItem("delta-user-display");
      localStorage.removeItem("delta-user-role");
      localStorage.removeItem("delta-active-room");
      window.location.reload(); 
      loginBtn.setAttribute("aria-expanded", "false");
    };

    // Close menu when clicking outside
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

      let extraInfo = "";
      if (room.subject || room.timing) {
        extraInfo =
          '<div style="text-align: left; margin: 8px 0; font-size: 0.9em; color: #555;">' +
          (room.subject ? "<div><strong>Sub:</strong> " + room.subject + "</div>" : "") +
          (room.timing ? "<div><strong>Time:</strong> " + room.timing + "</div>" : "") +
          "</div>";
      }
      card.innerHTML = `
          <div class="dc-room-card-top">
            <span class="dc-room-badge ${host ? "dc-room-badge--teacher" : "dc-room-badge--student"}">
              ${host ? "Created - Teacher" : "Joined - Student"}
            </span>
          </div>
          <h3 class="dc-room-code-lg">${room.code}</h3>
          ${extraInfo}
          <p class="dc-room-meta">Saved: ${formatDate(room.at)}</p>
        `;

      card.addEventListener("click", (e) => {
        // Prevent trigger if clicking modular components inside the card
        if (e.target.closest(".btn-delete-room")) return;
        
        onRoomSelected?.({
          roomCode: room.code,
          role: host ? "teacher" : "student",
        });
      });
      card.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onRoomSelected?.({
          roomCode: room.code,
          role: host ? "teacher" : "student",
        });
      });

      cards.appendChild(card);

      // Show delete button only for the original creator.
      if (canDelete) {
        mountDeleteButton(card, {
          roomCode: room.code,
          api: api,
          onDeleteSuccess: () => {
            removeRoomFromStorage(room.code);
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

  /**
   * Fetches room data and initiates card rendering.
   */
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
        rooms = readRooms();
      }
    } else {
      rooms = readRooms();
    }

    renderCards(rooms);
    if (!rooms.length) {
      noCards.textContent = "No classrooms yet. Create or join to see cards here.";
    }
  }

  // --- EVENT LISTENERS ---
  wrap.querySelector("#dc-create").addEventListener("click", () => onCreateRequested?.());
  wrap.querySelector("#dc-join").addEventListener("click", () => onJoinRequested?.());

  // Motivation Quote Animation
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
}