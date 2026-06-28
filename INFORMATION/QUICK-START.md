# Quick Reference: Local Network Deployment

## 🎯 30-Second Setup

### For Server Machine (Where Backend Runs)
```bash
# 1. Get your IP
ipconfig  # Windows: look for IPv4 Address (e.g., 192.168.1.105)

# 2. Edit server/.env
PORT=3000
MONGO_URI=<your-mongodb-connection-string>
CORS_ORIGIN=http://localhost:5173,http://<client-machine-ip>:5173

# 3. Run backend
cd server && npm install && npm start
```

### For Client Machine (Where You Open the Browser)
```bash
# 1. Edit client/.env.local
VITE_SERVER_URL=http://<server-machine-ip>:3000
VITE_AUTH_API_URL=http://<server-machine-ip>:3000/auth

# 2. Run frontend
cd client && npm install && npm run dev

# 3. Open in browser
http://<server-machine-ip>:5173
```

---

## 📋 Files You Need to Know

### To Configure: Create These Files
| File | Purpose | Template |
|------|---------|----------|
| `server/.env` | Backend config | `server/.env.example` |
| `client/.env.local` | Frontend config | `client/.env.local` (already provided) |

### To Read: Documentation
| File | Topic |
|------|-------|
| `README-LOCAL-NETWORK.md` | Complete deployment guide |
| `DEPLOYMENT-CHECKLIST.md` | Step-by-step checklist |
| `MIGRATION-SUMMARY.md` | Technical details of changes |
| `MODIFIED-FILES-LIST.md` | All files that changed |

### Files That Were Modified
| File | What Changed |
|------|--------------|
| `client/vite.config.js` | Uses env vars for proxy |
| `client/src/socketTransport.js` | Added URL exports |
| `client/src/main.js` | Uses env-based socket URLs |
| `client/src/startup/classroomLoader.js` | Uses env-based socket URLs |
| `client/src/features/dashboard/dashboardPage.js` | Uses env-based socket URLs |
| `server/index.js` | Environment-based CORS |

---

## 🔧 Environment Variables Explained

### Frontend: `VITE_` Prefix Variables
```bash
# VITE_SERVER_URL = Backend server address
# Example: http://192.168.1.105:3000
VITE_SERVER_URL=http://<server-ip>:3000

# VITE_AUTH_API_URL = Auth endpoint (optional)
# Falls back to VITE_SERVER_URL/auth if not set
VITE_AUTH_API_URL=http://<server-ip>:3000/auth

# VITE_SOCKET_TRANSPORT_POLLING = Force polling (for problematic networks)
# Default: false (uses websocket + polling fallback)
VITE_SOCKET_TRANSPORT_POLLING=false
```

### Backend: No Prefix Variables
```bash
# CORS_ORIGIN = Allowed client URLs (comma-separated)
# Example: http://localhost:5173,http://192.168.1.50:5173
CORS_ORIGIN=http://localhost:5173

# PORT = Server port (default: 3000)
PORT=3000

# MONGO_URI = MongoDB connection string
MONGO_URI=mongodb+srv://...

# JWT_SECRET = Authentication secret (use strong value)
JWT_SECRET=your-secret-here

# DEBUG_LOGS = Verbose logging (true/false)
DEBUG_LOGS=false
```

---

## ✅ Quick Checklist (5 Minutes)

- [ ] **Both machines on same Wi-Fi** - Verify by pinging each other
- [ ] **Get server IP** - Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
- [ ] **Create `server/.env`** - Copy from `server/.env.example`, set MONGO_URI
- [ ] **Create `client/.env.local`** - Copy template, set VITE_SERVER_URL
- [ ] **Start backend** - `cd server && npm start` (should show "✓ Server started on port 3000")
- [ ] **Start frontend** - `cd client && npm run dev` (should show network URL)
- [ ] **Open browser** - Navigate to printed URL or `http://<server-ip>:5173`
- [ ] **Test login** - Should work without errors
- [ ] **Check console** - DevTools F12, no red CORS errors
- [ ] **Create classroom** - Teacher creates a test room
- [ ] **Join on same machine** - Or another machine as student

---

## 🐛 Common Issues & Quick Fixes

| Issue | Quick Fix |
|-------|-----------|
| "Cannot GET /" | Wrong port or server not running |
| CORS error | Check CORS_ORIGIN in server/.env |
| "Cannot connect to server" | Wrong IP in VITE_SERVER_URL |
| Socket.IO polls only | Network may block websockets (add `VITE_SOCKET_TRANSPORT_POLLING=true`) |
| WebRTC video fails | Firewall may block UDP; contact network admin |
| "MongoDB connection failed" | Check MONGO_URI is correct |

---

## 🎓 Understanding the Changes

### Before (Hardcoded)
```javascript
// vite.config.js
const SOCKET_TARGET = "http://localhost:3000";
const AUTH_TARGET = "http://localhost:3000";

// Only worked for localhost, not network
```

### After (Environment-Based)
```javascript
// vite.config.js
const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
// Works for localhost, 192.168.x.x, Railway URLs, anything!
```

### Result
```
Same code runs on:
✅ Localhost (development)
✅ Local network (192.168.1.105:3000)
✅ Railway (https://your-app.railway.app)
✅ Any deployment - just change .env file!
```

---

## 📊 What Works Over Local Network

| Feature | Status |
|---------|--------|
| 3D Classroom | ✅ Works great |
| Real-time Chat | ✅ Works great |
| Voice Communication | ✅ Works great |
| Video Conferencing | ✅ Works great |
| Whiteboard | ✅ Works great |
| Polls | ✅ Works great |
| Socket.IO Live Sync | ✅ Works great |
| Authentication | ✅ Works great |
| Classroom Management | ✅ Works great |

---

## 🌐 IP Address Discovery

### Windows (Server Machine)
```cmd
ipconfig

# Look for section with your Wi-Fi name
# Find "IPv4 Address: 192.168.x.x"
```

### Mac (Server Machine)
```bash
ifconfig en0
# or
hostname -I
```

### Linux (Server Machine)
```bash
ifconfig
# or
hostname -I
```

### Verify Connection (From Client)
```bash
ping 192.168.1.105
# Should see replies - means network connection works
```

---

## 🚀 Deployment Paths

### Local Network (Two Laptops)
```
Client Laptop → Browser → http://<server-ip>:5173
                          ↓
                    Vite Dev Server (5173)
                          ↓
                    Backend Server (3000)
                          ↓
                    MongoDB Database
```

### Railway (Cloud)
```
Client Browser → https://<railway-frontend-url>
                          ↓
                    Vite Production Build
                          ↓
                    Railway Backend
                          ↓
                    MongoDB Atlas
```

**Key:** Just change `.env` files - same code works both ways!

---

## 📞 Getting Help

### 1. Check Console
```
Browser: F12 → Console tab (look for red errors)
Backend: Look at terminal output
```

### 2. Enable Debug Logs
```bash
# server/.env
DEBUG_LOGS=true

# Restart backend, look for extra log lines
```

### 3. Test Connectivity
```bash
# From client machine
ping <server-ip>  # Should work
curl http://<server-ip>:3000/health  # Should return JSON
```

### 4. Read Troubleshooting
- See `README-LOCAL-NETWORK.md` → Troubleshooting section
- Covers: CORS, Socket.IO, WebRTC, MongoDB issues

### 5. Check Configuration
- Verify all environment variables are set correctly
- Check that both machines are on the same Wi-Fi network
- Make sure firewall isn't blocking ports 3000, 5173, or UDP

---

## 🎯 Key Files Changed

### Frontend Socket Configuration
- `client/src/socketTransport.js` - URL & path helpers
- `client/src/main.js` - Main app socket creation
- `client/vite.config.js` - Dev proxy configuration

### Backend CORS Configuration
- `server/index.js` - CORS origin parsing & setup

### Configurations Added
- `client/.env.local` - Frontend config
- `server/.env` - Backend config

---

## ⏱️ Typical Timeline

| Step | Time |
|------|------|
| Read documentation | 5-10 min |
| Configure files | 2-3 min |
| Start servers | 1-2 min |
| First test | 1-2 min |
| Feature testing | 5-10 min |
| **Total** | **~15-30 min** |

---

## 📝 Sample Configuration

### Server Machine (192.168.1.105)
```bash
# server/.env
CORS_ORIGIN=http://localhost:5173,http://192.168.1.50:5173
PORT=3000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/delta-class-3d
JWT_SECRET=super-secret-key-change-this
DEBUG_LOGS=true
```

### Client Machine (192.168.1.50)
```bash
# client/.env.local
VITE_SERVER_URL=http://192.168.1.105:3000
VITE_AUTH_API_URL=http://192.168.1.105:3000/auth
VITE_SOCKET_TRANSPORT_POLLING=false
```

---

**Last Updated:** June 25, 2026  
**Status:** ✅ Ready to Deploy
