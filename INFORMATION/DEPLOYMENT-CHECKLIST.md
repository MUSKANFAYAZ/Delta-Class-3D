# Local Network Deployment Checklist

## Prerequisites Checklist
- [ ] Both machines on same Wi-Fi network
- [ ] Node.js 16+ installed on both machines
- [ ] MongoDB running (get connection string)
- [ ] Server machine IP address noted (e.g., `192.168.1.105`)
- [ ] Client machine IP address noted (if different)

## Backend Setup
```bash
cd server
npm install
```

- [ ] Create `.env` file (copy from `.env.example`)
- [ ] Set `MONGO_URI=<your-mongodb-connection-string>`
- [ ] Set `PORT=3000`
- [ ] Set `CORS_ORIGIN=http://localhost:5173,http://<client-ip>:5173`
- [ ] Set `JWT_SECRET=<strong-random-string>`
- [ ] Start server: `npm start`
- [ ] Verify output shows: "✓ Server started on port 3000"
- [ ] Test health endpoint: `http://<server-ip>:3000/health`

## Frontend Setup
```bash
cd ../client
npm install
```

- [ ] Create `.env.local` file (copy from `.env.example`)
- [ ] Set `VITE_SERVER_URL=http://<server-ip>:3000`
- [ ] Set `VITE_AUTH_API_URL=http://<server-ip>:3000/auth`
- [ ] Start dev server: `npm run dev`
- [ ] Verify output shows network URL
- [ ] Note the network URL (e.g., `http://192.168.1.105:5173`)

## Client Machine Testing
- [ ] Ping server machine: `ping <server-ip>` ✓ Replies received
- [ ] Open browser on client
- [ ] Navigate to: `http://<server-ip>:5173`
- [ ] Page loads without CORS errors
- [ ] Login page appears
- [ ] Open browser DevTools (F12) → Console
- [ ] No red errors visible

## Feature Testing
- [ ] **Authentication:** Login succeeds
- [ ] **Dashboard:** Classroom list loads
- [ ] **Socket.IO:** Console shows "Live sync connected"
- [ ] **Create Classroom:** Teacher creates room
- [ ] **Join Classroom:** Student joins and sees 3D environment loading
- [ ] **Video/Audio:** Both parties see video feed
- [ ] **Chat:** Messages sync in real-time
- [ ] **Whiteboard:** Drawing appears on both screens
- [ ] **Polls:** Poll creation and voting works
- [ ] **Voice Mesh:** Multiple voice participants can speak simultaneously

## Troubleshooting Steps (if issues occur)
- [ ] Check server logs: Look for errors
- [ ] Check frontend console (DevTools): Look for CORS errors
- [ ] Verify IP addresses are correct in both `.env` files
- [ ] Try setting `VITE_SOCKET_TRANSPORT_POLLING=true` if websockets fail
- [ ] Ensure firewall allows port 3000 (backend) and 5173 (frontend)
- [ ] Try restarting both server and frontend
- [ ] For WebRTC issues: Check if browser allows camera/mic

## Production Deployment (Railway)
To deploy to Railway instead:
1. Update `client/.env.local`:
   - `VITE_SERVER_URL=https://<railway-url>`
2. Follow Railway deployment guide for backend
3. Database migrations handled automatically

## Quick Reference: Get Your IP
**Windows (Server):**
```
ipconfig
```
Look for "IPv4 Address" (e.g., 192.168.1.105)

**Mac/Linux (Server):**
```
ifconfig
```
Look for "inet" address (e.g., 192.168.1.105)

**Test Connection:**
```
ping 192.168.1.105  # Replace with your server IP
```

---
**Estimated Setup Time:** 10-15 minutes (after dependencies installed)
