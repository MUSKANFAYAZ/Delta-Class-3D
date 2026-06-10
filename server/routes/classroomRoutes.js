const express = require("express");
const router = express.Router();
const Classroom = require("../models/Classroom");
const User = require("../models/User");
const { authMiddleware, verifyToken } = require("../lib/auth");
const { normalizeRoomCode, isValidRoomCode } = require("../utils/roomUtils");
const { 
  toAssignmentsMap, 
  getJoinStatusFromAssignments, 
  getNextPersistedSlot,
  getPendingStudentRequests 
} = require("../utils/classroomUtils");
const { getOrCreateClassroom } = require("../services/classroomService");
const { DEBUG_LOGS } = require("../config/server");

// In-memory cache for active classroom sessions (passed from main app)
let activeClassrooms;
let io;

function setActiveClassrooms(cache) {
  activeClassrooms = cache;
}

function setSocketIO(socketIO) {
  io = socketIO;
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

// POST /auth/classrooms - Create or update classroom
router.post("/classrooms", authMiddleware, async (req, res) => {
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

// GET /auth/classrooms - List classrooms
router.get("/classrooms", authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.sub || "");
    const role = String(req.user?.role || "");
    
    if (DEBUG_LOGS) console.log(`[GET /auth/classrooms] User: ${userId}, Role: ${role}`);
    
    let classrooms;
    
    if (role === "teacher") {
      classrooms = await Classroom.find({ createdBy: userId })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
    } else {
      const allClassrooms = await Classroom.find({})
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      
      classrooms = allClassrooms.filter((classroom) => {
        const approvedIds = Array.isArray(classroom.approvedStudentIds)
          ? classroom.approvedStudentIds.map((entry) => String(entry).trim())
          : [];
        const pendingIds = Array.isArray(classroom.pendingJoinRequests)
          ? classroom.pendingJoinRequests.map((entry) => String(entry.userId).trim())
          : [];
        return approvedIds.includes(userId) || pendingIds.includes(userId);
      });
    }

    if (DEBUG_LOGS) console.log(`[GET /auth/classrooms] Found ${classrooms.length} classrooms`);

    const classroomPayloads = await Promise.all(classrooms.map(async (classroom) => {
      const code = String(classroom.code || "").toLowerCase();
      const activeSession = activeClassrooms.get(code);
      const hasCreator = Boolean(classroom.createdBy);
      const assignmentCount = classroom.studentAssignments instanceof Map
        ? classroom.studentAssignments.size
        : Object.keys(classroom.studentAssignments || {}).length;
      const teacherCount = classroom.teacherPositions instanceof Map
        ? classroom.teacherPositions.size
        : Object.keys(classroom.teacherPositions || {}).length;
      const approvedIds = Array.isArray(classroom.approvedStudentIds)
        ? classroom.approvedStudentIds.map((entry) => String(entry).trim())
        : [];
      const pendingIds = Array.isArray(classroom.pendingJoinRequests)
        ? classroom.pendingJoinRequests.map((entry) => String(entry.userId).trim())
        : [];
      const isPending = !approvedIds.includes(userId) && pendingIds.includes(userId);
      const payload = {
        code,
        subject: classroom.subject || "",
        timing: classroom.timing || "",
        capacity: classroom.capacity || "",
        info: classroom.info || "",
        createdAt: classroom.createdAt || classroom.created_at || null,
        teacherPresent: Boolean(activeSession?.teacherPresent),
        participants: assignmentCount + teacherCount,
        canDelete: (hasCreator && String(classroom.createdBy || "") === userId) || (!hasCreator && role === "teacher"),
        pending: isPending,
      };

      if (role === "teacher") {
        const pendingRequests = await getPendingStudentRequests(classroom.studentAssignments, User);
        payload.pendingRequests = pendingRequests;
        payload.pendingCount = pendingRequests.length;
      } else {
        payload.joinStatus = getJoinStatusFromAssignments(classroom.studentAssignments, userId) || "approved";
      }

      return payload;
    }));

    return res.json({ classrooms: classroomPayloads });
  } catch (error) {
    console.error("[GET /auth/classrooms] Error fetching classrooms:", error?.message || error, error?.stack);
    return res.status(500).json({ message: "Error fetching classrooms", detail: error?.message });
  }
});

// GET /auth/classrooms/:code - Get classroom details
router.get("/classrooms/:code", async (req, res) => {
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

// POST /auth/classrooms/:code/join - Join classroom
router.post("/classrooms/:code/join", authMiddleware, async (req, res) => {
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

    const approvedIds = Array.isArray(classroom.approvedStudentIds)
      ? classroom.approvedStudentIds.map((entry) => String(entry).trim())
      : [];
    const pendingRequests = Array.isArray(classroom.pendingJoinRequests)
      ? classroom.pendingJoinRequests
      : [];

    if (approvedIds.includes(userId)) {
      return res.json({
        ok: true,
        code,
        joined: true,
        pending: false,
        teacherPresent: Boolean(activeClassrooms.get(code)?.teacherPresent),
        participants: (approvedIds.length || 0) + (classroom.teacherPositions?.size || 0),
      });
    }

    const existingRequest = pendingRequests.find((entry) => String(entry.userId) === userId);
    if (existingRequest) {
      return res.json({
        ok: true,
        code,
        joined: false,
        pending: true,
        message: "Join request submitted. Waiting for teacher approval.",
      });
    }

    const newRequest = {
      userId,
      displayName: String(req.user?.name || req.user?.displayName || req.user?.phone || "").trim(),
      createdAt: new Date(),
    };

    classroom.pendingJoinRequests = [
      ...pendingRequests,
      newRequest,
    ];
    await classroom.save();

    if (io) {
      io.to(code).emit("pending-requests-updated", {
        requestCount: classroom.pendingJoinRequests.length,
        request: newRequest,
      });
    }

    return res.json({
      ok: true,
      code,
      joined: false,
      pending: true,
      message: "Join request submitted. Waiting for teacher approval.",
    });
  } catch (error) {
    console.error("[POST /auth/classrooms/:code/join] Error joining classroom:", error?.message || error, error?.stack);
    return res.status(500).json({ ok: false, message: "Error joining classroom", detail: error?.message });
  }
});

// POST /auth/classrooms/:code/request-entry - Request entry to classroom
router.post("/classrooms/:code/request-entry", authMiddleware, async (req, res) => {
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
    if (role !== "student") {
      return res.status(403).json({ ok: false, message: "Only students can request classroom entry" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }

    const assignments = toAssignmentsMap(classroom.studentAssignments);
    if (!assignments.has(userId)) {
      assignments.set(userId, -1);
      classroom.studentAssignments = assignments;
      await classroom.save();
    }

    const joinStatus = getJoinStatusFromAssignments(assignments, userId) || "pending";
    if (joinStatus === "approved") {
      return res.json({ ok: true, code, joinStatus: "approved" });
    }

    const student = await User.findById(userId).select("name").lean();
    return res.json({
      ok: true,
      code,
      joinStatus: "pending",
      student: {
        userId,
        name: student?.name || "Student",
      },
    });
  } catch (error) {
    console.error("[POST /auth/classrooms/:code/request-entry] Error:", error?.message || error, error?.stack);
    return res.status(500).json({ ok: false, message: "Error requesting classroom entry", detail: error?.message });
  }
});

// POST /auth/classrooms/:code/approve-student - Approve student entry
router.post("/classrooms/:code/approve-student", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ ok: false, message: "Invalid room code format" });
    }

    const teacherId = String(req.user?.sub || "");
    const role = String(req.user?.role || "").toLowerCase();
    const studentId = String(req.body?.studentId || req.body?.userId || "").trim();

    if (!teacherId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    if (role !== "teacher") {
      return res.status(403).json({ ok: false, message: "Only teachers can approve students" });
    }
    if (!studentId) {
      return res.status(400).json({ ok: false, message: "Missing studentId" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }
    if (String(classroom.createdBy || "") !== teacherId) {
      return res.status(403).json({ ok: false, message: "Only the classroom creator can approve students" });
    }

    const assignments = toAssignmentsMap(classroom.studentAssignments);
    if (!assignments.has(studentId)) {
      return res.status(404).json({ ok: false, message: "Student is not enrolled in this classroom" });
    }
    if (Number(assignments.get(studentId)) !== -1) {
      return res.json({ ok: true, code, studentId, joinStatus: "approved", slotIndex: Number(assignments.get(studentId)) });
    }

    const slotIndex = getNextPersistedSlot(assignments);
    if (slotIndex === null) {
      return res.status(409).json({ ok: false, message: "Classroom is full" });
    }

    assignments.set(studentId, slotIndex);
    classroom.studentAssignments = assignments;
    await classroom.save();

    return res.json({
      ok: true,
      code,
      studentId,
      joinStatus: "approved",
      slotIndex,
    });
  } catch (error) {
    console.error("[POST /auth/classrooms/:code/approve-student] Error:", error?.message || error, error?.stack);
    return res.status(500).json({ ok: false, message: "Error approving student", detail: error?.message });
  }
});

// GET /auth/classrooms/:code/pending-requests - Get pending join requests
router.get("/classrooms/:code/pending-requests", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    if (!isValidRoomCode(code)) {
      return res.status(400).json({ ok: false, message: "Invalid room code format" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }

    if (String(classroom.createdBy) !== String(req.user.sub)) {
      return res.status(403).json({ ok: false, message: "Only the classroom teacher may view pending requests" });
    }

    return res.json({ ok: true, pendingRequests: Array.isArray(classroom.pendingJoinRequests) ? classroom.pendingJoinRequests : [] });
  } catch (error) {
    console.error("[GET /auth/classrooms/:code/pending-requests]", error?.message || error);
    return res.status(500).json({ ok: false, message: "Error fetching pending requests", detail: error?.message });
  }
});

// POST /auth/classrooms/:code/pending-requests/:studentId/approve - Approve pending request
router.post("/classrooms/:code/pending-requests/:studentId/approve", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    const studentId = String(req.params.studentId || "").trim();
    if (!isValidRoomCode(code) || !studentId) {
      return res.status(400).json({ ok: false, message: "Invalid request" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }

    if (String(classroom.createdBy) !== String(req.user.sub)) {
      return res.status(403).json({ ok: false, message: "Only the classroom teacher may approve students" });
    }

    const pendingRequests = Array.isArray(classroom.pendingJoinRequests) ? classroom.pendingJoinRequests : [];
    const remainingRequests = pendingRequests.filter((entry) => String(entry.userId) !== studentId);
    classroom.pendingJoinRequests = remainingRequests;
    classroom.approvedStudentIds = Array.isArray(classroom.approvedStudentIds) ? [...new Set([...classroom.approvedStudentIds, studentId])] : [studentId];
    await classroom.save();

    if (io) {
      io.to(code).emit("pending-requests-updated", { approved: studentId, requestCount: classroom.pendingJoinRequests.length });
    }
    return res.json({ ok: true, approved: studentId });
  } catch (error) {
    console.error("[POST /auth/classrooms/:code/pending-requests/:studentId/approve]", error?.message || error);
    return res.status(500).json({ ok: false, message: "Error approving request", detail: error?.message });
  }
});

// DELETE /auth/classrooms/:code/pending-requests/:studentId - Deny pending request
router.delete("/classrooms/:code/pending-requests/:studentId", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    const studentId = String(req.params.studentId || "").trim();
    if (!isValidRoomCode(code) || !studentId) {
      return res.status(400).json({ ok: false, message: "Invalid request" });
    }

    const classroom = await Classroom.findOne({ code });
    if (!classroom) {
      return res.status(404).json({ ok: false, message: "Classroom not found" });
    }

    if (String(classroom.createdBy) !== String(req.user.sub)) {
      return res.status(403).json({ ok: false, message: "Only the classroom teacher may deny requests" });
    }

    classroom.pendingJoinRequests = (Array.isArray(classroom.pendingJoinRequests) ? classroom.pendingJoinRequests : []).filter(
      (entry) => String(entry.userId) !== studentId,
    );
    await classroom.save();

    if (io) {
      io.to(code).emit("pending-requests-updated", { denied: studentId, requestCount: classroom.pendingJoinRequests.length });
    }
    return res.json({ ok: true, denied: studentId });
  } catch (error) {
    console.error("[DELETE /auth/classrooms/:code/pending-requests/:studentId]", error?.message || error);
    return res.status(500).json({ ok: false, message: "Error denying request", detail: error?.message });
  }
});

// DELETE /auth/classrooms/:code - Delete classroom
router.delete("/classrooms/:code", authMiddleware, async (req, res) => {
  try {
    const code = normalizeRoomCode(req.params.code);
    console.log(`\n[DELETE] ====== DELETE CLASSROOM REQUEST ======`);
    console.log(`[DELETE] Code: ${code}`);
    console.log(`[DELETE] User sub: ${req.user?.sub} (type: ${typeof req.user?.sub})`);
    
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

    const creatorId = classroom?.createdBy ? String(classroom.createdBy) : null;
    const requesterId = String(req.user?.sub || "");
    
    console.log(`[DELETE] ---- Authorization Check ----`);
    console.log(`[DELETE] Creator ID: "${creatorId}" (type: ${typeof creatorId})`);
    console.log(`[DELETE] Requester ID: "${requesterId}" (type: ${typeof requesterId})`);
    console.log(`[DELETE] Match: ${creatorId === requesterId}`);
    
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
    
    if (room && io) {
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

// GET /auth/_debug/mongo - Debug endpoint for MongoDB connection
router.get("/_debug/mongo", (req, res) => {
  if (String(process.env.DEBUG_DB || "").toLowerCase() !== "true") {
    return res.status(404).json({ ok: false, message: "Not found" });
  }

  const uri = process.env.MONGO_URI || process.env.MONGO_URL || process.env.DATABASE_URL || "";
  let masked = uri;
  try {
    masked = uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/, "$1<user>:<pass>@");
  } catch (e) {
    // ignore
  }

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

  const mongoose = require("mongoose");
  return res.json({
    ok: true,
    envPresent: Boolean(uri),
    uriMasked: masked,
    host,
    mongooseReadyState: mongoose.connection.readyState,
    connectedDbName: mongoose.connection.name || null,
  });
});

module.exports = { router, setActiveClassrooms, setSocketIO };
