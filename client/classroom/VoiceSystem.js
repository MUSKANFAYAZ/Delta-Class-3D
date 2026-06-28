export class VoiceSystem {
  constructor(socket, currentUserId, currentRole) {
    if (typeof window !== "undefined" && window.activeVoiceSystem && window.activeVoiceSystem !== this) {
      try {
        window.activeVoiceSystem.destroy();
      } catch (err) {
        console.warn("[VoiceSystem] Failed to destroy previous instance:", err);
      }
    }

    this.socket = socket;
    this.currentUserId = currentUserId || socket?.id || null;
    this.currentRole = currentRole; // 'teacher' or 'student'
    this.destroyed = false;
    this._relayResetAttempts = new Map();
    this.isSocketConnected = Boolean(socket?.connected);
    this.disconnectCleanupTimer = null;
    
    this.peers = new Map(); // userId -> RTCPeerConnection
    this._peerInitLocks = new Map(); // userId -> Promise
    this._connectPeerListRunning = false;
    this._pendingPeerList = null;
    this.localStream = null;
    this.audioContext = null;
    this.localAudioTrack = null;
    this.remoteAudioSources = new Map(); // userId -> AudioContext MediaElementAudioSourceNode
    this.peerReconnectAttempts = new Map(); // userId -> attempt count
    this.voiceRelayRecorders = new Map();
    this.voiceRelayRemotePlayers = new Map();
    this.voiceRelaySequence = 0;
  // WebRTC mesh is primary for classroom audio; server relay is fallback for large rooms
  // Teachers always use server relay to ensure consistent audio broadcast
    this.useServerVoiceRelay = this.currentRole === "teacher" ? true : false;
    this.voiceRelayMimeType = "audio/webm;codecs=opus";
    this.voiceRelayBitrate = 16000;
    this.voiceRelayHealthTimer = null;
    this._audioUnlocked = false;
    this._audioUnlockHandler = null;
    this._audioUnlockBannerId = "dc-audio-unlock-banner";
    this.listenOnlyMode = false;
    this._pendingAudioUnlock = false;
    this.teacherMicApproved = false;
    
    // Voice state
    this.isMuted = this.currentRole === "teacher" ? false : true;
    this.isDeafened = false; // for students to mute teacher's voice locally
    
    // Connection tracking for better multi-user support
    this.peerConnectivityTimeout = new Map(); // userId -> timeoutId
    this.teacherOnlyMesh = false;
    this.meshParticipantLimit = 12;
    this.voiceScalingBannerId = "dc-voice-scaling-banner";

    this.handleSocketConnect = this.handleSocketConnect.bind(this);
    this.handleSocketDisconnect = this.handleSocketDisconnect.bind(this);
    this._boundSocketHandlers = [];

    this.setupSocketListeners();
    if (typeof window !== "undefined") {
      window.activeVoiceSystem = this;
    }
    if (this.socket.connected && this.socket.id) {
      this.handleSocketConnect();
    }
    this.requestExistingPeers();
    this.installAudioUnlockHandler();
  }

  logWebRtc(event, data = {}) {
    console.log(`[VoiceSystem:WebRTC] ${event}`, {
      role: this.currentRole,
      selfId: this.socket?.id || this.currentUserId,
      useServerVoiceRelay: this.useServerVoiceRelay,
      ...data,
    });
  }

  getIceServers() {
    return [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
    ];
  }

  safePlayAudio(audio, context = "") {
    if (!audio || this.destroyed) {
      return;
    }

    audio.muted = false;
    audio.volume = this.isDeafened ? 0 : 1.0;

    if (!this._audioUnlocked) {
      this.showAudioUnlockBanner();
      return;
    }

    const playPromise = audio.play?.();
    if (!playPromise) {
      return;
    }

    playPromise.catch((err) => {
      const message = err?.message || String(err);
      if (message.includes("interrupted") || message.includes("pause")) {
        return;
      }
      console.warn(`[VoiceSystem] Playback failed (${context}):`, message);
      if (!this._audioUnlocked) {
        this.showAudioUnlockBanner();
      }
    });
  }

  attachWebRtcRemoteAudio(peerId, stream) {
    if (!peerId || !stream) {
      return null;
    }

    let audioEntry = document.getElementById(`audio-${peerId}`);
    if (!audioEntry) {
      audioEntry = document.createElement("audio");
      audioEntry.id = `audio-${peerId}`;
      audioEntry.autoplay = true;
      audioEntry.playsInline = true;
      audioEntry.className = "dc-remote-audio dc-webrtc-audio";
      audioEntry.dataset.speakerId = peerId;
      this.configureRelayAudioElement(audioEntry);
      audioEntry.onloadedmetadata = () => {
        this.logWebRtc("ontrack metadata loaded", { peerId });
        this.safePlayAudio(audioEntry, `webrtc-${peerId}-metadata`);
      };
      document.body.appendChild(audioEntry);
    }

    audioEntry.srcObject = stream;
    audioEntry.volume = this.isDeafened ? 0 : 1.0;
    audioEntry.muted = false;

    if (audioEntry.readyState >= 1) {
      this.safePlayAudio(audioEntry, `webrtc-${peerId}-immediate`);
    }

    this.logWebRtc("remote stream attached", {
      peerId,
      trackCount: stream.getAudioTracks().length,
      tracks: stream.getAudioTracks().map((t) => ({
        enabled: t.enabled,
        muted: t.muted,
        readyState: t.readyState,
      })),
    });

    return audioEntry;
  }

  installAudioUnlockHandler() {
    if (typeof document === "undefined" || this._audioUnlockHandler) {
      return;
    }

    const unlock = () => {
      this.enableRemoteAudioWithGesture();
      this.removeAudioUnlockHandler();
    };

    this._audioUnlockHandler = unlock;
    const options = { capture: true, passive: true };
    document.addEventListener("pointerdown", unlock, options);
    document.addEventListener("keydown", unlock, options);
    document.addEventListener("touchstart", unlock, options);
  }

  removeAudioUnlockHandler() {
    if (!this._audioUnlockHandler || typeof document === "undefined") {
      return;
    }

    const options = { capture: true };
    document.removeEventListener("pointerdown", this._audioUnlockHandler, options);
    document.removeEventListener("keydown", this._audioUnlockHandler, options);
    document.removeEventListener("touchstart", this._audioUnlockHandler, options);
    this._audioUnlockHandler = null;
  }

  showAudioUnlockBanner() {
    if (this._audioUnlocked || typeof document === "undefined") {
      return;
    }

    let banner = document.getElementById(this._audioUnlockBannerId);
    if (banner) {
      return;
    }

    banner = document.createElement("div");
    banner.id = this._audioUnlockBannerId;
    banner.style.position = "fixed";
    banner.style.left = "50%";
    banner.style.bottom = "24px";
    banner.style.transform = "translateX(-50%)";
    banner.style.zIndex = "9998";
    banner.style.padding = "12px 18px";
    banner.style.borderRadius = "10px";
    banner.style.background = "rgba(15, 23, 42, 0.92)";
    banner.style.color = "#ffffff";
    banner.style.fontSize = "13px";
    banner.style.lineHeight = "1.4";
    banner.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.35)";
    banner.style.maxWidth = "92vw";
    banner.style.textAlign = "center";
    banner.textContent = "Tap or click anywhere to enable classroom audio.";
    document.body.appendChild(banner);
  }

  hideAudioUnlockBanner() {
    const banner = document.getElementById(this._audioUnlockBannerId);
    if (banner) {
      banner.remove();
    }
  }

  isMicrophoneAvailable() {
    return typeof navigator !== "undefined"
      && typeof navigator.mediaDevices?.getUserMedia === "function";
  }

  getMicrophoneBlockedReason() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "Microphone requires HTTPS. Open https://<server-ip>:5173 (not http://) and accept the certificate warning.";
    }
    if (!this.isMicrophoneAvailable()) {
      return "This browser does not expose microphone APIs in the current context.";
    }
    return "Microphone access is unavailable.";
  }

  showMicBlockedBanner(message) {
    if (typeof document === "undefined") {
      return;
    }

    const bannerId = "dc-mic-blocked-banner";
    let banner = document.getElementById(bannerId);
    if (banner) {
      banner.textContent = message;
      return;
    }

    banner = document.createElement("div");
    banner.id = bannerId;
    banner.style.position = "fixed";
    banner.style.left = "50%";
    banner.style.top = "12px";
    banner.style.transform = "translateX(-50%)";
    banner.style.zIndex = "9999";
    banner.style.padding = "10px 14px";
    banner.style.borderRadius = "10px";
    banner.style.background = "rgba(220, 38, 38, 0.95)";
    banner.style.color = "#ffffff";
    banner.style.fontSize = "12px";
    banner.style.lineHeight = "1.35";
    banner.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.3)";
    banner.style.maxWidth = "92vw";
    banner.style.textAlign = "center";
    banner.textContent = message;
    document.body.appendChild(banner);
  }

  hideMicBlockedBanner() {
    const banner = document.getElementById("dc-mic-blocked-banner");
    if (banner) {
      banner.remove();
    }
  }

  async initListenOnlyMode(reason = "") {
    this.listenOnlyMode = true;
    console.warn("[VoiceSystem] Listen-only mode:", reason || "microphone unavailable");

    await this.setupAudioProcessing();
    this.refreshRemoteAudioElements();
    this.showAudioUnlockBanner();
    this.requestExistingPeers();

    if (this.currentRole === "teacher") {
      this.showMicBlockedBanner(this.getMicrophoneBlockedReason());
    } else {
      console.info("[VoiceSystem] Student listen-only mode is active. Tap anywhere to hear the teacher.");
    }

    this.requestAudioUnlockAfterInit();
    return false;
  }

  configureRelayAudioElement(audio) {
    audio.style.position = "fixed";
    audio.style.left = "0";
    audio.style.bottom = "0";
    audio.style.width = "1px";
    audio.style.height = "1px";
    audio.style.opacity = "0";
    audio.style.pointerEvents = "none";
    audio.style.zIndex = "-1";
  }

  resumeAllRelayPlayback() {
    this.voiceRelayRemotePlayers.forEach((entry, speakerId) => {
      if (!entry?.audio || entry.stopped) {
        return;
      }

      entry.audio.volume = this.isDeafened ? 0 : 1.0;
      entry.audio.muted = false;
      this.flushRelaySpeakerQueue(speakerId);

      const playPromise = entry.audio.play?.();
      if (playPromise) {
        playPromise.catch((err) => {
          console.warn("[VoiceSystem] Failed to resume relay playback for", speakerId, err?.message);
        });
      }
    });
  }

  attachPendingAudioBoosts() {
    document.querySelectorAll(".dc-remote-audio, .dc-voice-relay-audio").forEach((audio) => {
      const speakerRole = audio.dataset?.role || "student";
      this.attachAudioBoost(audio, speakerRole);
    });
  }

  bindSocketEvent(eventName, handler) {
    if (!this.socket || typeof handler !== "function") {
      return handler;
    }
    this._boundSocketHandlers.push([eventName, handler]);
    this.socket.on(eventName, handler);
    return handler;
  }

  removeSocketListeners() {
    if (!this.socket || !Array.isArray(this._boundSocketHandlers)) {
      return;
    }

    this._boundSocketHandlers.forEach(([eventName, handler]) => {
      try {
        this.socket.off(eventName, handler);
      } catch (err) {
        console.warn(`[VoiceSystem] Failed to remove ${eventName} listener:`, err);
      }
    });
    this._boundSocketHandlers.length = 0;
  }

  async normalizeRelayChunk(chunk) {
    if (!chunk) {
      return null;
    }

    if (chunk instanceof ArrayBuffer) {
      return chunk;
    }

    if (ArrayBuffer.isView(chunk)) {
      return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    }

    if (typeof Blob !== "undefined" && chunk instanceof Blob) {
      return await chunk.arrayBuffer();
    }

    if (typeof chunk?.arrayBuffer === "function") {
      return await chunk.arrayBuffer();
    }

    if (chunk?.type === "Buffer" && Array.isArray(chunk.data)) {
      return Uint8Array.from(chunk.data).buffer;
    }

    if (typeof chunk === "string") {
      try {
        const binary = atob(chunk);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      } catch {
        return null;
      }
    }

    if (chunk?.buffer instanceof ArrayBuffer) {
      return chunk.buffer;
    }

    return null;
  }

  detachRelayAudioElement(entry) {
    if (!entry?.audio) {
      return;
    }

    const audio = entry.audio;
    try {
      audio.pause();
    } catch (err) {
      console.warn("[VoiceSystem] Failed to pause relay audio:", err);
    }

    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.srcObject = null;

    try {
      audio.removeAttribute("src");
      audio.src = "";
      audio.load();
    } catch (err) {
      console.warn("[VoiceSystem] Failed to clear relay audio src:", err);
    }

    if (entry.objectUrl) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch (err) {
        console.warn("[VoiceSystem] Failed to revoke relay object URL:", err);
      }
      entry.objectUrl = null;
    }

    try {
      audio.remove();
    } catch (err) {
      console.warn("[VoiceSystem] Failed to remove relay audio element:", err);
    }

    entry.audio = null;
  }

  shouldConnectToPeer(peer) {
    if (this.useServerVoiceRelay) {
      return false;
    }

    const peerId = typeof peer === "string" ? peer : peer?.userId;
    const selfId = this.socket?.id || this.currentUserId;
    if (!peerId || peerId === this.currentUserId || peerId === selfId) {
      return false;
    }
    return true;
  }

  shouldInitiatePeer(peerId) {
    if (!peerId || !this.currentUserId) return true;
    return String(this.currentUserId) < String(peerId);
  }

  upsertVoiceScalingBanner(payload = {}) {
    const recommendRelay = Boolean(payload.recommendRelay);
    const participantCount = Number(payload.participantCount || 0);
    const meshLimit = Number(payload.meshParticipantLimit || this.meshParticipantLimit || 12);

    let banner = document.getElementById(this.voiceScalingBannerId);
    if (!recommendRelay) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement("div");
      banner.id = this.voiceScalingBannerId;
      banner.style.position = "fixed";
      banner.style.left = "50%";
      banner.style.top = "12px";
      banner.style.transform = "translateX(-50%)";
      banner.style.zIndex = "9999";
      banner.style.padding = "10px 14px";
      banner.style.borderRadius = "10px";
      banner.style.background = "rgba(124, 58, 237, 0.95)";
      banner.style.color = "#ffffff";
      banner.style.fontSize = "12px";
      banner.style.lineHeight = "1.35";
      banner.style.boxShadow = "0 10px 30px rgba(15, 23, 42, 0.3)";
      banner.style.maxWidth = "92vw";
      banner.style.textAlign = "center";
      document.body.appendChild(banner);
    }

    banner.textContent = `Large voice class (${participantCount} participants). Mesh limit is ${meshLimit}. For stable teacher uplink, switch to SFU/media relay.`;
  }

  applyVoiceScalingState(payload = {}) {
    this.meshParticipantLimit = Number(payload.meshParticipantLimit || this.meshParticipantLimit || 12);
    this.teacherOnlyMesh = false;
    const participantCount = Number(payload.participantCount || 0);

    if (payload?.topology === "server-relay") {
      // Server explicitly requests relay mode for classroom audio.
      this.useServerVoiceRelay = true;
      this.logWebRtc("scaling state", {
        topology: payload.topology,
        participantCount,
        meshParticipantLimit: this.meshParticipantLimit,
        useServerVoiceRelay: this.useServerVoiceRelay,
      });
      this.syncVoiceRelayState();
      this.upsertVoiceScalingBanner({ recommendRelay: false });
      if (payload.message) {
        console.info("[VoiceSystem]", payload.message);
      }
      return;
    }

    this.upsertVoiceScalingBanner(payload);
  }

  requestExistingPeers() {
    try {
      this.socket.emit("request-existing-peers");
    } catch (err) {
      console.warn("[VoiceSystem] Failed to request existing peers:", err);
    }
  }

  handleSocketConnect() {
    if (this.destroyed) {
      return;
    }

    this.isSocketConnected = true;
    if (this.disconnectCleanupTimer) {
      clearTimeout(this.disconnectCleanupTimer);
      this.disconnectCleanupTimer = null;
    }
    this.currentUserId = this.socket.id || this.currentUserId;
    this.requestExistingPeers();
    this.resumeAudioContext();
    this.refreshRemoteAudioElements();
    this.syncVoiceRelayState();
    // Ensure relay recorder stays running after reconnects
    this.startVoiceRelayHealthCheck();
  }

  async transferSocket(newSocket) {
    if (this.destroyed || !newSocket || newSocket === this.socket) {
      return false;
    }

    const previousSocket = this.socket;
    const wasRelaying = this.voiceRelayRecorders.has("local");

    if (previousSocket && previousSocket.connected && wasRelaying) {
      try {
        previousSocket.emit("voice-relay-stop", { reason: "socket-transfer" });
      } catch (err) {
        console.warn("[VoiceSystem] Failed to stop relay on old socket during transfer:", err);
      }
    }

    this.removeSocketListeners();
    this.socket = newSocket;
    this.currentUserId = newSocket.id || this.currentUserId;
    this.setupSocketListeners();

    const restartVoiceRelay = () => {
      if (wasRelaying && !this.isMuted && this.useServerVoiceRelay) {
        this.emitVoiceRelayStart().catch((err) => {
          console.warn("[VoiceSystem] Failed to restart voice relay after socket transfer:", err);
        });
      }
      if (this.socket && this.socket.connected) {
        try {
          this.socket.emit("audio-state-change", { muted: this.isMuted, deafened: this.isDeafened });
        } catch (err) {
          console.warn("[VoiceSystem] Failed to sync audio state after socket transfer:", err);
        }
      }
    };

    if (newSocket.connected) {
      this.handleSocketConnect();
      restartVoiceRelay();
    } else {
      newSocket.once("connect", () => {
        if (this.destroyed) {
          return;
        }
        this.handleSocketConnect();
        restartVoiceRelay();
      });
    }

    return true;
  }

  handleSocketDisconnect(reason) {
    if (this.destroyed) {
      return;
    }

    console.log("[VoiceSystem] Socket disconnected", reason || "");
    this.isSocketConnected = false;
    this.stopVoiceRelay(reason || "socket-disconnect");

    // Stop health checks while disconnected
    this.stopVoiceRelayHealthCheck();

    if (this.disconnectCleanupTimer) {
      clearTimeout(this.disconnectCleanupTimer);
    }

    // Keep existing peer connections alive during transient signaling outages.
    // WebRTC media can continue flowing while Socket.IO reconnects.
    this.disconnectCleanupTimer = setTimeout(() => {
      if (this.destroyed || this.isSocketConnected) {
        return;
      }

      this.peerReconnectAttempts.clear();
      Array.from(this.peers.keys()).forEach((userId) => {
        this.closePeer(userId);
      });
    }, 15000);
  }

  async resumeAudioContext() {
    try {
      if (this.audioContext && this.audioContext.state === "suspended") {
        console.log("[VoiceSystem] Resuming suspended audio context");
        await this.audioContext.resume();
        console.log("[VoiceSystem] ✓ Audio context resumed, state:", this.audioContext.state);
      }
    } catch (err) {
      console.warn("[VoiceSystem] Failed to resume audio context:", err?.message);
    }
  }

  setMuted(nextMuted) {
    this.isMuted = Boolean(nextMuted);
    // Students need teacher approval before speaking (unless already approved)
    if (this.currentRole === "student" && !this.isMuted && !this.teacherMicApproved) {
      try {
        const displayName = localStorage.getItem("delta-user-display") || "";
        this.socket.emit("raise-hand", { displayName });
        this.socket.emit("request-unmute", { displayName });
      } catch (e) {
        this.socket.emit("request-unmute");
      }
      this.isMuted = true;
      return this.isMuted;
    }

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }

    this.syncVoiceRelayState();

    // If a student mutes themself after being granted mic access, lower their hand too.
    if (this.currentRole === "student" && this.isMuted) {
      try {
        this.socket.emit("clear-raise-hand", { userId: this.currentUserId });
      } catch (e) {
        console.warn("[VoiceSystem] Failed to clear raise hand on self-mute:", e);
      }
      try {
        window.dispatchEvent(new Event("delta-student-lowered-hand"));
      } catch (e) {
        // ignore if no window context
      }
    }

    // Notify server of mute state for better bandwidth management
    this.socket.emit("audio-state-change", { muted: this.isMuted });
    return this.isMuted;
  }

  async applyTeacherAudioState({ muted, deafened, by }) {
    if (muted !== undefined) {
      this.isMuted = Boolean(muted);
      if (!this.isMuted && (by || this.currentRole === "student")) {
        this.teacherMicApproved = true;
        this.hideMicBlockedBanner();
      }
      if (this.isMuted && by) {
        this.teacherMicApproved = false;
      }

      if (!this.localStream) {
        await this.initLocalStream();
      }
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = !this.isMuted;
        });
      } else if (!this.isMuted && this.listenOnlyMode) {
        this.showMicBlockedBanner(this.getMicrophoneBlockedReason());
      }

      if (!this.isMuted) {
        if (this.useServerVoiceRelay) {
          await this.startVoiceRelay();
          this.startVoiceRelayHealthCheck();
        } else {
          this.requestExistingPeers();
          await this.ensureLocalTrackOnPeers();
        }
      }
    }

    if (deafened !== undefined) {
      this.isDeafened = Boolean(deafened);
      document.querySelectorAll(".dc-remote-audio").forEach((audio) => {
        audio.muted = this.isDeafened;
      });
      this.refreshRemoteAudioElements();
    }

    this.syncVoiceRelayState();
  }

  async ensureLocalTrackOnPeers() {
    if (this.useServerVoiceRelay) {
      return;
    }

    const track = this.localStream?.getAudioTracks?.()[0];
    if (!track) {
      this.logWebRtc("ensureLocalTrackOnPeers skipped — no local track");
      return;
    }

    track.enabled = !this.isMuted;
    this.logWebRtc("ensureLocalTrackOnPeers", {
      trackEnabled: track.enabled,
      peerCount: this.peers.size,
      isMuted: this.isMuted,
    });

    for (const [peerId, pc] of this.peers.entries()) {
      try {
        let needsRenegotiation = false;
        const audioSender = pc.getSenders().find((sender) => sender.track?.kind === "audio");
        if (audioSender) {
          if (audioSender.track !== track) {
            await audioSender.replaceTrack(track);
            needsRenegotiation = true;
            this.logWebRtc("replaceTrack", { peerId, enabled: track.enabled });
          } else if (audioSender.track) {
            audioSender.track.enabled = !this.isMuted;
            this.logWebRtc("updated sender track enabled", { peerId, enabled: audioSender.track.enabled });
          }
        } else {
          pc.addTrack(track, this.localStream);
          needsRenegotiation = true;
          this.logWebRtc("addTrack", {
            peerId,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          });
        }

        if (needsRenegotiation && pc.signalingState === "stable") {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
          this.optimizeSdpForLowBandwidth(offer);
          await pc.setLocalDescription(offer);
          this.logWebRtc("offer created (renegotiation)", { peerId, signalingState: pc.signalingState });
          this.socket.emit("webrtc-offer", { target: peerId, offer });
        }
      } catch (error) {
        this.logWebRtc("ensureLocalTrackOnPeers error", { peerId, error: error?.message || error });
      }
    }
  }

  ensureUnmuted() {
    return this.setMuted(false);
  }

  enableRemoteAudioWithGesture() {
    // Call this from a user gesture (click/tap) to unmute remote audio
    // This bypasses browser autoplay policy
    if (this._audioUnlocked) {
      this.resumeAudioContext().then(() => {
        this.resumeAllRelayPlayback();
      });
      return;
    }

    console.log("[VoiceSystem] Enabling remote audio with gesture");
    this._audioUnlocked = true;
    this._pendingAudioUnlock = false;
    this.hideAudioUnlockBanner();
    this.removeAudioUnlockHandler();

    this.resumeAudioContext().then(() => {
      if (!this.listenOnlyMode) {
        this.attachPendingAudioBoosts();
      }
      this.resumeAllRelayPlayback();
    });

    document.querySelectorAll(".dc-remote-audio, .dc-voice-relay-audio, .dc-voice-relay-fallback, .dc-webrtc-audio").forEach((audio) => {
      audio.muted = false;
      audio.volume = this.isDeafened ? 0 : 1.0;
      this.safePlayAudio(audio, "gesture-unlock");
    });
    console.log("[VoiceSystem] Remote audio enabled with gesture, resuming context");
  }

  requestAudioUnlockAfterInit() {
    if (this._audioUnlocked) {
      return;
    }

    if (this._pendingAudioUnlock) {
      this.enableRemoteAudioWithGesture();
      return;
    }

    this.showAudioUnlockBanner();
  }

  refreshRemoteAudioElements() {
    document.querySelectorAll(".dc-remote-audio").forEach((audio) => {
      audio.muted = false; // Never mute, use volume instead
      audio.volume = this.isDeafened ? 0 : 1.0;
      audio.autoplay = true;
      audio.playsInline = true;
      const playPromise = audio.play?.();
      if (playPromise) {
        playPromise.catch(() => {});
      }
    });
    this.resumeAudioContext();
  }

  getPreferredRelayMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ];

    return candidates.find((mimeType) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(mimeType)) || "";
  }

  async emitVoiceRelayStart() {
    if (!this.socket?.connected || this.destroyed) {
      return false;
    }

    const mimeType = this.getPreferredRelayMimeType() || this.voiceRelayMimeType;
    this.voiceRelayMimeType = mimeType || this.voiceRelayMimeType;

    try {
      this.socket.emit("voice-relay-start", {
        displayName: localStorage.getItem("delta-user-display") || "",
        mimeType: this.voiceRelayMimeType,
      });
      return true;
    } catch (err) {
      console.warn("[VoiceSystem] Failed to announce voice relay start:", err);
      return false;
    }
  }

  async startVoiceRelay() {
    if (!this.useServerVoiceRelay || !this.localStream || this.isMuted || this.destroyed || !this.socket?.connected) {
      return;
    }

    if (this.voiceRelayRecorders.has("local")) {
      return;
    }

    const mimeType = this.getPreferredRelayMimeType() || this.voiceRelayMimeType;
    this.voiceRelayMimeType = mimeType || this.voiceRelayMimeType;

    try {
      const preferredMimeType = this.getPreferredRelayMimeType();
      const recorderOptions = {
        audioBitsPerSecond: this.voiceRelayBitrate,
      };
      if (preferredMimeType) {
        this.voiceRelayMimeType = preferredMimeType;
        recorderOptions.mimeType = preferredMimeType;
      }
      const recorder = new MediaRecorder(this.localStream, recorderOptions);
      this.voiceRelayRecorders.set("local", recorder);

      recorder.ondataavailable = async (event) => {
        try {
          if (this.destroyed || this.isMuted || !event?.data || event.data.size === 0 || !this.socket?.connected) {
            return;
          }

          const chunk = await event.data.arrayBuffer();
          this.socket.emit("voice-relay-chunk", {
            mimeType: this.voiceRelayMimeType,
            sequence: ++this.voiceRelaySequence,
            timestamp: Date.now(),
            chunk,
          });
        } catch (err) {
          console.warn("[VoiceSystem] Failed to send voice relay chunk:", err);
        }
      };

      recorder.onerror = (event) => {
        console.warn("[VoiceSystem] Voice relay recorder error:", event?.error || event);
        // Emit status event for UI
        try { window.dispatchEvent(new CustomEvent('voice-relay-status', { detail: { status: 'restarting', reason: (event?.error && String(event.error)) || 'recorder-error' } })); } catch (e) {}
        // Attempt a quick automatic restart of the recorder when possible
        try {
          setTimeout(() => {
            if (this.destroyed || this.isMuted || !this.localStream || !this.socket?.connected) return;
            const existing = this.voiceRelayRecorders.get("local");
            const inactive = !existing || (existing && existing.state === "inactive");
            if (inactive) {
              this.startVoiceRelay().catch(() => {});
            }
          }, 700);
        } catch (e) {}
      };

      recorder.onstop = () => {
        this.voiceRelayRecorders.delete("local");
      };

      await this.emitVoiceRelayStart();
      recorder.start(220);
      console.log("[VoiceSystem] Server voice relay started");
      try { window.dispatchEvent(new CustomEvent('voice-relay-status', { detail: { status: 'healthy' } })); } catch (e) {}
    } catch (err) {
      this.voiceRelayRecorders.delete("local");
      console.warn("[VoiceSystem] Failed to start voice relay:", err);
      try { window.dispatchEvent(new CustomEvent('voice-relay-status', { detail: { status: 'stopped', reason: String(err || '') } })); } catch (e) {}
    }
  }

  stopVoiceRelay(reason = "muted") {
    if (this.destroyed) {
      return;
    }

    const recorder = this.voiceRelayRecorders.get("local");
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch (err) {
        console.warn("[VoiceSystem] Failed to stop voice relay recorder:", err);
      }
    }

    this.voiceRelayRecorders.delete("local");

    if (this.socket?.connected && !this.destroyed) {
      try {
        this.socket.emit("voice-relay-stop", { reason });
      } catch (err) {
        console.warn("[VoiceSystem] Failed to announce voice relay stop:", err);
      }
    }
    try { window.dispatchEvent(new CustomEvent('voice-relay-status', { detail: { status: 'stopped', reason } })); } catch (e) {}
  }

  syncVoiceRelayState() {
    if (this.destroyed) {
      return;
    }

    if (this.isMuted || !this.localStream || !this.socket?.connected) {
      const reason = this.isMuted ? "muted" : "inactive";
      const recorder = this.voiceRelayRecorders.get("local");
      if (recorder && recorder.state !== "inactive") {
        this.stopVoiceRelay(reason);
      }
      return;
    }

    const recorder = this.voiceRelayRecorders.get("local");
    if (!recorder || recorder.state === "inactive") {
      this.startVoiceRelay();
    }
  }

  startVoiceRelayHealthCheck(intervalMs = 4000) {
    try {
      if (this.voiceRelayHealthTimer) return;
      this.voiceRelayHealthTimer = setInterval(() => {
        try {
          if (this.destroyed || this.isMuted || !this.localStream || !this.socket?.connected) return;
          const recorder = this.voiceRelayRecorders.get("local");
          const needStart = !recorder || (recorder && recorder.state === "inactive");
          if (needStart) {
            this.startVoiceRelay().catch(() => {});
          }
        } catch (e) {}
      }, Number(intervalMs) || 4000);
    } catch (e) {}
  }

  stopVoiceRelayHealthCheck() {
    try {
      if (this.voiceRelayHealthTimer) {
        clearInterval(this.voiceRelayHealthTimer);
        this.voiceRelayHealthTimer = null;
      }
    } catch (e) {}
  }

  attachAudioBoost(audioElement, speakerRole = "student") {
    if (!audioElement || !this.audioContext || this.listenOnlyMode) {
      return;
    }

    if (!this._audioUnlocked || this.audioContext.state !== "running") {
      return;
    }

    const sourceKey = audioElement.id || audioElement.dataset?.speakerId || audioElement;
    if (this.remoteAudioSources.has(sourceKey)) {
      return;
    }

    try {
      const sourceNode = this.audioContext.createMediaElementSource(audioElement);
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = speakerRole === "teacher" ? 2.8 : 1.8;
      sourceNode.connect(gainNode).connect(this.audioContext.destination);
      this.remoteAudioSources.set(sourceKey, { sourceNode, gainNode });
    } catch (err) {
      console.warn("[VoiceSystem] Failed to attach audio boost:", err);
    }
  }

  isRelaySourceBufferReady(entry) {
    if (!entry || entry.stopped) {
      return false;
    }

    const { sourceBuffer, mediaSource } = entry;
    if (!sourceBuffer || !mediaSource || mediaSource.readyState !== "open") {
      return false;
    }

    try {
      return Array.from(mediaSource.sourceBuffers || []).includes(sourceBuffer);
    } catch {
      return false;
    }
  }

  playRelayChunkFallback(entry, buffer, speakerId = "") {
    if (this.destroyed || !entry) {
      return;
    }

    if (!entry.streamParts) {
      entry.streamParts = [];
    }
    entry.streamParts.push(buffer);

    if (entry.streamParts.length > 120) {
      entry.streamParts = entry.streamParts.slice(-60);
    }

    if (entry._blobPlayTimer) {
      clearTimeout(entry._blobPlayTimer);
    }
    entry._blobPlayTimer = window.setTimeout(() => {
      entry._blobPlayTimer = null;
      this.flushStreamBlobPlayback(entry, speakerId);
    }, 320);
  }

  flushStreamBlobPlayback(entry, speakerId = "") {
    if (this.destroyed || !entry || entry.stopped || !entry.streamParts?.length) {
      return;
    }

    try {
      const blob = new Blob(entry.streamParts, { type: entry?.mimeType || this.voiceRelayMimeType });
      const objectUrl = URL.createObjectURL(blob);
      const audio = entry.audio || document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = this.isDeafened ? 0 : 1.0;
      audio.muted = false;
      audio.className = "dc-remote-audio dc-voice-relay-audio dc-voice-relay-fallback";
      audio.dataset.speakerId = speakerId;
      this.configureRelayAudioElement(audio);

      if (!entry.audio) {
        document.body.appendChild(audio);
        entry.audio = audio;
      }

      const previousUrl = entry.objectUrl;
      entry.objectUrl = objectUrl;
      audio.src = objectUrl;

      if (previousUrl && previousUrl !== objectUrl) {
        window.setTimeout(() => {
          try {
            URL.revokeObjectURL(previousUrl);
          } catch (err) {
            console.warn(`[VoiceSystem] Failed to revoke relay object URL for ${speakerId}:`, err);
          }
        }, 500);
      }

      this.safePlayAudio(audio, `relay-blob-${speakerId}`);
    } catch (err) {
      console.warn(`[VoiceSystem] Fallback relay playback failed for ${speakerId}:`, err);
    }
  }

  removeRelaySpeakerPlayback(speakerId) {
    const entry = this.voiceRelayRemotePlayers.get(speakerId);
    if (!entry) {
      return;
    }

    entry.stopped = true;
    entry.queue.length = 0;
    entry.streamParts = [];
    if (entry._blobPlayTimer) {
      clearTimeout(entry._blobPlayTimer);
      entry._blobPlayTimer = null;
    }
    entry.sourceBuffer = null;

    try {
      if (entry.mediaSource && entry.mediaSource.readyState === "open") {
        try {
          entry.mediaSource.endOfStream();
        } catch (err) {
          console.warn(`[VoiceSystem] Failed to end relay media source for ${speakerId}:`, err);
        }
      }
    } catch (err) {
      console.warn(`[VoiceSystem] Relay speaker cleanup warning for ${speakerId}:`, err);
    }

    entry.mediaSource = null;
    this.detachRelayAudioElement(entry);
    this._relayResetAttempts.delete(speakerId);

    this.voiceRelayRemotePlayers.delete(speakerId);
    this.remoteAudioSources.delete(`voice-relay-${speakerId}`);
  }

  resetRelaySpeakerPlayback(speakerId, payload = {}) {
    const attempts = Number(this._relayResetAttempts.get(speakerId) || 0);
    if (attempts >= 3) {
      return this.voiceRelayRemotePlayers.get(speakerId) || null;
    }

    this._relayResetAttempts.set(speakerId, attempts + 1);
    this.removeRelaySpeakerPlayback(speakerId);
    return this.ensureRelaySpeakerPlayback(speakerId, payload);
  }

  ensureRelaySpeakerPlayback(speakerId, payload = {}) {
    if (speakerId === (this.socket?.id || this.currentUserId)) {
      return null;
    }

    let entry = this.voiceRelayRemotePlayers.get(speakerId);
    if (entry?.stopped) {
      this.removeRelaySpeakerPlayback(speakerId);
      entry = null;
    }
    if (entry) {
      if (payload.displayName) entry.displayName = payload.displayName;
      if (payload.mimeType) entry.mimeType = payload.mimeType;
      if (payload.role) entry.role = payload.role;
      return entry;
    }

    const mimeType = String(payload.mimeType || this.voiceRelayMimeType || "audio/webm;codecs=opus");
    const audio = document.createElement("audio");
    audio.id = `voice-relay-${speakerId}`;
    audio.className = "dc-remote-audio dc-voice-relay-audio";
    audio.autoplay = true;
    audio.playsInline = true;
    audio.preload = "auto";
    audio.muted = false; // CRITICAL: Never mute by default, let volume handle it
    audio.dataset.speakerId = speakerId;
    audio.dataset.role = payload.role || "student";
    audio.dataset.displayName = payload.displayName || speakerId;
    audio.volume = this.isDeafened ? 0 : 1.0; // Use volume instead of muted
    audio.controls = false; // Hidden controls for debugging
    this.configureRelayAudioElement(audio);
    
    document.body.appendChild(audio);
    console.log("[VoiceSystem] ✓ Created relay audio element:", { speakerId, displayName: payload.displayName, mimeType, volume: audio.volume, muted: audio.muted });

    entry = {
      speakerId,
      displayName: payload.displayName || speakerId,
      role: payload.role || "student",
      mimeType,
      audio,
      mediaSource: null,
      sourceBuffer: null,
      queue: [],
      streamParts: [],
      objectUrl: null,
      ready: false,
      stopped: false,
      appendedChunks: 0,
    };

    this.voiceRelayRemotePlayers.set(speakerId, entry);

    const useStreamBlobPlayback = this.listenOnlyMode
      || typeof MediaSource === "undefined"
      || !MediaSource.isTypeSupported?.(mimeType);

    if (!useStreamBlobPlayback) {
      const mediaSource = new MediaSource();
      entry.mediaSource = mediaSource;
      entry.objectUrl = URL.createObjectURL(mediaSource);
      audio.src = entry.objectUrl;

      mediaSource.addEventListener("sourceopen", () => {
        try {
          if (entry.stopped || this.destroyed) {
            console.log("[VoiceSystem] Relay relay for", speakerId, "was stopped before sourceopen");
            return;
          }

          let sourceBuffer;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          } catch (err) {
            console.warn(`[VoiceSystem] ✗ Failed to create SourceBuffer for ${speakerId}:`, err?.message || err);
            entry.mediaSource = null;
            entry.sourceBuffer = null;
            entry.ready = true;
            return;
          }

          sourceBuffer.mode = "sequence";
          sourceBuffer.addEventListener("updateend", () => {
            if (entry.stopped || this.destroyed) {
              return;
            }
            this.flushRelaySpeakerQueue(speakerId);
          });
          entry.sourceBuffer = sourceBuffer;
          entry.ready = true;
          console.log("[VoiceSystem] ✓ Relay source opened for", speakerId, "- ready for audio chunks");
          
          // Ensure audio is not muted and volume is up
          audio.volume = this.isDeafened ? 0 : 1.0;
          audio.muted = false;
          
          this.flushRelaySpeakerQueue(speakerId);
          
          this.safePlayAudio(audio, `relay-sourceopen-${speakerId}`);
        } catch (err) {
          console.warn(`[VoiceSystem] ✗ Failed to open relay source for ${speakerId}:`, err?.message || err);
        }
      }, { once: true });
    } else {
      console.log("[VoiceSystem] Using stream blob playback for", speakerId);
      entry.ready = true;
    }

    this.attachAudioBoost(audio, payload.role || "student");
    
    audio.volume = this.isDeafened ? 0 : 1.0;
    audio.muted = false;
    
    console.log("[VoiceSystem] Audio element configured:", { speakerId, volume: audio.volume, muted: audio.muted, paused: audio.paused });
    return entry;
  }

  flushRelaySpeakerQueue(speakerId) {
    const entry = this.voiceRelayRemotePlayers.get(speakerId);
    if (!entry || entry.stopped || !this.isRelaySourceBufferReady(entry) || entry.sourceBuffer.updating || entry.queue.length === 0) {
      return;
    }

    const nextChunk = entry.queue.shift();
    if (!nextChunk) {
      return;
    }

    try {
      entry.sourceBuffer.appendBuffer(nextChunk);
      entry.appendedChunks += 1;
    } catch (err) {
      console.warn(`[VoiceSystem] Failed to append relay chunk for ${speakerId}:`, err);
      entry.queue.unshift(nextChunk);
      this.resetRelaySpeakerPlayback(speakerId, {
        displayName: entry.displayName,
        mimeType: entry.mimeType,
        role: entry.role,
      });
    }
  }

  handleVoiceRelayStart(payload = {}) {
    const speakerId = String(payload.speakerId || "").trim();
    if (!speakerId || speakerId === String(this.socket?.id || this.currentUserId || "")) return;
    const existing = this.voiceRelayRemotePlayers.get(speakerId);
    if (existing?.stopped) {
      this.removeRelaySpeakerPlayback(speakerId);
    }
    this.ensureRelaySpeakerPlayback(speakerId, payload);
  }

  handleVoiceRelaySnapshot(payload = {}) {
    const speakers = Array.isArray(payload.speakers) ? payload.speakers : [];
    const history = Array.isArray(payload.history) ? payload.history : [];

    speakers.forEach((speaker) => {
      const speakerId = String(speaker?.speakerId || "").trim();
      if (!speakerId || speakerId === String(this.socket?.id || this.currentUserId || "")) {
        return;
      }
      this.ensureRelaySpeakerPlayback(speakerId, speaker);
    });

    // History entries are intentionally ignored to prevent stale buffered voice
    // from playing when a new participant joins. Only live relay packets should
    // be played after join.
    //
    // If you still want to show active speakers, the speaker list is created above
    // from the current relay state, but no buffered audio chunks are replayed.
  }

  async handleVoiceRelayChunk(payload = {}) {
    if (this.destroyed) {
      return;
    }

    const speakerId = String(payload.speakerId || "").trim();
    const chunk = payload.chunk;
    if (!speakerId || !chunk || speakerId === String(this.socket?.id || this.currentUserId || "")) return;

    console.log("[VoiceSystem] Received voice relay chunk from:", speakerId, "chunk size:", chunk?.length || "?");

    let entry = this.ensureRelaySpeakerPlayback(speakerId, payload);
    if (!entry) {
      console.warn("[VoiceSystem] Failed to ensure replay player for:", speakerId);
      return;
    }

    const buffer = await this.normalizeRelayChunk(chunk);
    if (!buffer) {
      console.warn("[VoiceSystem] Failed to normalize relay chunk from:", speakerId);
      return;
    }

    if (!this.isRelaySourceBufferReady(entry)) {
      entry.queue.push(buffer);

      if (!entry.mediaSource || !entry.sourceBuffer) {
        console.log("[VoiceSystem] MediaSource unavailable or source buffer invalid for", speakerId, "- using stream blob playback");
        this.playRelayChunkFallback(entry, buffer, speakerId);
      } else {
        console.log("[VoiceSystem] SourceBuffer not ready yet for", speakerId, "- queued chunk");
      }

      if (!this._audioUnlocked) {
        this.showAudioUnlockBanner();
      }
      return;
    }

    if (!entry.sourceBuffer.updating) {
      try {
        entry.sourceBuffer.appendBuffer(buffer);
        entry.appendedChunks += 1;
        this._relayResetAttempts.delete(speakerId);
        console.log("[VoiceSystem] Appended chunk for", speakerId, "- total chunks:", entry.appendedChunks);
      } catch (err) {
        console.warn(`[VoiceSystem] Failed to append relay chunk for ${speakerId}:`, err?.message);
        entry.queue.push(buffer);
        this.resetRelaySpeakerPlayback(speakerId, payload);
      }
    } else {
      console.log("[VoiceSystem] SourceBuffer updating, queueing chunk for", speakerId);
      entry.queue.push(buffer);
      this.flushRelaySpeakerQueue(speakerId);
    }

    if (entry.audio?.paused && this._audioUnlocked) {
      entry.audio.volume = this.isDeafened ? 0 : 1.0;
      entry.audio.muted = false;
      this.safePlayAudio(entry.audio, `relay-chunk-${speakerId}`);
    }
    
    // Ensure volume is correct
    if (entry.audio) {
      entry.audio.volume = this.isDeafened ? 0 : 1.0;
      entry.audio.muted = false;
    }

    if (!this._audioUnlocked) {
      this.showAudioUnlockBanner();
    } else if (this.audioContext?.state === "running") {
      this.attachAudioBoost(entry.audio, entry.role || payload.role || "student");
    }
  }

  handleVoiceRelayStop(payload = {}) {
    const speakerId = String(payload.speakerId || "").trim();
    if (!speakerId || speakerId === String(this.socket?.id || this.currentUserId || "")) return;
    this.removeRelaySpeakerPlayback(speakerId);
  }

  async initLocalStream() {
    try {
      if (!this.isMicrophoneAvailable()) {
        return this.initListenOnlyMode(this.getMicrophoneBlockedReason());
      }

      // Detect low-bandwidth / save-data mode (2G devices)
      const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const effectiveType = String(net?.effectiveType || "").toLowerCase();
      const saveData = Boolean(net?.saveData);
      const isLowBandwidth = saveData || effectiveType === "slow-2g" || effectiveType === "2g";

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,

          sampleRate: isLowBandwidth ? { ideal: 8000 } : { ideal: 16000 },
          channelCount: 1,

          latency: 0.01,
          maxaveragebitrate: isLowBandwidth ? 8000 : 16000,
        },
        video: false
      };

      this.logWebRtc("getUserMedia requesting", { constraints, isMuted: this.isMuted });
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.listenOnlyMode = false;
      this.hideMicBlockedBanner();
      this.logWebRtc("getUserMedia success", {
        trackCount: this.localStream.getAudioTracks().length,
        tracks: this.localStream.getAudioTracks().map((t) => ({
          enabled: t.enabled,
          muted: t.muted,
          readyState: t.readyState,
          label: t.label,
        })),
      });
      
      // Apply additional audio processing
      await this.setupAudioProcessing();
      console.log("[VoiceSystem] Audio context created:", this.audioContext?.state);
      
      // Start muted
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = !this.isMuted;
        this.localAudioTrack = t;
        this.logWebRtc("local track configured", { enabled: t.enabled, isMuted: this.isMuted });
      });
      
      this.refreshRemoteAudioElements();
      this.syncVoiceRelayState();
      this.startVoiceRelayHealthCheck();
      this.requestExistingPeers();

      if (!this.useServerVoiceRelay) {
        this.logWebRtc("local stream ready — WebRTC mesh active");
      }

      if (this.useServerVoiceRelay && (this.currentRole === "teacher" || this.teacherMicApproved) && !this.isMuted) {
        await this.startVoiceRelay();
      }

      return true;
    } catch (err) {
      const reason = err?.message || String(err);
      this.logWebRtc("getUserMedia failed", { error: reason, name: err?.name });

      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        if (this.currentRole === "teacher") {
          this.showMicBlockedBanner("Microphone permission denied. Allow mic access in browser settings.");
        }
      }

      return this.initListenOnlyMode(reason);
    }
  }

  async setupAudioProcessing() {
    try {
      // Create AudioContext for better audio processing in multi-user scenarios
      if (!this.audioContext) {
        const ContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new ContextClass();
        console.log("[VoiceSystem] Created AudioContext:", this.audioContext?.state);
      }
      
      // Resume audio context if suspended (autoplay policy)
      await this.resumeAudioContext();
      
      // This allows for more granular control in 3+ user scenarios
      // The browser's native audio processing is still the primary mechanism
    } catch (err) {
      console.warn("[VoiceSystem] Audio processing setup failed (non-critical):", err?.message);
    }
  }

  toggleMute() {
    return this.setMuted(!this.isMuted);
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    console.log("[VoiceSystem] Deafen toggled:", this.isDeafened);
    // Walk over all remote audio elements and adjust volume (not mute attribute)
    document.querySelectorAll('.dc-remote-audio').forEach(audio => {
      audio.volume = this.isDeafened ? 0 : 1.0;
      audio.muted = false; // Keep muted as false, use volume instead
      console.log("[VoiceSystem] Updated audio volume for deafen:", { volume: audio.volume, speaker: audio.dataset.speakerId });
    });
    this.socket.emit("audio-state-change", { deafened: this.isDeafened });
    return this.isDeafened;
  }

  getMaxMeshPeerConnections() {
    return Math.max(1, Number(this.meshParticipantLimit || 12) - 1);
  }

  fallbackToServerVoiceRelay(reason = "peer-connection-limit") {
    if (this.useServerVoiceRelay || this.destroyed) {
      return;
    }

    console.warn(`[VoiceSystem] Falling back to server voice relay (${reason})`);
    this.useServerVoiceRelay = true;
    Array.from(this.peers.keys()).forEach((userId) => {
      this.closePeer(userId);
    });
    this.syncVoiceRelayState();
  }

  pruneStalePeers(activePeerIds = []) {
    const activeIds = new Set(activePeerIds.filter(Boolean));
    Array.from(this.peers.keys()).forEach((userId) => {
      if (!activeIds.has(userId)) {
        this.closePeer(userId);
      }
    });
  }

  releasePeerConnection(pc) {
    if (!pc) {
      return;
    }

    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;

    try {
      pc.close();
    } catch (err) {
      console.warn("[VoiceSystem] Error closing peer connection:", err?.message || err);
    }
  }

  shouldReusePeerConnection(pc) {
    if (!pc) {
      return false;
    }

    const connectionState = pc.connectionState;
    if (connectionState === "connected" || connectionState === "connecting" || connectionState === "new") {
      return true;
    }

    if (connectionState === "disconnected") {
      const signalingState = pc.signalingState;
      return signalingState === "have-local-offer"
        || signalingState === "have-remote-offer"
        || signalingState === "stable";
    }

    return false;
  }

  async connectToPeerList(peers = []) {
    if (this.useServerVoiceRelay) {
      return;
    }

    const normalizedPeers = peers
      .map((peer) => (typeof peer === "string"
        ? { userId: peer, role: null }
        : { userId: peer?.userId, role: peer?.role || null }))
      .filter((peer) => this.shouldConnectToPeer(peer));

    this._pendingPeerList = normalizedPeers;
    if (this._connectPeerListRunning) {
      return;
    }

    this._connectPeerListRunning = true;
    try {
      while (this._pendingPeerList) {
        const batch = this._pendingPeerList;
        this._pendingPeerList = null;
        await this.syncPeerConnections(batch);
      }
    } finally {
      this._connectPeerListRunning = false;
    }
  }

  async syncPeerConnections(normalizedPeers = []) {
    this.logWebRtc("connectToPeerList", { count: normalizedPeers.length, peers: normalizedPeers });
    this.pruneStalePeers(normalizedPeers.map((peer) => peer.userId));

    for (const peer of normalizedPeers) {
      const peerId = peer.userId;
      try {
        // Stagger connection initiation to prevent simultaneous offers/answers
        const delayMs = Math.random() * 500;
        await new Promise((resolve) => setTimeout(resolve, delayMs));

        await this.initPeerConnection(peerId, this.shouldInitiatePeer(peerId));
      } catch (err) {
        console.error(`[VoiceSystem] Failed to connect to peer ${peerId}:`, err);
        if (this.isPeerConnectionLimitError(err)) {
          this.fallbackToServerVoiceRelay("browser-peer-connection-limit");
          return;
        }
      }
    }
  }

  isPeerConnectionLimitError(err) {
    const message = String(err?.message || err || "").toLowerCase();
    return message.includes("cannot create so many peerconnections")
      || message.includes("cannot create so many peer connections");
  }

  setupSocketListeners() {
    this.bindSocketEvent("connect", this.handleSocketConnect);
    this.bindSocketEvent("disconnect", this.handleSocketDisconnect);

    this.bindSocketEvent("reconnect", () => {
      if (this.destroyed) return;
      console.log("[VoiceSystem] Socket reconnected");
      this.handleSocketConnect();
    });

    this.bindSocketEvent("reconnect_attempt", (attempt) => {
      if (this.destroyed) return;
      console.log(`[VoiceSystem] Socket reconnect attempt ${attempt}`);
    });

    this.bindSocketEvent("reconnect_error", (err) => {
      if (this.destroyed) return;
      console.warn("[VoiceSystem] Socket reconnect error:", err?.message || err);
    });

    this.bindSocketEvent("connect_error", (err) => {
      if (this.destroyed) return;
      console.warn("[VoiceSystem] Socket connection error:", err?.message || err);
    });

    this.bindSocketEvent("peer-joined", async ({ userId, role }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      const selfId = this.socket?.id || this.currentUserId;
      if (userId === this.currentUserId || userId === selfId) {
        console.log("[VoiceSystem] Received our own user ID confirmation");
        return;
      }
      
      console.log(`[VoiceSystem] Peer joined: ${userId} (role: ${role})`);
      this.logWebRtc("peer joined", { userId, role });

      if (!this.shouldConnectToPeer({ userId, role })) {
        return;
      }

      try {
        await this.initPeerConnection(userId, this.shouldInitiatePeer(userId));
      } catch (err) {
        if (this.isPeerConnectionLimitError(err)) {
          this.fallbackToServerVoiceRelay("browser-peer-connection-limit");
          return;
        }
        console.warn(`[VoiceSystem] Could not connect to joined peer ${userId}:`, err);
      }
    });

    this.bindSocketEvent("voice-scaling-state", (payload) => {
      this.applyVoiceScalingState(payload || {});
    });

    this.bindSocketEvent("existing-peers", async (peers) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      if (!Array.isArray(peers) || peers.length === 0) {
        return;
      }

      console.log(`[VoiceSystem] Syncing ${peers.length} existing peers`);
      this.logWebRtc("existing peers", { count: peers.length });
      await this.connectToPeerList(peers);
    });

    this.bindSocketEvent("webrtc-offer", async ({ caller, callerRole, offer }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      try {
        if (!this.shouldConnectToPeer({ userId: caller, role: callerRole || null })) {
          return;
        }

        this.logWebRtc("offer received", { caller, callerRole });
        const pc = await this.initPeerConnection(caller, false);
        
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        this.logWebRtc("remote offer applied", { caller, signalingState: pc.signalingState });
        
        const answer = await pc.createAnswer();
        this.optimizeSdpForLowBandwidth(answer);
        await pc.setLocalDescription(answer);
        this.logWebRtc("answer created", { caller });
        
        this.socket.emit("webrtc-answer", { target: caller, answer });
      } catch (err) {
        this.logWebRtc("offer handling error", { caller, error: err?.message || err });
      }
    });

    this.bindSocketEvent("webrtc-answer", async ({ caller, answer }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      try {
        const pc = this.peers.get(caller);
        if (!pc) {
          console.warn(`[VoiceSystem] Received answer for unknown peer ${caller}`);
          return;
        }

        // If remote description already matches, ignore duplicate answers
        try {
          if (pc.remoteDescription && pc.remoteDescription.sdp === answer.sdp) {
            console.log(`[VoiceSystem] Duplicate answer received from ${caller}, ignoring`);
            return;
          }
        } catch (e) {
          // ignore comparison errors
        }

        // Only apply answers when in a state that expects them
        const sigState = pc.signalingState;
        if (sigState !== "have-local-offer" && sigState !== "have-local-pranswer") {
          console.warn(`[VoiceSystem] Ignoring remote answer from ${caller} due to signalingState=${sigState}`);

          // If we received an answer while stable, attempt a limited recovery:
          // close and recreate the peer connection and re-initiate an offer.
          if (sigState === "stable") {
            const attempts = this.peerReconnectAttempts.get(caller) || 0;
            if (attempts < 2) {
              console.warn(`[VoiceSystem] Attempting recovery for ${caller} (attempt ${attempts + 1})`);
              this.peerReconnectAttempts.set(caller, attempts + 1);
              try {
                this.closePeer(caller);
                // slight pause before recreating
                await new Promise(r => setTimeout(r, 150 + Math.random() * 200));
                await this.initPeerConnection(caller, true);
              } catch (recErr) {
                console.error(`[VoiceSystem] Recovery attempt failed for ${caller}:`, recErr);
              }
            } else {
              console.warn(`[VoiceSystem] Max recovery attempts reached for ${caller}`);
            }
          }

          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        this.logWebRtc("answer applied", { caller, connectionState: pc.connectionState });
      } catch (err) {
        this.logWebRtc("answer handling error", { caller, error: err?.message || err });
      }
    });

    this.bindSocketEvent("webrtc-candidate", async ({ caller, candidate }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      try {
        const pc = this.peers.get(caller);
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          this.logWebRtc("ICE candidate added", {
            caller,
            type: candidate?.candidate?.split(" ")[7] || "unknown",
          });
        }
      } catch (err) {
        this.logWebRtc("ICE candidate error", { caller, error: err?.message || err });
      }
    });

    this.bindSocketEvent("peer-left", (userId) => {
      console.log(`[VoiceSystem] Peer left: ${userId}`);
      this.closePeer(userId);
    });
    
    // Update audio state notifications from server (teacher or user updates)
    this.bindSocketEvent("audio-state-change", ({ userId, muted, deafened, by }) => {
      try {
        const selfId = this.socket?.id || this.currentUserId;
        if (userId === selfId || userId === this.currentUserId) {
          this.applyTeacherAudioState({ muted, deafened, by }).catch((error) => {
            console.warn("[VoiceSystem] Could not apply teacher audio state:", error);
          });
          return;
        }

        // Relay speakers use voice-relay-* elements; WebRTC uses audio-{userId}
        if (muted === false) {
          const webrtcAudio = document.getElementById(`audio-${userId}`);
          if (webrtcAudio) {
            webrtcAudio.muted = false;
            webrtcAudio.volume = this.isDeafened ? 0 : 1.0;
            this.safePlayAudio(webrtcAudio, `webrtc-state-${userId}`);
          }
          if (!this.useServerVoiceRelay) {
            this.ensureRelaySpeakerPlayback(String(userId), { speakerId: userId, role: "student" });
          }
          if (this._audioUnlocked) {
            this.resumeAllRelayPlayback();
          }
        }

        // Update remote audio element for other users
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
          if (muted !== undefined) {
            // If muted=true, mute the remote element; if false, attempt playback
            audio.muted = Boolean(muted) || this.isDeafened;
            if (!audio.muted) {
              audio.play().catch(err => console.warn(`[VoiceSystem] Play after state update failed for ${userId}:`, err));
            }
          }
          if (deafened !== undefined) {
            // Deafened is a local-only flag; reflect as mute on element
            audio.muted = this.isDeafened || Boolean(deafened);
          }
        }
      } catch (err) {
        console.warn("audio-state-change handler error:", err);
      }
    });

    // Teachers receive list of raised hands
    this.bindSocketEvent("raise-hand-list", (list) => {
      console.log("[VoiceSystem] Raised hand list:", list);
    });

    this.bindSocketEvent("voice-relay-start", (payload) => {
      this.handleVoiceRelayStart(payload || {});
    });

    this.bindSocketEvent("voice-relay-chunk", (payload) => {
      this.handleVoiceRelayChunk(payload || {}).catch((err) => {
        console.warn("[VoiceSystem] Failed to handle relay chunk:", err);
      });
    });

    this.bindSocketEvent("voice-relay-stop", (payload) => {
      this.handleVoiceRelayStop(payload || {});
    });

    this.bindSocketEvent("voice-relay-state", (payload = {}) => {
      this.handleVoiceRelaySnapshot(payload || {});
    });

    this.bindSocketEvent("unmute-request", ({ userId }) => {
      console.log("[VoiceSystem] Unmute request from:", userId);
    });
  }

  async initPeerConnection(userId, isInitiator) {
    if (this.useServerVoiceRelay) {
      return null;
    }

    if (this._peerInitLocks.has(userId)) {
      return this._peerInitLocks.get(userId);
    }

    const initPromise = this.createPeerConnection(userId, isInitiator);
    this._peerInitLocks.set(userId, initPromise);
    try {
      return await initPromise;
    } finally {
      this._peerInitLocks.delete(userId);
    }
  }

  async createPeerConnection(userId, isInitiator) {
    if (this.useServerVoiceRelay) {
      return null;
    }

    if (this.peers.has(userId)) {
      const existingPc = this.peers.get(userId);
      if (this.shouldReusePeerConnection(existingPc)) {
        this.logWebRtc("reusing existing peer connection", {
          userId,
          state: existingPc.connectionState,
          signalingState: existingPc.signalingState,
        });
        return existingPc;
      }
      this.closePeer(userId);
    }

    if (
      !this.peers.has(userId)
      && this.peers.size >= this.getMaxMeshPeerConnections()
    ) {
      this.pruneStalePeers(Array.from(this.peers.keys()));
    }

    if (
      !this.peers.has(userId)
      && this.peers.size >= this.getMaxMeshPeerConnections()
    ) {
      this.fallbackToServerVoiceRelay("mesh-peer-budget-exceeded");
      return null;
    }

    if (!this.localStream && !this.listenOnlyMode) {
      const success = await this.initLocalStream();
      if (!success && !this.localStream) {
        throw new Error("Failed to initialize local stream");
      }
    }

    let pc;
    try {
      pc = new RTCPeerConnection({
        iceServers: this.getIceServers(),
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceTransportPolicy: "all",
      });
    } catch (err) {
      if (this.isPeerConnectionLimitError(err)) {
        Array.from(this.peers.entries()).forEach(([peerId, existingPc]) => {
          if (existingPc.connectionState !== "connected") {
            this.closePeer(peerId);
          }
        });

        if (this.peers.size >= this.getMaxMeshPeerConnections()) {
          this.fallbackToServerVoiceRelay("browser-peer-connection-limit");
          return null;
        }

        try {
          pc = new RTCPeerConnection({
            iceServers: this.getIceServers(),
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
            iceTransportPolicy: "all",
          });
        } catch (retryErr) {
          this.fallbackToServerVoiceRelay("browser-peer-connection-limit");
          return null;
        }
      } else {
        throw err;
      }
    }

    this.peers.set(userId, pc);
    this.logWebRtc("peer connection created", { userId, isInitiator });

    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((track) => {
          pc.addTrack(track, this.localStream);
          this.logWebRtc("addTrack on connect", {
            userId,
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          });
        });
      } catch (err) {
        this.logWebRtc("addTrack error", { userId, error: err?.message || err });
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-candidate", { target: userId, candidate: event.candidate });
        this.logWebRtc("ICE candidate local", {
          userId,
          type: event.candidate.type,
          protocol: event.candidate.protocol,
        });
      } else {
        this.logWebRtc("ICE gathering complete", { userId });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0] || new MediaStream([event.track]);
      this.logWebRtc("ontrack fired", {
        userId,
        trackKind: event.track?.kind,
        trackEnabled: event.track?.enabled,
        trackMuted: event.track?.muted,
        streamId: stream?.id,
      });
      this.attachWebRtcRemoteAudio(userId, stream);
    };

    pc.onconnectionstatechange = () => {
      this.logWebRtc("connection state", { userId, state: pc.connectionState });
      
      if (pc.connectionState === "connected") {
        if (this.peerConnectivityTimeout.has(userId)) {
          clearTimeout(this.peerConnectivityTimeout.get(userId));
          this.peerConnectivityTimeout.delete(userId);
        }
        if (this.peerReconnectAttempts?.has(userId)) {
          this.peerReconnectAttempts.delete(userId);
        }
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(userId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      this.logWebRtc("ICE connection state", { userId, state: pc.iceConnectionState });
    };

    pc.onsignalingstatechange = () => {
      this.logWebRtc("signaling state", { userId, state: pc.signalingState });
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
          iceRestart: false,
        });
        this.optimizeSdpForLowBandwidth(offer);
        await pc.setLocalDescription(offer);
        this.logWebRtc("offer created", { userId });
        this.socket.emit("webrtc-offer", { target: userId, offer });
      } catch (err) {
        this.logWebRtc("offer creation error", { userId, error: err?.message || err });
        this.closePeer(userId);
      }
    }

    return pc;
  }

  optimizeSdpForLowBandwidth(desc) {
    if (!desc?.sdp) {
      return;
    }

    // Keep the SDP standards-safe and only tune bandwidth-sensitive parameters.
    // Changing the OPUS clock rate in SDP can break audio negotiation on some browsers.
    let sdp = desc.sdp;

    // Remove any pre-existing bandwidth caps so we can insert a consistent audio profile.
    sdp = sdp.replace(/^b=AS:\d+\r?$/gm, "");

    // Prefer an OPUS profile suitable for slow 2G/3G networks.
    // Match various OPUS formats: opus/48000/2, opus/48000, etc.
    sdp = sdp.replace(
      /(a=rtpmap:111 opus\/\d+(?:\/\d+)?\r?\n)/,
      "$1a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;sprop-stereo=0;maxaveragebitrate=16000;maxplaybackrate=8000\r\na=ptime:20\r\n"
    );

    // Apply a conservative audio-only bandwidth cap.
    sdp = sdp.replace(/(m=audio\s+\d+\s+[A-Z\/]+\s+\d+\r?\n)/, "$1b=AS:16\r\n");

    desc.sdp = sdp;
  }

  closePeer(userId) {
    console.log(`[VoiceSystem] Closing peer connection for ${userId}`);

    if (this.peerConnectivityTimeout.has(userId)) {
      clearTimeout(this.peerConnectivityTimeout.get(userId));
      this.peerConnectivityTimeout.delete(userId);
    }

    const pc = this.peers.get(userId);
    if (pc) {
      this.peers.delete(userId);
      this.releasePeerConnection(pc);
    }
    
    const audioEntry = document.getElementById(`audio-${userId}`);
    if (audioEntry) {
      audioEntry.pause();
      audioEntry.srcObject = null;
      audioEntry.remove();
    }
    
    if (this.remoteAudioSources.has(userId)) {
      this.remoteAudioSources.delete(userId);
    }
    
    console.log(`[VoiceSystem] Peer ${userId} closed`);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    console.log("[VoiceSystem] Destroying voice system");
    this.destroyed = true;

    this.stopVoiceRelayHealthCheck();
    this.removeAudioUnlockHandler();
    this.hideAudioUnlockBanner();
    this.hideMicBlockedBanner();

    if (this.disconnectCleanupTimer) {
      clearTimeout(this.disconnectCleanupTimer);
      this.disconnectCleanupTimer = null;
    }

    this.peerConnectivityTimeout.forEach((timeoutId) => clearTimeout(timeoutId));
    this.peerConnectivityTimeout.clear();

    this.stopVoiceRelay("destroy");
    this.removeSocketListeners();

    this.peers.forEach((pc) => {
      this.releasePeerConnection(pc);
    });
    this.peers.clear();
    this._peerInitLocks.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
      });
      this.localStream = null;
    }

    Array.from(this.voiceRelayRemotePlayers.keys()).forEach((speakerId) => {
      this.removeRelaySpeakerPlayback(speakerId);
    });
    this.voiceRelayRemotePlayers.clear();
    this.voiceRelayRecorders.clear();
    this._relayResetAttempts.clear();

    document.querySelectorAll(".dc-remote-audio, .dc-voice-relay-audio, .dc-voice-relay-fallback").forEach((audio) => {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.src = "";
        audio.load();
        audio.remove();
      } catch (err) {
        console.warn("[VoiceSystem] Error removing remote audio element:", err);
      }
    });

    this.remoteAudioSources.clear();

    const scalingBanner = document.getElementById(this.voiceScalingBannerId);
    if (scalingBanner) {
      scalingBanner.remove();
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (typeof window !== "undefined" && window.activeVoiceSystem === this) {
      window.activeVoiceSystem = null;
    }

    console.log("[VoiceSystem] Voice system destroyed");
  }
}
