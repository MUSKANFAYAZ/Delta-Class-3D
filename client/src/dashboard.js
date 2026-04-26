/**
 * Delta Class 3D — dashboard shell (lightweight; no Three.js here).
 * 3D classroom + socket load only after user taps Create / Join (better on 2G).
 */

const STORAGE = {
  network: "delta-network-profile", // "2g" | "auto"
  sessionTime: "delta-session-seconds",
  attendance: "delta-attendance-percent",
  dataUsage: "delta-data-usage-mb",
  doubts: "delta-doubts-json",
  user: "delta-user-display",
  room: "delta-active-room",
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getNetworkProfile() {
  return localStorage.getItem(STORAGE.network) || "auto";
}

function setNetworkProfile(mode) {
  localStorage.setItem(STORAGE.network, mode);
}

function bumpDataUsage(mb) {
  const prev = Number(localStorage.getItem(STORAGE.dataUsage) || "0");
  localStorage.setItem(STORAGE.dataUsage, String(prev + mb));
}

function formatBytes(mb) {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  return `${mb.toFixed(2)} MB`;
}

export function mountDashboard(
  root,
  { serverUrl, defaultRole, onEnterClassroom, onClassroomFailed, onLoginRequested }
) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-drawer-backdrop" id="dc-drawer-backdrop" aria-hidden="true"></div>
    <aside class="dc-drawer" id="dc-drawer" aria-label="Menu">
      <div class="dc-drawer-head">
        <span class="dc-drawer-title">Menu</span>
        <button type="button" class="dc-icon-btn" id="dc-drawer-close" aria-label="Close menu">✕</button>
      </div>
      <nav class="dc-drawer-nav">
        <button type="button" class="dc-nav-item" data-panel="profile">View profile</button>
        <button type="button" class="dc-nav-item" data-panel="classes">My classes</button>
        <button type="button" class="dc-nav-item" data-panel="analytics">Analytics</button>
      </nav>
      <div class="dc-drawer-panels">
        <div class="dc-panel" id="dc-panel-profile" hidden>
          <h3>Profile</h3>
          <p class="dc-muted">Display name (saved on this device)</p>
          <input type="text" id="dc-profile-name" class="dc-input" maxlength="80" placeholder="Your name" />
          <button type="button" class="dc-btn dc-btn-primary" id="dc-profile-save">Save</button>
        </div>
        <div class="dc-panel" id="dc-panel-classes" hidden>
          <h3>My classes</h3>
          <ul class="dc-list" id="dc-class-list"></ul>
          <p class="dc-muted dc-small">Tip: Create or join a room from the dashboard. Rooms are stored locally for demo.</p>
        </div>
        <div class="dc-panel" id="dc-panel-analytics" hidden>
          <h3>Analytics</h3>
          <div class="dc-stat-grid">
            <div class="dc-stat">
              <span class="dc-stat-label">Attendance (demo)</span>
              <strong id="dc-stat-attendance">—</strong>
            </div>
            <div class="dc-stat">
              <span class="dc-stat-label">Time in app (min)</span>
              <strong id="dc-stat-time">—</strong>
            </div>
          </div>
          <label class="dc-field-label" for="dc-network-mode">Network mode</label>
          <select id="dc-network-mode" class="dc-input">
            <option value="auto">Auto (balanced)</option>
            <option value="2g">2G / save data</option>
          </select>
          <p class="dc-muted dc-small">2G mode loads lighter 3D settings (lower pixel ratio, no MSAA).</p>
        </div>
      </div>
    </aside>

    <div class="dc-dashboard" id="dc-dashboard">
      <header class="dc-topbar">
        <button type="button" class="dc-burger" id="dc-burger" aria-label="Open menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        <h1 class="dc-brand">Delta Class 3D</h1>
        <div class="dc-topbar-actions">
          <button type="button" class="dc-icon-btn dc-notify-btn" id="dc-notify" aria-label="Notifications" title="Notifications">
            🔔<span class="dc-badge" id="dc-notify-badge">2</span>
          </button>
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-login">Login</button>
        </div>
      </header>
      <div class="dc-notify-pop" id="dc-notify-pop" hidden>
        <p class="dc-notify-title">Updates</p>
        <ul class="dc-notify-list">
          <li>New: lighter classroom load for slow networks.</li>
          <li>Reminder: CS-301 lab tomorrow 10:00.</li>
        </ul>
      </div>

      <section class="dc-ticker-wrap" aria-label="Upcoming classes">
        <div class="dc-ticker-label">Upcoming</div>
        <div class="dc-ticker">
          <div class="dc-ticker-track" id="dc-ticker-track"></div>
        </div>
      </section>

      <section class="dc-actions">
        <button type="button" class="dc-btn dc-btn-primary dc-btn-large" id="dc-create">Create a classroom</button>
        <button type="button" class="dc-btn dc-btn-secondary dc-btn-large" id="dc-join">Join classroom</button>
      </section>

      <section class="dc-usage" aria-label="Data usage">
        <h2 class="dc-section-title">Data usage (estimate)</h2>
        <p class="dc-muted dc-small">Static bars — no extra chart library (faster on 2G).</p>
        <div class="dc-bars" id="dc-bars"></div>
      </section>
    </div>

    <div class="dc-classroom-shell" id="dc-classroom-shell" hidden>
      <div class="dc-classroom-bar">
        <button type="button" class="dc-btn dc-btn-ghost" id="dc-leave-class">← Dashboard</button>
        <span class="dc-room-pill" id="dc-room-pill"></span>
      </div>
      <main id="canvas-container" class="canvas-container"></main>
    </div>

    <button type="button" class="dc-fab-doubt" id="dc-fab-doubt" aria-label="Doubts">💬</button>

    <div class="dc-doubts-panel" id="dc-doubts-panel" hidden>
      <div class="dc-doubts-head">
        <strong>Doubt clearing</strong>
        <button type="button" class="dc-icon-btn" id="dc-doubts-close" aria-label="Close">✕</button>
      </div>
      <p class="dc-muted dc-small">Post a question (saved locally for demo).</p>
      <textarea id="dc-doubt-text" class="dc-textarea" rows="4" placeholder="Describe your doubt..."></textarea>
      <button type="button" class="dc-btn dc-btn-primary" id="dc-doubt-submit">Submit</button>
      <ul class="dc-doubt-list" id="dc-doubt-list"></ul>
    </div>
  `;

  root.appendChild(wrap);

  const drawer = wrap.querySelector("#dc-drawer");
  const backdrop = wrap.querySelector("#dc-drawer-backdrop");
  const burger = wrap.querySelector("#dc-burger");
  const drawerClose = wrap.querySelector("#dc-drawer-close");
  const dashboardEl = wrap.querySelector("#dc-dashboard");
  const classroomShell = wrap.querySelector("#dc-classroom-shell");
  const notifyBtn = wrap.querySelector("#dc-notify");
  const notifyPop = wrap.querySelector("#dc-notify-pop");
  const loginBtn = wrap.querySelector("#dc-login");
  const fabDoubt = wrap.querySelector("#dc-fab-doubt");
  const doubtsPanel = wrap.querySelector("#dc-doubts-panel");

  const upcoming = [
    { code: "CS-301", title: "Data Structures — Lab", when: "Mon 10:00" },
    { code: "MA-201", title: "Linear Algebra", when: "Tue 14:00" },
    { code: "HU-102", title: "Technical Writing", when: "Wed 09:30" },
    { code: "CS-310", title: "Operating Systems", when: "Thu 11:00" },
  ];

  const track = wrap.querySelector("#dc-ticker-track");
  upcoming.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "dc-ticker-chip";
    chip.textContent = `${c.code} · ${c.title} · ${c.when}`;
    track.appendChild(chip);
  });
  upcoming.forEach((c) => {
    const chip = document.createElement("span");
    chip.className = "dc-ticker-chip";
    chip.textContent = `${c.code} · ${c.title} · ${c.when}`;
    track.appendChild(chip);
  });

  function openDrawer(open) {
    drawer.classList.toggle("dc-drawer--open", open);
    backdrop.classList.toggle("dc-drawer-backdrop--visible", open);
    backdrop.setAttribute("aria-hidden", open ? "false" : "true");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  burger.addEventListener("click", () => openDrawer(!drawer.classList.contains("dc-drawer--open")));
  drawerClose.addEventListener("click", () => openDrawer(false));
  backdrop.addEventListener("click", () => openDrawer(false));

  function showPanel(id) {
    wrap.querySelectorAll(".dc-panel").forEach((p) => {
      p.hidden = p.id !== id;
    });
  }

  wrap.querySelectorAll(".dc-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-panel");
      if (panel === "profile") showPanel("dc-panel-profile");
      if (panel === "classes") {
        showPanel("dc-panel-classes");
        refreshClassList();
      }
      if (panel === "analytics") {
        showPanel("dc-panel-analytics");
        refreshAnalytics();
      }
    });
  });

  const profileName = wrap.querySelector("#dc-profile-name");
  profileName.value = localStorage.getItem(STORAGE.user) || "";

  wrap.querySelector("#dc-profile-save").addEventListener("click", () => {
    const v = profileName.value.trim();
    if (!v) return;
    localStorage.setItem(STORAGE.user, v);
    loginBtn.textContent = v.length > 12 ? `${v.slice(0, 12)}…` : v;
    openDrawer(false);
  });

  function refreshClassList() {
    const ul = wrap.querySelector("#dc-class-list");
    ul.innerHTML = "";
    const rooms = readJson("delta-my-rooms", []);
    if (!rooms.length) {
      ul.innerHTML = `<li class="dc-muted">No rooms yet. Create or join one.</li>`;
      return;
    }
    rooms.forEach((r) => {
      const li = document.createElement("li");
      li.textContent = `${r.host ? "Hosted" : "Joined"} · ${r.code}`;
      ul.appendChild(li);
    });
  }

  function refreshAnalytics() {
    const att = Number(localStorage.getItem(STORAGE.attendance) || "92");
    const sec = Number(localStorage.getItem(STORAGE.sessionTime) || "0");
    wrap.querySelector("#dc-stat-attendance").textContent = `${att}%`;
    wrap.querySelector("#dc-stat-time").textContent = `${Math.floor(sec / 60)}`;
    const sel = wrap.querySelector("#dc-network-mode");
    sel.value = getNetworkProfile();
    sel.onchange = () => {
      setNetworkProfile(sel.value);
    };
  }

  function refreshUsageBars() {
    const mb = {
      classroom: Number(localStorage.getItem(STORAGE.dataUsage) || "2.4"),
      socket: 0.35,
      assets: 0.8,
    };
    const max = Math.max(mb.classroom, mb.socket, mb.assets, 0.01);
    const bars = wrap.querySelector("#dc-bars");
    bars.innerHTML = "";
    [
      { k: "3D + sync (est.)", v: mb.classroom },
      { k: "Realtime (est.)", v: mb.socket },
      { k: "UI assets (est.)", v: mb.assets },
    ].forEach((row) => {
      const pct = Math.round((row.v / max) * 100);
      const rowEl = document.createElement("div");
      rowEl.className = "dc-bar-row";
      rowEl.innerHTML = `
        <div class="dc-bar-label">${row.k}<span>${formatBytes(row.v)}</span></div>
        <div class="dc-bar-track"><div class="dc-bar-fill" style="width:${pct}%"></div></div>
      `;
      bars.appendChild(rowEl);
    });
  }

  notifyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifyPop.hidden = !notifyPop.hidden;
  });
  document.addEventListener("click", () => {
    notifyPop.hidden = true;
  });
  notifyPop.addEventListener("click", (e) => e.stopPropagation());

  loginBtn.addEventListener("click", () => onLoginRequested?.());

  const roomPill = wrap.querySelector("#dc-room-pill");

  function showClassroomView() {
    dashboardEl.hidden = true;
    fabDoubt.hidden = true;
    notifyPop.hidden = true;
    classroomShell.hidden = false;
    openDrawer(false);
  }

  function showDashboardView() {
    dashboardEl.hidden = false;
    fabDoubt.hidden = false;
    classroomShell.hidden = true;
  }

  function rememberRoom(entry) {
    const list = readJson("delta-my-rooms", []);
    list.unshift(entry);
    writeJson("delta-my-rooms", list.slice(0, 20));
  }

  wrap.querySelector("#dc-create").addEventListener("click", async () => {
    const code = `ROOM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    localStorage.setItem(STORAGE.room, code);
    rememberRoom({ code, host: true, at: Date.now() });
    bumpDataUsage(0.15);
    roomPill.textContent = code;
    showClassroomView();
    try {
      await onEnterClassroom({ roomCode: code, role: defaultRole, serverUrl });
    } catch (e) {
      console.error(e);
      alert("Could not start classroom. Check server and try again.");
      showDashboardView();
      onClassroomFailed?.();
    }
  });

  wrap.querySelector("#dc-join").addEventListener("click", async () => {
    const code = window.prompt("Enter classroom code", localStorage.getItem(STORAGE.room) || "")?.trim();
    if (!code) return;
    localStorage.setItem(STORAGE.room, code);
    rememberRoom({ code, host: false, at: Date.now() });
    bumpDataUsage(0.12);
    roomPill.textContent = code;
    showClassroomView();
    try {
      await onEnterClassroom({ roomCode: code, role: defaultRole, serverUrl });
    } catch (e) {
      console.error(e);
      alert("Could not join classroom. Check code and server.");
      showDashboardView();
      onClassroomFailed?.();
    }
  });

  wrap.querySelector("#dc-leave-class").addEventListener("click", () => {
    window.location.reload();
  });

  fabDoubt.addEventListener("click", () => {
    doubtsPanel.hidden = false;
    renderDoubts();
  });
  wrap.querySelector("#dc-doubts-close").addEventListener("click", () => {
    doubtsPanel.hidden = true;
  });

  function renderDoubts() {
    const list = wrap.querySelector("#dc-doubt-list");
    const items = readJson(STORAGE.doubts, []);
    list.innerHTML = "";
    items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      list.appendChild(li);
    });
  }

  wrap.querySelector("#dc-doubt-submit").addEventListener("click", () => {
    const ta = wrap.querySelector("#dc-doubt-text");
    const text = ta.value.trim();
    if (!text) return;
    const items = readJson(STORAGE.doubts, []);
    items.unshift(text);
    writeJson(STORAGE.doubts, items.slice(0, 30));
    ta.value = "";
    renderDoubts();
  });

  /* Session timer for analytics */
  const started = Date.now();
  setInterval(() => {
    const sec = Math.floor((Date.now() - started) / 1000);
    localStorage.setItem(STORAGE.sessionTime, String(sec));
  }, 10000);

  const displayName = localStorage.getItem(STORAGE.user);
  if (displayName) loginBtn.textContent = displayName.length > 12 ? `${displayName.slice(0, 12)}…` : displayName;

  refreshUsageBars();
  setInterval(refreshUsageBars, 30000);

  return {
    showClassroomView,
    showDashboardView,
  };
}
