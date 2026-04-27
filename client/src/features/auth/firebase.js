let lastOtpToken = "";
let lastOtpPhone = "";
let lastOtpPurpose = "signup";

function normalizePhone(raw) {
  return String(raw || "").replace(/\s+/g, "");
}

export async function sendFirebaseOtp(api, phoneNumber, purpose = "signup") {
  if (typeof api !== "function") {
    throw new Error("Auth API is unavailable");
  }

  const phone = normalizePhone(phoneNumber);
  const result = await api("/request-otp", {
    method: "POST",
    body: { phone, purpose },
  });

  lastOtpPhone = phone;
  lastOtpPurpose = purpose;
  lastOtpToken = result?.otpToken || "";
  return result;
}

export async function verifyFirebaseOtp(api, phoneNumber, code, purpose = "signup") {
  if (typeof api !== "function") {
    throw new Error("Auth API is unavailable");
  }

  const phone = normalizePhone(phoneNumber);
  const otp = String(code || "").trim();
  const result = await api("/verify-otp", {
    method: "POST",
    body: { phone, otp, purpose },
  });

  lastOtpPhone = phone;
  lastOtpPurpose = purpose;
  lastOtpToken = result?.otpToken || "";
  return { otpToken: lastOtpToken };
}

export function getFirebaseOtpToken() {
  return lastOtpToken;
}

export function resetFirebaseOtpFlow() {
  lastOtpToken = "";
  lastOtpPhone = "";
  lastOtpPurpose = "signup";
}
