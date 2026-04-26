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

// Serve frontend static files
const clientBuildPath = path.join(__dirname, "../client/dist");
const clientBuildExists = fs.existsSync(clientBuildPath);

if (clientBuildExists) {
  app.use(express.static(clientBuildPath));
  console.log(`Serving frontend from ${clientBuildPath}`);
} else {
  console.warn(`Frontend build not found at ${clientBuildPath}`);
  app.use((_req, res) => {
    res.status(503).send("Frontend build not available. Please build the client.");
  });
}

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

// Serve index.html for SPA routing (only if build exists)
if (clientBuildExists) {
  app.use((_req, res) => {
    const indexPath = path.join(clientBuildPath, "index.html");
    res.sendFile(indexPath, { headers: { "Cache-Control": "no-cache" } });
  });
}

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