export function attachClassroomSocketSync({ 
  socket, 
  assignStudentToUser, 
  moveAssignedStudent, 
  moveTeacherByDirection, 
  teacher,
  onNetworkActivity // Added callback to wake up the renderer
}) {
  
  // Helper to trigger a render update loop when sync updates arrive
  const triggerUpdate = () => {
    if (typeof onNetworkActivity === "function") {
      onNetworkActivity();
    }
  };

  socket.on("student-assigned", ({ userId, slotIndex }) => {
    assignStudentToUser(userId, slotIndex);
    triggerUpdate();
  });

  socket.on("student-move-update", ({ userId, x, z }) => {
    moveAssignedStudent(userId, { x, z });
    triggerUpdate();
  });

  socket.on("update", ({ id, x, z }) => {
    moveAssignedStudent(id, { x, z });
    triggerUpdate();
  });

  socket.on("teacher-student-instruction", ({ userId, direction }) => {
    moveAssignedStudent(userId, { direction });
    triggerUpdate();
  });

  socket.on("teacher-move-update", (data) => {
    teacher.position.x = data.x;
    teacher.position.z = data.z;
    triggerUpdate();
  });

  socket.on("teacher-instruction", ({ direction }) => {
    moveTeacherByDirection(direction);
    triggerUpdate();
  });
}