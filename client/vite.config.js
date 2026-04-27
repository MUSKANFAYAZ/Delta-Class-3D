import { defineConfig } from "vite";

const SOCKET_TARGET = "http://localhost:3000";
const AUTH_TARGET = "http://localhost:3000";

export default defineConfig({
    server: {
        host: "0.0.0.0",
        port: 5173,
        proxy: {
            "/socket.io": {
                target: SOCKET_TARGET,
                ws: true,
            },
            "/auth": {
                target: AUTH_TARGET,
                changeOrigin: true,
            },
        },
    },

});