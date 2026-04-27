const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const Otp = require("../models/Otp");
const { sendSms } = require("../lib/sms");
const { signAccessToken, signOtpToken, authMiddleware } = require("../lib/auth");

const router = express.Router();

function normalizePhone(raw) {
  return String(raw || "").replace(/\s+/g, "");
}

function isValidPhoneWithCode(phone) {
  // Example: +911234567890 (country code + 10-digit number)
  return /^\+\d{1,3}\d{10}$/.test(phone);
}

function randomOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post("/request-otp", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const purpose = req.body.purpose === "login" ? "login" : "signup";

  if (!phone) return res.status(400).json({ message: "Phone is required" });
  if (!isValidPhoneWithCode(phone)) {
    return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
  }

  if (purpose === "signup") {
    const existing = await User.findOne({ phone });
    if (existing) return res.status(409).json({ message: "Phone already registered" });
  }

  if (purpose === "login") {
    const existing = await User.findOne({ phone });
    if (!existing) return res.status(404).json({ message: "User not found" });
  }

  const code = randomOtp();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await Otp.findOneAndUpdate(
    { phone, purpose },
    { phone, purpose, codeHash, expiresAt, attempts: 0 },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await sendSms({ to: phone, message: `Your DeltaClass3D OTP is ${code}. Valid for 5 minutes.` });

  return res.json({ ok: true });
});

router.post("/verify-otp", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const purpose = req.body.purpose === "login" ? "login" : "signup";
  const otp = String(req.body.otp || "").trim();

  if (!phone || !otp) return res.status(400).json({ message: "Phone and OTP required" });

  const row = await Otp.findOne({ phone, purpose });
  if (!row) return res.status(400).json({ message: "OTP expired or not requested" });
  if (row.expiresAt.getTime() < Date.now()) {
    await row.deleteOne();
    return res.status(400).json({ message: "OTP expired" });
  }

  const ok = await bcrypt.compare(otp, row.codeHash);
  row.attempts += 1;
  await row.save();

  if (!ok) return res.status(400).json({ message: "Invalid OTP" });

  await row.deleteOne();
  const otpToken = signOtpToken({ phone, purpose, kind: "otp" });
  return res.json({ ok: true, otpToken });
});

router.post("/register", async (req, res) => {
  const { name, password, role, studentClass, userId, otpToken, firebaseVerified } = req.body || {};
  const phone = normalizePhone(req.body.phone);
  const safeName = String(name || "").trim();
  const safePassword = String(password || "");
  const safeClass = String(studentClass || "").trim();

  if (!otpToken && !firebaseVerified) return res.status(400).json({ message: "OTP verification required" });
  if (!isValidPhoneWithCode(phone)) {
    return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
  }

  if (!firebaseVerified) {
    // verify server OTP token
    let verified;
    try {
      verified = require("../lib/auth").verifyToken(otpToken);
    } catch {
      return res.status(400).json({ message: "Invalid OTP token" });
    }
    if (verified.kind !== "otp" || verified.purpose !== "signup" || verified.phone !== phone) {
      return res.status(400).json({ message: "OTP token mismatch" });
    }
  }

  if (!safeName || !phone || !safePassword) return res.status(400).json({ message: "Missing fields" });
  if (safeName.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters" });
  if (safePassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
  const nextRole = role === "teacher" ? "teacher" : "student";
  if (nextRole === "student" && !safeClass) {
    return res.status(400).json({ message: "Class is required for students" });
  }

  const existing = await User.findOne({ phone });
  if (existing) return res.status(409).json({ message: "Phone already registered" });

  const user = await User.create({
    name: safeName,
    phone,
    password: safePassword,
    role: nextRole,
    studentClass: safeClass,
    userId: userId || undefined,
  });

  const token = signAccessToken({ sub: user._id.toString(), role: user.role, phone: user.phone });
  return res.status(201).json({
    token,
    user: { name: user.name, role: user.role, userId: user.userId, phone: user.phone, studentClass: user.studentClass },
  });
});

router.post("/login", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password || "");
  const role = req.body.role === "teacher" ? "teacher" : "student";
  if (!phone || !password) return res.status(400).json({ message: "Phone and password required" });
  if (!isValidPhoneWithCode(phone)) {
    return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
  }
  if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "User not found" });
  if (user.role !== role) {
    return res.status(403).json({ message: `This account is registered as ${user.role}, not ${role}` });
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: "Wrong password" });

  const token = signAccessToken({ sub: user._id.toString(), role: user.role, phone: user.phone });
  return res.json({
    token,
    user: { name: user.name, role: user.role, userId: user.userId, phone: user.phone, studentClass: user.studentClass },
  });
});

router.post("/reset-password", async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const otpToken = String(req.body.otpToken || "");
  const newPassword = String(req.body.newPassword || "");
  const firebaseVerified = Boolean(req.body.firebaseVerified);

  if (!phone || !newPassword) {
    return res.status(400).json({ message: "Phone and newPassword required" });
  }
  if (!isValidPhoneWithCode(phone)) {
    return res.status(400).json({ message: "Phone must include country code and 10-digit number (example: +911234567890)" });
  }
  if (newPassword.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });

  if (!firebaseVerified) {
    let verified;
    try {
      verified = require("../lib/auth").verifyToken(otpToken);
    } catch {
      return res.status(400).json({ message: "Invalid OTP token" });
    }
    if (verified.kind !== "otp" || verified.purpose !== "login" || verified.phone !== phone) {
      return res.status(400).json({ message: "OTP token mismatch" });
    }
  }

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

