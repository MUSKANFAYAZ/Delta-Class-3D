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

app.post("/auth/classrooms", async (req, res) => {
  try {
    const code = normalizeRoomCode(req.body?.code);
    const { subject, timing, capacity, info } = req.body;
    
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ message: "Invalid room code format" });
    }

    const exists = await Classroom.findOne({ code });
    const classroom = await getOrCreateClassroom(code, { subject, timing, capacity, info });
    
    return res.status(exists ? 200 : 201).json({
      ok: true,
      code: classroom.code,
      exists: Boolean(exists),
      subject: classroom.subject,
      timing: classroom.timing,
      capacity: classroom.capacity,
      info: classroom.info,
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
    return res.json({
      exists: Boolean(classroom),
      code,
      subject: classroom?.subject,
      timing: classroom?.timing,
      capacity: classroom?.capacity,
      info: classroom?.info,
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
    // Fetch or create classroom from MongoDB
    let classroom = await Classroom.findOne({ code: roomCode });
    
    if (!classroom && role !== "teacher") {
      socket.emit("room-error", { message: "Room does not exist" });
      socket.disconnect(true);
      return;
    }

    if (!classroom) {
      classroom = await getOrCreateClassroom(roomCode);
    }

    // Get or create an in-memory cache for this session
    if (!activeClassrooms.has(roomCode)) {
      activeClassrooms.set(roomCode, {
        studentAssignments: new Map(),
        studentPositions: new Map(),
        teacherPositions: new Map(),
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

    // Send whiteboard snapshot to new student
    if (classroom.blackboardStrokes && classroom.blackboardStrokes.length > 0) {
      socket.emit("blackboard-snapshot", { strokes: classroom.blackboardStrokes });
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
      // Store stroke in database
      classroom.blackboardStrokes = classroom.blackboardStrokes || [];
      classroom.blackboardStrokes.push(stroke);
      // Limit to last 1000 strokes to avoid memory issues
      if (classroom.blackboardStrokes.length > 1000) {
        classroom.blackboardStrokes = classroom.blackboardStrokes.slice(-1000);
      }
      await classroom.save().catch(err => console.error("Error saving classroom:", err));
      // Broadcast to all users in room
      io.to(roomCode).emit("blackboard-stroke", stroke);
    });

    socket.on("blackboard-clear", async () => {
      classroom.blackboardStrokes = [];
      await classroom.save().catch(err => console.error("Error saving classroom:", err));
      io.to(roomCode).emit("blackboard-clear");
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);

      activeSession.studentAssignments.delete(socket.id);
      activeSession.studentPositions.delete(socket.id);
      activeSession.teacherPositions.delete(socket.id);

      if (
        activeSession.studentAssignments.size === 0
        && activeSession.studentPositions.size === 0
        && activeSession.teacherPositions.size === 0
      ) {
        activeClassrooms.delete(roomCode);
      }
    });
  } catch (error) {
    console.error("Socket connection error:", error);
    socket.emit("room-error", { message: "Error connecting to room" });
    socket.disconnect(true);
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