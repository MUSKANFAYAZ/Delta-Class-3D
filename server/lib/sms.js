async function sendSms({ to, message }) {
  // Plug in Firebase / Twilio here. For now we keep the server working in dev.
  console.log(`[sms] to=${to} message=${message}`);
  return { ok: true };
}

module.exports = { sendSms };

