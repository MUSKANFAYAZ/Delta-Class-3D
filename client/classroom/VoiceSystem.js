export class VoiceSystem {
  constructor(socket, currentUserId, currentRole) {
    this.socket = socket;
    this.currentUserId = currentUserId;
    this.currentRole = currentRole; // 'teacher' or 'student'
    
    this.peers = new Map(); // userId -> RTCPeerConnection
    this.localStream = null;
    
    // Voice state
    this.isMuted = true;
    this.isDeafened = false; // for students to mute teacher's voice locally
    
    this.setupSocketListeners();
  }

  async initLocalStream() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Extremely low bandwidth for 2G
          sampleRate: 8000,
          sampleSize: 16,
          channelCount: 1,
        },
        video: false
      });
      // Start muted
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
      return true;
    } catch (err) {
      console.error("Local mic not available:", err);
      return false;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
    }
    return this.isMuted;
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    // Walk over all remote audio elements and mute them locally
    document.querySelectorAll('.dc-remote-audio').forEach(audio => {
      audio.muted = this.isDeafened;
    });
    return this.isDeafened;
  }

  setupSocketListeners() {
    this.socket.on("peer-joined", async ({ userId, role }) => {
      if (userId === this.currentUserId) return;
      await this.initPeerConnection(userId, true);
    });

    this.socket.on("webrtc-offer", async ({ caller, offer }) => {
      const pc = await this.initPeerConnection(caller, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      this.setLowBitrate(answer);
      await pc.setLocalDescription(answer);
      this.socket.emit("webrtc-answer", { target: caller, answer });
    });

    this.socket.on("webrtc-answer", async ({ caller, answer }) => {
      const pc = this.peers.get(caller);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    this.socket.on("webrtc-candidate", async ({ caller, candidate }) => {
      const pc = this.peers.get(caller);
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("ICE error", e));
      }
    });

    this.socket.on("peer-left", (userId) => {
      this.closePeer(userId);
    });
  }

  async initPeerConnection(userId, isInitiator) {
    if (this.peers.has(userId)) return this.peers.get(userId);

    // Initialize local stream if not already done
    if (!this.localStream) {
      await this.initLocalStream();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    this.peers.set(userId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-candidate", { target: userId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      let audioEntry = document.getElementById(`audio-${userId}`);
      if (!audioEntry) {
        audioEntry = document.createElement("audio");
        audioEntry.id = `audio-${userId}`;
        audioEntry.autoplay = true;
        audioEntry.className = "dc-remote-audio";
        if (this.isDeafened) audioEntry.muted = true;
        document.body.appendChild(audioEntry);
      }
      audioEntry.srcObject = stream;
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.closePeer(userId);
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      this.setLowBitrate(offer);
      await pc.setLocalDescription(offer);
      this.socket.emit("webrtc-offer", { target: userId, offer });
    }

    return pc;
  }

  setLowBitrate(desc) {
    // Modify SDP to limit audio bitrate to 12kbps for extreme 2G compatibility
    if (desc.sdp) {
      desc.sdp = desc.sdp.replace(/(a=fmtp:111\s+.*?)\r\n/g, '$1;maxaveragebitrate=12000;usedtx=1\r\n');
      // Also inject b=AS:12 (Application Specific max bandwidth 12kbps)
      desc.sdp = desc.sdp.replace(/c=IN IP4 (.*)\r\n/g, 'c=IN IP4 $1\r\nb=AS:12\r\n');
    }
  }

  closePeer(userId) {
    const pc = this.peers.get(userId);
    if (pc) {
      pc.close();
      this.peers.delete(userId);
    }
    const audioEntry = document.getElementById(`audio-${userId}`);
    if (audioEntry) {
      audioEntry.remove();
    }
  }

  destroy() {
    this.peers.forEach(pc => pc.close());
    this.peers.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    document.querySelectorAll('.dc-remote-audio').forEach(a => a.remove());
  }
}
