# Delta-Class-3D 
## 1) What exactly this project is
Delta-Class-3D is a **real-time 3D virtual classroom**.
Core idea:
- Teacher creates a class room code.
- Students join with that code.
- Everyone enters a shared 3D classroom scene.
- Movement, blackboard, raise-hand, and presentation are synchronized in real time.
- Voice is peer-to-peer using WebRTC signaling through Socket.IO.
- User and classroom data are stored in MongoDB.

So this is not just a static website; it is a full stack real-time app with:
- Frontend (Vite + vanilla JS + Three.js)
- Backend API (Express)
- Real-time server (Socket.IO)
- Database (MongoDB/Mongoose)
- Auth (JWT + bcrypt)

## 2) Project structure (top level)

At root:
- `client/` → frontend app (all pages + 3D + realtime client)
- `server/` → backend API + socket server + DB logic
- `package.json` → monorepo scripts (`dev`, `build`, `start`)
- `render.yaml` + `RENDER_DEPLOYMENT.md` → deployment on Render

Execution flow in production:
1. `server/index.js` starts Express + HTTP + Socket.IO.
2. Server serves `client/dist` static files.
3. Browser loads frontend from `client` build.
4. Frontend calls `/auth/*` REST APIs and opens Socket.IO connection.

## 3) Tech stack

### Frontend
- Vite
- Vanilla JavaScript SPA (hash routing)
- Three.js (3D scene)
- socket.io-client

- WebRTC (browser native RTCPeerConnection)

### Backend
- Node.js + Express 5
- Socket.IO
- Mongoose + MongoDB
- bcrypt
- jsonwebtoken
- cors + dotenv

### Infrastructure
- MongoDB Atlas
- Render web service

---

## 4) Step-wise walkthrough (as requested: Classroom first)

You asked to go step-by-step and start from classroom side first, then next pages.

## 4A) Classroom flow first (client side)

### 4A.1 Entry into classroom route
Routing happens in `client/src/main.js`.

When URL hash is like:
- `#/classroom?role=teacher&code=abc-defg-hij`
- `#/classroom?role=student&code=abc-defg-hij`

It loads:
- `renderClassroomPage(...)` from `client/src/classroomPage.js`
- `createClassroomLoader(...)` from `client/src/startup/classroomLoader.js`

`classroomPage.js` creates:
- top bar,
- status badge,
- load 3D button,
- reload modal,
- exit modal,
- raise-hand panel (teacher only),
- mic controls.

### 4A.2 Why "Load 3D classroom" button exists
In low bandwidth devices, the app does **deferred loading**:
- UI loads first quickly.
- Heavy modules (3D scene, camera system, blackboard) load only when user clicks.

This is handled by `createClassroomLoader`.

### 4A.3 Socket + 3D startup
On load click:
1. Opens socket connection (`socket.io-client`).
2. Imports `startClassroom` from `client/src/classroom.js`.
3. Calls `startClassroom(socket, role, options)`.

Inside `startClassroom`:
- `SceneSetup` creates scene/camera/renderer.
- `Lighting` adds light.
- `Environment` creates walls + blackboard.
- `Furniture` creates desks + slots + teacher avatar.
- `SocketSync` wires movement sync events.
- `ImageSync` wires presentation feature.
- Deferred load: `CameraSystem` + `Blackboard` for performance.

### 4A.4 3D modules meaning (pin-to-pin)

#### `classroom/SceneSetup.js`
- Initializes Three.js scene.
- Chooses antialias/pixel ratio based on bandwidth profile.

#### `classroom/Lighting.js`
- Uses simplified light for low bandwidth.
- Uses ambient + directional in better conditions.

#### `classroom/Environment.js`
- Creates classroom walls + ceiling.
- Creates whiteboard (called blackboard in code).

#### `classroom/Avatars.js`
- Builds student and teacher avatar meshes.
- Uses low-poly versions on low bandwidth.

#### `classroom/Furniture.js`
- Creates desk/chair groups and teacher podium.
- Builds `studentSlots` array and `staticObstacles` for collision logic.

#### `classroom/CameraSystem.js`
- Camera presets: Whiteboard view, Full view, Teacher view.
- Smooth transitions via lerp.
- Frame-throttling for slow networks (e.g., ~8 FPS in strict low-bandwidth).

#### `classroom/Blackboard.js`
- Uses HTML canvas texture mapped onto 3D board.
- Teacher can draw/erase/clear.
- Emits `blackboard-stroke` via socket.
- Receives remote strokes and applies batching in low bandwidth.
- Handles snapshot/reconnect synchronization.

#### `classroom/ImageSync.js`
- Presentation overlay full-screen.
- Teacher uploads images/PDF; students receive slide updates.
- Events: `presentation-start`, `presentation-update`, `presentation-stop`.

#### `classroom/VoiceSystem.js`
- WebRTC peer connections for audio.
- Uses Socket.IO for signaling (`offer/answer/candidate`).
- Manages mute/deafen and teacher audio control.
- Applies low-bitrate SDP tuning for poor networks.

#### `classroom/SocketSync.js`
- Binds socket events for movement/state sync:
  - student assigned
  - student move update
  - teacher move update
  - teacher instructions

#### `classroom/Movement.js`
- Core movement + collision logic (used by legacy movement architecture).
- Assignment map user→slot and obstacle collision checks.

### 4A.5 Classroom UX controls
- Exit modal:
  - Student: just exit
  - Teacher: take break OR end class
- Reload warning before refresh
- **Raise-hand panel (Teacher only)**:
  - Fixed **right-side corner tab** with hand-raise icon
  - Collapses by default when entering classroom
  - **Hover-activated expand**: hovering over the corner tab or panel expands it with smooth 0.3s transition
  - Shows list of students with raised hands
  - Each student has **mute/unmute button** and **clear hand** button
  - Clear button displays **hand-down symbol** (not blank)
  - Teacher can toggle student mute state via icons
- Mute button synced with voice system

---

## 4B) Next pages (full frontend page-by-page)

All main routes are controlled in `client/src/main.js` using hash routing.

### `/login` page
File: `client/src/features/auth/login.js`

What it does:
- role choose (teacher/student)
- login via phone + password
- calls `POST /auth/login`
- stores token and user profile in localStorage
- password reset flow via `POST /auth/reset-password`

### `/register` page
File: `client/src/features/auth/register.js`

What it does:
- register teacher or student
- validates fields (phone/password/class for students)
- creates random user code like `D3D-XXXXXX`
- calls `POST /auth/register`
- stores token/session keys

### `/dashboard` page (default fallback route)
File: `client/src/features/dashboard/dashboardPage.js`

What it does:
- top actions: create / join / login(profile menu)
- shows classroom cards fetched through `onResolveRooms`
- each card displays: room code, timing, subject, capacity, and participants
- quick-access buttons at card bottom:
  - **Discussion button** (with 💬 icon) — accessible to both teachers and students; navigates to `/group-discussion` page
  - Notes button — opens notes page
- open selected room by clicking card
- delete classroom button for creator only
- periodic room sync every 15 seconds

### `/create` page
File: `client/src/features/dashboard/createClassroomPage.js`

What it does:
- generates room code via `generateMeetingCode()`
- collects metadata (subject/time/capacity/info)
- calls create via API through `onSave`

### `/join` page
File: `client/src/features/dashboard/joinClassroomPage.js`

What it does:
- accepts room code
- normalizes format
- validates existence + joins through backend

### `/room` page (alternative room UI)
File: `client/src/features/dashboard/roomPage.js`

What it does:
- compact room shell UI for alternative classroom access
- socket-linked voice controls (mute/unmute button)
- **Raise-hand panel** (Teacher only):
  - hidden by default
  - right-side **corner tab with hand-raise icon** for visibility
  - expands on hover with smooth transition
  - shows students with raised hands + their mute/clear states
- exit modal with teacher/student branching
- pending join requests panel (teacher only) with approve/reject buttons

### `/profile` page
File: `client/src/features/profile/profilePage.js`

What it does:
- calls `/auth/me`
- displays user details
- shows role-specific quick action

### `/group-discussion` page
File: `client/src/features/dashboard/groupDiscussionPage.js`

What it does:
- real-time discussion thread with messages, polls, and image sharing
- **Accessible to both teachers and students**
- **Features**:
  - Message feed with user metadata
  - Send messages with real-time socket sync + REST persistence to MongoDB
  - **Delete functionality**: senders can delete their own messages; teachers can delete any message
  - Create polls with real-time voting
  - Vote tracking (stored in database)
  - Image upload and sync
  - Hybrid sync: socket events for real-time UI + REST endpoints for database persistence
- **Backend endpoints** (all authenticated):
  - `GET /classrooms/:code/discussion` — fetch persisted discussion state
  - `POST /classrooms/:code/discussion/message` — create message
  - `DELETE /classrooms/:code/discussion/message/:messageId` — delete message (sender or teacher only)
  - `POST /classrooms/:code/discussion/poll` — create poll
  - `DELETE /classrooms/:code/discussion/poll/:pollId` — delete poll

### `/classroom` page
Main full classroom route described in section 4A.

---

## 5) Backend deep explanation (server)

Main entry: `server/index.js`

Responsibilities:
1. Setup Express middleware (CORS, JSON body, request logs).
2. Health endpoints:
	- `/health`
	- `/health/db`
3. Mount auth routes at `/auth`.
4. Serve frontend static files from `client/dist`.
5. Setup Socket.IO server.
6. Classroom REST APIs.
7. Attach socket handlers from `server/socketHandlers.js`.
8. Delete classroom authorization & cleanup.
9. Connect MongoDB using `MONGO_URI`.

### `server/socketHandlers.js`
This is the real-time engine.

Key behavior:
- Validates room code on socket connection.
- Maintains in-memory `activeClassrooms` session state.
- Teacher presence gate: student blocked if teacher not present.
- Slot assignment for students.
- Movement broadcast.
- Whiteboard stroke sync + persistence.
- Presentation sync.
- Raise-hand list management.
- Audio state moderation.
- WebRTC signaling relay.

### `server/routes/auth.js`
Auth and user endpoints:
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/reset-password`
- `GET /auth/me`

### Data models

#### `server/models/User.js`
Fields:
- name, phone, password, role, studentClass, userId

Hooks:
- auto-generate userId if missing
- hash password with bcrypt before save

#### `server/models/Classroom.js`
Fields:
- code, subject, timing, capacity, info
- createdBy
- studentAssignments, positions, teacherPositions
- blackboardStrokes

---

## 6) API endpoints and what they do

### Health
- `GET /health` → basic alive check
- `GET /health/db` → DB connectivity check

### Auth
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/reset-password`
- `GET /auth/me` (JWT required)

### Classroom management
- `POST /auth/classrooms` (create/update by teacher)
- `GET /auth/classrooms` (teacher gets owned classes; student gets joined classes)
- `GET /auth/classrooms/:code` (exists/details)
- `POST /auth/classrooms/:code/join`
- `DELETE /auth/classrooms/:code` (creator only)

---

## 7) Real-time event protocol map (Socket.IO)

### Classroom/session events
- `student-assigned`
- `student-move-update`
- `teacher-move-update`
- `teacher-instruction`
- `teacher-student-instruction`

### Whiteboard events
- `blackboard-stroke`
- `blackboard-clear`
- `blackboard-snapshot`
- `request-blackboard`

### Presentation events
- `presentation-start`
### Audio/voice moderation events
- `teacher-set-audio-state`
- `request-unmute`

### Raise hand events
- `raise-hand`
- `clear-raise-hand`
- `raise-hand-list`
- `request-raise-hand-list`
- `request-existing-peers`


These are concrete algorithms/patterns in this project:
1. **Meeting code generation**
	- Function: `generateMeetingCode()`

2. **Room code validation (regex)**

3. **Student slot allocation**
	- Strategy: first-fit scan from slot `0` to `MAX_STUDENT_SLOTS - 1`.

4. **Collision detection for movement**
	- Uses circle-vs-rectangle intersection (`circleIntersectsRect`).

6. **Adaptive rendering/frame throttling**
	- Batches remote stroke processing for low-end networks.


10. **JWT token auth**

	 - SDP parameter tuning for low bandwidth audio.

## 9) Protocols used

1. **HTTP/HTTPS**
	- For REST auth/classroom endpoints and static file delivery.

2. **WebSocket (through Socket.IO protocol layer)**
	- For real-time classroom state sync.

3. **WebRTC (SRTP media path)**
	- For peer-to-peer audio between participants.

4. **STUN**
	- Used by WebRTC ICE for NAT traversal (Google STUN servers configured).

5. **JWT bearer auth protocol (application-level)**
	- `Authorization: Bearer <token>` for protected APIs.

6. **MongoDB wire protocol (driver-managed)**
	- Mongoose/driver handles DB communication to MongoDB Atlas.

---

## 10) State management summary

### Client-side state
- `localStorage` keys:
  - token
  - token timestamp
  - user display name
  - user role
  - active room
  - network profile override

### Server-side in-memory state
- `activeClassrooms` map with:
  - student assignments
  - positions
  - teacher sockets
  - whiteboard strokes
  - audio states
  - raise hand set

### Persistent state (MongoDB)
- Users
- Classrooms + metadata
- stored whiteboard strokes and assignments/positions snapshots

---

## 11) Deployment/runtime behavior

Deployment target configured for Render:
- Build: `npm install; npm run build`
- Start: `npm start`
- Health check: `/health`

Required env vars:
- `MONGO_URI`
- `JWT_SECRET`

---

## 12) Practical end-to-end user journey

1. User opens app.
2. Register/Login as teacher or student.
3. Teacher creates classroom code.
4. Student joins using same code.
5. Teacher enters class; session becomes active.
6. Students enter and get seat assignment.
7. Real-time actions happen:
	- movement sync,
	- whiteboard sync,
	- raise-hand + moderation,
	- presentation sync,
	- audio via WebRTC.
8. Teacher can:
	- take break (room remains),
	- end class (delete room and disconnect all).

---

## 13) Important observations / notes

- `client/package.json` currently includes backend packages (`express`, `mongoose`, `dotenv`, etc.) that are not needed in browser bundle. The app still works, but this can be cleaned.
- There is both `#/classroom` and `#/room` classroom-style route support (legacy/new path coexistence).
- Voice system includes reconnection and SDP tuning logic for unstable networks.
- **Recent UI/UX improvements (v2 release)**:
  - Raise-hand panel now collapses to a corner tab by default with hover-to-expand behavior for better screen space efficiency
  - Hand-down state displays a clear symbol (not blank) for better clarity
  - Discussion button moved from classroom page to dashboard cards with chat icon, accessible to both teachers and students for improved accessibility
  - All raise-hand and discussion features persist to MongoDB for offline access and history

### 14) Low-bandwidth (2G/3G) behavior — comparison with Zoom / Google Meet / Google Classroom

This section describes how Delta-Class-3D adapts to constrained networks (2G / slow 3G) and compares effectiveness, advantages, and disadvantages against traditional conferencing platforms (Zoom, Google Meet) and LMS-like Google Classroom.

Summary: Delta-Class-3D is optimized for low-data usage by deferring heavy work, reducing rendering fidelity, throttling realtime emissions, and tuning WebRTC for low bitrate. Zoom/Google Meet are highly optimized for real-time media with server-side relays (SFU) and sophisticated adaptive codecs; they generally deliver more robust multi-party audio/video at higher bandwidth cost. Google Classroom is primarily an LMS (asynchronous) and uses Meet for live sessions.

How Delta-Class-3D reduces data on 2G/3G
- Deferred module load: the 3D scene and heavy modules are loaded only after an explicit user gesture (`Load 3D classroom`), keeping initial network and CPU costs minimal.
- Low-poly assets: avatars, furniture, and lighting use simplified geometries and fewer texture uploads when a low-bandwidth profile is detected.
- Adaptive renderer: `CameraSystem` throttles frame rate (e.g., ~8 FPS) on strict low-bandwidth profiles to lower CPU/GPU usage and memory pressure.
- Whiteboard optimizations: canvas resolution is reduced (1024/1536px), strokes are throttled by distance/time and batched for remote replay; snapshots applied in chunks to avoid spikes.
- SDP tuning: `VoiceSystem` applies conservative OPUS fmtp parameters and bandwidth caps (low average bitrate) for WebRTC negotiation to reduce encoded audio bitrate.
- P2P audio: peers connect directly (no SFU) which avoids server media bandwidth but increases upstream bandwidth per teacher/client depending on topology.
- Feature gating: non-essential UI (high-res textures, continuous rendering, large uploads) is avoided unless user explicitly enables it.
- Reconnection, batching, and graceful fallbacks: reconnect handlers and reduced emission rates keep the app usable over lossy links.

Effectiveness estimates (approximate)
- Audio (Delta tuned): 8–24 kbps per audio peer (with conservative SDP) for mono low-sample-rate OPUS configurations. Effective two-way perceived speech quality is lower than high-bitrate OPUS but understandable for voice-only lessons.
- Whiteboard/presentation: teacher-sent images (single-slide) are sent as compressed JPEG data URLs; initial broadcast of one image is low-data (tens–hundreds KB), further slide changes send only the changed image. On 2G this is workable if teacher precompresses slides.
- 3D scene assets: initial download size is the dominating cost when loading scene; on strict low-bandwidth this step is avoided or deferred.

Comparison with Zoom / Google Meet
- Architecture:
	- Delta-Class-3D: browser-client heavy; Socket.IO signaling + direct WebRTC P2P for audio (no built-in SFU). Server handles signaling and optional persistence only.
	- Zoom/Google Meet: use centralized media relays (SFU) to mix/forward streams; clients send one high-quality uplink and receive optimized downlinks (simulcast/scalable layers). SFU reduces each client's upstream burden when many participants are present and allows server-side bandwidth management.
- Bandwidth & Quality:
	- Zoom/Meet: adaptive codecs, simulcast, congestion control, and prioritized layers yield more stable audio/video quality across varying conditions. Audio quality typically uses higher bitrates and better QoS, resulting in clearer voice and video where bandwidth permits.
	- Delta-Class-3D: can achieve very low bandwidth usage for audio by aggressive SDP tuning, but P2P scaling causes the teacher (or each peer) to bear multiple upstreams if many attendees connect—this can be a limitation in multi-party calls.
- Latency & Responsiveness:
	- Both approaches provide low-latency audio; SFU-based services often have slightly higher but stable latency due to server hops but better for large groups.
	- Delta-Class-3D's direct P2P can be lowest-latency in ideal NAT conditions, but fragile with NAT/ICE failures; ICE/STUN behavior on 2G/3G can be unreliable without TURN.
- Feature tradeoffs:
	- Zoom/Meet provide robust native video + screen-share, background noise suppression, echo cancellation, and a managed experience—these features cost more bandwidth.
	- Delta-Class-3D focuses on low-bandwidth 3D experiences and whiteboard synchronization rather than high-quality video; it intentionally avoids heavy video by design.

Advantages of Delta-Class-3D on 2G/3G
- Lower baseline data usage for non-media features: by deferring heavy modules and reducing canvas sizes, the app keeps the interactive experience available where video-based platforms would struggle.
- Tailored UX for slow networks: throttled rendering and batched updates avoid UI freezes and long stalls common on resource-constrained devices.
- Presentation efficiency: sending single compressed images for slides is often far cheaper than streaming video of the same content.
- Offline-first tolerance: smaller live-state updates (positions, strokes) allow intermittent connectivity to continue to be useful.

Disadvantages vs Zoom/Meet
- Audio scaling: P2P audio is efficient for small groups but scales poorly; with many peers the aggregate upstream requirements increase (or teacher must forward), making SFU approaches superior for medium/large classes.

Current mitigation in this codebase (interim)
- Server emits `voice-scaling-state` with participant count and a mesh threshold (`VOICE_MESH_PARTICIPANT_LIMIT`, default 12).
- Client `VoiceSystem` switches to `teacher-priority-mesh` in larger rooms (students connect to teacher peers only), which reduces total mesh fan-out and signaling pressure.
- A runtime banner warns that SFU/media relay is recommended for stable large-class teacher uplink.
- No server media relay (TURN) by default: if peers cannot establish direct connections due to NAT/firewall, media may fail unless TURN/relay is introduced (which adds server bandwidth cost).
- Lower perceived audio/video fidelity: aggressive bitrate caps and mono/low-sample-rate audio reduce intelligibility compared to optimized SFU codecs at higher rates.
- More client CPU work: clients still render Three.js scenes (even low-poly) and perform canvas operations which may tax weaker devices; Zoom/Meet offload more to native apps with optimized pipelines.

Practical recommendations
- Prefer audio-only sessions on strict 2G/3G; avoid video and defer 3D until users are on better connections.
- Teacher should precompress slides as JPEG and upload; use image-based presentations rather than live-screen streaming.
- For larger classes (>10–15), consider adding an SFU or media relay option so the teacher doesn't need N upstreams.
- Add TURN as fallback to improve WebRTC connectivity in restrictive networks (accepts server bandwidth cost but improves reliability).
- Provide a "low-data mode" toggle that forces minimal assets, audio-only, and very low-frequency updates for whiteboard and presence.

Bottom line
- Delta-Class-3D is intentionally optimized to keep a lightweight collaborative classroom usable over slow networks by prioritizing small-state updates, deferring heavy content, and tuning media for low bitrate. For higher-quality multi-party audio/video at scale, SFU-based commercial solutions (Zoom/Meet) outperform in stability and perceived quality, but at significantly higher bandwidth and server cost. Google Classroom is complementary (LMS + assignments) and typically relies on Meet for live sessions — it is not optimized for lightweight, low-data interactive 3D sessions the way this project aims to be.

---

### 14.1 Detailed technical explanation (SDP, bandwidth math, batching, and recommendations)

This subsection gives concrete, actionable technical detail for engineers who want to understand or tune Delta-Class-3D for extremely constrained networks (typical 2G/slow 3G conditions). It expands the previous high-level section with sample parameter values, bandwidth math, and implementation notes.

1) WebRTC / SDP tuning (what the app already does and why)
- Goals: reduce bytes-on-wire, increase packetization efficiency for voice, tolerate jitter/loss, and preserve intelligibility.
- Typical SDP knobs to use (examples the project already applies conceptually):
	- `b=AS:<kbps>` — application-level bandwidth cap. For strict low-data profiles set `b=AS:12` (12 kbps) to force the encoder to target very low bitrate. For a slightly better experience try `b=AS:24`.
	- OPUS fmtp flags: enable mono, set `useinbandfec=1` (FEC) and `stereo=0`. Example: `a=fmtp:111 minptime=20;useinbandfec=1;stereo=0`.
	- `minptime` / `ptime` — increase packetization interval where appropriate (e.g., `minptime=20`–`40` ms) to reduce header overhead on very low bitrates.
	- DTX (discontinuous transmission) / CNG — enable comfort-noise so silent periods do not use full bandwidth.
	- Disable/avoid simulcast or high-res layers for low-data mode.

Implementation note: these SDP edits are applied in `VoiceSystem` before completing the `setLocalDescription()` step. They are low-risk changes for voice-only use-cases but degrade fidelity if the user switches to music or high-fidelity audio.

2) Topology and bandwidth math (mesh P2P vs SFU)
- Mesh (current P2P approach): every peer maintains a direct PeerConnection to each other peer. If the per-stream encoded bitrate is `R` kbps and there are `P` participants, upstream per-user ≈ R * (P-1) kbps.
	- Example: `R = 20 kbps`, `P = 6` → upstream ≈ 20 * 5 = 100 kbps per participant.
	- Teacher with 25 students and `R = 20 kbps` → upload ≈ 20 * 24 = 480 kbps (likely impractical on 2G).
- SFU approach: each participant uploads one stream (R kbps). The SFU forwards/downmixs to listeners. Upstream per-user ≈ R kbps independent of `P`.
	- Example: `R = 20 kbps` → everyone uploads 20 kbps regardless of class size; server bears distribution bandwidth.

Recommendation: for classes > ~8 participants, an SFU dramatically reduces participant upstream needs. For 2G/3G deployments, using an SFU (or at least selectively using SFU for the teacher) is the most scalable way to keep per-user data low while supporting many students.

3) TURN and NAT traversal (practical reliability)
- STUN alone works when NATs are permissive, but restrictive NATs or carrier-grade NAT on mobile networks often require a TURN relay for reliable connectivity. TURN forwards media through a server and therefore consumes server bandwidth (uplink+downlink).
- Recommendation: include a small, low-cost TURN pool as a fallback for connections that cannot form direct P2P. Metering TURN usage and enabling it only for failed ICE paths reduces cost.

4) Whiteboard / presentation sync internals (how to keep bytes low)
- Canvas sizing: the client uses three profiles (strict low, low, default). Lower resolutions produce much smaller data URLs for image snapshots.
- Throttling: strokes are emitted with `emitIntervalMs` and distance thresholds. Lower-frequency emission (e.g., 200–500 ms) and chunked snapshots during idle periods reduce bursts.
- Batching & replay: remote stroke batches are stored and applied in groups to avoid many small redraws; use incremental checksum or versioning to avoid replay duplicates.

Concrete tuning suggestions:
- `emitIntervalMs` (teacher client) = 300 ms for strict low-data; 150 ms for low data.
- Snapshot chunk size = no more than 64 KB per chunk over unreliable links; reassemble on client with sequence numbers.

5) 3D asset & renderer strategies (practical steps you can adopt)
- Lazy-load textures and heavy meshes only after user taps to "Load classroom".
- Provide LOD (level-of-detail) for avatars and furniture; swap to a simple billboard or single-quad avatar when in low-data mode.
- Use compressed texture formats (ETC1/2 or JPEG) and low-resolution thumbnails for profile images.
- Reduce renderer resolution (CSS/renderer size) and apply `renderer.setPixelRatio(0.5)` or similar for constrained devices.

6) Example device/network scenarios (quick reference)
- Strict 2G, single-teacher + 10 students: set audio `R = 12 kbps`, `emitIntervalMs = 400 ms`, disable 3D load. Teacher upstream (mesh) = 12 * 9 = 108 kbps — still risky if mobile uplink is <100 kbps. Better: switch teacher to single SFU uplink ~12 kbps.
- Slow 3G, 1:1 tutoring: mesh works fine with `R = 24 kbps`, small canvas updates, and occasional image slides (precompressed).

7) Measurable knobs to expose in the UI (for teachers / admins)
- `Low-data mode` (boolean): enforces audio-only, disables 3D, forces `emitIntervalMs >= 300`, and caps audio bandwidth at 12–24 kbps.
- `Presentation mode (precompressed)`: forces slide uploads as compressed JPEG (max size 300 KB).
- `SFU mode` toggle (admin): routes teacher uplink to SFU when class size > threshold.

8) Quick diagnostic & benchmark plan (how to verify)
- Build a small browser script that measures upload/download throughput and ping over the user's current link (30s of repeated PUT to test endpoint) and uses results to auto-suggest `Low-data mode`.
- Sample check: if measured upload < 150 kbps, suggest `Low-data mode` and SFU for teachers.

9) Security & privacy notes
- If adding TURN or SFU, ensure media traffic passes over TLS and that the TURN credentials are short-lived tokens.

10) Implementation checklist for engineers who want to harden for 2G
- Add server-side SFU option (Janus/mediasoup/freeSWITCH) or a managed SFU provider.
- Add optional TURN and rate-limiting on server for abusive usage.
- Expose `Low-data mode` as a client preference and persist choice per user.
- Add telemetry counters for emitted bytes-per-minute per role (teacher vs student) to evaluate real-world bandwidth.

End of detailed technical expansion.

---

## 15) Ports, Topology, Media flow, and Synchronization (technical details)

This section documents concrete runtime ports, network topology, media flow, and the synchronization mechanism used by the app.

Server port and Socket.IO transport
- Server HTTP/Socket.IO port: `process.env.PORT || 3000` (the server listens on the `PORT` env var or defaults to `3000`).
- Socket.IO is mounted on the same HTTP server (no separate media port); default Socket.IO path `/socket.io` and transports include WebSocket (preferred) and long-polling fallback.

Topology (signaling + media)
- Signaling: Socket.IO (WebSocket) carries application events and WebRTC signaling messages. Signaling uses the same server port as the HTTP API/static files and routes (no separate signaling server required).
- Media topology (current implementation): Peer-to-peer mesh for audio. Each participant creates RTCPeerConnection objects to other peers (mesh). This keeps server bandwidth low but increases per-client upstream with class size.
- SFU/TURN: No SFU is used by default. TURN is not required by code but recommended as a fallback (relay) for restrictive NATs; adding TURN provides reliability at the cost of server bandwidth.

How voice is sent
- Local capture: `VoiceSystem.initLocalStream()` uses `getUserMedia({ audio: { ... }, video: false })`. Video is explicitly disabled.
- Constraints & low-bandwidth behavior: for slow networks the client requests low sample rates, `channelCount:1`, and sets `maxaveragebitrate` (e.g., ~8000–16000 bps) in the constraints.
- Peer connections: `RTCPeerConnection` is created per remote peer with ICE servers set to Google STUN servers. Connection options: `bundlePolicy: 'max-bundle'`, `rtcpMuxPolicy: 'require'`, `iceTransportPolicy: 'all'`.
- SDP tuning: on offer/answer the client calls `optimizeSdpForLowBandwidth()` to insert `a=fmtp` OPUS parameters (e.g., `minptime`, `useinbandfec`, `stereo=0`, `maxaveragebitrate`) and `b=AS` caps. The createOffer/createAnswer calls use `offerToReceiveAudio: true, offerToReceiveVideo: false`.
- Signaling messages: the client/server exchange `webrtc-offer`, `webrtc-answer`, and `webrtc-candidate` events via Socket.IO. Server relays these messages to the intended target socket id.

How (video) is handled
- This project does not send/receive camera video streams in the default implementation: `video: false` and offers set `offerToReceiveVideo: false`. Live video streaming is not part of the default media flow.
- Presentation slides/images: instead of camera video, teachers upload slides/images which are sent via `presentation-start` / `presentation-update` Socket.IO events (payloads contain slide metadata and an `image` field). The client renders these images locally rather than streaming video.

Synchronization mechanisms (state + events)
- Movement sync:
	- Client emits `move` with `{ x, z }`.
	- Server receives `move`, updates in-memory `studentPositions`, and emits `student-move-update` and a legacy `update` event to the room.
	- Teachers emit `teacher-move`, server broadcasts `teacher-move-update`.
- Whiteboard sync:
	- Clients emit `blackboard-stroke` objects (batched or throttled by the client).
	- Server appends strokes to `activeSession.blackboardStrokes` and persists them to DB periodically or on stroke events, then broadcasts `blackboard-stroke` to room.
	- On join the server emits `blackboard-snapshot` with the persisted strokes so the newly joined client can replay the board.
	- `blackboard-clear` clears both in-memory and DB copies and emits `blackboard-clear` to participants.
- Presentation sync:
	- Teacher emits `presentation-start` (payload includes initial slide/image), `presentation-update` (index + `image`), and `presentation-stop`.
	- Server stores the `presentation` in the active session and broadcasts updates to room.
- Raise-hand / audio moderation:
	- Students emit `raise-hand` and `request-unmute`.
	- Teacher receives `raise-hand-list` and `unmute-request` events (server forwards) and uses `teacher-set-audio-state` or `audio-state-change` to mute/unmute students.
- Peer lifecycle events:
	- `peer-joined` is emitted when someone connects; `existing-peers` can be requested by a client to get current peers. `peer-left` is emitted on disconnect.

ICE / STUN / TURN
- Client uses Google STUN servers by default (`stun:stun.l.google.com:19302`, `stun1`, `stun2`, `stun3`). These provide server-reflexive candidates.
- If you add TURN for reliability, standard TURN ports are `3478` (UDP/TCP) and `5349` (TLS), and credentials should be ephemeral tokens.
- ICE candidate types observed in the wild: `host`, `srflx` (server reflexive/STUN), and `relay` (TURN). Relay candidates will route media through TURN servers.

Port / firewall notes
- The app requires the HTTP(S) server port (default `3000`) to be reachable by clients for static assets and Socket.IO signaling. If using HTTPS, ensure TLS is configured (port 443) and `process.env.PORT` points accordingly.
- WebRTC peer connections open dynamic UDP/TCP ports for RTP; ICE handles selecting candidates. TURN relay requires access to the TURN server ports mentioned above.

Scaling recommendations
- Small classes (<= ~6–8): mesh P2P audio is usable with low-bitrate SDP tuning.
- Medium/Large classes (> ~8–15): use an SFU for teacher uplink to avoid multiplying upstream bandwidth; add TURN to improve connection reliability on mobile networks.

Examples (concise)
- Signaling flow for a new student:
	1. Client connects to Socket.IO on `https://<host>:<PORT>` and joins room with `roomCode` in handshake.
	2. Server emits `peer-joined` to others and sends `existing-peers` to the new client.
	3. Client creates RTCPeerConnections to peers, creates offers, and sends `webrtc-offer` to targets via Socket.IO.
	4. Targets reply with `webrtc-answer`; ICE candidates are exchanged via `webrtc-candidate`.
	5. On `connected` state, audio flows directly P2P between peers (or via TURN relay when needed).

Quick checklist (network):
- Open `PORT` (default 3000) for HTTP/Socket.IO.
- Allow WebSocket upgrades on that port.
- If using TURN, ensure UDP/TCP 3478 and TLS 5349 are reachable from clients.

End of Ports/Topology/Media+Sync section.

