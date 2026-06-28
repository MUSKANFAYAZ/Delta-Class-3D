# Voice/Audio Not Audible - Debug Guide

## What Was Fixed

The audio system now has comprehensive logging to help identify exactly where the issue occurs. The fixes include:

### 1. **Audio Element Creation** (`VoiceSystem.js`)
- ✅ Audio elements are properly positioned off-screen (hidden but accessible)
- ✅ Volume is explicitly set to `1.0` (not muted by default)
- ✅ `autoplay` and `playsInline` attributes enabled
- ✅ Console logs when audio elements are created

### 2. **Audio Context Management** (`VoiceSystem.js`)
- ✅ AudioContext is properly initialized during setup
- ✅ AudioContext state is logged (running/suspended)
- ✅ Suspended contexts are automatically resumed
- ✅ Logging shows when context is resumed

### 3. **Voice Relay Playback** (`VoiceSystem.js`)
- ✅ When audio chunks arrive, logging shows:
  - Speaker ID and chunk size
  - Whether SourceBuffer is ready
  - When chunks are appended
  - When audio playback starts
- ✅ Fallback blob playback logs when MediaSource is unavailable

### 4. **Initial Stream Setup** (`VoiceSystem.js`)
- ✅ Microphone access request is logged
- ✅ Audio tracks are logged with enabled state
- ✅ Teacher role automatically starts voice relay

## How to Debug Audio Issues Now

### Step 1: Open Browser Developer Tools
```
On Desktop: F12 or Ctrl+Shift+I
On Mobile: Use remote debugging or console app
```

### Step 2: Join Classroom and Look for These Logs

**In Browser Console** (F12 → Console tab):

```javascript
// Initialization logs
[VoiceSystem] ✓ Microphone access granted
[VoiceSystem] Audio context created: running
[VoiceSystem] Audio track enabled: true muted state: false
[VoiceSystem] ✓ Local stream initialized successfully

// Audio element creation
[VoiceSystem] Created relay audio element: { 
  speakerId: "...", 
  displayName: "Teacher",
  volume: 1.0, 
  muted: false 
}

// When audio chunks arrive
[VoiceSystem] Received voice relay chunk from: <speakerId>
[VoiceSystem] Appended chunk for <speakerId> - total chunks: 1

// Playback
[VoiceSystem] Audio paused for <speakerId> - attempting play
```

### Step 3: Common Issues and Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| **Microphone blocked** | `[VoiceSystem] ✗ Failed to get local audio` | Allow microphone in browser permissions |
| **Autoplay blocked** | Audio elements exist but no sound | Browser autoplay policy requires user interaction. Click in the window. |
| **AudioContext suspended** | `Audio context created: suspended` | Click anywhere in the window to resume context |
| **No audio chunks** | `Created relay audio element` but no "Received chunk" logs | Check backend is relaying chunks. Check socket connection. |
| **SourceBuffer failed** | `Using fallback blob playback` repeated | Browser doesn't support WebM codec. Try fallback. |
| **Volume is 0** | Audio logs show it's playing but no sound | Check system volume. Check browser volume (if supported). |

### Step 4: Check if Audio is Actually Playing

In browser console, run:

```javascript
// Find all audio elements
const audios = document.querySelectorAll('audio');
console.log('Audio elements:', audios.length);

// Check each one
audios.forEach((a, i) => {
  console.log(`Audio ${i}:`, {
    id: a.id,
    volume: a.volume,
    muted: a.muted,
    paused: a.paused,
    currentTime: a.currentTime,
    duration: a.duration,
    src: a.src?.substring(0, 50)
  });
});

// Try to manually play one
audios[0]?.play().catch(e => console.error('Play error:', e.message));
```

### Step 5: Check Network Traffic

**Open DevTools Network Tab:**
1. Filter for `socket.io` to see if `voice-relay-chunk` messages arrive
2. Each message should contain a chunk of audio data
3. If no chunks arrive, the backend isn't sending them

### Step 6: Check Backend Logs

Look for these in server terminal (`npm run dev`):

```
[VoiceSystem] Server successfully relayed chunk from <speakerId> to <N> participants
```

If these don't appear, voice chunks aren't being recorded or relayed.

## Checklist Before Filing Issue

- [ ] Microphone permissions granted in browser
- [ ] At least 2 people in the same classroom
- [ ] One person (usually teacher) unmuted
- [ ] Browser console shows `[VoiceSystem]` logs
- [ ] Audio elements created with volume 1.0
- [ ] Voice chunks are being received
- [ ] Audio is attempting to play

## Expected Behavior

✅ **When voice is working:**
1. Teacher/unmuted student speaks
2. Other participants hear audio after ~1-2 second delay
3. Browser console shows chunk reception and playback

❌ **Common failures:**
- "No audio elements created" → Microphone permission denied
- "Audio elements created but chunks never arrive" → Socket relay issue
- "Chunks arrive but no sound" → Browser autoplay/mute issue
- "Fallback blob playback" → WebM codec not supported (try MP3 fallback)

## Technical Details

- **Audio Format:** WebM with Opus codec (16 kHz, mono, 16 kbps bitrate)
- **Transmission:** Server relays chunks every ~200ms
- **Playback:** MediaSource API with fallback to Blob URLs
- **Mute Policy:** Students muted by default until teacher approves
- **Volume:** Always 1.0 (browser volume controls system volume)

## If Audio Still Doesn't Work

1. **Capture all console logs** (copy and paste full console output)
2. **Check server logs** for relay errors
3. **Verify network connectivity** - no packet loss/high latency
4. **Try a different browser** - may have codec support issues
5. **Check firewall/proxy** - may be blocking voice data
