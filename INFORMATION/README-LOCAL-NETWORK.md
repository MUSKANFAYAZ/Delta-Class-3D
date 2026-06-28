# Delta-Class-3D: Local Network Deployment Guide

This guide explains how to run Delta-Class-3D on a local network for demonstration on two laptops connected to the same Wi-Fi.

## Overview

The project has been updated to support both **Railway cloud deployment** and **local network deployment** using environment variables.

### Key Changes
- Frontend uses `VITE_SERVER_URL` and `VITE_AUTH_API_URL` environment variables
- Backend listens on `0.0.0.0` and accepts connections from any network interface
- CORS is configurable via `CORS_ORIGIN` environment variable
- Service worker registration only happens in production to avoid caching issues during development

---

## Prerequisites

### System Requirements
- **Node.js** 16+ (LTS recommended)
- **MongoDB** database (local or cloud)
- Two laptops/computers on the **same Wi-Fi network**
- Basic command line knowledge

### Installation
1. Clone the repository
2. Install backend dependencies: `cd server && npm install`
3. Install frontend dependencies: `cd ../client && npm install`

---

## Finding IP Addresses

**On Windows (Server Machine):**
```bash
ipconfig
```
Look for "IPv4 Address" under your active network connection (e.g., `192.168.1.105`)

**On Mac/Linux (Server Machine):**
```bash
ifconfig
# or
hostname -I
```

**Verify connectivity from client machine:**
```bash
ping <server-ip>  # Should respond with replies
```

---

## Local Network Deployment Setup

### Step 1: Configure Environment Variables

#### Backend Server (.env file)
```bash
# server/.env

CORS_ORIGIN=http://localhost:5173,http://<client-machine-ip>:5173
PORT=3000
MONGO_URI=<your-mongodb-uri>
JWT_SECRET=<your-strong-secret-key>
DEBUG_LOGS=true
```

**CORS_ORIGIN:** Comma-separated list of allowed client URLs
- `http://localhost:5173` - if running frontend on the same machine
- `http://<client-ip>:5173` - if running frontend on a different machine

#### Frontend Client (.env.local file)
```bash
# client/.env.local

VITE_SERVER_URL=http://<server-machine-ip>:3000
VITE_AUTH_API_URL=http://<server-machine-ip>:3000/auth
VITE_SOCKET_TRANSPORT_POLLING=false
```

**Examples:**
- Server at `192.168.1.105`: `VITE_SERVER_URL=http://192.168.1.105:3000`
- Polling-only (for problematic networks): `VITE_SOCKET_TRANSPORT_POLLING=true`

### Step 2: Start the Backend Server

```bash
cd server
npm install  # if not already done
npm start
```

**Expected output:**
```
✓ Server started on port 3000
✓ MongoDB connected to database: delta-class-3d
```

### Step 3: Start the Frontend Development Server

```bash
cd client
npm install  # if not already done
npm run dev
```

**Expected output:**
```
VITE v... dev server running at:
➜ Local: http://localhost:5173/
➜ Network: http://<your-machine-ip>:5173/
```

### Step 4: Access from Client Machine

Open a browser on the client machine and navigate to:
```
http://<server-machine-ip>:5173
```

---

## Features Working Over Local Network

✅ **WebRTC** - Real-time 3D video conferencing (peer-to-peer)
✅ **Socket.IO** - Live sync between students and teachers
✅ **Chat** - Real-time messaging via Socket.IO
✅ **Voice Communication** - WebRTC audio streaming
✅ **Polls** - Real-time voting and results
✅ **Whiteboard** - Collaborative drawing with live updates
✅ **Classroom Management** - Student join requests, approvals, room codes

### Network Requirements
- **Low Latency:** Recommended for real-time features to work smoothly
- **Bandwidth:** ~1-2 Mbps per connection for 1080p video
- **WebRTC Support:** Modern browsers with WebRTC enabled
- **Firewall:** May need to allow UDP ports for WebRTC

---

## Troubleshooting

### Issue: "Cannot connect to server"
**Solution:**
1. Verify server IP: `ping <server-ip>` from client machine
2. Ensure backend is running on port 3000
3. Check firewall isn't blocking port 3000
4. Verify `VITE_SERVER_URL` is correct (include `http://` prefix)

### Issue: "CORS error in browser console"
**Solution:**
1. Check `CORS_ORIGIN` in backend `.env` includes client URL
2. Ensure the URL includes `http://` and correct port
3. Restart backend server after changing `.env`

### Issue: "Socket.IO connection fails, falls back to polling"
**Solution:**
1. WebSockets may be blocked on your network
2. Option A: Set `VITE_SOCKET_TRANSPORT_POLLING=true` on client (slower but works)
3. Option B: Check network firewall rules for TCP port blocking

### Issue: "WebRTC/video not working"
**Solution:**
1. Verify both machines can see each other: `ping <other-machine-ip>`
2. Check browser allows camera/microphone access
3. Some networks block peer-to-peer UDP traffic - contact network admin

### Issue: "Server shows 'MongoDB connection failed'"
**Solution:**
1. Verify MongoDB is running and accessible
2. Check `MONGO_URI` is correct (connection string should start with `mongodb://` or `mongodb+srv://`)
3. Ensure MongoDB credentials are correct

---

## Switching Between Deployments

### To Railway Deployment
1. Update `client/.env.local`:
   ```
   VITE_SERVER_URL=https://<railway-deployment-url>
   VITE_AUTH_API_URL=https://<railway-deployment-url>/auth
   ```
2. Rebuild and redeploy

### Back to Local Network
1. Revert `client/.env.local` to local IP addresses
2. Restart frontend dev server

---

## Production Considerations

For production deployment to Railway or other cloud platforms:

1. **Service Worker Caching:** Already configured to only register in production
   - Development mode skips service worker registration
   - Production builds automatically register for offline support

2. **HTTPS:** Railway provides HTTPS; local network uses HTTP (acceptable for local dev)

3. **Environment Variables:** Use platform-specific configuration (Railway environment dashboard)

4. **Database:** Use MongoDB Atlas or similar managed service

5. **Security:** 
   - Use strong JWT_SECRET
   - Enable HTTPS in production
   - Restrict CORS_ORIGIN to specific domains

---

## File Structure Reference

```
Delta-Class-3D/
├── client/
│   ├── .env.example         # Example environment variables
│   ├── .env.local           # Local configuration (git-ignored)
│   ├── vite.config.js       # Updated to use env variables
│   └── src/
│       ├── socketTransport.js   # Socket URL & transport helper
│       ├── main.js              # Uses VITE_SERVER_URL
│       └── ...
├── server/
│   ├── .env.example         # Example environment variables
│   ├── .env.local           # Local configuration (git-ignored)
│   ├── index.js             # CORS configuration
│   └── config/
│       └── server.js        # Configuration loading
└── README-LOCAL-NETWORK.md  # This file
```

---

## Support & Debugging

**Enable verbose logging:**
1. Backend: Set `DEBUG_LOGS=true` in `.env`
2. Frontend: Open browser DevTools (F12) → Console tab

**Check network connectivity:**
```bash
# From client machine to server
ping <server-ip>
telnet <server-ip> 3000  # or curl http://<server-ip>:3000/health
```

---

## Additional Resources

- [Vite Network Documentation](https://vitejs.dev/guide/ssr.html#setting-up-the-dev-server)
- [Socket.IO Client Configuration](https://socket.io/docs/v4/client-api/)
- [WebRTC Peer Connection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [MongoDB Connection String](https://docs.mongodb.com/manual/reference/connection-string/)

---

Last Updated: June 2026
