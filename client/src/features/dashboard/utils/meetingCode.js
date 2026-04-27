export function generateMeetingCode() {
  const letters = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (len) =>
    Array.from({ length: len }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}
