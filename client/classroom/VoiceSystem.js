export class VoiceSystem {
  constructor(socket, currentUserId, currentRole) {
    this.socket = socket;
    this.currentUserId = currentUserId || socket?.id || null;
    this.currentRole = currentRole; // 'teacher' or 'student'
    this.destroyed = false;
    this.isSocketConnected = Boolean(socket?.connected);
    this.disconnectCleanupTimer = null;
    
    this.peers = new Map(); // userId -> RTCPeerConnection
    this.localStream = null;
    this.audioContext = null;
    this.localAudioTrack = null;
    this.remoteAudioSources = new Map(); // userId -> AudioContext MediaElementAudioSourceNode
    this.peerReconnectAttempts = new Map(); // userId -> attempt count
    this.voiceRelayRecorders = new Map();
    this.voiceRelayRemotePlayers = new Map();
    this.voiceRelaySequence = 0;
    this.useServerVoiceRelay = true;
    this.voiceRelayMimeType = "audio/webm;codecs=opus";
    this.voiceRelayBitrate = 16000;
    
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
    
    this.setupSocketListeners();
    if (this.socket.connected && this.socket.id) {
      this.handleSocketConnect();
    }
    this.requestExistingPeers();
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
    if (payload?.topology === "server-relay") {
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
  }

  handleSocketDisconnect(reason) {
    if (this.destroyed) {
      return;
    }

    console.log("[VoiceSystem] Socket disconnected", reason || "");
    this.isSocketConnected = false;
    this.stopVoiceRelay(reason || "socket-disconnect");

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
        await this.audioContext.resume();
      }
    } catch (err) {
      console.warn("[VoiceSystem] Failed to resume audio context:", err);
    }
  }

  setMuted(nextMuted) {
    this.isMuted = Boolean(nextMuted);
    // If student tries to unmute themselves, disallow and request teacher permission
    if (this.currentRole === "student" && !this.isMuted) {
      // revert flag and send request to teacher
      try {
        const displayName = localStorage.getItem("delta-user-display") || "";
        this.socket.emit("request-unmute", { displayName });
      } catch (e) {
        // best-effort
        this.socket.emit("request-unmute");
      }
      // keep muted
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

  async applyTeacherAudioState({ muted, deafened }) {
    if (muted !== undefined) {
      this.isMuted = Boolean(muted);
      if (!this.localStream) {
        await this.initLocalStream();
      }
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach((track) => {
          track.enabled = !this.isMuted;
        });
      }
      if (!this.isMuted) {
        await this.ensureLocalTrackOnPeers();
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
    const track = this.localStream?.getAudioTracks?.()[0];
    if (!track) return;

    for (const [peerId, pc] of this.peers.entries()) {
      try {
        const hasTrack = pc.getSenders().some((sender) => sender.track === track || sender.track?.kind === "audio");
        if (!hasTrack) {
          pc.addTrack(track, this.localStream);
          if (pc.signalingState === "stable") {
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
            this.optimizeSdpForLowBandwidth(offer);
            await pc.setLocalDescription(offer);
            this.socket.emit("webrtc-offer", { target: peerId, offer });
          }
        }
      } catch (error) {
        console.warn(`[VoiceSystem] Could not attach local audio to ${peerId}:`, error);
      }
    }
  }

  ensureUnmuted() {
    return this.setMuted(false);
  }

  enableRemoteAudioWithGesture() {
    // Call this from a user gesture (click/tap) to unmute remote audio
    // This bypasses browser autoplay policy
    this.resumeAudioContext();
    document.querySelectorAll('.dc-remote-audio').forEach(audio => {
      if (audio.muted && !this.isDeafened) {
        audio.muted = false;
        audio.play().catch(err => {
          console.warn(`[VoiceSystem] Failed to play audio after gesture:`, err);
        });
      }
    });
  }

  refreshRemoteAudioElements() {
    document.querySelectorAll(".dc-remote-audio").forEach((audio) => {
      audio.muted = this.isDeafened;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 1.0;
      audio.play?.().catch(() => {});
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
      const recorderOptions = {
        mimeType: this.voiceRelayMimeType,
        audioBitsPerSecond: this.voiceRelayBitrate,
      };
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
      };

      recorder.onstop = () => {
        this.voiceRelayRecorders.delete("local");
      };

      await this.emitVoiceRelayStart();
      recorder.start(220);
      console.log("[VoiceSystem] Server voice relay started");
    } catch (err) {
      this.voiceRelayRecorders.delete("local");
      console.warn("[VoiceSystem] Failed to start voice relay:", err);
    }
  }

  stopVoiceRelay(reason = "muted") {
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
  }

  syncVoiceRelayState() {
    if (this.isMuted || !this.localStream || !this.socket?.connected || this.destroyed) {
      this.stopVoiceRelay(this.isMuted ? "muted" : "inactive");
      return;
    }

    this.startVoiceRelay();
  }

  attachAudioBoost(audioElement, speakerRole = "student") {
    if (!audioElement || !this.audioContext) {
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
    try {
      const blob = new Blob([buffer], { type: entry?.mimeType || this.voiceRelayMimeType });
      const objectUrl = URL.createObjectURL(blob);
      const fallbackAudio = new Audio(objectUrl);
      fallbackAudio.autoplay = true;
      fallbackAudio.playsInline = true;
      fallbackAudio.volume = 1.0;
      fallbackAudio.muted = this.isDeafened;
      fallbackAudio.play().catch(() => {}).finally(() => {
        URL.revokeObjectURL(objectUrl);
      });
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

    if (entry.audio) {
      try {
        entry.audio.pause();
      } catch (err) {
        console.warn(`[VoiceSystem] Failed to pause relay audio for ${speakerId}:`, err);
      }
      entry.audio.srcObject = null;
      if (entry.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch (err) {
          console.warn(`[VoiceSystem] Failed to revoke relay object URL for ${speakerId}:`, err);
        }
      }
      entry.audio.remove();
    }

    this.voiceRelayRemotePlayers.delete(speakerId);
    this.remoteAudioSources.delete(`voice-relay-${speakerId}`);
  }

  resetRelaySpeakerPlayback(speakerId, payload = {}) {
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
    audio.muted = this.isDeafened;
    audio.dataset.speakerId = speakerId;
    audio.dataset.role = payload.role || "student";
    audio.dataset.displayName = payload.displayName || speakerId;
    audio.volume = 1.0;

    document.body.appendChild(audio);

    entry = {
      speakerId,
      displayName: payload.displayName || speakerId,
      role: payload.role || "student",
      mimeType,
      audio,
      mediaSource: null,
      sourceBuffer: null,
      queue: [],
      objectUrl: null,
      ready: false,
      stopped: false,
      appendedChunks: 0,
    };

    this.voiceRelayRemotePlayers.set(speakerId, entry);

    if (typeof MediaSource !== "undefined" && MediaSource.isTypeSupported?.(mimeType)) {
      const mediaSource = new MediaSource();
      entry.mediaSource = mediaSource;
      entry.objectUrl = URL.createObjectURL(mediaSource);
      audio.src = entry.objectUrl;

      mediaSource.addEventListener("sourceopen", () => {
        try {
          if (entry.stopped || this.destroyed) {
            return;
          }

          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBuffer.mode = "sequence";
          sourceBuffer.addEventListener("updateend", () => {
            if (entry.stopped || this.destroyed) {
              return;
            }
            this.flushRelaySpeakerQueue(speakerId);
          });
          entry.sourceBuffer = sourceBuffer;
          entry.ready = true;
          this.flushRelaySpeakerQueue(speakerId);
          audio.play().catch(() => {});
        } catch (err) {
          console.warn(`[VoiceSystem] Failed to open relay source for ${speakerId}:`, err);
        }
      }, { once: true });
    } else {
      entry.ready = true;
    }

    this.attachAudioBoost(audio, payload.role || "student");
    audio.play().catch(() => {});
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

    history.forEach((entry) => {
      const speakerId = String(entry?.speakerId || "").trim();
      if (!speakerId || speakerId === String(this.socket?.id || this.currentUserId || "")) {
        return;
      }

      const chunks = Array.isArray(entry?.chunks) ? entry.chunks : [];
      chunks.forEach((chunkEntry) => {
        this.handleVoiceRelayChunk({
          speakerId,
          role: speakers.find((speaker) => String(speaker?.speakerId || "") === speakerId)?.role || "student",
          displayName: speakers.find((speaker) => String(speaker?.speakerId || "") === speakerId)?.displayName || speakerId,
          mimeType: chunkEntry?.mimeType || speakers.find((speaker) => String(speaker?.speakerId || "") === speakerId)?.mimeType || this.voiceRelayMimeType,
          sequence: chunkEntry?.sequence,
          timestamp: chunkEntry?.timestamp,
          chunk: chunkEntry?.chunk,
        });
      });
    });
  }

  handleVoiceRelayChunk(payload = {}) {
    const speakerId = String(payload.speakerId || "").trim();
    const chunk = payload.chunk;
    if (!speakerId || !chunk || speakerId === String(this.socket?.id || this.currentUserId || "")) return;

    const entry = this.ensureRelaySpeakerPlayback(speakerId, payload);
    if (!entry) return;

    const buffer = chunk instanceof ArrayBuffer
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
        : chunk?.arrayBuffer
          ? null
          : chunk?.buffer;
    if (!buffer) return;

    if (!this.isRelaySourceBufferReady(entry)) {
      if (entry.sourceBuffer || entry.mediaSource) {
        entry = this.resetRelaySpeakerPlayback(speakerId, payload) || entry;
      }
    }

    if (!this.isRelaySourceBufferReady(entry)) {
      this.playRelayChunkFallback(entry, buffer, speakerId);
      return;
    }

    if (!entry.sourceBuffer.updating) {
      try {
        entry.sourceBuffer.appendBuffer(buffer);
        entry.appendedChunks += 1;
      } catch (err) {
        console.warn(`[VoiceSystem] Failed to append relay chunk for ${speakerId}:`, err);
        entry.queue.push(buffer);
        this.resetRelaySpeakerPlayback(speakerId, payload);
      }
    } else {
      entry.queue.push(buffer);
      this.flushRelaySpeakerQueue(speakerId);
    }

    if (entry.audio?.paused) {
      entry.audio.play().catch(() => {});
    }
  }

  handleVoiceRelayStop(payload = {}) {
    const speakerId = String(payload.speakerId || "").trim();
    if (!speakerId || speakerId === String(this.socket?.id || this.currentUserId || "")) return;
    this.removeRelaySpeakerPlayback(speakerId);
  }

  async initLocalStream() {
    try {
      // Detect low-bandwidth / save-data mode (2G devices)
      const net = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const effectiveType = String(net?.effectiveType || "").toLowerCase();
      const saveData = Boolean(net?.saveData);
      const isLowBandwidth = saveData || effectiveType === "slow-2g" || effectiveType === "2g";

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // Disable AGC to prevent volume conflicts in group calls

          // Adapt sample rate and bitrate based on network
          sampleRate: isLowBandwidth ? { ideal: 8000 } : { ideal: 16000 },
          channelCount: 1,

          // Optional constraints for network adaption
          latency: 0.01,
          maxaveragebitrate: isLowBandwidth ? 8000 : 16000,
        },
        video: false
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Apply additional audio processing
      await this.setupAudioProcessing();
      
      // Start muted
      this.localStream.getAudioTracks().forEach(t => {
        t.enabled = !this.isMuted;
        this.localAudioTrack = t;
      });
      
      this.refreshRemoteAudioElements();
      this.syncVoiceRelayState();
      console.log("[VoiceSystem] Local stream initialized successfully");
      this.requestExistingPeers();
      return true;
    } catch (err) {
      console.error("[VoiceSystem] Failed to get local audio:", err);
      return false;
    }
  }

  async setupAudioProcessing() {
    try {
      // Create AudioContext for better audio processing in multi-user scenarios
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // This allows for more granular control in 3+ user scenarios
      // The browser's native audio processing is still the primary mechanism
    } catch (err) {
      console.warn("[VoiceSystem] Audio processing setup failed (non-critical):", err);
    }
  }

  toggleMute() {
    return this.setMuted(!this.isMuted);
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    // Walk over all remote audio elements and mute them locally
    document.querySelectorAll('.dc-remote-audio').forEach(audio => {
      audio.muted = this.isDeafened;
    });
    this.socket.emit("audio-state-change", { deafened: this.isDeafened });
    return this.isDeafened;
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

    for (const peer of normalizedPeers) {
      const peerId = peer.userId;
      try {
        // Stagger connection initiation to prevent simultaneous offers/answers
        // This prevents ICE candidate flooding and SDP negotiation failures
        const delayMs = Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        await this.initPeerConnection(peerId, this.shouldInitiatePeer(peerId));
      } catch (err) {
        console.error(`[VoiceSystem] Failed to connect to peer ${peerId}:`, err);
      }
    }
  }

  setupSocketListeners() {
    this.socket.on("connect", this.handleSocketConnect);
    this.socket.on("reconnect", () => {
      if (this.destroyed) return;
      console.log("[VoiceSystem] Socket reconnected");
      this.handleSocketConnect();
    });

    this.socket.on("reconnect_attempt", (attempt) => {
      if (this.destroyed) return;
      console.log(`[VoiceSystem] Socket reconnect attempt ${attempt}`);
    });

    this.socket.on("reconnect_error", (err) => {
      if (this.destroyed) return;
      console.warn("[VoiceSystem] Socket reconnect error:", err?.message || err);
    });

    this.socket.on("connect_error", (err) => {
      if (this.destroyed) return;
      console.warn("[VoiceSystem] Socket connection error:", err?.message || err);
    });

    this.socket.on("peer-joined", async ({ userId, role }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      const selfId = this.socket?.id || this.currentUserId;
      if (userId === this.currentUserId || userId === selfId) {
        console.log("[VoiceSystem] Received our own user ID confirmation");
        return;
      }
      
      console.log(`[VoiceSystem] Peer joined: ${userId} (role: ${role})`);

      if (!this.shouldConnectToPeer({ userId, role })) {
        return;
      }

      try {
        await this.initPeerConnection(userId, this.shouldInitiatePeer(userId));
      } catch (err) {
        console.warn(`[VoiceSystem] Could not connect to joined peer ${userId}:`, err);
      }
    });

    this.socket.on("voice-scaling-state", (payload) => {
      this.applyVoiceScalingState(payload || {});
    });

    this.socket.on("existing-peers", async (peers) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      if (!Array.isArray(peers) || peers.length === 0) {
        return;
      }

      console.log(`[VoiceSystem] Syncing ${peers.length} existing peers`);
      await this.connectToPeerList(peers);
    });

    this.socket.on("webrtc-offer", async ({ caller, callerRole, offer }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      try {
        if (!this.shouldConnectToPeer({ userId: caller, role: callerRole || null })) {
          return;
        }

        console.log(`[VoiceSystem] Received offer from ${caller}`);
        const pc = await this.initPeerConnection(caller, false);
        
        // Set remote description with error handling
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        
        // Create answer with optimized SDP
        const answer = await pc.createAnswer();
        this.optimizeSdpForLowBandwidth(answer);
        await pc.setLocalDescription(answer);
        
        this.socket.emit("webrtc-answer", { target: caller, answer });
      } catch (err) {
        console.error(`[VoiceSystem] Error handling offer from ${caller}:`, err);
      }
    });

    this.socket.on("webrtc-answer", async ({ caller, answer }) => {
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
        console.log(`[VoiceSystem] Answer applied for ${caller}`);
      } catch (err) {
        console.error(`[VoiceSystem] Error setting answer from ${caller}:`, err);
      }
    });

    this.socket.on("webrtc-candidate", async ({ caller, candidate }) => {
      if (this.useServerVoiceRelay) {
        return;
      }

      try {
        const pc = this.peers.get(caller);
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.warn(`[VoiceSystem] ICE candidate error for ${caller}:`, err);
      }
    });

    this.socket.on("peer-left", (userId) => {
      console.log(`[VoiceSystem] Peer left: ${userId}`);
      this.closePeer(userId);
    });
    
    // Update audio state notifications from server (teacher or user updates)
    this.socket.on("audio-state-change", ({ userId, muted, deafened, by }) => {
      try {
        // If this update is about this client
        if (userId === this.currentUserId) {
          this.applyTeacherAudioState({ muted, deafened }).catch((error) => {
            console.warn("[VoiceSystem] Could not apply teacher audio state:", error);
          });
          return;
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
    this.socket.on("raise-hand-list", (list) => {
      console.log("[VoiceSystem] Raised hand list:", list);
      // UI integration point: teacher UI can subscribe to socket events
    });

    this.socket.on("voice-relay-start", (payload) => {
      this.handleVoiceRelayStart(payload || {});
    });

    this.socket.on("voice-relay-chunk", (payload) => {
      this.handleVoiceRelayChunk(payload || {});
    });

    this.socket.on("voice-relay-stop", (payload) => {
      this.handleVoiceRelayStop(payload || {});
    });

    this.socket.on("voice-relay-state", (payload = {}) => {
      this.handleVoiceRelaySnapshot(payload || {});
    });

    // Teachers receive unmute requests from students
    this.socket.on("unmute-request", ({ userId }) => {
      console.log("[VoiceSystem] Unmute request from:", userId);
      // UI integration point: show prompt in teacher UI
    });
    
    // Handle multiple connections more gracefully
    this.socket.on("disconnect", this.handleSocketDisconnect);
  }

  async initPeerConnection(userId, isInitiator) {
    if (this.useServerVoiceRelay) {
      return null;
    }

    if (this.peers.has(userId)) {
      const existingPc = this.peers.get(userId);
      if (existingPc.connectionState === "connected" || existingPc.connectionState === "connecting") {
        return existingPc;
      } else {
        // Reconnect if previous connection failed
        this.closePeer(userId);
      }
    }

    // Initialize local stream if not already done
    if (!this.localStream) {
      const success = await this.initLocalStream();
      if (!success) {
        throw new Error("Failed to initialize local stream");
      }
    }

    // Create RTCPeerConnection with optimized ICE configuration
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }, // Added redundancy
        { urls: "stun:stun3.l.google.com:19302" }
      ],
      // Optimize for low bandwidth
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all" // Allow both host and server reflexive candidates for 2G/3G
    });

    this.peers.set(userId, pc);
    console.log(`[VoiceSystem] Created peer connection for ${userId} (initiator: ${isInitiator})`);

    // Add local audio tracks with stricter error handling
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      } catch (err) {
        console.error(`[VoiceSystem] Error adding local tracks for ${userId}:`, err);
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-candidate", { target: userId, candidate: event.candidate });
      } else {
        console.log(`[VoiceSystem] ICE gathering completed for ${userId}`);
      }
    };

    // Handle remote audio tracks
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      console.log(`[VoiceSystem] Received remote track from ${userId}`);
      
      let audioEntry = document.getElementById(`audio-${userId}`);
      if (!audioEntry) {
        audioEntry = document.createElement("audio");
        audioEntry.id = `audio-${userId}`;
        // Start with muted=true for autoplay permission, then unmute once ready
        audioEntry.muted = this.isDeafened; // Muted only if user deafened
        audioEntry.autoplay = true;
        audioEntry.playsInline = true;
        audioEntry.className = "dc-remote-audio";
        audioEntry.volume = 0.8; // Prevent clipping
        
        // Add error handling for audio playback
        audioEntry.onerror = (err) => console.error(`[VoiceSystem] Audio error for ${userId}:`, err);
        audioEntry.onended = () => console.log(`[VoiceSystem] Audio ended for ${userId}`);
        
        // Wait for audio to be loadable, then play
        audioEntry.onloadedmetadata = () => {
          console.log(`[VoiceSystem] Audio metadata loaded for ${userId}, starting playback`);
          audioEntry.play().catch(err => {
            console.error(`[VoiceSystem] Failed to play audio for ${userId}:`, err);
            // Retry with user gesture requirement noted
            if (err.name === "NotAllowedError") {
              console.warn(`[VoiceSystem] Autoplay blocked for ${userId} - waiting for user gesture`);
            }
          });
        };
        
        document.body.appendChild(audioEntry);
      }
      
      audioEntry.srcObject = stream;
      // Trigger play if metadata already loaded
      if (audioEntry.readyState >= 1) {
        audioEntry.play().catch(err => {
          console.error(`[VoiceSystem] Immediate play failed for ${userId}:`, err);
        });
      }
    };

    // Monitor connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[VoiceSystem] Connection state change for ${userId}: ${pc.connectionState}`);
      
      if (pc.connectionState === "connected") {
        // Successfully connected, clear any timeout
        if (this.peerConnectivityTimeout.has(userId)) {
          clearTimeout(this.peerConnectivityTimeout.get(userId));
          this.peerConnectivityTimeout.delete(userId);
        }
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(userId);
      }
      if (pc.connectionState === "connected") {
        // Clear any reconnect attempts on successful connect
        if (this.peerReconnectAttempts && this.peerReconnectAttempts.has(userId)) {
          this.peerReconnectAttempts.delete(userId);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[VoiceSystem] ICE state for ${userId}: ${pc.iceConnectionState}`);
    };

    // Create offer/answer based on initiator flag
    if (isInitiator) {
      try {
        console.log(`[VoiceSystem] Creating offer for ${userId}`);
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
          iceRestart: false
        });
        this.optimizeSdpForLowBandwidth(offer);
        await pc.setLocalDescription(offer);
        this.socket.emit("webrtc-offer", { target: userId, offer });
      } catch (err) {
        console.error(`[VoiceSystem] Error creating offer for ${userId}:`, err);
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
    
    // Clear timeout if exists
    if (this.peerConnectivityTimeout.has(userId)) {
      clearTimeout(this.peerConnectivityTimeout.get(userId));
      this.peerConnectivityTimeout.delete(userId);
    }
    
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
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
    console.log("[VoiceSystem] Destroying voice system");

    if (this.disconnectCleanupTimer) {
      clearTimeout(this.disconnectCleanupTimer);
      this.disconnectCleanupTimer = null;
    }
    
    // Clear all timeouts
    this.peerConnectivityTimeout.forEach(timeoutId => clearTimeout(timeoutId));
    this.peerConnectivityTimeout.clear();

    this.handleSocketDisconnect("destroy");
    this.destroyed = true;
    
    // Close all peer connections
    this.peers.forEach((pc, userId) => {
      pc.close();
      console.log(`[VoiceSystem] Closed peer ${userId}`);
    });
    this.peers.clear();
    
    // Stop local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => {
        t.stop();
        console.log("[VoiceSystem] Stopped local track");
      });
      this.localStream = null;
    }
    
    // Remove all remote audio elements
    document.querySelectorAll('.dc-remote-audio').forEach(a => {
      a.pause();
      a.srcObject = null;
      a.remove();
    });

    this.voiceRelayRemotePlayers.forEach((entry) => {
      try {
        entry.audio?.pause?.();
      } catch (err) {
        console.warn("[VoiceSystem] Error pausing relay audio during destroy:", err);
      }
    });
    this.voiceRelayRemotePlayers.clear();
    this.voiceRelayRecorders.clear();

    const scalingBanner = document.getElementById(this.voiceScalingBannerId);
    if (scalingBanner) {
      scalingBanner.remove();
    }
    
    // Close audio context if created
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    console.log("[VoiceSystem] Voice system destroyed");
  }
}
