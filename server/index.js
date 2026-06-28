const path = require("path");
const fs = require("fs");
const dotenvPath = fs.existsSync(path.join(__dirname, ".env.local"))
  ? path.join(__dirname, ".env.local")
  : path.join(__dirname, ".env");
require("dotenv").config({ path: dotenvPath });

const express = require("express");
const http = require("http");
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

// Get allowed origins from environment or default to accept all
const allowedOrigins = (() => {
  const corsOrigin = process.env.CORS_ORIGIN || "*";
  if (corsOrigin === "*") return "*";
  return corsOrigin.split(",").map((o) => o.trim());
})();

console.log("[STARTUP] CORS Configuration:", {
  allowedOrigins,
  corsOrigin: process.env.CORS_ORIGIN || "(default: *)",
});

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  credentials: allowedOrigins !== "*" ? true : false,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

// Detailed logging middleware for all requests
app.use((req, res, next) => {
  console.log("[HTTP]", {
    method: req.method,
    path: req.path,
    origin: req.get("origin"),
    host: req.get("host"),
    userAgent: req.get("user-agent")?.substring(0, 50),
    timestamp: new Date().toISOString(),
  });
  next();
});

app.use((req, res, next) => {
  if (DEBUG_LOGS) console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

app.use(createHealthRouter({ mongoose, User }));
app.use("/auth", authRouter);

const io = new Server(server, {
  cors: corsOptions,
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

console.log("[STARTUP] Critical environment variables:");
console.log(`  JWT_SECRET: ${CRITICAL_ENV_VARS.JWT_SECRET ? "✓ SET" : "✗ NOT SET (using fallback)"}`);
console.log(`  MONGO_URI: ${CRITICAL_ENV_VARS.MONGO_URI ? "✓ SET" : "✗ NOT SET"}`);

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("✗ MONGO_URI not set — server will not connect to any database. Set MONGO_URI to your MongoDB Atlas connection string and restart.");
  process.exit(1);
}

mongoose
  .connect(mongoUri)
  .then(() => {
    console.log("✅ MongoDB Connected");
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`✓ Server started on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Failed:", err);
    process.exit(1);
  });
