export function attachClassroomSocketSync({ socket, assignStudentToUser, moveAssignedStudent, moveTeacherByDirection, teacher }) {
  socket.on("student-assigned", ({ userId, slotIndex }) => {
    assignStudentToUser(userId, slotIndex);
  });

  socket.on("student-move-update", ({ userId, x, z }) => {
    moveAssignedStudent(userId, { x, z });
  });

  socket.on("update", ({ id, x, z }) => {
    moveAssignedStudent(id, { x, z });
  });

  socket.on("teacher-student-instruction", ({ userId, direction }) => {
    moveAssignedStudent(userId, { direction });
  });

  socket.on("teacher-move-update", (data) => {
    teacher.position.x = data.x;
    teacher.position.z = data.z;
  });

  socket.on("teacher-instruction", ({ direction }) => {
    moveTeacherByDirection(direction);
  });
}
