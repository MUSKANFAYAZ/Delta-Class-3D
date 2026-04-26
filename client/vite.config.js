import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ["three", "socket.io-client"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      // Proxy Socket.IO in dev so client and server can run concurrently.
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
