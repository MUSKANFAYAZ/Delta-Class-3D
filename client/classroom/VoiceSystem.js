export class VoiceSystem {
  constructor(socket, currentUserId, currentRole) {
    this.socket = socket;
    this.currentUserId = currentUserId;
    this.currentRole = currentRole; // 'teacher' or 'student'
    
    this.peers = new Map(); // userId -> RTCPeerConnection
    this.localStream = null;
    this.audioContext = null;
    this.localAudioTrack = null;
    this.remoteAudioSources = new Map(); // userId -> AudioContext MediaElementAudioSourceNode
    
    // Voice state
    this.isMuted = true;
    this.isDeafened = false; // for students to mute teacher's voice locally
    
    // Connection tracking for better multi-user support
    this.peerConnectivityTimeout = new Map(); // userId -> timeoutId
    
    this.setupSocketListeners();
    this.requestExistingPeers();
  }

  requestExistingPeers() {
    try {
      this.socket.emit("request-existing-peers");
    } catch (err) {
      console.warn("[VoiceSystem] Failed to request existing peers:", err);
    }
  }

  setMuted(nextMuted) {
    this.isMuted = Boolean(nextMuted);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
    // Notify server of mute state for better bandwidth management
    this.socket.emit("audio-state-change", { muted: this.isMuted });
    return this.isMuted;
  }

  ensureUnmuted() {
    return this.setMuted(false);
  }

  enableRemoteAudioWithGesture() {
    // Call this from a user gesture (click/tap) to unmute remote audio
    // This bypasses browser autoplay policy
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
      audio.volume = 0.8; // Prevent clipping in multi-user scenarios
      audio.play?.().catch(() => {});
    });
  }

  async initLocalStream() {
    try {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false, // Disable AGC to prevent volume conflicts in group calls
          
          // Low bandwidth constraints for 2G/3G
          sampleRate: { ideal: 16000 }, // 8kHz for extreme 2G, 16kHz for better quality on 3G
          channelCount: 1, // Mono for low bandwidth
          
          // Optional constraints for network adaption
          latency: 0.01, // 10ms target latency
          maxaveragebitrate: 16000, // 16kbps max for 3G
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
    const peerIds = peers
      .map((peer) => (typeof peer === "string" ? peer : peer?.userId))
      .filter((peerId) => peerId && peerId !== this.currentUserId);

    for (const peerId of peerIds) {
      try {
        // Stagger connection initiation to prevent simultaneous offers/answers
        // This prevents ICE candidate flooding and SDP negotiation failures
        const delayMs = Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        await this.initPeerConnection(peerId, true);
      } catch (err) {
        console.error(`[VoiceSystem] Failed to connect to peer ${peerId}:`, err);
      }
    }
  }

  setupSocketListeners() {
    this.socket.on("peer-joined", async ({ userId, role }) => {
      if (userId === this.currentUserId) {
        console.log("[VoiceSystem] Received our own user ID confirmation");
        return;
      }
      
      console.log(`[VoiceSystem] Peer joined: ${userId} (role: ${role})`);
    });

    this.socket.on("existing-peers", async (peers) => {
      if (!Array.isArray(peers) || peers.length === 0) {
        return;
      }

      console.log(`[VoiceSystem] Syncing ${peers.length} existing peers`);
      await this.connectToPeerList(peers);
    });

    this.socket.on("webrtc-offer", async ({ caller, offer }) => {
      try {
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
      try {
        const pc = this.peers.get(caller);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log(`[VoiceSystem] Answer applied for ${caller}`);
        }
      } catch (err) {
        console.error(`[VoiceSystem] Error setting answer from ${caller}:`, err);
      }
    });

    this.socket.on("webrtc-candidate", async ({ caller, candidate }) => {
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
    
    // Handle multiple connections more gracefully
    this.socket.on("disconnect", () => {
      console.log("[VoiceSystem] Socket disconnected");
      this.destroy();
    });
  }

  async initPeerConnection(userId, isInitiator) {
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
        audioEntry.muted = !this.isDeafened; // Muted unless user deafened
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
    
    // Clear all timeouts
    this.peerConnectivityTimeout.forEach(timeoutId => clearTimeout(timeoutId));
    this.peerConnectivityTimeout.clear();
    
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
    
    // Close audio context if created
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    console.log("[VoiceSystem] Voice system destroyed");
  }
}
