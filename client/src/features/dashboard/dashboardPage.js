import { generateMeetingCode } from "./utils/meetingCode.js";

function readRooms() {
  try {
    const raw = localStorage.getItem("delta-my-rooms");
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function formatDate(ts) {
  if (!ts) return "Just now";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "Just now";
  }
}

export { generateMeetingCode };

export function mountDashboard(root, {
  onLoginRequested,
  onCreateRequested,
  onJoinRequested,
  onRoomSelected,
  onResolveRooms,
}) {
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
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-login">${isLoggedIn ? (userName || "Logged in") : "Login"}</button>
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
      const host = Boolean(room.host);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "dc-room-card";
      
      let extraInfo = '';
      if (room.subject || room.timing) {
        extraInfo = '<div style="text-align: left; margin: 8px 0; font-size: 0.9em; color: #555;">' +
          (room.subject ? '<div><strong>Sub:</strong> ' + room.subject + '</div>' : '') +
          (room.timing ? '<div><strong>Time:</strong> ' + room.timing + '</div>' : '') +
        '</div>';
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
      card.addEventListener("click", () => {
        onRoomSelected?.({ roomCode: room.code, role: host ? "teacher" : "student" });
      });
      cards.appendChild(card);
    });
  }

  async function initializeCards() {
    const noCards = wrap.querySelector("#dc-no-cards");
    noCards.hidden = false;
    noCards.textContent = "Loading classrooms...";

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

  wrap.querySelector("#dc-create").addEventListener("click", () => {
    onCreateRequested?.();
  });

  wrap.querySelector("#dc-join").addEventListener("click", () => {
    onJoinRequested?.();
  });

  wrap.querySelector("#dc-login").addEventListener("click", () => {
    onLoginRequested?.();
  });

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


