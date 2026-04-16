const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT) || 3001;
const MAX_STUDENT_SLOTS = 25;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const studentAssignments = new Map();
const studentPositions = new Map();
const teacherPositions = new Map();

function getRole(socket) {
  return (
    socket.handshake.auth?.role ||
    socket.handshake.query?.role ||
    "guest"
  );
}

function getNextAvailableSlot() {
  for (let i = 0; i < MAX_STUDENT_SLOTS; i += 1) {
    if (![...studentAssignments.values()].includes(i)) {
      return i;
    }
  }
  return null;
}

function broadcastSnapshot(socket) {
  for (const [userId, slotIndex] of studentAssignments.entries()) {
    socket.emit("student-assigned", { userId, slotIndex });
  }

  for (const [userId, pos] of studentPositions.entries()) {
    socket.emit("student-move-update", { userId, x: pos.x, z: pos.z });
    socket.emit("update", { id: userId, x: pos.x, z: pos.z });
  }

  for (const [, pos] of teacherPositions.entries()) {
    socket.emit("teacher-move-update", { x: pos.x, z: pos.z });
  }
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "delta-classroom-server" });
});

io.on("connection", (socket) => {
  const role = getRole(socket);
  console.log(`Socket connected: ${socket.id} (${role})`);

  if (role === "student") {
    const slotIndex = getNextAvailableSlot();
    if (slotIndex !== null) {
      studentAssignments.set(socket.id, slotIndex);
      io.emit("student-assigned", { userId: socket.id, slotIndex });
    }
  }

  broadcastSnapshot(socket);

  socket.on("move", (payload = {}) => {
    const nextX = Number(payload.x);
    const nextZ = Number(payload.z);

    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      return;
    }

    studentPositions.set(socket.id, { x: nextX, z: nextZ });
    io.emit("student-move-update", {
      userId: socket.id,
      x: nextX,
      z: nextZ,
    });

    // Compatibility event expected by older client builds.
    io.emit("update", { id: socket.id, x: nextX, z: nextZ });
  });

  socket.on("teacher-move", (payload = {}) => {
    const nextX = Number(payload.x);
    const nextZ = Number(payload.z);

    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      return;
    }

    teacherPositions.set(socket.id, { x: nextX, z: nextZ });
    io.emit("teacher-move-update", { x: nextX, z: nextZ });
  });

  socket.on("teacher-instruction", (payload = {}) => {
    if (typeof payload.direction !== "string") return;
    io.emit("teacher-instruction", { direction: payload.direction });
  });

  socket.on("teacher-student-instruction", (payload = {}) => {
    const { userId, direction } = payload;
    if (typeof userId !== "string" || typeof direction !== "string") return;

    io.emit("teacher-student-instruction", { userId, direction });
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    studentAssignments.delete(socket.id);
    studentPositions.delete(socket.id);
    teacherPositions.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`DeltaClass3D server running on http://localhost:${PORT}`);
});