const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "delta-class3d-dev-secret";

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function signOtpToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "10m" });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ message: "Missing token" });
  try {
    req.user = verifyToken(match[1]);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = { signAccessToken, signOtpToken, verifyToken, authMiddleware };

