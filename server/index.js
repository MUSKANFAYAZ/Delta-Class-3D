require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const authRouter = require("./routes/auth");

const PORT = process.env.PORT || 3000;
const MAX_STUDENT_SLOTS = 25;

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRouter);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const ROOM_CODE_REGEX = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;
const classrooms = new Map();

function normalizeRoomCode(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidRoomCode(code) {
  return ROOM_CODE_REGEX.test(code);
}

function getOrCreateClassroom(code, additionalData = {}) {
  if (!classrooms.has(code)) {
    classrooms.set(code, {
      studentAssignments: new Map(),
      studentPositions: new Map(),
      teacherPositions: new Map(),
      createdAt: Date.now(),
      ...additionalData
    });
  }
  return classrooms.get(code);
}

// Serve frontend static files
const clientBuildPath = path.join(__dirname, "../client/dist");
const clientBuildExists = fs.existsSync(clientBuildPath);

if (clientBuildExists) {
  app.use(express.static(clientBuildPath));
  console.log(`Serving frontend from ${clientBuildPath}`);
} else {
  app.use((_req, res) => {
    res.status(503).send(
     "Frontend build not available"
    );
  });
}

function getRole(socket) {
  return (
    socket.handshake.auth?.role ||
    socket.handshake.query?.role ||
    "guest"
  );
}

function getNextAvailableSlot(classroom) {
  for (let i = 0; i < MAX_STUDENT_SLOTS; i += 1) {
    if (![...classroom.studentAssignments.values()].includes(i)) {
      return i;
    }
  }
  return null;
}

function broadcastSnapshot(socket, classroom) {
  for (const [userId, slotIndex] of classroom.studentAssignments.entries()) {
    socket.emit("student-assigned", { userId, slotIndex });
  }

  for (const [userId, pos] of classroom.studentPositions.entries()) {
    socket.emit("student-move-update", { userId, x: pos.x, z: pos.z });
    socket.emit("update", { id: userId, x: pos.x, z: pos.z });
  }

  for (const [, pos] of classroom.teacherPositions.entries()) {
    socket.emit("teacher-move-update", { x: pos.x, z: pos.z });
  }
}

app.post("/auth/classrooms", (req, res) => {
  const code = normalizeRoomCode(req.body?.code);
  const { subject, timing, capacity, info } = req.body;
  
  if (!isValidRoomCode(code)) {
    return res.status(400).json({ message: "Invalid room code format" });
  }

  const exists = classrooms.has(code);
  const classroom = getOrCreateClassroom(code, { subject, timing, capacity, info });
  
  // If editing an existing classroom could be part of the flow later,
  // we could update here if 'exists' is true. But for now this works.

  return res.status(exists ? 200 : 201).json({
    ok: true,
    code,
    exists,
    subject: classroom.subject,
    timing: classroom.timing,
    capacity: classroom.capacity,
    info: classroom.info,
    participants: classroom.studentAssignments.size + classroom.teacherPositions.size,
  });
});

app.get("/auth/classrooms/:code", (req, res) => {
  const code = normalizeRoomCode(req.params.code);
  if (!isValidRoomCode(code)) {
    return res.status(400).json({ exists: false, message: "Invalid room code format" });
  }

  const classroom = classrooms.get(code);
  return res.json({
    exists: Boolean(classroom),
    code,
    subject: classroom?.subject,
    timing: classroom?.timing,
    capacity: classroom?.capacity,
    info: classroom?.info,
    participants: classroom
      ? classroom.studentAssignments.size + classroom.teacherPositions.size
      : 0,
  });
});

// Serve index.html for SPA routing (only if build exists)
if (clientBuildExists) {
  app.use((_req, res) => {
    const indexPath = path.join(clientBuildPath, "index.html");
    res.sendFile(indexPath, { headers: { "Cache-Control": "no-cache" } });
  });
}

io.on("connection", (socket) => {
  const role = getRole(socket);
  const roomCode = normalizeRoomCode(
    socket.handshake.auth?.roomCode || socket.handshake.query?.roomCode,
  );

  if (!isValidRoomCode(roomCode)) {
    socket.emit("room-error", { message: "Invalid room code" });
    socket.disconnect(true);
    return;
  }

  if (!classrooms.has(roomCode) && role !== "teacher") {
    socket.emit("room-error", { message: "Room does not exist" });
    socket.disconnect(true);
    return;
  }

  const classroom = getOrCreateClassroom(roomCode);
  socket.data.roomCode = roomCode;
  socket.join(roomCode);

  console.log(`Socket connected: ${socket.id} (${role}) room=${roomCode}`);

  if (role === "student") {
    const slotIndex = getNextAvailableSlot(classroom);
    if (slotIndex !== null) {
      classroom.studentAssignments.set(socket.id, slotIndex);
      io.to(roomCode).emit("student-assigned", { userId: socket.id, slotIndex });
    }
  }

  broadcastSnapshot(socket, classroom);

  socket.on("move", (payload = {}) => {
    const nextX = Number(payload.x);
    const nextZ = Number(payload.z);

    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      return;
    }

    classroom.studentPositions.set(socket.id, { x: nextX, z: nextZ });
    io.to(roomCode).emit("student-move-update", {
      userId: socket.id,
      x: nextX,
      z: nextZ,
    });

    // Compatibility event expected by older client builds.
    io.to(roomCode).emit("update", { id: socket.id, x: nextX, z: nextZ });
  });

  socket.on("teacher-move", (payload = {}) => {
    const nextX = Number(payload.x);
    const nextZ = Number(payload.z);

    if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
      return;
    }

    classroom.teacherPositions.set(socket.id, { x: nextX, z: nextZ });
    io.to(roomCode).emit("teacher-move-update", { x: nextX, z: nextZ });
  });

  socket.on("teacher-instruction", (payload = {}) => {
    if (typeof payload.direction !== "string") return;
    io.to(roomCode).emit("teacher-instruction", { direction: payload.direction });
  });

  socket.on("teacher-student-instruction", (payload = {}) => {
    const { userId, direction } = payload;
    if (typeof userId !== "string" || typeof direction !== "string") return;

    io.to(roomCode).emit("teacher-student-instruction", { userId, direction });
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);

    classroom.studentAssignments.delete(socket.id);
    classroom.studentPositions.delete(socket.id);
    classroom.teacherPositions.delete(socket.id);

    if (
      classroom.studentAssignments.size === 0
      && classroom.studentPositions.size === 0
      && classroom.teacherPositions.size === 0
    ) {
      classrooms.delete(roomCode);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Server started on port ${PORT}`);
});

const MONGO_URI = process.env.MONGO_URI;
if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined })
    .then(() => console.log("✓ MongoDB connected"))
    .catch((e) => console.error("MongoDB connection failed:", e?.message || e));
} else {
  console.warn("MONGO_URI not set — auth storage will not work until MongoDB is configured.");
}