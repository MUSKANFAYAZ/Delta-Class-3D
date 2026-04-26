import { initializeApp } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId) {
  throw new Error("Missing Firebase env vars. Check client/.env");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let recaptchaVerifier = null;
let confirmationResult = null;

function ensureRecaptcha(containerId = "recaptcha-container") {
  if (!recaptchaVerifier) {
    recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
      size: "normal",
    });
  }
  return recaptchaVerifier;
}

export async function sendFirebaseOtp(phoneNumber, containerId = "recaptcha-container") {
  const verifier = ensureRecaptcha(containerId);
  confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  return true;
}

export async function verifyFirebaseOtp(code) {
  if (!confirmationResult) throw new Error("Request OTP first");
  const cred = await confirmationResult.confirm(String(code || "").trim());
  const idToken = await cred.user.getIdToken();
  return { idToken };
}

export function resetFirebaseOtpFlow() {
  confirmationResult = null;
}
