import { defineConfig, loadEnv } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const serverUrl = String(env.VITE_SERVER_URL || "http://localhost:3000").replace(/\/+$/, "");
  const authTarget = String(env.VITE_AUTH_API_URL || serverUrl).replace(/\/+$/, "");
  const useHttps = String(env.VITE_DEV_HTTPS || "true").trim().toLowerCase() !== "false";

  return {
    plugins: useHttps ? [basicSsl()] : [],
    server: {
      host: "0.0.0.0",
      port: 5173,
      https: useHttps,
      proxy: {
        "/socket.io": {
          target: serverUrl,
          ws: true,
          changeOrigin: true,
          secure: false,
        },
        "/auth": {
          target: authTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
