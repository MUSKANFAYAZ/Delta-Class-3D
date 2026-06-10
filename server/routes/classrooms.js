const express = require("express");
const mongoose = require("mongoose");
const Classroom = require("../models/Classroom");
const { authMiddleware } = require("../lib/auth");
const { DEBUG_LOGS } = require("../config/server");
const { normalizeRoomCode, isValidRoomCode } = require("../utils/roomCode");
const {
  activeClassrooms,
  getOrCreateClassroom,
  resolveParticipantDetails,
  getUserFromAuthHeader,
} = require("../services/classroomSession");

module.exports = function createClassroomsRouter(io) {
  const router = express.Router();

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

      const participantDetails = await resolveParticipantDetails(classroom);

      return res.status(exists ? 200 : 201).json({
        ok: true,
        code: classroom.code,
        exists: Boolean(exists),
        subject: classroom.subject,
        timing: classroom.timing,
        capacity: classroom.capacity,
        info: classroom.info,
        canDelete: String(classroom.createdBy) === String(req.user.sub),
        participants: participantDetails.participants || (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0),
        participantNames: participantDetails.participantNames,
      });
    } catch (error) {
      console.error("[POST /auth/classrooms] Error creating classroom:", error?.message || error, error?.stack);
      res.status(500).json({ message: "Error creating classroom", detail: error?.message });
    }
  });

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

      const classroomsWithParticipants = await Promise.all(classrooms.map(async (classroom) => {
        const code = String(classroom.code || "").toLowerCase();
        const activeSession = activeClassrooms.get(code);
        const hasCreator = Boolean(classroom.createdBy);
        const participantDetails = await resolveParticipantDetails(classroom, activeSession);
        const approvedIds = Array.isArray(classroom.approvedStudentIds)
          ? classroom.approvedStudentIds.map((entry) => String(entry).trim())
          : [];
        const pendingIds = Array.isArray(classroom.pendingJoinRequests)
          ? classroom.pendingJoinRequests.map((entry) => String(entry.userId).trim())
          : [];
        const isPending = !approvedIds.includes(userId) && pendingIds.includes(userId);

        return {
          code,
          subject: classroom.subject || "",
          timing: classroom.timing || "",
          capacity: classroom.capacity || "",
          info: classroom.info || "",
          createdAt: classroom.createdAt || classroom.created_at || null,
          teacherPresent: Boolean(activeSession?.teacherPresent),
          participants: participantDetails.participants || (classroom.studentAssignments?.size || 0) + (classroom.teacherPositions?.size || 0),
          participantNames: participantDetails.participantNames,
          canDelete: (hasCreator && String(classroom.createdBy || "") === userId) || (!hasCreator && role === "teacher"),
          pending: isPending,
        };
      }));

      return res.json({
        classrooms: classroomsWithParticipants,
      });
    } catch (error) {
      console.error("[GET /auth/classrooms] Error fetching classrooms:", error?.message || error, error?.stack);
      return res.status(500).json({ message: "Error fetching classrooms", detail: error?.message });
    }
  });

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
      const participantDetails = await resolveParticipantDetails(classroom, activeClassrooms.get(code));

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
        participantNames: participantDetails.participantNames,
      });
    } catch (error) {
      console.error("Error fetching classroom:", error);
      res.status(500).json({ exists: false, message: "Error fetching classroom" });
    }
  });

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

      io.to(code).emit("pending-requests-updated", {
        requestCount: classroom.pendingJoinRequests.length,
        request: newRequest,
      });

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

      io.to(code).emit("pending-requests-updated", { approved: studentId, requestCount: classroom.pendingJoinRequests.length });
      return res.json({ ok: true, approved: studentId });
    } catch (error) {
      console.error("[POST /auth/classrooms/:code/pending-requests/:studentId/approve]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error approving request", detail: error?.message });
    }
  });

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

      io.to(code).emit("pending-requests-updated", { denied: studentId, requestCount: classroom.pendingJoinRequests.length });
      return res.json({ ok: true, denied: studentId });
    } catch (error) {
      console.error("[DELETE /auth/classrooms/:code/pending-requests/:studentId]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error denying request", detail: error?.message });
    }
  });

  router.get("/classrooms/:code/discussion", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      if (!isValidRoomCode(code)) {
        return res.status(400).json({ ok: false, message: "Invalid room code format" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      return res.json({
        ok: true,
        feed: Array.isArray(classroom.discussionFeed) ? classroom.discussionFeed : [],
        polls: Array.isArray(classroom.discussionPolls) ? classroom.discussionPolls : [],
      });
    } catch (error) {
      console.error("[GET /auth/classrooms/:code/discussion]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error fetching discussion state", detail: error?.message });
    }
  });

  router.post("/classrooms/:code/discussion/message", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      if (!isValidRoomCode(code)) {
        return res.status(400).json({ ok: false, message: "Invalid room code format" });
      }

      const text = String(req.body?.text || "").trim();
      if (!text) {
        return res.status(400).json({ ok: false, message: "Message text is required" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "message",
        text,
        displayName: String(req.user?.name || req.user?.displayName || "").trim() || "Unknown",
        userId: String(req.user?.sub || ""),
        createdAt: Date.now(),
      };

      classroom.discussionFeed = Array.isArray(classroom.discussionFeed) ? [...classroom.discussionFeed, item] : [item];
      if (classroom.discussionFeed.length > 500) classroom.discussionFeed = classroom.discussionFeed.slice(-500);
      await classroom.save();

      io.to(code).emit("discussion-update", item);
      return res.json({ ok: true, item });
    } catch (error) {
      console.error("[POST /auth/classrooms/:code/discussion/message]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error saving message", detail: error?.message });
    }
  });

  router.post("/classrooms/:code/discussion/image", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      if (!isValidRoomCode(code)) {
        return res.status(400).json({ ok: false, message: "Invalid room code format" });
      }

      const dataUrl = String(req.body?.dataUrl || "").trim();
      if (!dataUrl.startsWith("data:image/")) {
        return res.status(400).json({ ok: false, message: "Image data is required" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "image",
        name: String(req.body?.name || "image").trim(),
        dataUrl,
        displayName: String(req.user?.name || req.user?.displayName || "").trim() || "Unknown",
        userId: String(req.user?.sub || ""),
        createdAt: Date.now(),
      };

      classroom.discussionFeed = Array.isArray(classroom.discussionFeed) ? [...classroom.discussionFeed, item] : [item];
      if (classroom.discussionFeed.length > 500) classroom.discussionFeed = classroom.discussionFeed.slice(-500);
      await classroom.save();

      io.to(code).emit("discussion-update", item);
      return res.json({ ok: true, item });
    } catch (error) {
      console.error("[POST /auth/classrooms/:code/discussion/image]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error saving image", detail: error?.message });
    }
  });

  router.delete("/classrooms/:code/discussion/message/:messageId", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      const messageId = String(req.params.messageId || "").trim();
      if (!isValidRoomCode(code) || !messageId) {
        return res.status(400).json({ ok: false, message: "Invalid request" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      const feed = Array.isArray(classroom.discussionFeed) ? classroom.discussionFeed : [];
      const existing = feed.find((item) => String(item.id) === messageId);
      if (!existing) {
        return res.status(404).json({ ok: false, message: "Message not found" });
      }

      const userId = String(req.user?.sub || "");
      const isTeacher = String(classroom.createdBy) === userId;
      if (String(existing.userId) !== userId && !isTeacher) {
        return res.status(403).json({ ok: false, message: "Only the sender or teacher may delete this message" });
      }

      classroom.discussionFeed = feed.filter((item) => String(item.id) !== messageId);
      await classroom.save();

      io.to(code).emit("discussion-delete", { id: messageId });
      return res.json({ ok: true, deleted: messageId });
    } catch (error) {
      console.error("[DELETE /auth/classrooms/:code/discussion/message/:messageId]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error deleting message", detail: error?.message });
    }
  });

  router.post("/classrooms/:code/discussion/poll", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      if (!isValidRoomCode(code)) {
        return res.status(400).json({ ok: false, message: "Invalid room code format" });
      }

      const question = String(req.body?.question || "").trim();
      const options = Array.isArray(req.body?.options)
        ? req.body.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 6)
        : [];

      if (!question || options.length < 2) {
        return res.status(400).json({ ok: false, message: "Poll question and at least 2 options are required" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      const poll = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question,
        options: options.map((text) => ({ text, votes: 0 })),
        votesByUser: {},
        displayName: String(req.user?.name || req.user?.displayName || "").trim() || "Unknown",
        userId: String(req.user?.sub || ""),
        createdAt: Date.now(),
      };

      classroom.discussionPolls = Array.isArray(classroom.discussionPolls) ? [poll, ...classroom.discussionPolls] : [poll];
      if (classroom.discussionPolls.length > 50) classroom.discussionPolls = classroom.discussionPolls.slice(0, 50);
      await classroom.save();

      io.to(code).emit("discussion-poll-update", poll);
      return res.json({ ok: true, poll });
    } catch (error) {
      console.error("[POST /auth/classrooms/:code/discussion/poll]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error saving poll", detail: error?.message });
    }
  });

  router.post("/classrooms/:code/discussion/poll/:pollId/vote", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      const pollId = String(req.params.pollId || "").trim();
      const optionIndex = Number(req.body?.optionIndex);
      if (!isValidRoomCode(code) || !pollId || !Number.isInteger(optionIndex)) {
        return res.status(400).json({ ok: false, message: "Invalid request" });
      }

      const classroom = await Classroom.findOne({ code });
      if (!classroom) {
        return res.status(404).json({ ok: false, message: "Classroom not found" });
      }

      const poll = (Array.isArray(classroom.discussionPolls) ? classroom.discussionPolls : []).find((entry) => String(entry.id) === pollId);
      if (!poll || optionIndex < 0 || optionIndex >= poll.options.length) {
        return res.status(400).json({ ok: false, message: "Invalid poll or option" });
      }

      poll.votesByUser = poll.votesByUser && typeof poll.votesByUser === "object" ? poll.votesByUser : {};
      const previousVote = poll.votesByUser[String(req.user.sub)];
      if (Number.isInteger(previousVote) && poll.options[previousVote]) {
        poll.options[previousVote].votes = Math.max(0, Number(poll.options[previousVote].votes || 0) - 1);
      }

      poll.options[optionIndex].votes = Number(poll.options[optionIndex].votes || 0) + 1;
      poll.votesByUser[String(req.user.sub)] = optionIndex;

      await classroom.save();

      io.to(code).emit("discussion-poll-update", poll);
      return res.json({ ok: true, poll });
    } catch (error) {
      console.error("[POST /auth/classrooms/:code/discussion/poll/:pollId/vote]", error?.message || error);
      return res.status(500).json({ ok: false, message: "Error voting on poll", detail: error?.message });
    }
  });

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

    return res.json({
      ok: true,
      envPresent: Boolean(uri),
      uriMasked: masked,
      host,
      mongooseReadyState: mongoose.connection.readyState,
      connectedDbName: mongoose.connection.name || null,
    });
  });

  router.delete("/classrooms/:code", authMiddleware, async (req, res) => {
    try {
      const code = normalizeRoomCode(req.params.code);
      console.log("\n[DELETE] ====== DELETE CLASSROOM REQUEST ======");
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
        console.warn("[DELETE] FAILED: Room not found in memory or DB");
        return res.status(404).json({ ok: false, message: "Room not found" });
      }

      if (classroom) {
        console.log(`[DELETE] Classroom found: ${classroom._id}`);
        console.log(`[DELETE] Classroom createdBy: ${classroom.createdBy} (type: ${typeof classroom.createdBy})`);
      }

      const creatorId = classroom?.createdBy ? String(classroom.createdBy) : null;
      const requesterId = String(req.user?.sub || "");

      console.log("[DELETE] ---- Authorization Check ----");
      console.log(`[DELETE] Creator ID: "${creatorId}" (type: ${typeof creatorId})`);
      console.log(`[DELETE] Requester ID: "${requesterId}" (type: ${typeof requesterId})`);
      console.log(`[DELETE] Match: ${creatorId === requesterId}`);

      if (!creatorId || creatorId !== requesterId) {
        console.warn("[DELETE] FAILED: Authorization denied");
        console.warn(`[DELETE] Expected "${creatorId}" but got "${requesterId}"`);
        return res.status(403).json({
          ok: false,
          message: "Only the classroom creator can delete this class",
        });
      }

      console.log("[DELETE] ✓ Authorization passed");
      console.log("[DELETE] ---- Deleting from Database ----");
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
      console.log("[DELETE] ✓ Removed from in-memory cache");
      console.log("[DELETE] ====== DELETE CLASSROOM SUCCESS ======\n");

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

  return router;
};
