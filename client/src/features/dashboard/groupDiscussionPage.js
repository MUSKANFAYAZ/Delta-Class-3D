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

export function mountRoomToolPage(root, { role = "student", roomCode = "", api, onBack, onDashboard } = {}) {
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
            <div id="dc-poll-options-wrap" class="dc-discussion-poll-options-wrap" aria-live="polite"></div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button type="button" class="dc-btn dc-btn-ghost" id="dc-add-poll-option">Add option</button>
            </div>
            <button type="button" class="dc-btn dc-btn-secondary" id="dc-create-poll">Create poll</button>
          </div>

          <div class="dc-discussion-card">
            <h2>Share image</h2>
            <input type="file" id="dc-image-input" accept="image/*" class="dc-input dc-discussion-input" />
            <div id="dc-image-preview" class="dc-discussion-image-preview" aria-live="polite" style="margin-top:8px;"></div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button type="button" class="dc-btn dc-btn-secondary" id="dc-send-image">Send image</button>
              <button type="button" class="dc-btn dc-btn-ghost" id="dc-remove-image">Remove image</button>
            </div>
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
  const pollOptionsWrap = wrap.querySelector("#dc-poll-options-wrap");
  const addPollOptionButton = wrap.querySelector("#dc-add-poll-option");
  const createPollButton = wrap.querySelector("#dc-create-poll");
  const imageInput = wrap.querySelector("#dc-image-input");
  const sendImageButton = wrap.querySelector("#dc-send-image");
  const removeImageButton = wrap.querySelector("#dc-remove-image");
  const imagePreviewWrap = wrap.querySelector("#dc-image-preview");

  // Poll option helpers
  const minPollOptions = 2;
  function renumberOptions() {
    const rows = Array.from(pollOptionsWrap.querySelectorAll(".dc-poll-option-row"));
    rows.forEach((row, i) => {
      const idx = i + 1;
      const label = row.querySelector("label");
      const input = row.querySelector("input.dc-poll-option-input");
      if (label) label.textContent = `Option ${idx}`;
      if (input) input.placeholder = `Option ${idx}`;
      const removeBtn = row.querySelector("button.dc-poll-option-remove");
      if (removeBtn) removeBtn.disabled = rows.length <= minPollOptions;
    });
  }

  function createOptionRow(value = "") {
    const index = pollOptionsWrap.querySelectorAll(".dc-poll-option-row").length + 1;
    const row = document.createElement("div");
    row.className = "dc-poll-option-row";
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";

    const label = document.createElement("label");
    label.style.minWidth = "72px";
    label.textContent = `Option ${index}`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "dc-input dc-poll-option-input";
    input.placeholder = `Option ${index}`;
    input.value = value || "";
    input.style.flex = "1";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "dc-btn dc-btn-icon dc-poll-option-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Remove option";

    removeBtn.addEventListener("click", () => {
      const rows = Array.from(pollOptionsWrap.querySelectorAll(".dc-poll-option-row"));
      if (rows.length <= minPollOptions) return;
      row.remove();
      renumberOptions();
    });

    input.addEventListener("input", () => {
      // auto-add a new empty option when typing into the last input
      const rows = Array.from(pollOptionsWrap.querySelectorAll(".dc-poll-option-input"));
      const last = rows[rows.length - 1];
      if (last === input && input.value.trim() !== "") {
        addPollOption();
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  function addPollOption(value = "") {
    if (!pollOptionsWrap) return;
    const row = createOptionRow(value);
    pollOptionsWrap.appendChild(row);
    renumberOptions();
    return row;
  }

  function getPollOptionsValues() {
    if (!pollOptionsWrap) return [];
    return Array.from(pollOptionsWrap.querySelectorAll("input.dc-poll-option-input"))
      .map((i) => String(i.value || "").trim())
      .filter(Boolean);
  }

  // initialize with two option rows
  if (pollOptionsWrap && !pollOptionsWrap.querySelectorAll(".dc-poll-option-row").length) {
    addPollOption("");
    addPollOption("");
  }

  addPollOptionButton?.addEventListener("click", () => addPollOption(""));
  const participantsCount = wrap.querySelector("#dc-participants-count");
  const participantsList = wrap.querySelector("#dc-participants-list");
  const pollsList = wrap.querySelector("#dc-polls-list");

  const discussionState = {
    feed: [],
    polls: [],
  };

  const getCurrentUserId = () => {
    try {
      const token = localStorage.getItem("delta-access-token") || "";
      const payload = token.split(".")[1];
      if (!payload) return null;
      const decoded = JSON.parse(decodeURIComponent(escape(window.atob(payload.replace(/-/g, "+").replace(/_/g, "/")))));
      return decoded?.sub || null;
    } catch {
      return null;
    }
  };

  const currentUserId = getCurrentUserId();
  const discussionApi = api
    ? (path, options = {}) => api(`/classrooms/${encodeURIComponent(roomCode)}${path}`, options)
    : null;

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
          ${((currentUserId && String(poll.userId) === String(currentUserId)) || role === "teacher") ? `<div class="dc-discussion-poll-actions"><button type="button" class="dc-btn dc-btn-ghost dc-discussion-poll-delete" data-poll-id="${escapeHtml(poll.id)}">Delete</button></div>` : ''}
        </article>
      `;
    }).join("");

    pollsList.querySelectorAll(".dc-discussion-poll-option").forEach((button) => {
      button.addEventListener("click", async () => {
        const pollId = button.dataset.pollId;
        const optionIndex = Number(button.dataset.optionIndex);
        if (!pollId || Number.isNaN(optionIndex)) return;

        if (socket) {
          socket.emit("discussion-vote", { pollId, optionIndex });
          return;
        }

        if (discussionApi) {
          try {
            const response = await discussionApi(`/discussion/poll/${encodeURIComponent(pollId)}/vote`, {
              method: "POST",
              body: { optionIndex },
            });
            if (response?.ok && response.poll) {
              const index = discussionState.polls.findIndex((entry) => String(entry.id) === String(response.poll.id));
              if (index >= 0) discussionState.polls[index] = response.poll;
              else discussionState.polls.unshift(response.poll);
              renderPolls();
            }
          } catch (err) {
            console.error("Could not submit poll vote", err);
          }
        }
      });
    });

    pollsList.querySelectorAll(".dc-discussion-poll-delete").forEach((button) => {
      button.addEventListener("click", async () => {
        const pollId = button.dataset.pollId;
        if (!pollId) return;

        try {
          if (socket) {
            socket.emit("discussion-poll-delete", { pollId });
            return;
          }

          if (!discussionApi) return;
          const response = await discussionApi(`/discussion/poll/${encodeURIComponent(pollId)}`, { method: "DELETE" });
          if (response?.ok) {
            discussionState.polls = discussionState.polls.filter((p) => String(p.id) !== String(pollId));
            renderPolls();
          }
        } catch (err) {
          console.error("Could not delete poll", err);
        }
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
      const isOwnMessage = currentUserId && String(item.userId) === String(currentUserId);
      const deleteButton = isOwnMessage
        ? `<button type="button" class="dc-discussion-delete" data-message-id="${escapeHtml(item.id)}">Delete</button>`
        : "";

      if (item.type === "image") {
        return `
          <article class="dc-discussion-entry dc-discussion-entry--image">
            <div class="dc-discussion-entry-meta">${escapeHtml(item.displayName || item.userId || "Unknown")} · ${formatTime(item.createdAt)}</div>
            <div class="dc-discussion-image-wrap">
              <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || "shared image")}" />
            </div>
            ${deleteButton}
          </article>
        `;
      }

      return `
        <article class="dc-discussion-entry">
          <div class="dc-discussion-entry-meta">${escapeHtml(item.displayName || item.userId || "Unknown")} · ${formatTime(item.createdAt)}</div>
          <p>${escapeHtml(item.text || "")}</p>
          ${deleteButton}
        </article>
      `;
    }).join("");

    if (feed) {
      feed.querySelectorAll(".dc-discussion-delete").forEach((button) => {
        button.addEventListener("click", async () => {
          const messageId = button.dataset.messageId;
          if (!messageId) return;
          try {
            if (socket) {
              const response = await discussionApi?.(`/discussion/message/${encodeURIComponent(messageId)}`, { method: "DELETE" });
              if (response?.ok) {
                discussionState.feed = discussionState.feed.filter((item) => String(item.id) !== messageId);
                renderFeed();
              }
            } else if (discussionApi) {
              const response = await discussionApi(`/discussion/message/${encodeURIComponent(messageId)}`, { method: "DELETE" });
              if (response?.ok) {
                discussionState.feed = discussionState.feed.filter((item) => String(item.id) !== messageId);
                renderFeed();
              }
            }
          } catch (err) {
            console.error("Could not delete message", err);
          }
        });
      });
    }
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

    socket.on("discussion-poll-delete", ({ id } = {}) => {
      if (!id) return;
      discussionState.polls = discussionState.polls.filter((p) => String(p.id) !== String(id));
      renderPolls();
    });

    socket.on("discussion-delete", ({ id } = {}) => {
      if (!id) return;
      discussionState.feed = discussionState.feed.filter((item) => String(item.id) !== String(id));
      renderFeed();
    });

    socket.on("participants-state", ({ participants = [] } = {}) => {
      renderParticipants(Array.isArray(participants) ? participants : []);
    });
  } else {
    renderParticipants([]);
    if (discussionApi) {
      discussionApi("/discussion")
        .then((response) => {
          if (!response?.ok) return;
          discussionState.feed = Array.isArray(response.feed) ? [...response.feed] : [];
          discussionState.polls = Array.isArray(response.polls) ? [...response.polls] : [];
          renderFeed();
          renderPolls();
        })
        .catch((error) => {
          console.error("Could not load discussion state", error);
        });
    }
  }

  backButton?.addEventListener("click", () => onBack?.());
  dashboardButton?.addEventListener("click", () => onDashboard?.());

  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = String(messageInput?.value || "").trim();
    if (!text) return;

    if (socket) {
      socket.emit("discussion-message", {
        text,
        displayName: localStorage.getItem("delta-user-display") || "",
      });
      messageInput.value = "";
      return;
    }

    if (!discussionApi) return;
    try {
      const response = await discussionApi("/discussion/message", {
        method: "POST",
        body: { text },
      });
      if (response?.ok && response.item) {
        discussionState.feed = Array.isArray(discussionState.feed) ? [...discussionState.feed, response.item] : [response.item];
        renderFeed();
      }
    } catch (err) {
      console.error("Could not send message", err);
    }
    messageInput.value = "";
  });

  createPollButton?.addEventListener("click", async () => {
    const question = String(pollQuestionInput?.value || "").trim();
    const options = getPollOptionsValues();
    if (!question || options.length < 2) return;

    if (socket) {
      socket.emit("discussion-poll", {
        question,
        options,
        displayName: localStorage.getItem("delta-user-display") || "",
      });
      pollQuestionInput.value = "";
      // reset options to two blank inputs
      if (pollOptionsWrap) {
        pollOptionsWrap.innerHTML = "";
        addPollOption("");
        addPollOption("");
      }
      return;
    }

    if (!discussionApi) return;
    try {
      const response = await discussionApi("/discussion/poll", {
        method: "POST",
        body: { question, options },
      });
      if (response?.ok && response.poll) {
        discussionState.polls = [response.poll, ...discussionState.polls];
        renderPolls();
      }
    } catch (err) {
      console.error("Could not post poll", err);
    }
    pollQuestionInput.value = "";
    if (pollOptionsWrap) {
      pollOptionsWrap.innerHTML = "";
      addPollOption("");
      addPollOption("");
    }
  });

  sendImageButton?.addEventListener("click", () => {
    if (!imageInput?.files?.length) return;
    const file = imageInput.files[0];
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:image/")) return;
      if (socket) {
        socket.emit("discussion-image", {
          name: file.name,
          dataUrl,
          displayName: localStorage.getItem("delta-user-display") || "",
        });
      } else if (discussionApi) {
        try {
          const response = await discussionApi("/discussion/image", {
            method: "POST",
            body: { name: file.name, dataUrl },
          });
          if (response?.ok && response.item) {
            discussionState.feed = Array.isArray(discussionState.feed) ? [...discussionState.feed, response.item] : [response.item];
            renderFeed();
          }
        } catch (error) {
          console.error("Could not send image", error);
        }
      }
      imageInput.value = "";
    };
    reader.readAsDataURL(file);
  });
  // image preview and remove handlers
  function clearImagePreview() {
    if (imagePreviewWrap) imagePreviewWrap.innerHTML = "";
    if (imageInput) imageInput.value = "";
  }

  imageInput?.addEventListener("change", () => {
    if (!imageInput?.files?.length) {
      clearImagePreview();
      return;
    }
    const file = imageInput.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl.startsWith("data:image/")) return;
      if (!imagePreviewWrap) return;
      imagePreviewWrap.innerHTML = `
        <div class="dc-discussion-image-wrap" style="position:relative">
          <img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(file.name || "shared image")}" />
          <button type="button" class="dc-btn dc-btn-icon dc-remove-preview" aria-label="Remove image" style="position:absolute;top:8px;right:8px">×</button>
        </div>
      `;
      const btn = imagePreviewWrap.querySelector(".dc-remove-preview");
      if (btn) btn.addEventListener("click", clearImagePreview);
    };
    reader.readAsDataURL(file);
  });

  removeImageButton?.addEventListener("click", () => clearImagePreview());

  // Store listeners for cleanup
  const discussionListeners = [];

  if (socket) {
    // Register listeners for cleanup
    discussionListeners.push({ event: "discussion-state", fn: arguments.callee });
    discussionListeners.push({ event: "discussion-update", fn: arguments.callee });
    discussionListeners.push({ event: "discussion-poll-update", fn: arguments.callee });
    discussionListeners.push({ event: "discussion-poll-delete", fn: arguments.callee });
    discussionListeners.push({ event: "discussion-delete", fn: arguments.callee });
    discussionListeners.push({ event: "participants-state", fn: arguments.callee });
  }

  // Cleanup function to remove all listeners when leaving page
  const cleanupDiscussionListeners = () => {
    if (socket) {
      socket.off("discussion-state");
      socket.off("discussion-update");
      socket.off("discussion-poll-update");
      socket.off("discussion-poll-delete");
      socket.off("discussion-delete");
      socket.off("participants-state");
    }
  };

  // Store cleanup function on window for access from main.js
  window.currentDiscussionCleanup = cleanupDiscussionListeners;

  // Handle back button - cleanup listeners before navigating
  const originalBackHandler = backButton?.onclick;
  backButton?.addEventListener("click", (e) => {
    cleanupDiscussionListeners();
  });

  // Handle dashboard button - cleanup listeners before navigating
  dashboardButton?.addEventListener("click", (e) => {
    cleanupDiscussionListeners();
  });

  renderFeed();
  renderPolls();
  renderParticipants([]);
}
