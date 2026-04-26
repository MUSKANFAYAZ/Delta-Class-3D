import "./styles.css";

registerServiceWorker();

import { mountDashboard } from "./dashboard.js";
import { mountLogin } from "./login.js";
import { mountRegister } from "./register.js";

const ROOT_ID = "app";
const AUTH = {
  baseUrl: import.meta.env.VITE_AUTH_API_URL || "/auth",
  tokenKey: "delta-access-token",
};
const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_SERVER_URL || window.location.origin;

const appRoot = document.getElementById(ROOT_ID);
if (!appRoot) throw new Error("Missing app root element");

function getToken() {
  return localStorage.getItem(AUTH.tokenKey) || "";
}

function setToken(token) {
  if (!token) localStorage.removeItem(AUTH.tokenKey);
  else localStorage.setItem(AUTH.tokenKey, token);
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = token ?? getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${AUTH.baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    const message = data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

async function startSocketClassroom({ role, roomCode }) {
  const [{ io }, { startClassroom }] = await Promise.all([
    loadSocketClientModule(),
    import("./classroom.js"),
  ]);

  const socket = io({
    path: "/socket.io",
    transports: ["websocket"],
    auth: { role, roomCode },
    query: { role, roomCode },
    reconnection: true,
  });

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };
    const onConnect = () => {
      cleanup();
      startClassroom(socket, role);
      resolve({ socket });
    };
    const onError = (e) => {
      cleanup();
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      reject(e || new Error("Socket connection failed"));
    };
    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

async function loadSocketClientModule() {
  try {
    return await import("https://cdn.jsdelivr.net/npm/socket.io-client@4.8.3/dist/socket.io.esm.min.js");
  } catch {
    return import("socket.io-client");
  }
}

function navigate(path) {
  if (window.location.hash === `#${path}`) {
    renderRoute();
    return;
  }
  window.location.hash = path;
}

function parseHash() {
  const raw = window.location.hash || "#/dashboard";
  const noHash = raw.replace(/^#/, "");
  const [path, query = ""] = noHash.split("?");
  const params = new URLSearchParams(query);
  return { path, params };
}

async function renderRoute() {
  const { path, params } = parseHash();
  const role = params.get("role") === "teacher" ? "teacher" : "student";
  const mode = params.get("mode") === "signup" ? "signup" : params.get("mode") === "login" ? "login" : "";

  if (path === "/login") {
    mountLogin(appRoot, {
      api,
      role,
      mode,
      onDone: () => navigate("/dashboard"),
      onGoRegister: (nextRole = role) => navigate(`/register?role=${nextRole}&mode=signup`),
      onChoose: ({ nextMode, nextRole }) => {
        if (nextMode === "signup") navigate(`/register?role=${nextRole}&mode=signup`);
        else navigate(`/login?role=${nextRole}&mode=login`);
      },
    });
    return;
  }

  if (path === "/register") {
    mountRegister(appRoot, {
      api,
      role,
      mode,
      onDone: () => navigate(`/login?role=${role}&mode=login`),
      onGoLogin: (nextRole = role) => navigate(`/login?role=${nextRole}&mode=login`),
      onChoose: ({ nextMode, nextRole }) => {
        if (nextMode === "signup") navigate(`/register?role=${nextRole}&mode=signup`);
        else navigate(`/login?role=${nextRole}&mode=login`);
      },
    });
    return;
  }

  // default dashboard
  mountDashboard(appRoot, {
    serverUrl: SOCKET_SERVER_URL,
    defaultRole: new URLSearchParams(window.location.search).get("role") || "student",
    onLoginRequested: () => navigate("/login"),
    onEnterClassroom: async ({ roomCode, role }) => {
      await startSocketClassroom({ roomCode, role });
    },
    onClassroomFailed: () => {
      // dashboard handles UI fallback
    },
  });
}

window.addEventListener("hashchange", renderRoute);
renderRoute();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext) return;
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service worker registration failed:", error);
    });
  });
}
