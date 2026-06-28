# Delta-Class-3D — Complete Project Documentation

> **Purpose of this document:** Full reference for developers, evaluators, and seminar presentations. Covers every page, every major subsystem, tech choices, algorithms, APIs, feasibility, comparison with Zoom/Google Meet, drawbacks, and future enhancements.

---

## Table of Contents

1. [What Is Delta-Class-3D?](#1-what-is-delta-class-3d)
2. [Every Page (Complete SPA Route Map)](#2-every-page-complete-spa-route-map)
3. [End-to-End User Workflows](#3-end-to-end-user-workflows)
4. [System Architecture](#4-system-architecture)
5. [Real-Time Layer (WebSocket / Socket.IO)](#5-real-time-layer-websocket--socketio)
6. [3D Classroom Engine](#6-3d-classroom-engine)
7. [Voice System (Audio Relay)](#7-voice-system-audio-relay)
8. [Blackboard, Laser & Drawing Sync](#8-blackboard-laser--drawing-sync)
9. [Presentation (Slides / PDF / Images)](#9-presentation-slides--pdf--images)
10. [Group Discussion, Polls & Notes](#10-group-discussion-polls--notes)
11. [Raise Hand & Teacher Moderation](#11-raise-hand--teacher-moderation)
12. [Authentication & Authorization](#12-authentication--authorization)
13. [REST API Reference](#13-rest-api-reference)
14. [Database & Storage](#14-database--storage)
15. [Algorithms Used](#15-algorithms-used)
16. [Tech Stack & Why These Choices](#16-tech-stack--why-these-choices)
17. [Low-Bandwidth & Packet Design](#17-low-bandwidth--packet-design)
18. [Comparison: Delta-Class-3D vs Zoom / Google Meet](#18-comparison-delta-class-3d-vs-zoom--google-meet)
19. [Advantages of Our Approach](#19-advantages-of-our-approach)
20. [Drawbacks & Limitations](#20-drawbacks--limitations)
21. [Feature Enhancements (Roadmap)](#21-feature-enhancements-roadmap)
22. [Seminar Presentation Guide](#22-semininar-presentation-guide)

---

## 1. What Is Delta-Class-3D?

**Delta-Class-3D** is a **full-stack, real-time 3D virtual classroom** deployed as a monorepo (frontend + backend). Teachers create room codes; students join after approval; everyone enters a shared **Three.js** 3D scene with synchronized movement, blackboard, presentation slides, voice, raise-hand, and discussion tools.

| Layer | Technology |
|-------|------------|
| Frontend | Vite, Vanilla JS SPA (hash routing), Three.js |
| Backend | Node.js, Express 5, Socket.IO |
| Database | MongoDB Atlas via Mongoose |
| Auth | JWT + bcrypt |
| Deploy | Railway / Render (serves `client/dist` + API + sockets) |

**Not a static website** — it is a live collaborative application with in-memory session state on the server and persistent classroom/user data in MongoDB.

---

## 2. Every Page (Complete SPA Route Map)

Routing is handled in `client/src/main.js` using **hash URLs** (e.g. `#/classroom?role=student&code=abc-defg-hij`). Every route below is implemented; none are omitted.

| Route | File | Who Uses It | Purpose |
|-------|------|-------------|---------|
| `#/dashboard` | `features/dashboard/dashboardPage.js` | Teacher & Student | Home launcher: list classrooms, create/join shortcuts, room cards |
| `#/login` | `features/auth/login.js` | All | Phone + password login, JWT stored in localStorage |
| `#/register` | `features/auth/register.js` | All | Sign up as teacher or student (phone, name, class for students) |
| `#/create` | `features/dashboard/createClassroomPage.js` | Teacher | Create classroom metadata + room code, POST to API |
| `#/join` | `features/dashboard/joinClassroomPage.js` | Student | Enter room code, POST join (may enter pending approval) |
| `#/classroom` | `classroomPage.js` + `startup/classroomLoader.js` | Teacher & Student | **Main classroom shell**: 2D UI + optional 3D load button |
| `#/room` | `features/dashboard/roomPage.js` | Teacher & Student | Alternate 2D room layout with voice + raise-hand panel |
| `#/group-discussion` | `features/dashboard/groupDiscussionPage.js` | Teacher & Student | Chat, polls, image sharing (live + REST fallback) |
| `#/notes` | `features/dashboard/notesPage.js` | Teacher & Student | Personal notes per room (localStorage only) |
| `#/profile` | `features/profile/profilePage.js` | Teacher & Student | Profile view, logout, navigation shortcuts |

### 2.1 Dashboard (`#/dashboard`)

- Shows **room cards** for classrooms the user created (teacher) or joined (student).
- Teacher: **Create classroom** button → `#/create`.
- Student: **Join classroom** button → `#/join`.
- Login / user menu in top bar.
- Listens for `pending-requests-updated` socket event (teacher) to show join approvals.
- Resolves room list via `GET /auth/classrooms`.

### 2.2 Login (`#/login`)

- Phone number with country code + password.
- Calls `POST /auth/login`.
- Stores `delta-access-token`, `delta-user-display`, `delta-user-role` in localStorage.
- Redirects to dashboard or `next` query param.

### 2.3 Register (`#/register`)

- Name, phone, password, role (teacher/student), student class (required for students).
- Calls `POST /auth/register`.
- Returns JWT immediately on success.

### 2.4 Create Classroom (`#/create`)

- Form: room code (auto-generated format `xxx-xxxx-xxx`), subject, timing, capacity, info.
- `POST /auth/classrooms` — persists to MongoDB, links `createdBy` to teacher user ID.

### 2.5 Join Classroom (`#/join`)

- Student enters code → `POST /auth/classrooms/:code/join`.
- If not approved: **pending** state; student waits on classroom page for teacher approval.
- If approved: navigates to `#/classroom?role=student&code=...`.

### 2.6 Classroom — Main Shell (`#/classroom`)

**File:** `client/src/classroomPage.js`

This is the **primary classroom entry** for both roles.

**UI elements:**
- Connection status badge
- **Raise Hand** button (student) — hand icon + Raise/Lower label
- **Mute** button (teacher unmuted by default; student muted until teacher approves)
- **Presentation** button (teacher only)
- **Reload** with confirmation modal
- **Exit** modal (student: exit; teacher: take break or end class)
- **Raise-hand panel** (teacher) — list of students with raised hands, unmute/clear
- **Pending join requests** panel (teacher)
- **Participants** list
- **Load 3D Classroom** button — deferred heavy load for low bandwidth
- Links to **Group Discussion** and **Notes**

**How it works:**
1. Page renders immediately (lightweight 2D shell).
2. Socket connects in background (`initPendingWebsocketHandshake` in `main.js`) — reuses existing socket when navigating from discussion.
3. On **Load 3D**, `classroomLoader.js` connects/reuses Socket.IO, imports `startClassroom()` from `classroom.js`, boots Three.js scene.
4. VoiceSystem initializes on socket ready — mic permission, server voice relay.

### 2.7 Room Page (`#/room`)

**File:** `features/dashboard/roomPage.js`

Alternate 2D classroom layout with similar features: voice, raise-hand, pending requests, participants, exit modal. Used when navigating to `#/room?code=...`. Shares the same socket and VoiceSystem patterns as the main classroom page.

### 2.8 Group Discussion (`#/group-discussion`)

**File:** `features/dashboard/groupDiscussionPage.js`

- **Text messages** — socket `discussion-message` + REST `POST .../discussion/message`
- **Polls** — create, vote, delete via socket + REST
- **Image sharing** — upload image, broadcast via `discussion-image`
- **Participants** sidebar — `participants-state` socket event
- Back to classroom / dashboard navigation
- Discussion state persisted in MongoDB (`discussionFeed`, `discussionPolls` on Classroom document)

### 2.9 Notes (`#/notes`)

**File:** `features/dashboard/notesPage.js`

- Private textarea per room code
- Saved to **localStorage** key `delta-notes:{roomCode}` (not synced to server)
- Export as `.txt` download

### 2.10 Profile (`#/profile`)

**File:** `features/profile/profilePage.js`

- Shows user info, back to dashboard, create/join shortcuts, logout (clears tokens)

---

## 3. End-to-End User Workflows

### 3.1 Teacher Workflow

```
Register/Login → Dashboard → Create Classroom → Enter #/classroom
    → Socket connects (teacherPresent=true)
    → Approve pending students (REST + socket)
    → Load 3D Classroom
    → Move with arrow keys, draw on blackboard, start presentation
    → Voice relay auto-starts (mic on)
    → See raised hands, unmute students
    → Group Discussion for chat/polls
    → Exit: Take Break (keep room) or End Class (DELETE classroom)
```

### 3.2 Student Workflow

```
Register/Login → Join Classroom → #/classroom (maybe pending)
    → Wait for teacher approval (admission-approved socket)
    → Load 3D Classroom
    → Assigned desk slot, move with arrow keys
    → Raise hand + request unmute
    → Teacher unmutes → voice relay starts
    → View presentation, blackboard, discussion
    → Exit to dashboard
```

### 3.3 Navigation Without Full Reload

Hash routing in `main.js` switches pages without browser reload. On route change:
- `cleanupClassroomRuntime()` destroys VoiceSystem, stops 3D (`stopActiveClassroom`), optionally keeps socket when moving between classroom sub-pages.
- Discussion → Classroom → 3D works as a SPA flow.

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER (CLIENT)                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Hash Router │  │ REST API     │  │ Socket.IO Client       │ │
│  │ (main.js)   │  │ fetch /auth  │  │ Real-time events       │ │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬────────────┘ │
│         │                │                       │              │
│  ┌──────▼────────────────▼───────────────────────▼────────────┐ │
│  │ Pages: dashboard, classroom, discussion, notes, auth...   │ │
│  └──────┬─────────────────────────────────────────────────────┘ │
│         │                                                        │
│  ┌──────▼─────────────────────────────────────────────────────┐ │
│  │ 3D Layer: Three.js scene, movement, camera, blackboard      │ │
│  │ VoiceSystem: MediaRecorder → socket → MediaSource playback  │ │
│  │ ImageSync: presentation overlay + laser pointer             │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS / WSS
┌────────────────────────────▼────────────────────────────────────┐
│                     NODE.JS SERVER (Express)                       │
│  ┌──────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │
│  │ REST /auth/* │  │ Socket.IO       │  │ Static client/dist  │ │
│  │ classrooms   │  │ socketHandlers  │  │ (Vite build)        │ │
│  └──────┬───────┘  └────────┬────────┘  └─────────────────────┘ │
│         │                   │                                     │
│  ┌──────▼───────────────────▼─────────────────────────────────┐ │
│  │ activeClassrooms Map (in-memory live session state)         │ │
│  │ classroomSession.js — slots, positions, relay, raise hands  │ │
│  └──────┬──────────────────────────────────────────────────────┘ │
└─────────┼────────────────────────────────────────────────────────┘
          │
┌─────────▼─────────┐
│   MongoDB Atlas   │
│ User, Classroom   │
└───────────────────┘
```

**Two-tier state model:**
- **MongoDB** — durable: users, classroom metadata, approved students, blackboard strokes, discussion feed/polls.
- **In-memory (`activeClassrooms`)** — live: socket IDs, positions, voice relay buffers, raise-hand set, teacher presence.

---

## 5. Real-Time Layer (WebSocket / Socket.IO)

**Server:** `server/socketHandlers.js`  
**Client:** `socket.io-client` via `client/src/main.js`, `classroomLoader.js`, page modules.

### 5.1 Connection Handshake

On connect, client sends in `auth` / `query`:
- `role` — `teacher` | `student`
- `roomCode`
- `token` — JWT
- `displayName`

Server validates teacher owns classroom, student is approved (or keeps pending students connected for approval flow).

### 5.2 All Socket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `move` | Client → Server → Room | Student avatar position `{x, z}` |
| `student-assigned` | Server → Room | Desk slot index for new student |
| `teacher-move` | Client → Server → Room | Teacher position |
| `teacher-instruction` | Client → Server → Room | Broadcast teacher message |
| `teacher-student-instruction` | Client → Server → Target | Message to one student |
| `blackboard-stroke` | Client → Server → Room | Drawing stroke data; persisted to MongoDB |
| `blackboard-clear` | Client → Server → Room | Clear board |
| `blackboard-snapshot` | Server → Client | Full stroke list on join |
| `request-blackboard` | Client → Server | Request snapshot |
| `blackboard-laser` | Client → Server → Room | Laser pointer on board/presentation |
| `presentation-start` | Teacher → Server → Room | Begin slide show `{images, index}` |
| `presentation-update` | Teacher → Server → Room | Change slide index / image |
| `presentation-stop` | Teacher → Server → Room | End presentation |
| `raise-hand` | Student → Server → Teacher | Add to raise-hand list |
| `raise-hand-list` | Server → Teacher | Full list of raised hands |
| `request-raise-hand-list` | Teacher → Server | Refresh list |
| `clear-raise-hand` | Client → Server | Remove hand from list |
| `raise-hand-cleared` | Server → Student | UI reset when hand lowered |
| `request-unmute` | Student → Teacher | Ask for mic permission |
| `unmute-request` | Server → Teacher | Notification with displayName |
| `audio-state-change` | Bidirectional | Mute/deafen state sync |
| `teacher-set-audio-state` | Teacher → Server → Target | Force mute/unmute student |
| `voice-relay-start` | Client → Server → Room | Announce speaker + mimeType |
| `voice-relay-chunk` | Client → Server → Room | Binary audio chunk (~220ms WebM) |
| `voice-relay-stop` | Client → Server → Room | Stop relay for speaker |
| `voice-relay-state` | Server → Client | Active speakers + history snapshot |
| `voice-scaling-state` | Server → Room | Topology info (server-relay mode) |
| `webrtc-offer/answer/candidate` | P2P signaling | Legacy mesh path (disabled when relay active) |
| `peer-joined` / `peer-left` | Server → Clients | Peer lifecycle |
| `request-existing-peers` | Client → Server | WebRTC peer discovery |
| `participants-state` | Server → Room | Participant roster |
| `discussion-message` | Client → Server → Room | Chat message |
| `discussion-image` | Client → Server → Room | Shared image in discussion |
| `discussion-poll` | Client → Server → Room | Poll created |
| `discussion-vote` | Client → Server → Room | Poll vote |
| `discussion-poll-delete` | Client → Server → Room | Remove poll |
| `request-discussion-state` | Client → Server | Load discussion snapshot |
| `pending-requests-updated` | Server → Teacher | New join request |
| `student-join-approved` / `denied` | Teacher → Server → Student | Admission result |
| `admission-approved` / `admission-pending` | Server → Student | Join flow |
| `room-error` | Server → Client | Errors (room missing, not started, etc.) |
| `class-ended` | Server → Room | Teacher left / class ended |
| `disconnect` | — | Cleanup assignments, relay, teacher presence |

### 5.3 Synchronization Strategy

- **Movement:** event-per-keystroke with client-side lerp (`Movement.js`, `SocketSync.js`).
- **Blackboard:** stroke objects broadcast; server appends to `activeSession.blackboardStrokes` and persists async to MongoDB.
- **Presentation:** teacher is source of truth; students receive full slide array on start, index updates on change.
- **Voice:** server **broadcasts** audio chunks (not P2P mesh) — see Section 7.
- **Discussion:** optimistic UI + server persist + `request-discussion-state` on reconnect.

---

## 6. 3D Classroom Engine

**Entry:** `client/src/classroom.js` → `startClassroom(socket, role, options)`

### 6.1 Module Breakdown

| Module | File | Role |
|--------|------|------|
| Scene setup | `classroom/SceneSetup.js` | THREE.Scene, PerspectiveCamera, WebGLRenderer |
| Lighting | `classroom/Lighting.js` | Ambient + directional lights (reduced on 2G) |
| Environment | `classroom/Environment.js` | Walls, floor, blackboard mesh |
| Furniture | `classroom/Furniture.js` | Desks, student slots, teacher avatar |
| Movement | `classroom/Movement.js` | Collision, slot assignment, lerp |
| Input | `classroom/InputControls.js` | Arrow keys for students |
| Socket sync | `classroom/SocketSync.js` | Binds socket events to movement |
| Camera | `classroom/CameraSystem.js` | Full view, blackboard view, follow student, rAF loop |
| Blackboard | `classroom/Blackboard.js` | Canvas texture on 3D board, draw sync |
| ImageSync | `classroom/ImageSync.js` | Presentation overlay + laser |
| Voice | `classroom/VoiceSystem.js` | Audio capture + relay playback |

### 6.2 Deferred Loading (Low Bandwidth)

`classroomLoader.js` does **not** load Three.js until user clicks **Load 3D Classroom**:
- 2G/save-data: UI-only mode first; 3D modules warmed on hover/focus.
- Camera rAF capped at **8 FPS** on slow networks vs 60 FPS normally.
- Pixel ratio reduced on strict low bandwidth.

### 6.3 Student Slot Assignment

Algorithm (`getNextAvailableSlot` in `classroomSession.js`):
- `MAX_STUDENT_SLOTS` desk positions (configurable on server).
- Scan slot indices 0..N-1; assign first free slot to new student socket ID.
- Broadcast `student-assigned { userId, slotIndex }`.

### 6.4 Lifecycle / Teardown

`startClassroom()` returns `stopClassroom()` stored on `window.stopActiveClassroom`:
- Cancels `requestAnimationFrame`
- Disposes renderer / WebGL context
- Removes camera controls, keyboard listeners
- Clears canvas container

Called automatically when navigating away via `cleanupClassroomRuntime()` in `main.js`.

---

## 7. Voice System (Audio Relay)

**File:** `client/classroom/VoiceSystem.js`  
**Server:** `voice-relay-*` handlers in `socketHandlers.js`

### 7.1 Architecture: Server Relay (Not Full Mesh)

The app uses **`useServerVoiceRelay = true`** — audio is **not** sent peer-to-peer to every participant. Instead:

```
Teacher/Student Mic
    → MediaRecorder (WebM/Opus, ~16 kbps, 220ms timeslice)
    → socket.emit("voice-relay-chunk", { chunk: ArrayBuffer })
    → Server broadcasts to room (except sender)
    → Receivers: MediaSource + SourceBuffer OR fallback Blob audio
```

**Why relay instead of WebRTC mesh?**
- Mesh breaks down beyond ~12 participants (N×N connections).
- Slow networks struggle with multiple ICE negotiations.
- Server relay gives **one uplink, many downlinks** — predictable for classrooms.

WebRTC signaling handlers (`webrtc-offer`, etc.) remain for legacy/fallback but are skipped when relay mode is active.

### 7.2 Teacher vs Student Mic Policy

| Role | Default Muted | Can Self-Unmute? |
|------|---------------|------------------|
| Teacher | No | Yes |
| Student | Yes | No — must raise hand; teacher calls `teacher-set-audio-state` |

Flow:
1. Student raises hand → `raise-hand` + `request-unmute`.
2. Teacher clicks Unmute in raise-hand panel → `teacher-set-audio-state { muted: false }`.
3. Student VoiceSystem applies state → `startVoiceRelay()`.

### 7.3 Chunk Pipeline (Packet Sending)

**Send side:**
```javascript
recorder.ondataavailable → event.data.arrayBuffer()
→ emit("voice-relay-chunk", { mimeType, sequence, timestamp, chunk })
```

**Receive side:**
```javascript
normalizeRelayChunk(chunk)  // ArrayBuffer | Blob | Uint8Array | Node Buffer JSON
→ appendBuffer on MediaSource SourceBuffer (sequence mode)
→ OR playRelayChunkFallback() for one-shot WebM blob
```

**Server buffer:** keeps last **40 chunks** per speaker in `voiceRelayHistory` for late joiners (live speakers list synced; history replay minimized on client).

### 7.4 Bandwidth Tuning

- Audio constraints: mono, 16 kHz sample rate (8 kHz on 2G).
- `audioBitsPerSecond: 16000` on MediaRecorder.
- SDP optimization helpers exist for legacy WebRTC path.
- Voice scaling banner informs when topology is server-relay.

### 7.5 Lifecycle

- Single global VoiceSystem instance (destroys previous on create).
- `destroy()` removes socket listeners, stops tracks, clears MediaSource audio elements, revokes blob URLs in correct order (pause → clear src → revoke).
- Health check interval restarts recorder if it stops unexpectedly.

---

## 8. Blackboard, Laser & Drawing Sync

**File:** `client/classroom/Blackboard.js`

### 8.1 How Drawing Works

1. Teacher (or authorized writer) draws on HTML **canvas**.
2. Canvas is mapped as **THREE.CanvasTexture** on the 3D blackboard mesh.
3. Each stroke segment is emitted as `blackboard-stroke` with normalized coordinates, color, width.
4. Server broadcasts to room + persists to `Classroom.blackboardStrokes` in MongoDB.
5. New joiners receive `blackboard-snapshot` with full stroke array.

### 8.2 Laser Pointer

Two laser systems:
- **Blackboard laser** — `blackboard-laser` socket event; orange dot on canvas (teacher only).
- **Presentation laser** — `ImageSync.js`; laser dot on slide overlay, throttled by network tier (80–220ms).

Laser coordinates are normalized (0–1) so they scale across screen sizes.

### 8.3 Low-Bandwidth Canvas

| Network | Canvas Resolution |
|---------|-------------------|
| Normal | 2048 × 1024 |
| Low (3G) | 1536 × 768 |
| Strict (2G) | 1024 × 512 |

Stroke batching and throttle reduce emit frequency on slow links.

---

## 9. Presentation (Slides / PDF / Images)

**File:** `client/classroom/ImageSync.js`

> **Note:** This is **slide/image presentation**, not native OS screen sharing (like Zoom share screen). Teacher uploads **images or PDF pages** which are shown full-screen to all students.

### 9.1 Flow

1. Teacher clicks **Presentation** button.
2. Upload images or PDF → converted to image array client-side.
3. `presentation-start` emits `{ images: [base64 or URLs], index: 0 }`.
4. Full-screen overlay on all clients.
5. Teacher navigates slides → `presentation-update`.
6. Stop → `presentation-stop`.

### 9.2 Laser on Slides

Teacher enables laser mode on overlay; pointer moves emit throttled socket events; students see synchronized laser dot.

### 9.3 PDF Handling

PDF files are rendered to images in the browser before sending — no server-side PDF processing. Keeps backend lightweight.

---

## 10. Group Discussion, Polls & Notes

### 10.1 Group Discussion Page

**Socket (live):** `discussion-message`, `discussion-image`, `discussion-poll`, `discussion-vote`, `discussion-poll-delete`, `request-discussion-state`

**REST (persist + fallback):**
- `GET /auth/classrooms/:code/discussion`
- `POST .../discussion/message`
- `POST .../discussion/image`
- `POST .../discussion/poll`
- `POST .../discussion/poll/:pollId/vote`
- `DELETE .../discussion/message/:messageId`
- `DELETE .../discussion/poll/:pollId`

Messages stored in `Classroom.discussionFeed[]`; polls in `Classroom.discussionPolls[]`.

### 10.2 Notes Page

- **Local only** — `localStorage` key per room.
- No server sync (by design — private student/teacher notes).
- Export downloads plain text file.

---

## 11. Raise Hand & Teacher Moderation

### 11.1 Student Actions

- Click **Raise** → `raise-hand` + `request-unmute`.
- Button shows hand icon + **Lower** label + down arrow when active.
- Click again → `clear-raise-hand`.
- Self-mute also clears raised hand (`VoiceSystem.setMuted`).

### 11.2 Teacher Panel

- `raise-hand-list` event populates panel.
- Per student: **Unmute/Mute**, **Clear hand**.
- Socket rebinding on reconnect (`boundRaiseHandSocket` pattern) so list stays live after 3D load.

### 11.3 Join Approval (Separate from Raise Hand)

- Pending students: REST `pending-requests` + socket `pending-requests-updated`.
- Teacher approves via REST `POST .../approve` + socket `student-join-approved`.

---

## 12. Authentication & Authorization

**Files:** `server/routes/auth.js`, `server/lib/auth.js`, `server/models/User.js`

| Step | Mechanism |
|------|-----------|
| Register | bcrypt hash password → MongoDB User |
| Login | bcrypt compare → JWT (`signAccessToken`) |
| API calls | `Authorization: Bearer <token>` middleware |
| Socket | JWT in handshake `auth.token` |
| Teacher classroom | `createdBy` must match JWT `sub` |
| Student classroom | `userId` must be in `approvedStudentIds` |

JWT payload: `{ sub, role, phone, name }` — stored client-side as `delta-access-token`.

Session expiry: 24 hours (client-side check in `main.js`).

---

## 13. REST API Reference

Base path: `/auth` (proxied in Vite dev to backend).

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Create user |
| POST | `/login` | No | Get JWT |
| GET | `/me` | Yes | Current user profile |

### Classrooms

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/classrooms` | Yes | Create/update classroom |
| GET | `/classrooms` | Yes | List user's classrooms |
| GET | `/classrooms/:code` | Optional | Check room exists |
| POST | `/classrooms/:code/join` | Yes | Join (or pending) |
| DELETE | `/classrooms/:code` | Yes | Delete classroom (teacher) |
| GET | `/classrooms/:code/pending-requests` | Yes | List pending joins |
| POST | `/classrooms/:code/pending-requests/:id/approve` | Yes | Approve student |
| DELETE | `/classrooms/:code/pending-requests/:id` | Yes | Deny student |

### Discussion (REST mirror of socket)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/classrooms/:code/discussion` | Fetch feed + polls |
| POST | `/classrooms/:code/discussion/message` | Post message |
| POST | `/classrooms/:code/discussion/image` | Post image |
| POST | `/classrooms/:code/discussion/poll` | Create poll |
| POST | `/classrooms/:code/discussion/poll/:id/vote` | Vote |
| DELETE | `/classrooms/:code/discussion/message/:id` | Delete message |
| DELETE | `/classrooms/:code/discussion/poll/:id` | Delete poll |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |

---

## 14. Database & Storage

### 14.1 MongoDB Collections

**User**
- `name`, `phone`, `password` (hashed), `role`, `studentClass`, `userId`

**Classroom**
- `code` (unique, format `xxx-xxxx-xxx`)
- `subject`, `timing`, `capacity`, `info`
- `createdBy` (ObjectId → User)
- `approvedStudentIds[]`
- `pendingJoinRequests[]`
- `studentAssignments` Map, `studentPositions` Map, `teacherPositions` Map
- `blackboardStrokes[]`
- `discussionFeed[]`, `discussionPolls[]`

### 14.2 In-Memory (Server RAM)

**`activeClassrooms` Map** per room code:
- Socket IDs, positions, raiseHands Set, voiceRelaySpeakers, voiceRelayHistory
- teacherSocketIds, teacherPresent, presentation state
- userAudioStates, userDisplayNames

Lost on server restart — clients reconnect and reload snapshots from MongoDB where persisted.

### 14.3 Client Storage

| Key | Purpose |
|-----|---------|
| `delta-access-token` | JWT |
| `delta-user-display` | Display name |
| `delta-user-role` | teacher/student |
| `delta-active-room` | Last room code |
| `delta-notes:{code}` | Notes page content |
| Service Worker cache | PWA shell ( `client/public/sw.js` ) |

---

## 15. Algorithms Used

| Algorithm / Pattern | Where | Description |
|---------------------|-------|-------------|
| **Room code validation** | `utils/roomCode.js` | Regex `^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$` |
| **Next free slot** | `getNextAvailableSlot()` | Linear scan O(n) over desk slots |
| **Position lerp** | `Movement.js` | Interpolate avatar motion for smooth network updates |
| **Camera lerp** | `CameraSystem.js` | Smooth camera transitions (follow, blackboard, full view) |
| **Raycast drawing** | `Blackboard.js` | THREE.Raycaster maps mouse → board UV → stroke points |
| **Laser throttle** | Blackboard + ImageSync | Rate-limit + min delta distance before emit |
| **Stroke batching** | Blackboard | Batch points before emit on low bandwidth |
| **JWT sign/verify** | `lib/auth.js` | HS256 token for stateless auth |
| **bcrypt hashing** | Register/login | Password storage |
| **Voice chunk queue** | VoiceSystem | FIFO queue for SourceBuffer append while updating |
| **Relay reset backoff** | VoiceSystem | Max 3 MediaSource resets per speaker before fallback |
| **Singleton VoiceSystem** | VoiceSystem constructor | Destroy previous instance on new create |
| **Snapshot broadcast** | `broadcastSnapshot()` | Emit all positions/assignments to new joiner |
| **Participant name resolve** | `resolveParticipantDetails()` | Merge socket display names + MongoDB user lookup |
| **Meeting code generation** | `meetingCode.js` | Random formatted room code for create form |
| **Adaptive FPS** | CameraSystem | 8 FPS cap on 2G, 60 FPS otherwise |
| **SPA route cleanup** | `cleanupClassroomRuntime()` | Tiered teardown on hash navigation |

---

## 16. Tech Stack & Why These Choices

### 16.1 Frontend

| Choice | Why | Why Not Alternative |
|--------|-----|---------------------|
| **Vite** | Fast dev, simple build to static `dist/` | CRA slower; Next.js overkill for SPA |
| **Vanilla JS** | No React runtime — smaller bundle for low-end phones | React adds ~40KB+ gzipped |
| **Three.js** | Mature WebGL 3D — desks, avatars, board texture | Unity WebGL builds are huge |
| **Hash routing** | Works on static hosts (Railway, Render) without SSR | Browser router needs server rewrite rules |
| **socket.io-client** | Auto reconnect, fallbacks polling→websocket | Raw WebSocket — no reconnect/fallback built-in |

### 16.2 Backend

| Choice | Why | Why Not Alternative |
|--------|-----|---------------------|
| **Node + Express** | Same language as frontend; great for I/O-heavy sockets | Go/Java heavier dev cycle for this team size |
| **Socket.IO** | Rooms, broadcasts, binary chunks, reconnect | Raw WS — reinvent rooms and heartbeats |
| **MongoDB** | Flexible schema for strokes, discussion arrays, maps | SQL migrations painful for evolving stroke JSON |
| **JWT** | Stateless API auth | Sessions need sticky storage |
| **bcrypt** | Industry standard password hashing | Plain text — unacceptable |

### 16.3 Infrastructure

| Choice | Why |
|--------|-----|
| **Railway / Render** | Single Node process serves API + static + Socket.IO |
| **MongoDB Atlas** | Managed backups, free tier for demos |

### 16.4 Lightweight & Low-Network Design Principles

1. **Defer 3D** until explicit user action.
2. **Reduce canvas/renderer resolution** on `navigator.connection.effectiveType`.
3. **Voice bitrate ~16 kbps** mono Opus.
4. **Server audio relay** instead of mesh WebRTC.
5. **Stroke/laser throttling** on slow networks.
6. **Service worker** for shell caching (optional PWA behavior).
7. **Discussion REST fallback** when socket unavailable.

---

## 17. Low-Bandwidth & Packet Design

### 17.1 Network Detection

```javascript
navigator.connection.effectiveType  // '4g', '3g', '2g', 'slow-2g'
navigator.connection.saveData       // true on data-saver mode
```

Used in: `classroomLoader.js`, `Blackboard.js`, `ImageSync.js`, `VoiceSystem.js`, `CameraSystem.js`.

### 17.2 Typical Packet Sizes

| Event | Approx Size | Frequency |
|-------|-------------|-----------|
| `move` | ~50 bytes JSON | Per key repeat (throttled client-side) |
| `blackboard-stroke` | 100–500 bytes | Per draw segment (batched on 2G) |
| `blackboard-laser` | ~40 bytes | 5–15/sec max (throttled) |
| `voice-relay-chunk` | 0.5–4 KB | ~4–5/sec per speaker |
| `raise-hand` | ~80 bytes | Once per action |
| `presentation-update` | varies | Rare (slide change) |

### 17.3 Binary vs JSON

Voice chunks sent as **binary ArrayBuffer** attachment on Socket.IO — avoids base64 overhead (~33% savings).

---

## 18. Comparison: Delta-Class-3D vs Zoom / Google Meet

| Feature | Delta-Class-3D | Zoom / Google Meet |
|---------|----------------|---------------------|
| **3D classroom space** | Yes — desks, movement, immersion | No — flat video grid |
| **Spatial presence** | Avatars at assigned seats | Video tiles only |
| **Blackboard in 3D scene** | Yes — synced drawing | Whiteboard is separate 2D product |
| **Voice architecture** | Server relay ~16 kbps | SFU/cloud media servers (enterprise scale) |
| **Video** | Not implemented | Core feature (high bandwidth) |
| **Screen share** | Slide/image upload only | Full desktop capture |
| **Max reliable scale** | ~25–30 with relay (demo scale) | Thousands |
| **Install required** | Browser only | App or browser |
| **Account model** | Self-hosted phone auth | Google/Microsoft accounts |
| **Bandwidth minimum** | Tuned for 2G/3G audio + light UI | Needs stable broadband for video |
| **Customization** | Full source control | Closed platform |
| **Cost** | Railway + Atlas free tiers possible | Per-seat licensing |

---

## 19. Advantages of Our Approach

1. **Immersive learning** — 3D desk layout mimics physical classroom spatial cues.
2. **Ultra-light audio mode** — viable on slow mobile networks without video.
3. **Teacher control** — raise-hand queue, approve joins, mute/unmute authority.
4. **Unified room** — movement + board + slides + voice + chat in one code.
5. **Open & self-hostable** — no vendor lock-in; customize for institution.
6. **Progressive loading** — UI first, 3D optional — respects low-end devices.
7. **Persistent classroom** — MongoDB retains board strokes, discussion, roster.
8. **Pedagogy-focused** — polls, notes, laser pointer, student instructions.

---

## 20. Drawbacks & Limitations

1. **No native screen sharing** — only uploaded slides/images/PDF pages.
2. **No video cameras** — audio + 3D avatars only; less personal than video calls.
3. **Server relay bandwidth** — server broadcasts audio to all; scales worse than commercial SFU at large N.
4. **Single Node socket state** — horizontal scaling needs Redis adapter (not included).
5. **In-memory session loss** — server restart clears live positions (partial recovery from MongoDB).
6. **Notes not synced** — localStorage only; lost if browser cleared.
7. **WebGL required** — very old devices may fail 3D load.
8. **Safari MediaSource quirks** — voice playback may use fallback blobs on some browsers.
9. **No end-to-end encryption** for voice relay through server (Zoom/Meet offer E2E options).
10. **Manual join approval** — friction vs open meeting links.

---

## 21. Feature Enhancements (Roadmap)

| Priority | Enhancement |
|----------|-------------|
| High | Native screen share via `getDisplayMedia()` + relay |
| High | Redis Socket.IO adapter for multi-instance deploy |
| High | SFU (e.g. mediasoup) for video + better audio scale |
| Medium | Synced cloud notes (MongoDB per user per room) |
| Medium | Recording — store voice + board timeline |
| Medium | Breakout sub-rooms |
| Medium | Mobile touch controls for movement |
| Low | Avatar customization (Avatars.js extension) |
| Low | LTI integration for LMS (Moodle, Canvas) |
| Low | End-to-end encryption option for voice |

---

## 22. Seminar Presentation Guide

Use this section as your **slide outline** for college/project seminar.

### Slide 1 — Title
**Delta-Class-3D: Low-Bandwidth 3D Virtual Classroom**  
Team, institution, date.

### Slide 2 — Problem Statement
Traditional video conferencing (Zoom/Meet) demands high bandwidth and lacks spatial classroom metaphor. Rural / mobile students struggle with video-heavy tools.

### Slide 3 — Objectives
- Real-time 3D shared classroom
- Audio-first design for 2G/3G
- Teacher moderation (join approval, raise hand, mute control)
- Blackboard + slides + discussion in one room code

### Slide 4 — System Architecture
Show diagram from [Section 4](#4-system-architecture): Browser ↔ Express + Socket.IO ↔ MongoDB.

### Slide 5 — Tech Stack
Vite, Three.js, Socket.IO, Express, MongoDB, JWT — bullet reasons from [Section 16](#16-tech-stack--why-these-choices).

### Slide 6 — All Pages Demo Map
Table from [Section 2](#2-every-page-complete-spa-route-map) — prove completeness.

### Slide 7 — User Workflow
Teacher flow + Student flow diagrams from [Section 3](#3-end-to-end-user-workflows).

### Slide 8 — 3D Classroom
Scene modules, deferred loading, slot assignment, movement sync — [Section 6](#6-3d-classroom-engine).

### Slide 9 — Real-Time Sync
Socket event table (subset) — movement, board, presentation — [Section 5](#5-real-time-layer-websocket--socketio).

### Slide 10 — Voice System Deep Dive
```
Mic → MediaRecorder → voice-relay-chunk → Server → All clients → MediaSource
```
Bitrate, teacher/student policy — [Section 7](#7-voice-system-audio-relay).

### Slide 11 — Blackboard & Laser
Canvas texture, stroke sync, persistence — [Section 8](#8-blackboard-laser--drawing-sync).

### Slide 12 — Presentation / PDF
Image upload flow, laser on slides — [Section 9](#9-presentation-slides--pdf--images).  
Clarify: **not** OS screen capture.

### Slide 13 — Raise Hand & Moderation
Student raise → teacher unmute → voice starts — [Section 11](#11-raise-hand--teacher-moderation).

### Slide 14 — Discussion & Polls
Chat + polls + MongoDB persistence — [Section 10](#10-group-discussion-polls--notes).

### Slide 15 — APIs & Database
REST table + MongoDB schema — [Sections 13–14](#13-rest-api-reference).

### Slide 16 — Algorithms
Table from [Section 15](#15-algorithms-used).

### Slide 17 — Low Bandwidth Design
Network detection, packet sizes, deferred 3D — [Section 17](#17-low-bandwidth--packet-design).

### Slide 18 — vs Zoom / Google Meet
Comparison table — [Section 18](#18-comparison-delta-class-3d-vs-zoom--google-meet).

### Slide 19 — Advantages
Bullet list — [Section 19](#19-advantages-of-our-approach).

### Slide 20 — Drawbacks (Honest)
Bullet list — [Section 20](#20-drawbacks--limitations).

### Slide 21 — Future Work
Roadmap — [Section 21](#21-feature-enhancements-roadmap).

### Slide 22 — Live Demo Script
1. Register teacher → create room  
2. Register student → join → teacher approves  
3. Both enter classroom → load 3D  
4. Teacher moves, draws on board  
5. Upload presentation PDF → laser pointer  
6. Student raises hand → teacher unmutes → hear audio  
7. Open group discussion → poll  
8. Navigate discussion → classroom → 3D without reload  

### Slide 23 — Q&A
Expected questions:
- *Why not WebRTC mesh?* → Scale + 2G reliability → server relay.  
- *Where is video?* → Out of scope; audio-first for bandwidth.  
- *Is screen shared?* → Slide upload yes; desktop capture no (future work).  
- *Database?* → MongoDB Atlas; strokes and discussion persisted.  
- *Deployment?* → Railway, single Node serves static + API + WebSocket.

---

## Appendix A — Key File Index

```
client/
  src/main.js                 — Router, cleanup, socket bootstrap
  src/classroomPage.js        — Main classroom 2D shell
  src/classroom.js            — 3D startClassroom / stopClassroom
  src/startup/classroomLoader.js — Deferred 3D + socket boot
  classroom/VoiceSystem.js    — Audio relay
  classroom/Blackboard.js     — Drawing + laser
  classroom/ImageSync.js      — Presentation + slide laser
  classroom/SocketSync.js     — Movement socket bindings
  classroom/Movement.js       — Collision + lerp
  classroom/CameraSystem.js   — Render loop
  features/dashboard/         — All dashboard sub-pages
  features/auth/              — Login, register

server/
  index.js                    — Express + Socket.IO + Mongo connect
  socketHandlers.js           — All real-time events
  routes/auth.js              — Auth endpoints
  routes/classrooms.js        — Classroom + discussion REST
  services/classroomSession.js — activeClassrooms + algorithms
  models/User.js, Classroom.js — Mongoose schemas
```

---

## Appendix B — Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGO_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Token signing |
| `PORT` | No | Server port (default from host) |
| `DEBUG_LOGS` | No | Verbose server logging |
| `VOICE_MESH_PARTICIPANT_LIMIT` | No | Mesh limit hint (relay used above) |

---

*Document version: comprehensive replacement — covers all SPA routes, subsystems, APIs, algorithms, seminar outline, and honest trade-offs. Last aligned with codebase: Delta-Class-3D monorepo.*
