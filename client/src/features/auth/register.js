
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
  const value = String(raw || "").replace(/\s+/g, "");
  if (!value) return "+91";
  if (value.startsWith("+")) return value;
  if (/^\d{10}$/.test(value)) return `+91${value}`;
  return value;
}

const COUNTRY_CODES = [
  "+91",
  "+1",
  "+44",
  "+61",
  "+65",
  "+81",
  "+86",
  "+971",
  "+880",
  "+92",
  "+94",
  "+33",
  "+49",
];

function createCountryCodeSelect(defaultCountryCode = "+91") {
  const select = el("select", {
    class: "dc-input dc-country-code",
    autocomplete: "tel-country-code",
  }, COUNTRY_CODES.map((code) => el("option", { value: code, text: code })));

  select.value = COUNTRY_CODES.includes(defaultCountryCode) ? defaultCountryCode : "+91";
  return select;
}

function createPhoneFields(defaultCountryCode = "+91") {
  const countryCode = createCountryCodeSelect(defaultCountryCode);

  const phoneNumber = el("input", {
    class: "dc-input",
    placeholder: "1234567890",
    inputmode: "tel",
    autocomplete: "tel",
  });

  return {
    countryCode,
    phoneNumber,
    getValue() {
      const code = String(countryCode.value || "+91");
      const number = String(phoneNumber.value || "").replace(/\D/g, "").slice(0, 10);
      return `${code}${number}`;
    },
  };
}

function isValidPhoneWithCode(phone) {
  return /^\+\d{1,3}\d{10}$/.test(phone);
}

function generateId() {
  return `D3D-${Math.floor(100000 + Math.random() * 900000)}`;
}

export function mountRegister(root, { api, onDone, onGoLogin, role = "student", mode = "", onChoose }) {
  root.innerHTML = "";

  const status = el("p", { class: "dc-muted dc-small", text: "" });
  const name = el("input", { class: "dc-input", placeholder: "Full name", autocomplete: "name" });
  const studentClass = el("input", { class: "dc-input", placeholder: "Class (eg. 10-A)" });
  const phoneFields = createPhoneFields();
  const password = el("input", { class: "dc-input", type: "password", placeholder: "Password", autocomplete: "new-password" });
  const confirmPassword = el("input", {
    class: "dc-input",
    type: "password",
    placeholder: "Confirm password",
    autocomplete: "new-password",
  });

  const idValue = el("strong", { text: "" });
  const copyIdButton = el("button", { type: "button", class: "dc-btn dc-btn-secondary", text: "Copy code" });
  copyIdButton.addEventListener("click", async () => {
    const uniqueCode = String(idValue.textContent || "").trim();
    if (!uniqueCode) {
      status.textContent = "Please register first to generate your unique code.";
      return;
    }
    try {
      await navigator.clipboard.writeText(uniqueCode);
      status.textContent = "Code copied. Redirecting to login...";
      onGoLogin?.(currentRole);
    } catch {
      status.textContent = "Could not copy automatically. Please copy it manually.";
    }
  });
  const idWrap = el("div", { class: "dc-stat", hidden: "true" }, [
    el("span", { class: "dc-stat-label", text: "Your unique ID" }),
    idValue,
    copyIdButton,
  ]);

  let currentRole = role === "teacher" ? "teacher" : "student";
  let classFieldWrap = null;
  let registerButton = null;
  let registerInFlight = false;



  async function submit() {
    status.textContent = "";
    const nm = String(name.value || "").trim();
    const cls = String(studentClass.value || "").trim();
    const p = phoneFields.getValue();
    const pw = String(password.value || "");
    const cpw = String(confirmPassword.value || "");

    if (!nm || !p || !pw) {
      status.textContent = "Please fill name, phone, and password.";
      return;
    }
    if (nm.length < 2) {
      status.textContent = "Name must be at least 2 characters.";
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
    if (currentRole === "student" && !cls) {
      status.textContent = "Class is required for students.";
      return;
    }
    if (pw !== cpw) {
      status.textContent = "Passwords do not match.";
      return;
    }

    if (registerInFlight) return;
    registerInFlight = true;
    if (registerButton) {
      registerButton.disabled = true;
      registerButton.textContent = "Registering...";
    }

    const userId = generateId();
    try {
      const data = await api("/register", {
        method: "POST",
        body: {
          name: nm,
          phone: p,
          password: pw,
          role: currentRole,
          studentClass: cls,
          userId,
        },
      });
      if (data?.token) {
        localStorage.setItem("delta-access-token", data.token);
        localStorage.setItem("delta-access-token-ts", String(Date.now()));
      }
      if (data?.user?.name) localStorage.setItem("delta-user-display", data.user.name);
      if (data?.user?.role) localStorage.setItem("delta-user-role", data.user.role);
      idValue.textContent = userId;
      idWrap.hidden = false;
      status.textContent = "Signup successful. Copy your code, then login.";
    } catch (e) {
      status.textContent = e?.message || "Registration failed.";
    } finally {
      registerInFlight = false;
      if (registerButton) {
        registerButton.disabled = false;
        registerButton.textContent = "Register";
      }
    }
  }

  function renderChooser() {
    return el("div", { class: "dc-auth-body" }, [
      el("h2", { class: "dc-login-title", text: "Continue as" }),
      el("p", { class: "dc-muted dc-small", text: "Choose role + action." }),
      el("div", { class: "dc-actions" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-primary dc-btn-large", text: "Student Login", onclick: () => onChoose?.({ nextMode: "login", nextRole: "student" }) }),
        el("button", { type: "button", class: "dc-btn dc-btn-secondary dc-btn-large", text: "Teacher Login", onclick: () => onChoose?.({ nextMode: "login", nextRole: "teacher" }) }),
        el("button", { type: "button", class: "dc-btn dc-btn-primary dc-btn-large", text: "Student Signup", onclick: () => onChoose?.({ nextMode: "signup", nextRole: "student" }) }),
        el("button", { type: "button", class: "dc-btn dc-btn-secondary dc-btn-large", text: "Teacher Signup", onclick: () => onChoose?.({ nextMode: "signup", nextRole: "teacher" }) }),
      ]),
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Back", onclick: () => onDone?.() }),
      ]),
    ]);
  }

  const roleSelect = el("select", { class: "dc-input" }, [
    el("option", { value: "student", text: "Student" }),
    el("option", { value: "teacher", text: "Teacher" }),
  ]);
  roleSelect.value = currentRole;
  roleSelect.addEventListener("change", () => {
    currentRole = roleSelect.value === "teacher" ? "teacher" : "student";
    if (classFieldWrap) classFieldWrap.classList.toggle("dc-hidden", currentRole === "teacher");
  });

  const card = el("div", { class: "dc-auth-card" }, [
    el("div", { class: "dc-auth-body" }, mode ? [
      el("h2", { class: "dc-login-title", text: "Create your account" }),
      el("p", { class: "dc-muted dc-small", text: "Register a new account." }),

      el("label", { class: "dc-field-label", for: "dc-reg-role", text: "Role" }),
      (() => {
        roleSelect.id = "dc-reg-role";
        return roleSelect;
      })(),

      el("label", { class: "dc-field-label", for: "dc-reg-name", text: "Name" }),
      (() => {
        name.id = "dc-reg-name";
        return name;
      })(),

      (() => {
        classFieldWrap = el("div", {}, [
          el("label", { class: "dc-field-label", for: "dc-reg-class", text: "Class (students only)" }),
          (() => {
            studentClass.id = "dc-reg-class";
            return studentClass;
          })(),
        ]);
        if (currentRole === "teacher") classFieldWrap.classList.add("dc-hidden");
        return classFieldWrap;
      })(),

      el("label", { class: "dc-field-label", for: "dc-reg-phone", text: "Phone" }),
      el("div", { class: "dc-phone-row" }, [
        (() => {
          phoneFields.countryCode.id = "dc-reg-country-code";
          return phoneFields.countryCode;
        })(),
        (() => {
          phoneFields.phoneNumber.id = "dc-reg-phone";
          return phoneFields.phoneNumber;
        })(),
      ]),


      el("label", { class: "dc-field-label", for: "dc-reg-pass", text: "Password" }),
      (() => {
        password.id = "dc-reg-pass";
        return password;
      })(),

      el("label", { class: "dc-field-label", for: "dc-reg-confirm", text: "Confirm password" }),
      (() => {
        confirmPassword.id = "dc-reg-confirm";
        return confirmPassword;
      })(),

      status,
      el("div", { class: "dc-auth-actions dc-auth-actions-row" }, [
        el("button", { type: "button", class: "dc-btn dc-btn-ghost", text: "Login", onclick: () => onGoLogin?.(currentRole) }),
        (() => {
          registerButton = el("button", { type: "button", class: "dc-btn dc-btn-primary", text: "Register", onclick: submit });
          return registerButton;
        })(),
      ]),
      el("div", { class: "dc-stat-grid" }, [idWrap]),
    ] : [renderChooser()]),
  ]);

  const shell = el("div", { class: "dc-auth-shell" }, [
    el("section", { class: "dc-auth-hero" }, [
      el("div", { class: "dc-auth-hero-inner" }, [
        el("div", { class: "dc-auth-brand" }, [
          el("div", { class: "dc-auth-logo", text: "D" }),
          el("div", {}, [
            el("div", { class: "dc-auth-brand-name", text: "Delta Class 3D" }),
            el("div", { class: "dc-auth-brand-tag", text: "Signup then create/join a classroom" }),
          ]),
        ]),
        el("div", { class: "dc-auth-hero-card" }, [
          el("div", { class: "dc-auth-hero-title", text: "Quick signup" }),
          el("div", { class: "dc-auth-hero-sub", text: "Register and start learning." }),
        ]),
      ]),
    ]),
    el("section", { class: "dc-auth-panel" }, [card]),
  ]);

  root.appendChild(shell);
}
