import { defineConfig } from "vite";

const SOCKET_TARGET = process.env.VITE_SOCKET_PROXY_TARGET || "http://localhost:3000";
const AUTH_TARGET = process.env.VITE_AUTH_PROXY_TARGET || "http://localhost:3001";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // Proxy Socket.IO in dev so client and server can run concurrently.
      "/socket.io": {
        target: SOCKET_TARGET,
        ws: true,
      },
      // Proxy auth APIs in dev.
      "/auth": {
        target: AUTH_TARGET,
        changeOrigin: true,
      },
    },
  },
});
