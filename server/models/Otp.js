const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: ["signup", "login"], required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

otpSchema.index({ phone: 1, purpose: 1 }, { unique: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Otp", otpSchema);

