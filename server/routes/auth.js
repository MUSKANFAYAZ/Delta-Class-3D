const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const { signAccessToken, authMiddleware } = require("../lib/auth");

const router = express.Router();

function normalizePhone(raw) {
  const value = String(raw || "").replace(/\s+/g, "");
  if (!value) return "+91";
  if (value.startsWith("+")) return value;
  if (/^\d{10}$/.test(value)) return `+91${value}`;
  return value;
}

function isValidPhoneWithCode(phone) {
  // Example: +911234567890 (country code + 10-digit number)
  return /^\+\d{1,3}\d{10}$/.test(phone);
}


router.post("/register", async (req, res) => {
  try {
    const { name, password, role, studentClass, userId } = req.body || {};
    const phone = normalizePhone(req.body.phone);
    const safeName = String(name || "").trim();
    const safePassword = String(password || "");
    const safeClass = String(studentClass || "").trim();

    console.log("[AUTH/register] Incoming request:", { name: safeName, phone, role, studentClass: safeClass });

    if (!isValidPhoneWithCode(phone)) {
      console.warn("[AUTH/register] Invalid phone format:", phone);
      return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
    }

    if (!safeName || !phone || !safePassword) {
      console.warn("[AUTH/register] Missing required fields");
      return res.status(400).json({ message: "Missing fields" });
    }
    if (safeName.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters" });
    if (safePassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    
    const nextRole = role === "teacher" ? "teacher" : "student";
    if (nextRole === "student" && !safeClass) {
      return res.status(400).json({ message: "Class is required for students" });
    }

    console.log("[AUTH/register] Checking if user exists:", phone);
    const existing = await User.findOne({ phone });
    if (existing) {
      console.warn("[AUTH/register] User already exists:", phone);
      return res.status(409).json({ message: "Phone already registered" });
    }

    console.log("[AUTH/register] Creating new user...");
    const user = await User.create({
      name: safeName,
      phone,
      password: safePassword,
      role: nextRole,
      studentClass: safeClass,
      userId: userId || undefined,
    });

    console.log("[AUTH/register] User created successfully:", user._id, "Role:", user.role);

    const token = signAccessToken({ sub: user._id.toString(), role: user.role, phone: user.phone });
    return res.status(201).json({
      token,
      user: { name: user.name, role: user.role, userId: user.userId, phone: user.phone, studentClass: user.studentClass },
    });
  } catch (error) {
    console.error("[AUTH/register] Error:", error?.message || error, error?.stack);
    return res.status(500).json({ message: "Registration failed", detail: error?.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || "");
    const role = req.body.role === "teacher" ? "teacher" : "student";
    
    console.log("[AUTH/login] Incoming request:", { phone, role });
    
    if (!phone || !password) {
      console.warn("[AUTH/login] Missing phone or password");
      return res.status(400).json({ message: "Phone and password required" });
    }
    if (!isValidPhoneWithCode(phone)) {
      console.warn("[AUTH/login] Invalid phone format:", phone);
      return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
    }
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

    console.log("[AUTH/login] Looking up user:", phone);
    const user = await User.findOne({ phone });
    if (!user) {
      console.warn("[AUTH/login] User not found:", phone);
      return res.status(404).json({ message: "User not found" });
    }
    
    if (user.role !== role) {
      console.warn("[AUTH/login] Role mismatch. User role:", user.role, "Requested role:", role);
      return res.status(403).json({ message: `This account is registered as ${user.role}, not ${role}` });
    }

    console.log("[AUTH/login] Comparing passwords for user:", user._id);
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      console.warn("[AUTH/login] Wrong password for user:", phone);
      return res.status(401).json({ message: "Wrong password" });
    }

    const token = signAccessToken({ sub: user._id.toString(), role: user.role, phone: user.phone });
    console.log("[AUTH/login] Login successful for user:", user._id);
    return res.json({
      token,
      user: { name: user.name, role: user.role, userId: user.userId, phone: user.phone, studentClass: user.studentClass },
    });
  } catch (error) {
    console.error("[AUTH/login] Error:", error?.message || error, error?.stack);
    return res.status(500).json({ message: "Login failed", detail: error?.message });
  }
});

router.post("/reset-password", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const newPassword = String(req.body.newPassword || "");

  if (!phone || !newPassword) {
    return res.status(400).json({ message: "Phone and newPassword required" });
  }
  if (!isValidPhoneWithCode(phone)) {
    return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
  }
  if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "User not found" });

  user.password = newPassword; // will be hashed by pre-save hook
  await user.save();

  return res.json({ ok: true });
});

router.get("/me", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.sub).select("name phone userId role studentClass");
  if (!user) return res.status(404).json({ message: "User not found" });
  return res.json({ user });
});


module.exports = router;

