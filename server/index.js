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
const createHealthRouter = require("./routes/health");
const createClassroomsRouter = require("./routes/classrooms");
const attachSocketHandlers = require("./socketHandlers");
const { DEBUG_LOGS, PORT, CRITICAL_ENV_VARS } = require("./config/server");
const { normalizeRoomCode, isValidRoomCode } = require("./utils/roomCode");
const {
  activeClassrooms,
  createActiveSessionFromClassroom,
  getUserFromSocket,
  getRole,
  getNextAvailableSlot,
  broadcastSnapshot,
  createEmitExistingPeers,
} = require("./services/classroomSession");

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "PATCH", "DELETE"] }));
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  if (DEBUG_LOGS) console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

app.use(createHealthRouter({ mongoose, User }));
app.use("/auth", authRouter);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Increase buffer size to allow larger binary frames (voice chunks)
  // Default may be too small for some recorder chunks and cause parser errors
  maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB
  // Tune ping/pong timeouts if your hosting provider terminates idle websockets
  pingInterval: 25000,
  pingTimeout: 60000,
});

const clientBuildPath = path.join(__dirname, "../client/dist");
const clientBuildExists = fs.existsSync(clientBuildPath);

if (clientBuildExists) {
  app.use(express.static(clientBuildPath));
  if (DEBUG_LOGS) console.log(`Serving frontend from ${clientBuildPath}`);
} else {
  app.use((_req, res) => {
    res.status(503).send("Frontend build not available");
  });
}

app.use("/auth", createClassroomsRouter(io));

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

attachSocketHandlers(io, {
  getRole,
  normalizeRoomCode,
  isValidRoomCode,
  Classroom,
  activeClassrooms,
  createActiveSessionFromClassroom,
  getUserFromSocket,
  getNextAvailableSlot,
  broadcastSnapshot,
  emitExistingPeers: createEmitExistingPeers(io),
  DEBUG_LOGS,
});

app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err?.message || err, err?.stack);
  const status = err.status || 500;
  res.status(status).json({
    message: "Internal Server Error",
    detail: err.message || "Unknown database or execution error",
    path: req.path,
    method: req.method,
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]", error?.message || error, error?.stack);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Server started on port ${PORT}`);
});

console.log("[STARTUP] Critical environment variables:");
console.log(`  JWT_SECRET: ${CRITICAL_ENV_VARS.JWT_SECRET ? "✓ SET" : "✗ NOT SET (using fallback)"}`);
console.log(`  MONGO_URI: ${CRITICAL_ENV_VARS.MONGO_URI ? "✓ SET" : "✗ NOT SET"}`);

const MONGO_URI = CRITICAL_ENV_VARS.MONGO_URI;
if (MONGO_URI) {
  let logHost = "";
  try {
    const atIdx = MONGO_URI.indexOf("@");
    if (atIdx !== -1) {
      const afterAt = MONGO_URI.substring(atIdx + 1);
      logHost = afterAt.split("/")[0];
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
