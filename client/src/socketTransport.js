export const socketTransports = (() => {
  const forcePolling = String(import.meta.env.VITE_SOCKET_TRANSPORT_POLLING || "").trim().toLowerCase() === "true";
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isRailway = host.endsWith(".railway.app") || host.endsWith(".railway.app.");

  if (forcePolling || isRailway) {
    console.debug("[socketTransport] Using polling-only transport for Railway or forced polling.");
    return ["polling"];
  }

  return ["websocket", "polling"];
})();
