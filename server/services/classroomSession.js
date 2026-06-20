const Classroom = require("../models/Classroom");
const User = require("../models/User");
const { verifyToken } = require("../lib/auth");
const { DEBUG_LOGS, MAX_STUDENT_SLOTS } = require("../config/server");

const activeClassrooms = new Map();

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

function normalizeParticipantName(value, fallback) {
  const text = String(value || "").trim();
  return text || String(fallback || "").trim() || "Unknown participant";
}

async function resolveParticipantDetails(classroom, activeSession = null) {
  const participantNames = [];
  const seen = new Set();

  const addName = (value) => {
    const name = normalizeParticipantName(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    participantNames.push(name);
  };

  if (activeSession?.userDisplayNames instanceof Map) {
    for (const [, displayName] of activeSession.userDisplayNames.entries()) {
      addName(displayName);
    }
  }

  const classroomAssignments = classroom?.studentAssignments instanceof Map
    ? Array.from(classroom.studentAssignments.keys())
    : Object.keys(classroom?.studentAssignments || {});
  const approvedStudentIds = Array.isArray(classroom?.approvedStudentIds)
    ? classroom.approvedStudentIds.map((value) => String(value).trim())
    : [];

  const teacherIds = classroom?.createdBy ? [String(classroom.createdBy)] : [];
  const knownIds = Array.from(new Set([
    ...classroomAssignments,
    ...approvedStudentIds,
    ...teacherIds,
  ].map((value) => String(value).trim()).filter(Boolean)));

  if (knownIds.length > 0) {
    try {
      const users = await User.find({ _id: { $in: knownIds } }).select("name userId role").lean();
      for (const user of users || []) {
        addName(user?.name || user?.userId || user?._id);
      }
    } catch (error) {
      if (DEBUG_LOGS) console.warn("[participant lookup] failed:", error?.message || error);
    }
  }

  return {
    participantNames,
    participants: participantNames.length,
  };
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
    discussionFeed: Array.isArray(classroom?.discussionFeed)
      ? [...classroom.discussionFeed]
      : [],
    discussionPolls: Array.isArray(classroom?.discussionPolls)
      ? [...classroom.discussionPolls]
      : [],
    userAudioStates: new Map(),
    voiceRelaySpeakers: new Map(),
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

function getUserFromSocket(socket) {
  const token = String(socket.handshake.auth?.token || socket.handshake.query?.token || "").trim();
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
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

function createEmitExistingPeers(io) {
  return function emitExistingPeers(socket, roomCode, activeSession) {
    const existingPeers = Array.from(io.sockets.adapter.rooms.get(roomCode) || [])
      .filter((id) => id !== socket.id)
      .map((id) => ({
        userId: id,
        role: activeSession.teacherSocketIds.has(id) ? "teacher" : "student",
      }));

    if (existingPeers.length > 0) {
      socket.emit("existing-peers", existingPeers);
    }
  };
}

module.exports = {
  activeClassrooms,
  getOrCreateClassroom,
  resolveParticipantDetails,
  createActiveSessionFromClassroom,
  getUserFromAuthHeader,
  getUserFromSocket,
  getRole,
  getNextAvailableSlot,
  broadcastSnapshot,
  createEmitExistingPeers,
};
