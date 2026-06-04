function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]|'/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "now";
  }
}

export function mountRoomToolPage(root, { role = "student", roomCode = "", onBack, onDashboard } = {}) {
  root.innerHTML = "";

  const socket = window.activeClassroomSocket || null;
  const wrap = document.createElement("div");
  wrap.className = "dc-root";
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>
    <main class="dc-discussion-shell">
      <header class="dc-discussion-topbar dc-topbar">
        <div>
          <h1 class="dc-brand">Group Discussion</h1>
          <p class="dc-muted dc-small">Room: <strong>${escapeHtml(roomCode)}</strong></p>
        </div>
        <div class="dc-topbar-actions">
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-tool-back">Back to classroom</button>
          <button type="button" class="dc-btn dc-btn-secondary" id="dc-tool-dashboard">Dashboard</button>
        </div>
      </header>

      <section class="dc-discussion-layout">
        <article class="dc-discussion-panel">
          <div class="dc-discussion-card">
            <h2>Messages</h2>
            <div class="dc-discussion-feed" id="dc-discussion-feed"></div>
            <form class="dc-discussion-form" id="dc-message-form">
              <textarea id="dc-message-input" class="dc-input dc-discussion-input" rows="3" placeholder="Write a message..."></textarea>
              <button type="submit" class="dc-btn dc-btn-primary">Send message</button>
            </form>
          </div>

          <div class="dc-discussion-card">
            <h2>Create poll</h2>
            <input id="dc-poll-question" class="dc-input dc-discussion-input" placeholder="Poll question" />
            <textarea id="dc-poll-options" class="dc-input dc-discussion-input" rows="4" placeholder="Enter each option on a new line"></textarea>
            <button type="button" class="dc-btn dc-btn-secondary" id="dc-create-poll">Create poll</button>
          </div>

          <div class="dc-discussion-card">
            <h2>Share image</h2>
            <input type="file" id="dc-image-input" accept="image/*" class="dc-input dc-discussion-input" />
            <button type="button" class="dc-btn dc-btn-secondary" id="dc-send-image">Send image</button>
          </div>
        </article>

        <aside class="dc-discussion-sidebar">
          <section class="dc-discussion-card">
            <details open class="dc-room-participants" id="dc-discussion-participants">
              <summary class="dc-room-participants-summary">Participants (<span id="dc-participants-count">0</span>)</summary>
              <ul class="dc-room-participants-list" id="dc-participants-list"></ul>
            </details>
          </section>

          <section class="dc-discussion-card">
            <h2>Polls</h2>
            <div id="dc-polls-list" class="dc-discussion-polls"></div>
          </section>
        </aside>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  const backButton = wrap.querySelector("#dc-tool-back");
  const dashboardButton = wrap.querySelector("#dc-tool-dashboard");
  const feed = wrap.querySelector("#dc-discussion-feed");
  const messageForm = wrap.querySelector("#dc-message-form");
  const messageInput = wrap.querySelector("#dc-message-input");
  const pollQuestionInput = wrap.querySelector("#dc-poll-question");
  const pollOptionsInput = wrap.querySelector("#dc-poll-options");
  const createPollButton = wrap.querySelector("#dc-create-poll");
  const imageInput = wrap.querySelector("#dc-image-input");
  const sendImageButton = wrap.querySelector("#dc-send-image");
  const participantsCount = wrap.querySelector("#dc-participants-count");
  const participantsList = wrap.querySelector("#dc-participants-list");
  const pollsList = wrap.querySelector("#dc-polls-list");

  const discussionState = {
    feed: [],
    polls: [],
  };

  const renderParticipants = (participants = []) => {
    if (participantsCount) participantsCount.textContent = String(participants.length || 0);
    if (!participantsList) return;
    participantsList.innerHTML = participants.length
      ? participants.map((participant) => `<li>${escapeHtml(participant.displayName || participant.userId || "Unknown")}</li>`).join("")
      : "<li>No participants yet</li>";
  };

  const renderPolls = () => {
    if (!pollsList) return;
    if (!discussionState.polls.length) {
      pollsList.innerHTML = '<p class="dc-muted dc-small">No polls yet.</p>';
      return;
    }

    pollsList.innerHTML = discussionState.polls.map((poll) => {
      const optionsMarkup = (poll.options || []).map((option, optionIndex) => {
        const votes = Number(option.votes || 0);
        return `
          <button type="button" class="dc-discussion-poll-option" data-poll-id="${escapeHtml(poll.id)}" data-option-index="${optionIndex}">
            <span>${escapeHtml(option.text)}</span>
            <strong>${votes}</strong>
          </button>
        `;
      }).join("");

      return `
        <article class="dc-discussion-poll">
          <h3>${escapeHtml(poll.question)}</h3>
          <p class="dc-muted dc-small">By ${escapeHtml(poll.displayName || poll.userId || "Unknown")} · ${formatTime(poll.createdAt)}</p>
          <div class="dc-discussion-poll-options">${optionsMarkup}</div>
        </article>
      `;
    }).join("");

    pollsList.querySelectorAll(".dc-discussion-poll-option").forEach((button) => {
      button.addEventListener("click", () => {
        if (!socket) return;
        socket.emit("discussion-vote", {
          pollId: button.dataset.pollId,
          optionIndex: Number(button.dataset.optionIndex),
        });
      });
    });
  };

  const renderFeed = () => {
    if (!feed) return;
    if (!discussionState.feed.length) {
      feed.innerHTML = '<p class="dc-muted dc-small">No discussion messages yet.</p>';
      return;
    }

    feed.innerHTML = discussionState.feed.map((item) => {
      if (item.type === "image") {
        return `
          <article class="dc-discussion-entry dc-discussion-entry--image">
            <div class="dc-discussion-entry-meta">${escapeHtml(item.displayName || item.userId || "Unknown")} · ${formatTime(item.createdAt)}</div>
            <div class="dc-discussion-image-wrap">
              <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "shared image")}" />
            </div>
          </article>
        `;
      }

      return `
        <article class="dc-discussion-entry">
          <div class="dc-discussion-entry-meta">${escapeHtml(item.displayName || item.userId || "Unknown")} · ${formatTime(item.createdAt)}</div>
          <p>${escapeHtml(item.text || "")}</p>
        </article>
      `;
    }).join("");
  };

  if (socket) {
    socket.emit("request-discussion-state");

    socket.on("discussion-state", ({ feed: nextFeed = [], polls: nextPolls = [] } = {}) => {
      discussionState.feed = Array.isArray(nextFeed) ? [...nextFeed] : [];
      discussionState.polls = Array.isArray(nextPolls) ? [...nextPolls] : [];
      renderFeed();
      renderPolls();
    });

    socket.on("discussion-update", (item) => {
      if (!item) return;
      discussionState.feed = Array.isArray(discussionState.feed) ? [...discussionState.feed, item] : [item];
      renderFeed();
    });

    socket.on("discussion-poll-update", (poll) => {
      if (!poll) return;
      const index = discussionState.polls.findIndex((entry) => String(entry.id) === String(poll.id));
      if (index >= 0) discussionState.polls[index] = poll;
      else discussionState.polls.unshift(poll);
      renderPolls();
    });

    socket.on("participants-state", ({ participants = [] } = {}) => {
      renderParticipants(Array.isArray(participants) ? participants : []);
    });
  } else {
    renderParticipants([]);
  }

  backButton?.addEventListener("click", () => onBack?.());
  dashboardButton?.addEventListener("click", () => onDashboard?.());

  messageForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = String(messageInput?.value || "").trim();
    if (!text || !socket) return;
    socket.emit("discussion-message", {
      text,
      displayName: localStorage.getItem("delta-user-display") || "",
    });
    messageInput.value = "";
  });

  createPollButton?.addEventListener("click", () => {
    if (!socket) return;
    const question = String(pollQuestionInput?.value || "").trim();
    const options = String(pollOptionsInput?.value || "")
      .split(/\r?\n/g)
      .map((option) => option.trim())
      .filter(Boolean);
    if (!question || options.length < 2) return;
    socket.emit("discussion-poll", {
      question,
      options,
      displayName: localStorage.getItem("delta-user-display") || "",
    });
    pollQuestionInput.value = "";
    pollOptionsInput.value = "";
  });

  sendImageButton?.addEventListener("click", () => {
    if (!socket || !imageInput?.files?.length) return;
    const file = imageInput.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:image/")) return;
      socket.emit("discussion-image", {
        name: file.name,
        dataUrl,
        displayName: localStorage.getItem("delta-user-display") || "",
      });
      imageInput.value = "";
    };
    reader.readAsDataURL(file);
  });

  renderFeed();
  renderPolls();
  renderParticipants([]);
}
