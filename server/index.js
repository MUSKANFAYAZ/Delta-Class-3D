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
const User = require("./models/User");
const { authMiddleware, verifyToken } = require("./lib/auth");

// Controlled debug logging. Set DEBUG_LOGS=true in env to enable verbose logs.
const DEBUG_LOGS = String(process.env.DEBUG_LOGS || "").toLowerCase() === "true";

const PORT = process.env.PORT || 3000;
const MAX_STUDENT_SLOTS = 25;

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
app.use(express.json({ limit: "1mb" }));

// Request logging middleware
app.use((req, res, next) => {
  if (DEBUG_LOGS) console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/health/db", async (_req, res) => {
  try {
    const isConnected = mongoose.connection.readyState === 1;
    const dbName = mongoose.connection.name;
    if (!isConnected) {
      return res.status(503).json({ ok: false, message: "MongoDB not connected", readyState: mongoose.connection.readyState });
    }
    // Try a simple DB operation
    const userCount = await User.countDocuments();
    return res.json({ 
      ok: true, 
      message: "Database connected", 
      database: dbName,
      userCount,
      readyState: mongoose.connection.readyState
    });
  } catch (error) {
    console.error("[/health/db] Error:", error?.message);
    return res.status(503).json({ ok: false, message: "Database error", detail: error?.message });
  }
});

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
      if (typeof owner.toString === "function") {
        const text = String(owner.toString());
        if (text && text !== "[object Object]") return text;
      }
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
    if (typeof host.toString === "function") {
      const text = String(host.toString());
      if (text && text !== "[object Object]") return text;
    }
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

function createActiveSessionFromClassroom(classroom) {
  return {
    studentAssignments: new Map(),
    studentPositions: new Map(),
    teacherPositions: new Map(),
    teacherSocketIds: new Set(),
    teacherPresent: false,
    blackboardStrokes: Array.isArray(classroom?.blackboardStrokes)
      ? [...classroom.blackboardStrokes]
      : [],
    userAudioStates: new Map(),
    raiseHands: new Set(),
    userDisplayNames: new Map(),
  };
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
  if (DEBUG_LOGS) console.log(`Serving frontend from ${clientBuildPath}`);
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

  if (classroom.presentation) {
    socket.emit("presentation-start", classroom.presentation);
  }
}

function emitExistingPeers(socket, roomCode, activeSession) {
  const existingPeers = Array.from(io.sockets.adapter.rooms.get(roomCode) || [])
    .filter(id => id !== socket.id)
    .map(id => ({
      userId: id,
      role: activeSession.teacherSocketIds.has(id) ? "teacher" : "student"
    }));

  if (existingPeers.length > 0) {
    socket.emit("existing-peers", existingPeers);
  }
}

app.post("/auth/classrooms", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.body?.code);
    const { subject, timing, capacity, info } = req.body;
    
    if (DEBUG_LOGS) console.log(`[POST /auth/classrooms] User: ${req.user?.sub}, Code: ${code}`);
    
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
    
    if (DEBUG_LOGS) console.log(`[POST /auth/classrooms] Created/Updated classroom ${code} by user ${req.user.sub}, createdBy in DB: ${classroom.createdBy}`);
    
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
    console.error("[POST /auth/classrooms] Error creating classroom:", error?.message || error, error?.stack);
    res.status(500).json({ message: "Error creating classroom", detail: error?.message });
  }
});

app.get("/auth/classrooms", authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    const role = String(req.user?.role || "");
    
    if (DEBUG_LOGS) console.log(`[GET /auth/classrooms] User: ${userId}, Role: ${role}`);
    
    let classrooms;
    
    if (role === "teacher") {
      // Teachers see only classrooms they created
      classrooms = await Classroom.find({ createdBy: userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    } else {
      // Students see all classrooms, but filter to those they're assigned to
      const allClassrooms = await Classroom.find({})
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      
      classrooms = allClassrooms.filter((classroom) => {
        const studentAssignmentKeys = Object.keys(classroom.studentAssignments || {});
        return studentAssignmentKeys.includes(userId);
      });
    }

    if (DEBUG_LOGS) console.log(`[GET /auth/classrooms] Found ${classrooms.length} classrooms`);

    return res.json({
      classrooms: classrooms.map((classroom) => {
        const code = String(classroom.code || "").toLowerCase();
        const activeSession = activeClassrooms.get(code);
        const hasCreator = Boolean(classroom.createdBy);
        return {
          code,
          subject: classroom.subject || "",
          timing: classroom.timing || "",
          capacity: classroom.capacity || "",
          info: classroom.info || "",
          createdAt: classroom.createdAt || classroom.created_at || null,
          teacherPresent: Boolean(activeSession?.teacherPresent),
          participants: (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0),
          canDelete: (hasCreator && String(classroom.createdBy || "") === userId) || (!hasCreator && role === "teacher"),
        };
      }),
    });
  } catch (error) {
    console.error("[GET /auth/classrooms] Error fetching classrooms:", error?.message || error, error?.stack);
    return res.status(500).json({ message: "Error fetching classrooms", detail: error?.message });
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
      teacherPresent: Boolean(activeClassrooms.get(code)?.teacherPresent),
      participants: classroom
        ? (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0)
        : 0,
    });
  } catch (error) {
    console.error("Error fetching classroom:", error);
    res.status(500).json({ exists: false, message: "Error fetching classroom" });
  }
});

app.post("/auth/classrooms/:code/join", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ ok: false, message: "Invalid room code format" });
    }

    const userId = String(req.user?.sub || "");
    const role = String(req.user?.role || "").toLowerCase();
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }

    if (role === "teacher") {
      const isOwner = String(classroom.createdBy || "") === userId;
      return res.json({ ok: true, code, joined: false, role: "teacher", canDelete: isOwner });
    }

    const assignments = classroom.studentAssignments instanceof Map
      ? classroom.studentAssignments
      : new Map(Object.entries(classroom.studentAssignments || {}));

    if (!assignments.has(userId)) {
      assignments.set(userId, -1);
      classroom.studentAssignments = assignments;
      await classroom.save();
    }

    return res.json({
      ok: true,
      code,
      joined: true,
      teacherPresent: Boolean(activeClassrooms.get(code)?.teacherPresent),
      participants: (classroom.studentAssignments?.size || assignments.size || 0) + (classroom.teacherPositions?.size || 0),
    });
  } catch (error) {
    console.error("[POST /auth/classrooms/:code/join] Error joining classroom:", error?.message || error, error?.stack);
    return res.status(500).json({ ok: false, message: "Error joining classroom", detail: error?.message });
  }
});

// Temporary debug endpoint to verify which MongoDB URI the server is using.
// Enable by setting DEBUG_DB=true in the environment (do NOT leave enabled long-term).
app.get("/auth/_debug/mongo", (req, res) => {
  if (String(process.env.DEBUG_DB || "").toLowerCase() !== "true") {
    return res.status(404).json({ ok: false, message: "Not found" });
  }

  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL || "";
  let masked = uri;
  try {
    // Mask credentials if present
    masked = uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1<user>:<pass>@");
  } catch (e) {
    // ignore
  }

  // Extract host portion for easier identification
  let host = "";
  try {
    const atIndex = uri.indexOf("@");
    if (atIndex !== -1) {
      const afterAt = uri.substring(atIndex + 1);
      const slashIndex = afterAt.indexOf("/");
      host = slashIndex === -1 ? afterAt : afterAt.substring(0, slashIndex);
    } else if (uri.startsWith("mongodb+srv://") || uri.startsWith("mongodb://")) {
      const withoutProto = uri.replace(/^mongodb(?:\+srv)?:\/\//, "");
      const slashIndex = withoutProto.indexOf("/");
      host = slashIndex === -1 ? withoutProto : withoutProto.substring(0, slashIndex);
    }
  } catch (e) {
    host = "";
  }

  return res.json({
    ok: true,
    envPresent: Boolean(uri),
    uriMasked: masked,
    host,
    mongooseReadyState: mongoose.connection.readyState,
    connectedDbName: mongoose.connection.name || null,
  });
});

// Serve index.html for SPA routing (only if build exists).
// Express 5 + path-to-regexp rejects bare "*" routes, so use method-guarded middleware.
if (clientBuildExists) {
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/auth") || req.path.startsWith("/health") || req.path.startsWith("/socket.io")) {
      return next();
    }
    const indexPath = path.join(clientBuildPath, "index.html");
    return res.sendFile(indexPath, { headers: { "Cache-Control": "no-cache" } });
  });
}

// Attach Socket.IO connection handlers (moved to modular file)
const attachSocketHandlers = require("./socketHandlers");
attachSocketHandlers(io, {
  getRole,
  normalizeRoomCode,
  isValidRoomCode,
  Classroom,
  activeClassrooms,
  createActiveSessionFromClassroom,
  getNextAvailableSlot,
  broadcastSnapshot,
  emitExistingPeers,
  DEBUG_LOGS,
});

// DELETE classroom logic
app.delete("/auth/classrooms/:code", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    console.log(`\n[DELETE] ====== DELETE CLASSROOM REQUEST ======`);
    console.log(`[DELETE] Code: ${code}`);
    console.log(`[DELETE] User sub: ${req.user?.sub} (type: ${typeof req.user?.sub})`);
    console.log(`[DELETE] DB status: ${mongoose.connection.readyState === 1 ? "Connected" : "Disconnected"}`);
    
    if (!isValidRoomCode(code)) {
      console.warn(`[DELETE] FAILED: Invalid room code format: ${code}`);
      return res.status(400).json({ ok: false, message: "Invalid room code format" });
    }

    const room = activeClassrooms.get(code);
    const classroom = await Classroom.findOne({ code });
    console.log(`[DELETE] Room in memory: ${!!room}`);
    console.log(`[DELETE] Classroom in DB: ${!!classroom}`);
    
    if (!room && !classroom) {
      console.warn(`[DELETE] FAILED: Room not found in memory or DB`);
      return res.status(404).json({ ok: false, message: "Room not found" });
    }

    if (classroom) {
      console.log(`[DELETE] Classroom found: ${classroom._id}`);
      console.log(`[DELETE] Classroom createdBy: ${classroom.createdBy} (type: ${typeof classroom.createdBy})`);
    }

    // Authorization: only the creator can delete the classroom
    const creatorId = classroom?.createdBy ? String(classroom.createdBy) : null;
    const requesterId = String(req.user?.sub || "");
    
    console.log(`[DELETE] ---- Authorization Check ----`);
    console.log(`[DELETE] Creator ID: "${creatorId}" (type: ${typeof creatorId})`);
    console.log(`[DELETE] Requester ID: "${requesterId}" (type: ${typeof requesterId})`);
    console.log(`[DELETE] Match: ${creatorId === requesterId}`);
    
    // If classroom exists, check creator matches; if no creator, deny
    if (!creatorId || creatorId !== requesterId) {
      console.warn(`[DELETE] FAILED: Authorization denied`);
      console.warn(`[DELETE] Expected "${creatorId}" but got "${requesterId}"`);
      return res.status(403).json({
        ok: false,
        message: "Only the classroom creator can delete this class",
      });
    }

    console.log(`[DELETE] ✓ Authorization passed`);
    console.log(`[DELETE] ---- Deleting from Database ----`);
    const deleteResult = await Classroom.deleteMany({ code });
    console.log(`[DELETE] deleteMany result: deletedCount = ${deleteResult?.deletedCount}`);
    
    if (!deleteResult || deleteResult.deletedCount < 1) {
      console.warn(`[DELETE] FAILED: No documents deleted for code: ${code}`);
      return res.status(404).json({ ok: false, message: "Room not found" });
    }
    
    console.log(`[DELETE] ✓ Deleted ${deleteResult.deletedCount} document(s) from DB`);
    
    if (room) {
      io.to(code).emit("room-error", { message: "This classroom has been deleted." });
      for (const socketId of io.sockets.adapter.rooms.get(code) || []) {
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
    }
    activeClassrooms.delete(code);
    console.log(`[DELETE] ✓ Removed from in-memory cache`);
    console.log(`[DELETE] ====== DELETE CLASSROOM SUCCESS ======\n`);
    
    return res.json({
      ok: true,
      message: "Classroom deleted",
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error(`[DELETE] ERROR: ${error?.message || error}`);
    console.error(error?.stack);
    return res.status(500).json({ ok: false, message: "Error deleting classroom", detail: error?.message });
  }
});

// Global Error Handler for Express 5+
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err?.message || err, err?.stack);
  const status = err.status || 500;
  res.status(status).json({ 
    message: "Internal Server Error", 
    detail: err.message || "Unknown database or execution error",
    path: req.path,
    method: req.method
  });
});

// Catch unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]", error?.message || error, error?.stack);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Server started on port ${PORT}`);
});

// Verify critical environment variables on startup
const CRITICAL_ENV_VARS = {
  JWT_SECRET: process.env.JWT_SECRET || "delta-class3d-dev-secret",
  MONGO_URI: process.env.MONGO_URI,
};

console.log("[STARTUP] Critical environment variables:");
console.log(`  JWT_SECRET: ${CRITICAL_ENV_VARS.JWT_SECRET ? "✓ SET" : "✗ NOT SET (using fallback)"}`);
console.log(`  MONGO_URI: ${CRITICAL_ENV_VARS.MONGO_URI ? "✓ SET" : "✗ NOT SET"}`);

// Use MONGO_URI only (Atlas). Ignore Railway's MONGO_URL, DATABASE_URL, etc. to prevent accidental Railway DB writes.
const MONGO_URI = CRITICAL_ENV_VARS.MONGO_URI;
if (MONGO_URI) {
  // Extract host from URI for logging (helps verify Atlas vs Railway)
  let logHost = "";
  try {
    const atIdx = MONGO_URI.indexOf("@");
    if (atIdx !== -1) {
      const afterAt = MONGO_URI.substring(atIdx + 1);
      logHost = afterAt.split("/")[0]; // Extract host before first slash
    }
  } catch (e) {
    logHost = "unknown";
  }
  
  console.log(`[DB] Connecting to MongoDB URI with host: ${logHost}`);
  mongoose
    .connect(MONGO_URI)
    .then(() => {
      console.log(`✓ MongoDB connected to database: ${mongoose.connection.name} (URI host: ${logHost})`);
    })
    .catch((e) => {
      console.error(`✗ MongoDB connection failed for host ${logHost}:`, e?.message || e);
    });
} else {
  console.error("✗ MONGO_URI not set — server will not connect to any database. Set MONGO_URI to your MongoDB Atlas connection string and restart.");
}