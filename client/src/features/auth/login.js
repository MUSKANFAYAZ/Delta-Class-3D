import { resetFirebaseOtpFlow, sendFirebaseOtp, verifyFirebaseOtp } from "./firebase.js";

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined) node.setAttribute(k, String(v));
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

function normalizePhone(raw) {
  return String(raw || "").replace(/\s+/g, "");
}

function isValidPhoneWithCode(phone) {
  return /^\+\d{1,3}\d{10}$/.test(phone);
}

export function mountLogin(root, { api, onDone, onGoRegister, role = "", mode = "", onChoose }) {
  root.innerHTML = "";

  let currentRole = role === "teacher" ? "teacher" : role === "student" ? "student" : "";

  const status = el("p", { class: "dc-muted dc-small", text: "" });
  const phone = el("input", { class: "dc-input", placeholder: "Phone number", inputmode: "tel", autocomplete: "tel" });
  const password = el("input", {
    class: "dc-input",
    type: "password",
    placeholder: "Password (min 6 chars)",
    autocomplete: "current-password",
  });
  const otp = el("input", { class: "dc-input dc-input-otp", placeholder: "OTP", inputmode: "numeric" });
  const newPassword = el("input", { class: "dc-input", type: "password", placeholder: "New password", autocomplete: "new-password" });
  const confirmPassword = el("input", {
    class: "dc-input",
    type: "password",
    placeholder: "Confirm new password",
    autocomplete: "new-password",
  });

  let view = mode ? "login" : "choose";
  let firebaseIdToken = "";

  async function loginWithPassword() {
    status.textContent = "";
    const p = normalizePhone(phone.value);
    const pw = String(password.value || "");
    if (!currentRole) {
      status.textContent = "Please choose role first.";
      return;
    }
    if (!isValidPhoneWithCode(p)) {
      status.textContent = "Enter phone with country code (example: +911234567890).";
      return;
    }
    if (pw.length < 6) {
      status.textContent = "Password must be at least 6 characters.";
      return;
    }
    try {
      const data = await api("/login", { method: "POST", body: { phone: p, password: pw, role: currentRole } });
      if (data?.token) localStorage.setItem("delta-access-token", data.token);
      if (data?.user?.name) localStorage.setItem("delta-user-display", data.user.name);
      onDone?.();
    } catch (e) {
      status.textContent = e?.message || "Login failed.";
    }
  }

  async function requestResetOtp() {
    status.textContent = "";
    const p = normalizePhone(phone.value);
    if (!isValidPhoneWithCode(p)) {
      status.textContent = "Enter phone with country code (example: +911234567890).";
      return;
    }
    try {
      await sendFirebaseOtp(api, p, "login");
      status.textContent = "OTP sent for password reset.";
    } catch (e) {
      status.textContent = e?.message || "Could not send OTP.";
    }
  }

  async function verifyResetOtp() {
    status.textContent = "";
    const p = normalizePhone(phone.value);
    const code = String(otp.value || "").trim();
    if (!p || !code) {
      status.textContent = "Enter phone and OTP.";
      return;
    }
    try {
      const { otpToken } = await verifyFirebaseOtp(api, p, code, "login");
      firebaseIdToken = otpToken;
      status.textContent = "OTP verified. Set new password.";
    } catch (e) {
      firebaseIdToken = "";
      status.textContent = e?.message || "OTP verification failed.";
    }
  }

  async function resetPassword() {
    status.textContent = "";
    const p = normalizePhone(phone.value);
    const pw = String(newPassword.value || "");
    const cpw = String(confirmPassword.value || "");
    if (!p || !pw || !cpw) {
      status.textContent = "Fill phone and new password.";
      return;
    }
    if (pw !== cpw) {
      status.textContent = "Passwords do not match.";
      return;
    }
    if (!firebaseIdToken) {
      status.textContent = "Verify OTP first.";
      return;
    }
    try {
      await api("/reset-password", {
        method: "POST",
        body: { phone: p, newPassword: pw, otpToken: firebaseIdToken },
      });
      firebaseIdToken = "";
      resetFirebaseOtpFlow();
      status.textContent = "Password updated. Please login.";
      password.value = "";
      view = "login";
      renderBody();
    } catch (e) {
      status.textContent = e?.message || "Reset failed.";
    }
  }

  function renderChooser() {
    return el("div", { class: "dc-auth-body" }, [
      el("h2", { class: "dc-login-title", text: "Continue as" }),
      el("p", { class: "dc-muted dc-small", text: "Choose role + action." }),
      el("div", { class: "dc-actions" }, [
        el("button", {
          type: "button",
          class: "dc-btn dc-btn-primary dc-btn-large",
          text: "Teacher",
          onclick: () => {
            currentRole = "teacher";
            onChoose?.({ nextMode: "login", nextRole: "teacher" });
          },
        }),
        el("button", {
          type: "button",
          class: "dc-btn dc-btn-secondary dc-btn-large",
          text: "Student",
          onclick: () => {
            currentRole = "student";
            onChoose?.({ nextMode: "login", nextRole: "student" });
          },
        }),
      ]),
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back", onclick: () => onDone?.() }),
      ]),
    ]);
  }

  function renderLoginBody() {
    return el("div", { class: "dc-auth-body" }, [
      el("h2", { class: "dc-login-title", text: `${currentRole === "teacher" ? "Teacher" : "Student"} Login` }),
      el("p", { class: "dc-muted dc-small", text: "Phone + password login." }),
      el("label", { class: "dc-field-label", text: "Role" }),
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", {
          type: "button",
          class: `dc-btn ${currentRole === "teacher" ? "dc-btn-primary" : "dc-btn-ghost"}`,
          text: "Teacher",
          onclick: () => {
            currentRole = "teacher";
            renderBody();
          },
        }),
        el("button", {
          type: "button",
          class: `dc-btn ${currentRole === "student" ? "dc-btn-primary" : "dc-btn-ghost"}`,
          text: "Student",
          onclick: () => {
            currentRole = "student";
            renderBody();
          },
        }),
      ]),
      el("label", { class: "dc-field-label", for: "dc-login-phone", text: "Phone" }),
      (() => {
        phone.id = "dc-login-phone";
        return phone;
      })(),
      el("label", { class: "dc-field-label", for: "dc-login-pass", text: "Password" }),
      (() => {
        password.id = "dc-login-pass";
        return password;
      })(),
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Forgot password", onclick: () => { view = "reset"; renderBody(); } }),
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "New user? Signup", onclick: () => onGoRegister?.(currentRole || "student") }),
      ]),
      status,
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back", onclick: () => onDone?.() }),
        el("button", { type: "button", class: "dc-btn dc-btn-primary", text: "Login", onclick: loginWithPassword }),
      ]),
    ]);
  }

  function renderResetBody() {
    return el("div", { class: "dc-auth-body" }, [
      el("h2", { class: "dc-login-title", text: "Reset password" }),
      el("p", { class: "dc-muted dc-small", text: "Reset password with OTP." }),
      el("label", { class: "dc-field-label", for: "dc-reset-phone", text: "Phone" }),
      (() => {
        phone.id = "dc-reset-phone";
        return phone;
      })(),
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        otp,
        el("button", { type: "button", class: "dc-btn dc-btn-secondary", text: "Send OTP", onclick: requestResetOtp }),
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Verify", onclick: verifyResetOtp }),
      ]),
      el("label", { class: "dc-field-label", for: "dc-reset-new", text: "New password" }),
      (() => {
        newPassword.id = "dc-reset-new";
        return newPassword;
      })(),
      el("label", { class: "dc-field-label", for: "dc-reset-confirm", text: "Confirm new password" }),
      (() => {
        confirmPassword.id = "dc-reset-confirm";
        return confirmPassword;
      })(),
      status,
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back to login", onclick: () => { view = "login"; renderBody(); } }),
        el("button", { type: "button", class: "dc-btn dc-btn-primary", text: "Update password", onclick: resetPassword }),
      ]),
    ]);
  }

  let bodyMount = null;
  function renderBody() {
    if (!bodyMount) return;
    bodyMount.innerHTML = "";
    const node = view === "choose" ? renderChooser() : view === "reset" ? renderResetBody() : renderLoginBody();
    bodyMount.appendChild(node);
  }

  const card = el("div", { class: "dc-auth-card" }, [
    (() => {
      bodyMount = el("div");
      renderBody();
      return bodyMount;
    })(),
  ]);

  const shell = el("div", { class: "dc-auth-shell" }, [
    el("section", { class: "dc-auth-hero" }, [
      el("div", { class: "dc-auth-hero-inner" }, [
        el("div", { class: "dc-auth-brand" }, [
          el("div", { class: "dc-auth-logo", text: "D" }),
          el("div", {}, [
            el("div", { class: "dc-auth-brand-name", text: "Delta Class 3D" }),
            el("div", { class: "dc-auth-brand-tag", text: "Lightweight 3D classroom for slow networks" }),
          ]),
        ]),
        el("div", { class: "dc-auth-hero-card" }, [
          el("div", { class: "dc-auth-hero-title", text: "Login fast. Join class faster." }),
          el("div", { class: "dc-auth-hero-sub", text: "We only load the 3D scene when you create or join a room." }),
        ]),
      ]),
    ]),
    el("section", { class: "dc-auth-panel" }, [card]),
  ]);

  root.appendChild(shell);
}
