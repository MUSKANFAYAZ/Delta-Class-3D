const express = require("express");

module.exports = function createHealthRouter({ mongoose, User }) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get("/health/db", async (_req, res) => {
    try {
      const isConnected = mongoose.connection.readyState === 1;
      const dbName = mongoose.connection.name;
      if (!isConnected) {
        return res.status(503).json({ ok: false, message: "MongoDB not connected", readyState: mongoose.connection.readyState });
      }

      const userCount = await User.countDocuments();
      return res.json({
        ok: true,
        message: "Database connected",
        database: dbName,
        userCount,
        readyState: mongoose.connection.readyState,
      });
    } catch (error) {
      console.error("[/health/db] Error:", error?.message);
      return res.status(503).json({ ok: false, message: "Database error", detail: error?.message });
    }
  });

  return router;
};
