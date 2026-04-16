import { io } from "socket.io-client";
import { startClassroom } from "./classroom.js";
import "./styles.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing app root element");
}

app.innerHTML = `
  <div class="shell">
    <main id="canvas-container" class="canvas-container"></main>
  </div>
`;

const serverUrl = new URLSearchParams(window.location.search).get("server") || "http://localhost:3001";
const role = new URLSearchParams(window.location.search).get("role") || "student";

const socket = io(serverUrl, {
  transports: ["websocket"],
  auth: { role },
  query: { role },
  reconnection: true,
});

socket.on("connect", () => {
  startClassroom(socket, role);
});
