require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const authRouter = require("./routes/auth");
const Classroom = require("./models/Classroom");
const { authMiddleware, verifyToken } = require("./lib/auth");

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

// In-memory cache for active classroom sessions (Socket.IO state)
const activeClassrooms = new Map();

function normalizeRoomCode(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidRoomCode(code) {
  return ROOM_CODE_REGEX.test(code);
}

function getRoomOwnerId(room) {
  if (!room || typeof room !== "object") return null;

  const knownOwnerKeys = [
    "hostId",
    "teacherId",
    "ownerId",
    "createdBy",
    "creatorId",
    "userId",
  ];

  for (const key of knownOwnerKeys) {
    const owner = room[key];
    if (typeof owner === "string" || typeof owner === "number") {
      return String(owner);
    }
    if (owner && typeof owner === "object") {
      if (typeof owner.id === "string" || typeof owner.id === "number") return String(owner.id);
      if (typeof owner._id === "string" || typeof owner._id === "number") return String(owner._id);
      if (typeof owner.sub === "string" || typeof owner.sub === "number") return String(owner.sub);
    }
  }

  const host = room.host;
  if (typeof host === "string" || typeof host === "number") {
    return String(host);
  }
  if (host && typeof host === "object") {
    if (typeof host.id === "string" || typeof host.id === "number") return String(host.id);
    if (typeof host._id === "string" || typeof host._id === "number") return String(host._id);
    if (typeof host.sub === "string" || typeof host.sub === "number") return String(host.sub);
  }

  return null;
}

async function getOrCreateClassroom(code, additionalData = {}) {
  let classroom = await Classroom.findOne({ code });
  if (!classroom) {
    classroom = await Classroom.create({
      code,
      ...additionalData,
      studentAssignments: new Map(),
      studentPositions: new Map(),
      teacherPositions: new Map(),
    });
  }
  return classroom;
}

function getUserFromAuthHeader(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return verifyToken(match[1]);
  } catch {
    return null;
  }
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

app.post("/auth/classrooms", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.body?.code);
    const { subject, timing, capacity, info } = req.body;
    
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ message: "Invalid room code format" });
    }

    const exists = await Classroom.findOne({ code });
    if (exists && String(exists.createdBy) !== String(req.user.sub)) {
      return res.status(403).json({ message: "Classroom already exists and belongs to another teacher" });
    }

    const classroom = await getOrCreateClassroom(code, {
      subject,
      timing,
      capacity,
      info,
      createdBy: req.user.sub,
    });
    
    return res.status(exists ? 200 : 201).json({
      ok: true,
      code: classroom.code,
      exists: Boolean(exists),
      subject: classroom.subject,
      timing: classroom.timing,
      capacity: classroom.capacity,
      info: classroom.info,
      canDelete: String(classroom.createdBy) === String(req.user.sub),
      participants: (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0),
    });
  } catch (error) {
    console.error("Error creating classroom:", error);
    res.status(500).json({ message: "Error creating classroom" });
  }
});

app.get("/auth/classrooms/:code", async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ exists: false, message: "Invalid room code format" });
    }

    const classroom = await Classroom.findOne({ code });
    const user = getUserFromAuthHeader(req);
    const canDelete = Boolean(
      classroom
      && user?.sub
      && String(classroom.createdBy) === String(user.sub)
    );
    return res.json({
      exists: Boolean(classroom),
      code,
      subject: classroom?.subject,
      timing: classroom?.timing,
      capacity: classroom?.capacity,
      info: classroom?.info,
      canDelete,
      participants: classroom
        ? (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0)
        : 0,
    });
  } catch (error) {
    console.error("Error fetching classroom:", error);
    res.status(500).json({ exists: false, message: "Error fetching classroom" });
  }
});

// Serve index.html for SPA routing (only if build exists)
if (clientBuildExists) {
  app.use((_req, res) => {
    const indexPath = path.join(clientBuildPath, "index.html");
    res.sendFile(indexPath, { headers: { "Cache-Control": "no-cache" } });
  });
}

io.on("connection", async (socket) => {
  const role = getRole(socket);
  const roomCode = normalizeRoomCode(
    socket.handshake.auth?.roomCode || socket.handshake.query?.roomCode,
  );

  if (!isValidRoomCode(roomCode)) {
    socket.emit("room-error", { message: "Invalid room code" });
    socket.disconnect(true);
    return;
  }

  try {
    // Fetch classroom from MongoDB. If Mongo is temporarily unavailable,
    // keep live room sync working from in-memory state.
    let classroom = null;
    try {
      classroom = await Classroom.findOne({ code: roomCode });
    } catch (dbError) {
      console.error("Classroom lookup failed:", dbError?.message || dbError);
    }

    const hasActiveSession = activeClassrooms.has(roomCode);
    if (!classroom && !hasActiveSession && role !== "teacher") {
      socket.emit("room-error", { message: "Room does not exist" });
      socket.disconnect(true);
      return;
    }

    // Get or create an in-memory cache for this session
    if (!activeClassrooms.has(roomCode)) {
      activeClassrooms.set(roomCode, {
        studentAssignments: new Map(),
        studentPositions: new Map(),
        teacherPositions: new Map(),
        blackboardStrokes: Array.isArray(classroom?.blackboardStrokes)
          ? [...classroom.blackboardStrokes]
          : [],
      });
    }

    const activeSession = activeClassrooms.get(roomCode);
    socket.data.roomCode = roomCode;
    socket.join(roomCode);

    console.log(`Socket connected: ${socket.id} (${role}) room=${roomCode}`);

    if (role === "student") {
      const slotIndex = getNextAvailableSlot(activeSession);
      if (slotIndex !== null) {
        activeSession.studentAssignments.set(socket.id, slotIndex);
        io.to(roomCode).emit("student-assigned", { userId: socket.id, slotIndex });
      }
    }

    broadcastSnapshot(socket, activeSession);

    // Send whiteboard snapshot to newly connected user.
    if (activeSession.blackboardStrokes.length > 0) {
      socket.emit("blackboard-snapshot", { strokes: activeSession.blackboardStrokes });
    }

    socket.on("move", (payload = {}) => {
      const nextX = Number(payload.x);
      const nextZ = Number(payload.z);

      if (!Number.isFinite(nextX) || !Number.isFinite(nextZ)) {
        return;
      }

      activeSession.studentPositions.set(socket.id, { x: nextX, z: nextZ });
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

      activeSession.teacherPositions.set(socket.id, { x: nextX, z: nextZ });
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

    socket.on("blackboard-stroke", async (stroke) => {
      if (!stroke) return;
      // Keep an in-memory snapshot for live sync even if DB is temporarily unavailable.
      activeSession.blackboardStrokes.push(stroke);
      if (activeSession.blackboardStrokes.length > 1000) {
        activeSession.blackboardStrokes = activeSession.blackboardStrokes.slice(-1000);
      }

      // Persist when DB-backed classroom is available.
      if (classroom) {
        classroom.blackboardStrokes = [...activeSession.blackboardStrokes];
        await classroom.save().catch((err) => console.error("Error saving classroom:", err));
      }

      io.to(roomCode).emit("blackboard-stroke", stroke);
    });

    socket.on("blackboard-clear", async () => {
      activeSession.blackboardStrokes = [];
      if (classroom) {
        classroom.blackboardStrokes = [];
        await classroom.save().catch((err) => console.error("Error saving classroom:", err));
      }
      io.to(roomCode).emit("blackboard-clear");
    });

    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected: ${socket.id} reason=${reason}`);

      activeSession.studentAssignments.delete(socket.id);
      activeSession.studentPositions.delete(socket.id);
      activeSession.teacherPositions.delete(socket.id);

      if (
        activeSession.studentAssignments.size === 0
        && activeSession.studentPositions.size === 0
        && activeSession.teacherPositions.size === 0
        && activeSession.blackboardStrokes.length === 0
      ) {
        activeClassrooms.delete(roomCode);
      }
    });

    // Voice Chat / WebRTC Signaling
    socket.emit("peer-joined", { userId: socket.id, role });
    socket.broadcast.to(roomCode).emit("peer-joined", { userId: socket.id, role });

    socket.on("webrtc-offer", ({ target, offer }) => {
      io.to(target).emit("webrtc-offer", { caller: socket.id, offer });
    });

    socket.on("webrtc-answer", ({ target, answer }) => {
      io.to(target).emit("webrtc-answer", { caller: socket.id, answer });
    });

    socket.on("webrtc-candidate", ({ target, candidate }) => {
      io.to(target).emit("webrtc-candidate", { caller: socket.id, candidate });
    });

    socket.on("disconnect", () => {
      io.to(roomCode).emit("peer-left", socket.id);
    });

  } catch (error) {
    console.error("Socket connection error:", error);
    socket.emit("room-error", { message: "Error connecting to room" });
    socket.disconnect(true);
  }
});

// DELETE classroom logic
app.delete("/auth/classrooms/:code", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ ok: false, message: "Invalid room code format" });
    }

    const room = activeClassrooms.get(code);
    if (!room) {
      return res.status(404).json({ ok: false, message: "Room not found" });
    }

    const ownerId = getRoomOwnerId(room);
    const requesterId = String(req.user?.sub || "");
    if (!ownerId || ownerId !== requesterId) {
      return res.status(403).json({
        ok: false,
        message: "Only the classroom creator can delete this class",
      });
    }

    activeClassrooms.delete(code);
    return res.json({ ok: true, message: "Classroom deleted" });
  } catch (error) {
    console.error("Error deleting classroom:", error);
    return res.status(500).json({ ok: false, message: "Error deleting classroom" });
  }
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