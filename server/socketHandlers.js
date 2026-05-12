module.exports = function attachSocketHandlers(io, deps) {
  const {
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
  } = deps;

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
        if (DEBUG_LOGS) console.error("Classroom lookup failed:", dbError?.message || dbError);
      }

      const hasActiveSession = activeClassrooms.has(roomCode);
      if (!classroom && !hasActiveSession && role !== "teacher") {
        socket.emit("room-error", { message: "Room does not exist" });
        socket.disconnect(true);
        return;
      }

      // Get or create an in-memory cache for this session
      if (!activeClassrooms.has(roomCode)) {
        activeClassrooms.set(roomCode, createActiveSessionFromClassroom(classroom));
      }

      const activeSession = activeClassrooms.get(roomCode);
      socket.data.roomCode = roomCode;
      socket.join(roomCode);

      // Record display name if provided by client
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
        activeSession.blackboardStrokes.push(stroke);
        if (activeSession.blackboardStrokes.length > 1000) {
          activeSession.blackboardStrokes = activeSession.blackboardStrokes.slice(-1000);
        }

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
      });


      // Voice Chat / WebRTC Signaling with improved multi-user support
      if (!activeSession.userAudioStates) {
        activeSession.userAudioStates = new Map();
      }
      activeSession.userAudioStates.set(socket.id, { muted: true, deafened: false });
      if (!activeSession.raiseHands) activeSession.raiseHands = new Set();

      socket.emit("peer-joined", { userId: socket.id, role });
      socket.broadcast.to(roomCode).emit("peer-joined", { userId: socket.id, role });

      emitExistingPeers(socket, roomCode, activeSession);

      socket.on("request-existing-peers", () => {
        emitExistingPeers(socket, roomCode, activeSession);
      });

      socket.on("webrtc-offer", ({ target, offer }) => {
        if (DEBUG_LOGS) console.log(`WebRTC offer from ${socket.id} to ${target}`);
        io.to(target).emit("webrtc-offer", { caller: socket.id, offer });
      });

      socket.on("webrtc-answer", ({ target, answer }) => {
        if (DEBUG_LOGS) console.log(`WebRTC answer from ${socket.id} to ${target}`);
        io.to(target).emit("webrtc-answer", { caller: socket.id, answer });
      });

      socket.on("webrtc-candidate", ({ target, candidate }) => {
        if (DEBUG_LOGS && candidate) console.log(`ICE candidate from ${socket.id} to ${target}`);
        io.to(target).emit("webrtc-candidate", { caller: socket.id, candidate });
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

      socket.on("raise-hand", () => {
        try {
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

      socket.on("clear-raise-hand", ({ userId }) => {
        try {
          const senderIsTeacher = activeSession.teacherSocketIds.has(socket.id);
          if (!senderIsTeacher) return;
          if (userId) activeSession.raiseHands.delete(userId);
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

      socket.on("request-unmute", () => {
        try {
          const requester = socket.id;
          for (const teacherId of activeSession.teacherSocketIds) {
            io.to(teacherId).emit("unmute-request", { userId: requester, displayName: activeSession.userDisplayNames?.get(requester) || requester });
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
