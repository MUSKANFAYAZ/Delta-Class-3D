function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined) node.setAttribute(key, String(value));
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child === null || child === undefined) return;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  });
  return node;
}

function formatValue(value, fallback = "Not set") {
  const text = String(value || "").trim();
  return text || fallback;
}

function makeStat(label, value) {
  return el("div", { class: "dc-profile-stat" }, [
    el("span", { class: "dc-profile-stat-label", text: label }),
    el("strong", { class: "dc-profile-stat-value", text: value }),
  ]);
}

export async function mountProfilePage(
  root,
  {
    api,
    role = "student",
    onBack,
    onCreateRequested,
    onJoinRequested,
    onLogout,
  } = {},
) {
  if (!root) throw new Error("Missing app root element");

  root.innerHTML = "";
  const currentRole = role === "teacher" ? "teacher" : "student";

  const shell = el("div", { class: "dc-root" }, [
    el("div", { class: "dc-grid-bg", "aria-hidden": "true" }),
    el("main", { class: "dc-dashboard dc-dashboard--fullscreen dc-profile-page" }, [
      el("header", { class: "dc-topbar" }, [
        el("h1", { class: "dc-brand dc-profile-brand", text: `${currentRole === "teacher" ? "Teacher" : "Student"} Profile` }),
        el("div", { class: "dc-topbar-actions" }, [
          el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back", onclick: () => onBack?.() }),
          el("button", {
            type: "button",
            class: "dc-btn dc-btn-secondary",
            text: currentRole === "teacher" ? "Create classroom" : "Join classroom",
            onclick: () => {
              if (currentRole === "teacher") onCreateRequested?.();
              else onJoinRequested?.();
            },
          }),
          el("button", {
            type: "button",
            class: "dc-btn dc-btn-ghost dc-profile-logout",
            text: "Logout",
            onclick: () => onLogout?.(),
          }),
        ]),
      ]),
      el("section", { class: "dc-profile-card" }, [
        el("div", { class: "dc-profile-hero" }, [
          el("p", { class: "dc-hero-chip", text: `${currentRole === "teacher" ? "Teacher" : "Student"} account` }),
          el("h2", { class: "dc-profile-title", text: "Your account details" }),
          el("p", { class: "dc-profile-copy", text: "View the account that is linked to this login and jump to the right classroom action for your role." }),
        ]),
        el("div", { class: "dc-profile-content" }, [
          el("div", { class: "dc-profile-loading", text: "Loading profile..." }),
        ]),
      ]),
    ]),
  ]);

  root.appendChild(shell);

  const content = shell.querySelector(".dc-profile-content");
  const loading = shell.querySelector(".dc-profile-loading");

  try {
    const data = await api("/me");
    const user = data?.user || {};
    const resolvedRole = user.role === "teacher" ? "teacher" : user.role === "student" ? "student" : currentRole;
    const isTeacher = resolvedRole === "teacher";

    loading?.remove();
    content.innerHTML = "";

    const quickActionText = isTeacher ? "Create classroom" : "Join classroom";
    const quickActionHandler = isTeacher ? onCreateRequested : onJoinRequested;

    content.appendChild(
      el("div", { class: "dc-profile-grid" }, [
        el("section", { class: "dc-profile-panel dc-profile-panel--primary" }, [
          el("div", { class: "dc-profile-badge-row" }, [
            el("span", { class: `dc-room-badge ${isTeacher ? "dc-room-badge--teacher" : "dc-room-badge--student"}`, text: resolvedRole === "teacher" ? "Teacher" : "Student" }),
            el("span", { class: "dc-profile-subtle", text: isTeacher ? "Can create and manage classrooms" : "Can join classrooms and attend sessions" }),
          ]),
          el("div", { class: "dc-profile-name", text: formatValue(user.name, "Unnamed account") }),
          el("p", { class: "dc-profile-role-copy", text: isTeacher ? "Teacher dashboard access is ready for classroom creation." : "Student dashboard access is ready for joining class sessions." }),
          el("div", { class: "dc-profile-stat-grid" }, [
            makeStat("Phone", formatValue(user.phone)),
            makeStat("User ID", formatValue(user.userId)),
            makeStat("Role", resolvedRole === "teacher" ? "Teacher" : "Student"),
            makeStat("Class", isTeacher ? "Not required" : formatValue(user.studentClass)),
          ]),
        ]),
        el("aside", { class: "dc-profile-panel dc-profile-panel--secondary" }, [
          el("h3", { class: "dc-profile-side-title", text: "Next step" }),
          el("p", { class: "dc-profile-side-copy", text: isTeacher ? "Start a new room when you are ready to teach." : "Join your classroom when your teacher shares the code." }),
          el("div", { class: "dc-profile-actions" }, [
            el("button", {
              type: "button",
              class: "dc-btn dc-btn-primary dc-btn-large",
              text: quickActionText,
              onclick: () => quickActionHandler?.(),
            }),
            el("button", {
              type: "button",
              class: "dc-btn dc-btn-ghost dc-btn-large",
              text: "Back to dashboard",
              onclick: () => onBack?.(),
            }),
          ]),
          el("div", { class: "dc-profile-note" }, [
            el("strong", { text: "Signed in as: " }),
            el("span", { text: `${formatValue(user.name)} (${resolvedRole})` }),
          ]),
        ]),
      ]),
    );
  } catch (error) {
    loading?.remove();
    content.innerHTML = "";

    const message = String(error?.message || "Unable to load profile.");
    content.appendChild(
      el("div", { class: "dc-profile-error" }, [
        el("h3", { class: "dc-profile-side-title", text: "Profile unavailable" }),
        el("p", { class: "dc-profile-side-copy", text: message }),
        el("div", { class: "dc-profile-actions" }, [
          el("button", { type: "button", class: "dc-btn dc-btn-primary", text: "Login again", onclick: () => onLogout?.() }),
          el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back", onclick: () => onBack?.() }),
        ]),
      ]),
    );
  }
}
