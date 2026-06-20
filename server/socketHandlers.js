module.exports = function attachSocketHandlers(io, deps) {
  const {
    getRole,
    normalizeRoomCode,
    isValidRoomCode,
    Classroom,
    activeClassrooms,
    createActiveSessionFromClassroom,
    getUserFromSocket,
    getNextAvailableSlot,
    broadcastSnapshot,
    emitExistingPeers,
    DEBUG_LOGS,
  } = deps;

  const parsedVoiceLimit = Number.parseInt(process.env.VOICE_MESH_PARTICIPANT_LIMIT || "12", 10);
  const VOICE_MESH_PARTICIPANT_LIMIT = Number.isFinite(parsedVoiceLimit) && parsedVoiceLimit > 0
    ? parsedVoiceLimit
    : 12;

  function emitVoiceScalingState(roomCode) {
    const participantCount = Number(io.sockets.adapter.rooms.get(roomCode)?.size || 0);

    io.to(roomCode).emit("voice-scaling-state", {
      roomCode,
      participantCount,
      meshParticipantLimit: VOICE_MESH_PARTICIPANT_LIMIT,
      topology: "server-relay",
      message: `Room audio is relayed through the classroom server so the teacher and approved students are audible to everyone.`,
    });
  }

  function getVoiceRelayState(activeSession) {
    if (!activeSession.voiceRelaySpeakers) {
      activeSession.voiceRelaySpeakers = new Map();
    }
    return activeSession.voiceRelaySpeakers;
  }

  function canSpeakViaRelay(activeSession, socket, role) {
    if (role === "teacher") {
      return true;
    }

    const audioState = activeSession.userAudioStates?.get(socket.id);
    return Boolean(audioState && audioState.muted === false);
  }

  function broadcastVoiceRelayState(roomCode, activeSession) {
    io.to(roomCode).emit("voice-relay-state", {
      speakers: Array.from(getVoiceRelayState(activeSession).values()).map((entry) => ({
        speakerId: entry.speakerId,
        role: entry.role,
        displayName: entry.displayName,
        mimeType: entry.mimeType,
      })),
    });
  }

  function getParticipantRoster(roomCode, activeSession) {
    const roomSocketIds = Array.from(io.sockets.adapter.rooms.get(roomCode) || []);
    const participants = roomSocketIds.map((socketId) => ({
      userId: socketId,
      displayName: activeSession.userDisplayNames?.get(socketId) || socketId,
      role: activeSession.teacherSocketIds.has(socketId) ? "teacher" : "student",
    }));
    return participants;
  }

  async function persistDiscussionState(classroom, activeSession) {
    if (!classroom) return;
    classroom.discussionFeed = Array.isArray(activeSession.discussionFeed) ? [...activeSession.discussionFeed] : [];
    classroom.discussionPolls = Array.isArray(activeSession.discussionPolls) ? [...activeSession.discussionPolls] : [];
    await classroom.save().catch((err) => console.error("Error saving discussion state:", err));
  }

  function emitParticipantsState(roomCode, activeSession) {
    io.to(roomCode).emit("participants-state", {
      count: Number(io.sockets.adapter.rooms.get(roomCode)?.size || 0),
      participants: getParticipantRoster(roomCode, activeSession),
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
      let classroom = null;
      try {
        classroom = await Classroom.findOne({ code: roomCode });
      } catch (dbError) {
        if (DEBUG_LOGS) console.error("Classroom lookup failed:", dbError?.message || dbError);
      }

      const hasActiveSession = activeClassrooms.has(roomCode);
      if (!classroom && !hasActiveSession && role !== "teacher") {
        socket.emit("room-error", { message: "Room does not exist" });
        socket.disconnect(true);
        return;
      }

      if (!activeClassrooms.has(roomCode)) {
        activeClassrooms.set(roomCode, createActiveSessionFromClassroom(classroom));
      }

      const activeSession = activeClassrooms.get(roomCode);
      const user = getUserFromSocket(socket);
      const userId = String(user?.sub || "").trim();

      if (role === "teacher" && classroom && classroom.createdBy && String(classroom.createdBy) !== userId) {
        socket.emit("room-error", { message: "Teacher not authorized for this classroom." });
        socket.disconnect(true);
        return;
      }

      if (role === "student") {
        if (!userId) {
          socket.emit("room-error", { message: "Authentication required to join as a student." });
          socket.disconnect(true);
          return;
        }

        const approvedIds = Array.isArray(classroom?.approvedStudentIds)
          ? classroom.approvedStudentIds.map((entry) => String(entry).trim())
          : [];
          
        if (!approvedIds.includes(userId)) {
          // --- FIX: Keep them connected as a restricted spectator room listener ---
          socket.data.roomCode = roomCode;
          socket.data.userId = userId;
          socket.join(roomCode);

          // Tell the teacher room over native websockets to pull down the list immediately
          io.to(roomCode).emit("pending-requests-updated", { approved: null, studentUserId: userId });

          socket.emit("admission-pending", { message: "Your request is pending teacher approval. Please stay on this screen." });
          return;
        }
      }

      socket.data.roomCode = roomCode;
      socket.data.userId = userId;
      socket.join(roomCode);

      const displayName = String(socket.handshake.auth?.displayName || "").trim();
      if (displayName) {
        if (!activeSession.userDisplayNames) activeSession.userDisplayNames = new Map();
        activeSession.userDisplayNames.set(socket.id, displayName);
      }

      if (DEBUG_LOGS) console.log(`Socket connected: ${socket.id} (${role}) room=${roomCode}`);

      if (role === "teacher") {
        activeSession.teacherSocketIds.add(socket.id);
        activeSession.teacherPresent = true;
        const currentRaiseHands = Array.from(activeSession.raiseHands || []).map((id) => {
          const audioState = activeSession.userAudioStates?.get(id) || { muted: true, deafened: false };
          return {
            userId: id,
            displayName: activeSession.userDisplayNames?.get(id) || id,
            muted: Boolean(audioState.muted),
            deafened: Boolean(audioState.deafened),
          };
        });
        socket.emit("raise-hand-list", currentRaiseHands);
      }

      emitParticipantsState(roomCode, activeSession);

      if (role === "student" && !activeSession.teacherPresent) {
        socket.emit("room-error", { message: "Class session is not started yet. Please wait for the teacher to enter the classroom." });
        socket.disconnect(true);
        return;
      }

      if (role === "student") {
        const slotIndex = getNextAvailableSlot(activeSession);
        if (slotIndex !== null) {
          activeSession.studentAssignments.set(socket.id, slotIndex);
          io.to(roomCode).emit("student-assigned", { userId: socket.id, slotIndex });
        }
      }

      broadcastSnapshot(socket, activeSession);

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
        activeSession.blackboardStrokes.push(stroke);
        if (activeSession.blackboardStrokes.length > 1000) {
          activeSession.blackboardStrokes = activeSession.blackboardStrokes.slice(-1000);
        }

        if (classroom) {
          classroom.blackboardStrokes = [...activeSession.blackboardStrokes];
          await classroom.save().catch((err) => console.error("Error saving classroom:", err));
        }

        socket.to(roomCode).emit("blackboard-stroke", stroke);
      });

      socket.on("request-discussion-state", () => {
        try {
          socket.emit("discussion-state", {
            feed: Array.isArray(activeSession.discussionFeed) ? activeSession.discussionFeed : [],
            polls: Array.isArray(activeSession.discussionPolls) ? activeSession.discussionPolls : [],
          });
          emitParticipantsState(roomCode, activeSession);
        } catch (err) {
          console.error("request-discussion-state error:", err);
        }
      });

      socket.on("discussion-message", async (payload = {}) => {
        try {
          const text = String(payload.text || "").trim();
          if (!text) return;
          const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "message",
            text,
            displayName: activeSession.userDisplayNames?.get(socket.id) || payload.displayName || userId || socket.id,
            userId: userId || socket.id,
            createdAt: Date.now(),
          };
          activeSession.discussionFeed = Array.isArray(activeSession.discussionFeed) ? activeSession.discussionFeed : [];
          activeSession.discussionFeed.push(item);
          if (activeSession.discussionFeed.length > 500) {
            activeSession.discussionFeed = activeSession.discussionFeed.slice(-500);
          }
          await persistDiscussionState(classroom, activeSession);
          io.to(roomCode).emit("discussion-update", item);
        } catch (err) {
          console.error("discussion-message error:", err);
        }
      });

      // Teacher client may emit a targeted approval/denial to notify the pending student's socket
      socket.on("student-join-approved", (payload = {}) => {
        try {
          const studentId = String(payload?.studentId || "");
          if (!studentId) return;
          for (const [sId, sckt] of io.sockets.sockets) {
            if (sckt?.data?.userId && String(sckt.data.userId) === studentId && String(sckt.data.roomCode) === String(roomCode)) {
              try { sckt.emit("admission-approved", { message: "Your request to join was approved." }); } catch (e) {}
            }
          }
        } catch (err) {
          console.error('student-join-approved handler error', err);
        }
      });

      socket.on("student-join-denied", (payload = {}) => {
        try {
          const studentId = String(payload?.studentId || "");
          if (!studentId) return;
          for (const [sId, sckt] of io.sockets.sockets) {
            if (sckt?.data?.userId && String(sckt.data.userId) === studentId && String(sckt.data.roomCode) === String(roomCode)) {
              try { sckt.emit("admission-denied", { message: "Your request to join was denied by the teacher." }); } catch (e) {}
            }
          }
        } catch (err) {
          console.error('student-join-denied handler error', err);
        }
      });

      socket.on("discussion-image", async (payload = {}) => {
        try {
          const dataUrl = String(payload.dataUrl || "").trim();
          if (!dataUrl.startsWith("data:image/")) return;
          const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: "image",
            name: String(payload.name || "image").trim(),
            dataUrl,
            displayName: activeSession.userDisplayNames?.get(socket.id) || payload.displayName || socket.id,
            userId: socket.id,
            createdAt: Date.now(),
          };
          activeSession.discussionFeed = Array.isArray(activeSession.discussionFeed) ? activeSession.discussionFeed : [];
          activeSession.discussionFeed.push(item);
          if (activeSession.discussionFeed.length > 500) {
            activeSession.discussionFeed = activeSession.discussionFeed.slice(-500);
          }
          await persistDiscussionState(classroom, activeSession);
          io.to(roomCode).emit("discussion-update", item);
        } catch (err) {
          console.error("discussion-image error:", err);
        }
      });

      socket.on("discussion-poll", async (payload = {}) => {
        try {
          const question = String(payload.question || "").trim();
          const options = Array.isArray(payload.options)
            ? payload.options.map((option) => String(option || "").trim()).filter(Boolean).slice(0, 6)
            : [];
          if (!question || options.length < 2) return;

          const poll = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            question,
            options: options.map((text) => ({ text, votes: 0 })),
            votesByUser: {},
            displayName: activeSession.userDisplayNames?.get(socket.id) || payload.displayName || userId || socket.id,
            userId: userId || socket.id,
            createdAt: Date.now(),
          };

          activeSession.discussionPolls = Array.isArray(activeSession.discussionPolls) ? activeSession.discussionPolls : [];
          activeSession.discussionPolls.unshift(poll);
          if (activeSession.discussionPolls.length > 50) {
            activeSession.discussionPolls = activeSession.discussionPolls.slice(0, 50);
          }
          await persistDiscussionState(classroom, activeSession);
          io.to(roomCode).emit("discussion-poll-update", poll);
        } catch (err) {
          console.error("discussion-poll error:", err);
        }
      });

      socket.on("discussion-vote", async (payload = {}) => {
        try {
          const pollId = String(payload.pollId || "").trim();
          const optionIndex = Number(payload.optionIndex);
          const poll = (activeSession.discussionPolls || []).find((entry) => String(entry.id) === pollId);
          if (!poll || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) return;

          poll.votesByUser = poll.votesByUser && typeof poll.votesByUser === "object" ? poll.votesByUser : {};
          const previousVote = poll.votesByUser[socket.id];
          if (Number.isInteger(previousVote) && poll.options[previousVote]) {
            poll.options[previousVote].votes = Math.max(0, Number(poll.options[previousVote].votes || 0) - 1);
          }
          poll.options[optionIndex].votes = Number(poll.options[optionIndex].votes || 0) + 1;
          poll.votesByUser[socket.id] = optionIndex;

          await persistDiscussionState(classroom, activeSession);
          io.to(roomCode).emit("discussion-poll-update", poll);
        } catch (err) {
          console.error("discussion-vote error:", err);
        }
      });

      socket.on("discussion-poll-delete", async (payload = {}) => {
        try {
          const pollId = String(payload.pollId || "").trim();
          if (!pollId) return;

          activeSession.discussionPolls = Array.isArray(activeSession.discussionPolls) ? activeSession.discussionPolls : [];
          const existing = activeSession.discussionPolls.find((p) => String(p.id) === pollId);
          if (!existing) return;

          const isTeacher = activeSession.teacherSocketIds.has(socket.id);
          const isOwner = String(existing.userId) === userId || String(existing.userId) === socket.id;
          if (!isTeacher && !isOwner) return; // only teacher or poll owner may delete

          activeSession.discussionPolls = activeSession.discussionPolls.filter((p) => String(p.id) !== pollId);
          await persistDiscussionState(classroom, activeSession);
          io.to(roomCode).emit("discussion-poll-delete", { id: pollId });
        } catch (err) {
          console.error('discussion-poll-delete error:', err);
        }
      });

      socket.on("blackboard-clear", async () => {
        activeSession.blackboardStrokes = [];
        if (classroom) {
          classroom.blackboardStrokes = [];
          await classroom.save().catch((err) => console.error("Error saving classroom:", err));
        }
        io.to(roomCode).emit("blackboard-clear");
      });

      socket.on("blackboard-laser", (payload = {}) => {
        if (role !== "teacher") return;

        const active = payload.active !== false;
        const nextPayload = active
          ? {
              x: Number(payload.x),
              y: Number(payload.y),
              active: true,
            }
          : { active: false };

        if (active && (!Number.isFinite(nextPayload.x) || !Number.isFinite(nextPayload.y))) {
          return;
        }

        io.to(roomCode).emit("blackboard-laser", nextPayload);
      });

      socket.on("presentation-start", (payload) => {
        if (role === "teacher") {
          activeSession.presentation = payload;
          io.to(roomCode).emit("presentation-start", payload);
        }
      });

      socket.on("presentation-update", (payload) => {
        if (role === "teacher" && activeSession.presentation) {
          activeSession.presentation.index = payload.index;
          activeSession.presentation.image = payload.image;
          io.to(roomCode).emit("presentation-update", payload);
        }
      });

      socket.on("presentation-stop", () => {
        if (role === "teacher") {
          activeSession.presentation = null;
          io.to(roomCode).emit("presentation-stop");
        }
      });

      socket.on("disconnect", (reason) => {
        if (DEBUG_LOGS) console.log(`Socket disconnected: ${socket.id} reason=${reason}`);

        activeSession.studentAssignments.delete(socket.id);
        activeSession.studentPositions.delete(socket.id);
        activeSession.teacherPositions.delete(socket.id);
        activeSession.teacherSocketIds.delete(socket.id);
        if (activeSession.userDisplayNames) activeSession.userDisplayNames.delete(socket.id);

        if (activeSession.userAudioStates) {
          activeSession.userAudioStates.delete(socket.id);
        }

        const relaySpeakers = activeSession.voiceRelaySpeakers;
        if (relaySpeakers && relaySpeakers.has(socket.id)) {
          relaySpeakers.delete(socket.id);
          io.to(roomCode).emit("voice-relay-stop", {
            speakerId: socket.id,
            reason: "disconnect",
          });
          broadcastVoiceRelayState(roomCode, activeSession);
        }

        if (role === "teacher" && activeSession.teacherSocketIds.size === 0) {
          activeSession.teacherPresent = false;
        }

        if (
          activeSession.studentAssignments.size === 0
          && activeSession.studentPositions.size === 0
          && activeSession.teacherPositions.size === 0
          && activeSession.blackboardStrokes.length === 0
        ) {
          activeClassrooms.delete(roomCode);
        }

        io.to(roomCode).emit("peer-left", socket.id);
        emitParticipantsState(roomCode, activeSession);
        emitVoiceScalingState(roomCode);
      });

      if (!activeSession.userAudioStates) {
        activeSession.userAudioStates = new Map();
      }
      activeSession.userAudioStates.set(socket.id, { muted: true, deafened: false });
      if (!activeSession.raiseHands) activeSession.raiseHands = new Set();

      socket.emit("peer-joined", { userId: socket.id, role });
      socket.broadcast.to(roomCode).emit("peer-joined", { userId: socket.id, role });

      emitExistingPeers(socket, roomCode, activeSession);
      emitVoiceScalingState(roomCode);

      socket.on("request-existing-peers", () => {
        emitExistingPeers(socket, roomCode, activeSession);
        emitVoiceScalingState(roomCode);
      });

      socket.on("webrtc-offer", ({ target, offer }) => {
        if (DEBUG_LOGS) console.log(`WebRTC offer from ${socket.id} to ${target}`);
        const callerRole = activeSession.teacherSocketIds.has(socket.id) ? "teacher" : "student";
        io.to(target).emit("webrtc-offer", { caller: socket.id, callerRole, offer });
      });

      socket.on("webrtc-answer", ({ target, answer }) => {
        if (DEBUG_LOGS) console.log(`WebRTC answer from ${socket.id} to ${target}`);
        io.to(target).emit("webrtc-answer", { caller: socket.id, answer });
      });

      socket.on("webrtc-candidate", ({ target, candidate }) => {
        if (DEBUG_LOGS && candidate) console.log(`ICE candidate from ${socket.id} to ${target}`);
        io.to(target).emit("webrtc-candidate", { caller: socket.id, candidate });
      });

      socket.on("voice-relay-start", (payload = {}) => {
        try {
          if (!canSpeakViaRelay(activeSession, socket, role)) {
            return;
          }

          const relaySpeakers = getVoiceRelayState(activeSession);
          const speakerId = socket.id;
          const displayName = activeSession.userDisplayNames?.get(speakerId) || String(payload.displayName || speakerId).trim() || speakerId;
          const nextState = {
            speakerId,
            role: role === "teacher" ? "teacher" : "student",
            displayName,
            mimeType: String(payload.mimeType || "audio/webm;codecs=opus"),
            updatedAt: Date.now(),
          };

          relaySpeakers.set(speakerId, nextState);
          io.to(roomCode).emit("voice-relay-start", nextState);
          broadcastVoiceRelayState(roomCode, activeSession);
        } catch (err) {
          console.error("voice-relay-start error:", err);
        }
      });

      socket.on("voice-relay-chunk", (payload = {}) => {
        try {
          if (!canSpeakViaRelay(activeSession, socket, role)) {
            return;
          }

          const chunk = payload?.chunk;
          if (!chunk) return;

          const relaySpeakers = getVoiceRelayState(activeSession);
          const speakerId = socket.id;
          const currentState = relaySpeakers.get(speakerId) || {
            speakerId,
            role: role === "teacher" ? "teacher" : "student",
            displayName: activeSession.userDisplayNames?.get(speakerId) || speakerId,
            mimeType: String(payload.mimeType || "audio/webm;codecs=opus"),
            updatedAt: Date.now(),
          };

          currentState.mimeType = String(payload.mimeType || currentState.mimeType || "audio/webm;codecs=opus");
          currentState.displayName = activeSession.userDisplayNames?.get(speakerId) || currentState.displayName || speakerId;
          currentState.updatedAt = Date.now();
          relaySpeakers.set(speakerId, currentState);

          io.to(roomCode).emit("voice-relay-chunk", {
            speakerId,
            role: currentState.role,
            displayName: currentState.displayName,
            mimeType: currentState.mimeType,
            sequence: Number(payload.sequence || 0),
            timestamp: Number(payload.timestamp || Date.now()),
            chunk,
          });
        } catch (err) {
          console.error("voice-relay-chunk error:", err);
        }
      });

      socket.on("voice-relay-stop", (payload = {}) => {
        try {
          const relaySpeakers = getVoiceRelayState(activeSession);
          const speakerId = socket.id;
          if (relaySpeakers.has(speakerId)) {
            relaySpeakers.delete(speakerId);
            io.to(roomCode).emit("voice-relay-stop", {
              speakerId,
              reason: String(payload.reason || "stopped"),
            });
            broadcastVoiceRelayState(roomCode, activeSession);
          }
        } catch (err) {
          console.error("voice-relay-stop error:", err);
        }
      });

      socket.on("audio-state-change", ({ muted, deafened, target }) => {
        try {
          if (target) {
            const senderIsTeacher = activeSession.teacherSocketIds.has(socket.id);
            if (!senderIsTeacher) {
              if (DEBUG_LOGS) console.log(`Non-teacher ${socket.id} attempted to change audio state of ${target}`);
              return;
            }
            const state = activeSession.userAudioStates.get(target) || { muted: false, deafened: false };
            if (muted !== undefined) state.muted = muted;
            if (deafened !== undefined) state.deafened = deafened;
            activeSession.userAudioStates.set(target, state);
            if (DEBUG_LOGS) console.log(`Teacher ${socket.id} set audio for ${target}: muted=${state.muted} deafened=${state.deafened}`);
            io.to(roomCode).emit("audio-state-change", { userId: target, muted: state.muted, deafened: state.deafened });
            io.to(target).emit("audio-state-change", { userId: target, muted: state.muted, deafened: state.deafened, by: socket.id });
            return;
          }

          if (muted !== undefined) {
            const state = activeSession.userAudioStates.get(socket.id) || { muted: false, deafened: false };
            state.muted = muted;
            activeSession.userAudioStates.set(socket.id, state);
            if (DEBUG_LOGS) console.log(`User ${socket.id} muted: ${muted}`);
          }
          if (deafened !== undefined) {
            const state = activeSession.userAudioStates.get(socket.id) || { muted: false, deafened: false };
            state.deafened = deafened;
            activeSession.userAudioStates.set(socket.id, state);
            if (DEBUG_LOGS) console.log(`User ${socket.id} deafened: ${deafened}`);
          }
          socket.broadcast.to(roomCode).emit("audio-state-change", { userId: socket.id, muted, deafened });
        } catch (err) {
          console.error("audio-state-change handler error:", err);
        }
      });

      socket.on("teacher-set-audio-state", ({ target, muted, deafened }) => {
        try {
          const senderIsTeacher = activeSession.teacherSocketIds.has(socket.id);
          if (!senderIsTeacher) return;
          const state = activeSession.userAudioStates.get(target) || { muted: false, deafened: false };
          if (muted !== undefined) state.muted = muted;
          if (deafened !== undefined) state.deafened = deafened;
          activeSession.userAudioStates.set(target, state);
          if (DEBUG_LOGS) console.log(`Teacher ${socket.id} set audio for ${target}: muted=${state.muted} deafened=${state.deafened}`);
          io.to(roomCode).emit("audio-state-change", { userId: target, muted: state.muted, deafened: state.deafened });
          io.to(target).emit("audio-state-change", { userId: target, muted: state.muted, deafened: state.deafened, by: socket.id });
        } catch (err) {
          console.error("teacher-set-audio-state error:", err);
        }
      });

      socket.on("raise-hand", (payload = {}) => {
        try {
          if (payload && typeof payload.displayName === "string" && payload.displayName.trim()) {
            if (!activeSession.userDisplayNames) activeSession.userDisplayNames = new Map();
            activeSession.userDisplayNames.set(socket.id, String(payload.displayName).trim());
          }
          activeSession.raiseHands.add(socket.id);
          const list = Array.from(activeSession.raiseHands).map((id) => {
            const audioState = activeSession.userAudioStates?.get(id) || { muted: true, deafened: false };
            return {
              userId: id,
              displayName: activeSession.userDisplayNames?.get(id) || id,
              muted: Boolean(audioState.muted),
              deafened: Boolean(audioState.deafened),
            };
          });
          for (const teacherId of activeSession.teacherSocketIds) {
            io.to(teacherId).emit("raise-hand-list", list);
          }
          if (DEBUG_LOGS) console.log(`User ${socket.id} raised hand in ${roomCode}`);
        } catch (err) {
          console.error("raise-hand error:", err);
        }
      });

      socket.on("request-blackboard", () => {
        try {
          socket.emit("blackboard-snapshot", { strokes: activeSession.blackboardStrokes });
        } catch (err) {
          if (DEBUG_LOGS) console.warn("Failed to emit blackboard-snapshot:", err);
        }
      });

      socket.on("clear-raise-hand", ({ userId }) => {
        try {
          const senderIsTeacher = activeSession.teacherSocketIds.has(socket.id);
          const senderIsStudent = role === "student";
          if (senderIsTeacher) {
            if (userId) {
              activeSession.raiseHands.delete(userId);
              io.to(userId).emit("raise-hand-cleared", { userId });
            }
          } else if (senderIsStudent && userId === socket.id) {
            activeSession.raiseHands.delete(socket.id);
          } else {
            return;
          }
          const list = Array.from(activeSession.raiseHands).map((id) => {
            const audioState = activeSession.userAudioStates?.get(id) || { muted: true, deafened: false };
            return {
              userId: id,
              displayName: activeSession.userDisplayNames?.get(id) || id,
              muted: Boolean(audioState.muted),
              deafened: Boolean(audioState.deafened),
            };
          });
          for (const teacherId of activeSession.teacherSocketIds) {
            io.to(teacherId).emit("raise-hand-list", list);
          }
        } catch (err) {
          console.error("clear-raise-hand error:", err);
        }
      });

      socket.on("request-unmute", (payload = {}) => {
        try {
          const requester = socket.id;
          if (payload && typeof payload.displayName === "string" && payload.displayName.trim()) {
            if (!activeSession.userDisplayNames) activeSession.userDisplayNames = new Map();
            activeSession.userDisplayNames.set(requester, String(payload.displayName).trim());
          }
          const displayName = activeSession.userDisplayNames?.get(requester) || requester;
          for (const teacherId of activeSession.teacherSocketIds) {
            io.to(teacherId).emit("unmute-request", { userId: requester, displayName });
          }
        } catch (err) {
          console.error("request-unmute error:", err);
        }
      });

      socket.on("request-raise-hand-list", () => {
        try {
          if (role !== "teacher") return;
          const currentRaiseHands = Array.from(activeSession.raiseHands || []).map((id) => {
            const audioState = activeSession.userAudioStates?.get(id) || { muted: true, deafened: false };
            return {
              userId: id,
              displayName: activeSession.userDisplayNames?.get(id) || id,
              muted: Boolean(audioState.muted),
              deafened: Boolean(audioState.deafened),
            };
          });
          socket.emit("raise-hand-list", currentRaiseHands);
        } catch (err) {
          console.error("request-raise-hand-list error:", err);
        }
      });

    } catch (error) {
      console.error("Socket connection error:", error);
      socket.emit("room-error", { message: "Error connecting to room" });
      socket.disconnect(true);
    }
  });
};