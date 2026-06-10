const DEBUG_LOGS = String(process.env.DEBUG_LOGS || "").toLowerCase() === "true";
const PORT = process.env.PORT || 3000;
const MAX_STUDENT_SLOTS = 25;

const CRITICAL_ENV_VARS = {
  JWT_SECRET: process.env.JWT_SECRET || "delta-class3d-dev-secret",
  MONGO_URI: process.env.MONGO_URI,
};

module.exports = {
  DEBUG_LOGS,
  PORT,
  MAX_STUDENT_SLOTS,
  CRITICAL_ENV_VARS,
};
