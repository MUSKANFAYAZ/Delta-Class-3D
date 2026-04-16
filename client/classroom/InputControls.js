export function attachStudentKeyboardControls({ socket, role, localUserId, assignStudentToUser, moveAssignedStudent }) {
  if (role === "student") {
    assignStudentToUser(localUserId);
  }

  const onKeyDown = (e) => {
    if (role !== "student") return;

    const keyToDirection = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };

    const direction = keyToDirection[e.key];
    if (!direction) return;

    moveAssignedStudent(localUserId, { direction });

    const slot = assignStudentToUser(localUserId);
    if (!slot) return;

    socket.emit("move", {
      x: slot.student.position.x,
      z: slot.student.position.z,
    });
  };

  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}
