/**
 * Deletes a classroom by its room code.
 * @param {Function} api - The authenticated API function from main.js
 * @param {string} roomCode - The code of the room to delete.
 */
export async function deleteClassroom(api, roomCode) {
  if (!confirm(`Are you sure you want to delete classroom: ${roomCode}?`)) {
    return { ok: false };
  }

  try {
    const res = await api(`/classrooms/${encodeURIComponent(roomCode)}`, {
      method: "DELETE",
    });
    return { ok: true, data: res };
  } catch (err) {
    console.error("Delete failed:", err);
    const message = String(err?.message || "");
    if (/only the classroom creator/i.test(message) || /creator can delete/i.test(message)) {
      alert("Only the classroom creator can delete this class.");
    } else if (/not found/i.test(message)) {
      alert("This classroom is no longer active.");
    } else {
      alert(`Failed to delete classroom. ${message || "Please try again."}`);
    }
    return { ok: false, error: err };
  }
}