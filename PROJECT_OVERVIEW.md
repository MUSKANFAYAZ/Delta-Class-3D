# Delta-Class-3D — Project Overview

This document describes the project purpose, directory → file map, pages and user flows, real-time/socket behavior, algorithms used, deployment/runtime resource estimates (CPU/RAM/network), and short deployment notes.

## Problem Statement
Provide a collaborative 3D classroom where teachers and students join by room code, interact in a shared 3D scene (student movement), share a blackboard, present slides, raise hands, and use audio via WebRTC — with authentication and persistence of classrooms/users in MongoDB.

## High-Level Solution
- Monorepo: single `npm` project with a `server` (Express + Socket.IO + Mongoose) and `client` (Vite + Three.js + socket.io-client + React-like SPA).
- Server serves built static `client/dist` and handles REST auth routes plus Socket.IO real-time events and WebRTC signalling.
- MongoDB (Atlas) stores `User` and `Classroom` models; JWT + bcrypt used for authentication.

## Directory → File Map (key files)
- [package.json](Delta-Class-3D/package.json) — monorepo scripts: `npm run build`, `npm start`.
- [client/package.json](Delta-Class-3D/client/package.json) — frontend deps (Vite, three, socket.io-client, firebase).
- [client/vite.config.js](Delta-Class-3D/client/vite.config.js) — dev proxy settings to backend during local dev.
- `client/dist/` — production build output (served statically by server).
- [server/package.json](Delta-Class-3D/server/package.json) — backend deps: express, socket.io, mongoose, bcrypt, jsonwebtoken.
- [server/index.js](Delta-Class-3D/server/index.js) — server entry: Express app, static serving, health endpoints, MongoDB connection, Socket.IO bootstrapping.
- [server/socketHandlers.js](Delta-Class-3D/server/socketHandlers.js) — Socket.IO event handlers (connection, move, blackboard, webrtc signaling, audio state, raise-hand, presentation, disconnect).
- [server/routes/auth.js](Delta-Class-3D/server/routes/auth.js) — auth endpoints (register/login) using bcrypt + JWT.
- [server/models/Classroom.js](Delta-Class-3D/server/models/Classroom.js) — classroom schema and persistence.
- [server/models/User.js](Delta-Class-3D/server/models/User.js) — user schema.
- [railway.json](Delta-Class-3D/railway.json) — example deploy manifest; Render will use `npm run build` + `npm start`.

(If you want, I can add links to other client source files such as `client/src/App.*` once you confirm they exist.)

## Pages / SPA Views (what users see)
Note: the frontend is an SPA; URLs map to views rather than separate HTML files.
- Landing / Home: entry, sign-in/register links.
- Auth pages: register / login (calls `/auth` REST endpoints).
- Teacher Dashboard: create classroom, manage schedule/capacity.
- Join Classroom: enter room code (validated by `ROOM_CODE_REGEX`).
- Classroom View (3D scene): teacher + students avatars, movement, assigned student slots, teacher view controls.
- Presentation Overlay: teacher slides broadcast via `presentation-start` / `presentation-update` socket events.
- Blackboard: live drawing strokes shared via `blackboard-stroke` and `blackboard-clear` events.

## Socket / Realtime Details (concise)
- Transport: `Socket.IO` (WebSocket fallback) on server — event names defined in `server/socketHandlers.js`.
- Key events (server emits / listens):
  - `connection` / `disconnect` — socket lifecycle.
  - `join-room` / `leave-room` (or similar) — socket joins a room channel (roomCode).
  - `move` → server broadcasts `student-move-update` and `update` to room.
  - `teacher-move` → server broadcasts `teacher-move-update`.
  - `blackboard-stroke`, `blackboard-clear` → broadcast strokes / clears.
  - `presentation-start`, `presentation-update`, `presentation-stop` → presentation lifecycle.
  - `raise-hand`, `raise-hand-list`, `clear-raise-hand` → teacher-side moderation.
  - WebRTC signalling: `webrtc-offer`, `webrtc-answer`, `webrtc-candidate` → server forwards signaling messages so peers establish P2P media.
  - Audio-state events: `audio-state-change`, `request-unmute`, `unmute-request`.
- State: server keeps an in-memory `activeClassrooms` map for session state (assignments, positions, teacher sockets), and persists canonical data in MongoDB.

## Algorithms / Core Logic
- Room code validation: regex `ROOM_CODE_REGEX`.
- Slot assignment: `getNextAvailableSlot(classroom)` scans `MAX_STUDENT_SLOTS` and assigns lowest free slot index.
- State snapshot broadcast: `broadcastSnapshot` iterates active session maps and emits current positions/assignments.
- Persistence: `getOrCreateClassroom(code)` reads or creates a Classroom document in MongoDB.
- WebRTC: server acts as signaling relay only (not SFU), using `webrtc-offer/answer/candidate` messages.
- Authentication: `bcrypt` for password hashing, JWT for auth tokens validated by `authMiddleware`.

## Performance / Resource Estimates
- Server role: primarily signaling, small state updates, some DB reads/writes. Heavy work (3D rendering) is client-side in users' browsers.
- CPU:
  - Light load (single classroom, ≤25 users): <5% CPU on 1 vCPU for event handling.
  - Moderate load (several concurrent rooms, many connections): 1–2 vCPU recommended.
- RAM:
  - Minimum: 512 MB–1 GB (small test deployments).
  - Recommended: 2 GB for production with multiple rooms.
  - Larger-scale: 4+ GB if you expect many concurrent rooms and want headroom.
- Network / Bandwidth:
  - Signaling traffic (Socket.IO) is tiny: a few KB per user per minute for movement/blackboard events.
  - WebRTC media (if P2P): server is not relaying media — bandwidth is peer-dependent. Typical audio: 20–100 kbps per user; video (if used): 300 kbps–2 Mbps depending on resolution. If you switch to media relay (SFU), server bandwidth and CPU would increase considerably.
- Storage: MongoDB Atlas for persistent data; disk usage minimal unless you store large media.

## Time Estimates
- Local development setup (clone, install): 5–15 minutes (depends on network for `npm install`).
- Build time (Vite + npm install): 2–6 minutes typically.
- Typical restart/deploy time on Render: 2–8 minutes.
- Feature dev time (small changes, e.g., new socket event): 30–120 minutes.

## Deployment Notes (quick)
- REQUIRED env var: `MONGO_URI` (set to your MongoDB Atlas connection string). See [server/index.js](Delta-Class-3D/server/index.js#L596-L620).
- Build: root `npm run build` installs server + client deps and produces `client/dist`.
- Start: `npm start` runs `node server/index.js` and serves the static files + sockets.
- Recommended: set `NODE_ENV=production` and `PORT` via the host.

## Security & Scaling Considerations
- Authentication: JWT expiry and refresh; protect socket endpoints by validating tokens in `socket.handshake` where needed.
- Rate limiting: consider limiting frequent events (e.g., movement updates) to avoid abuse.
- Scaling Socket.IO: for multi-instance horizontally scaled deployments, use a Redis adapter to share socket rooms across instances.
- Backups: enable MongoDB backups, and avoid storing large binary blobs in DB.

## Next Steps I can do for you (pick any)
- Add this file to the repo (done) and commit + push it.
- Create a step-by-step Render deployment checklist and env var setup.
- Add `README` sections linked from `server` and `client` folders.

---

*File created at repo root: `PROJECT_OVERVIEW.md`.*
