const ROOM_CODE_REGEX = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/;

function normalizeRoomCode(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidRoomCode(code) {
  return ROOM_CODE_REGEX.test(code);
}

module.exports = {
  ROOM_CODE_REGEX,
  normalizeRoomCode,
  isValidRoomCode,
};
