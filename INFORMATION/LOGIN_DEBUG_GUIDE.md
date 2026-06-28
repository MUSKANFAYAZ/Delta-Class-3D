# Login Debug Guide - "Failed to fetch" Issue

## Root Cause Analysis

The "Failed to fetch" error when logging in from another device is caused by one or more of the following:

1. **MongoDB Connection Timeout (FIXED)**: The server was not waiting for MongoDB to connect before accepting requests, causing login queries to timeout.
2. **Environment Variables Not Loading (FIXED)**: The server wasn't loading `.env.local` properly.
3. **Insufficient Logging**: No visibility into whether requests reach the backend or fail at the frontend level.

## Changes Made

### 1. **Backend Server Startup Order** (`server/index.js`)
- **Issue**: Server was calling `server.listen()` immediately, before MongoDB connected.
- **Fix**: Wrapped `server.listen()` inside `mongoose.connect().then()` so the server only starts after DB connects.
- **Result**: Prevents "buffering timed out" errors during login.

### 2. **Environment Variable Loading** (`server/index.js`)
- **Issue**: `require("dotenv").config()` wasn't finding `.env.local` reliably.
- **Fix**: Added explicit path resolution to load `.env.local` if it exists:
  ```javascript
  const dotenvPath = fs.existsSync(path.join(__dirname, ".env.local"))
    ? path.join(__dirname, ".env.local")
    : path.join(__dirname, ".env");
  require("dotenv").config({ path: dotenvPath });
  ```
- **Result**: `MONGO_URI` is now always available at startup.

### 3. **Enhanced Frontend API Logging** (`client/src/main.js`)
- **Added**: Comprehensive console logs for every fetch request:
  ```javascript
  console.log("[API] Request:", { method, url, tokenPresent, body });
  console.log("[API] Response received:", { method, url, status, statusText });
  console.error("[API] Fetch error:", { method, url, error });
  console.error("[API] Request failed:", { method, url, status, errorMsg, data });
  console.log("[API] Request successful:", { method, url, dataKeys });
  ```
- **Added**: Startup log showing resolved API configuration:
  ```javascript
  console.log("[STARTUP] Frontend Environment Config:", {
    VITE_SERVER_URL,
    VITE_AUTH_API_URL,
    resolvedAuthApiUrl,
    authBaseUrl,
  });
  ```
- **Result**: You can now see in the browser console exactly which URL failed and why.

### 4. **Enhanced Backend Auth Logging** (`server/routes/auth.js`)
- **Added**: Detailed login request logging:
  ```javascript
  console.log("[AUTH/login] Origin:", req.get("origin"));
  console.log("[AUTH/login] Host:", req.get("host"));
  console.log("[AUTH/login] Method:", req.method);
  console.log("[AUTH/login] Path:", req.path);
  console.log("[AUTH/login] Body:", { phone, role, passwordLength });
  ```
- **Added**: Success/failure tracking:
  ```javascript
  console.log("[AUTH/login] ✓ LOGIN SUCCESSFUL for user:", user._id);
  console.error("[AUTH/login] ✗ ERROR:", error?.message);
  ```
- **Result**: Server logs now show exactly where login fails and why.

### 5. **Global HTTP Request Logging** (`server/index.js`)
- **Added**: Middleware to log all HTTP requests:
  ```javascript
  console.log("[HTTP]", {
    method, path, origin, host, userAgent, timestamp
  });
  ```
- **Result**: You can verify if requests from remote devices reach the server.

### 6. **CORS Configuration Logging** (`server/index.js`)
- **Added**: Startup log showing CORS allowed origins:
  ```javascript
  console.log("[STARTUP] CORS Configuration:", {
    allowedOrigins,
    corsOrigin: process.env.CORS_ORIGIN,
  });
  ```
- **Result**: Easy verification that CORS allows requests from client IP.

### 7. **Frontend Login Flow Logging** (`client/src/features/auth/login.js`)
- **Added**: Login attempt and result logging:
  ```javascript
  console.log("[LOGIN] Attempting login with:", { phone, role });
  console.log("[LOGIN] ✓ Login successful:", { userName, role });
  console.error("[LOGIN] ✗ Login failed:", error?.message);
  ```
- **Result**: Clear visibility into what the user is attempting and the result.

## How to Debug Login Issues Now

### Step 1: Check Backend Logs
```bash
# Terminal running: npm run dev
# Look for:
# [STARTUP] CORS Configuration: { allowedOrigins, corsOrigin }
# [STARTUP] Frontend Environment Config: { authBaseUrl, ... }
# [HTTP] { method, path, origin, host } <- Shows if request reached server
# [AUTH/login] Origin: http://10.24.120.246:5173
# [AUTH/login] ✓ LOGIN SUCCESSFUL or ✗ ERROR
```

### Step 2: Check Frontend Console Logs
```javascript
// Open browser DevTools (F12) → Console tab
// Look for:
// [STARTUP] Frontend Environment Config: { authBaseUrl: "http://10.24.120.246:3000/auth" }
// [LOGIN] Attempting login with: { phone, role }
// [API] Request: { method: "POST", url: "http://10.24.120.246:3000/auth/login", ... }
// [API] Response received: { status: 200 } OR [API] Fetch error: { error }
```

### Step 3: Common Issues and Solutions

| Symptom | Cause | Check In Console |
|---------|-------|------------------|
| "Failed to fetch" | Network/CORS issue | `[API] Fetch error` in browser console |
| Request doesn't reach backend | Proxy not working from different device | No `[HTTP]` log on server |
| Origin mismatch error | Wrong CORS origin | `[STARTUP] CORS Configuration` on server |
| 404 "User not found" | Phone number not registered | `[AUTH/login] User not found` on server |
| 401 "Wrong password" | Incorrect password | `[AUTH/login] Wrong password` on server |
| 500 "Login failed" | MongoDB connection issue | Check `✓ MongoDB Connected` on server startup |

## Verification Checklist

- [ ] Backend starts and shows: `✅ MongoDB Connected`
- [ ] Backend shows: `[STARTUP] CORS Configuration: { allowedOrigins: "*" }`
- [ ] Frontend shows: `[STARTUP] Frontend Environment Config: { authBaseUrl: "http://10.24.120.246:3000/auth" }`
- [ ] When you attempt login, backend shows: `[HTTP] { method: "POST", path: "/auth/login" }`
- [ ] Login succeeds and backend shows: `[AUTH/login] ✓ LOGIN SUCCESSFUL`
- [ ] Frontend shows: `[LOGIN] ✓ Login successful: { userName, role }`

## Files Modified

1. **server/index.js** - Fixed startup order, env loading, added logging
2. **server/routes/auth.js** - Enhanced login endpoint logging
3. **client/src/main.js** - Added comprehensive API request/response logging
4. **client/src/features/auth/login.js** - Added login flow logging

## Next Steps to Test

1. **Restart the server**: `npm run dev` in `Delta-Class-3D/server`
2. **On another device**, open the frontend at `http://10.24.120.246:5173`
3. **Open browser DevTools** (F12)
4. **Try to login**
5. **Capture both**:
   - Browser console logs (showing frontend request)
   - Server terminal logs (showing backend received it)
6. **Share the logs** if still encountering issues

## Expected Behavior After Fixes

✅ **Login from another device should now work:**
- Frontend sends POST to `http://10.24.120.246:3000/auth/login`
- CORS allows it (origin: `http://10.24.120.246:5173`)
- Backend receives request and validates credentials
- Backend returns token and user data
- Frontend stores token and redirects to main page
- **No "Failed to fetch" error**

If you still see "Failed to fetch", the console logs will now tell you exactly why!
