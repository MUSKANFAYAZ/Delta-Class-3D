import { createScene } from "./classroom/scene.js";
import { buildEnvironment } from "./classroom/environment.js";
import { buildFurniture } from "./classroom/furniture.js";
import { createMovementController } from "./classroom/movement.js";
import { createCameraController } from "./classroom/camera-controls.js";

export function startClassroom(socket, role) {
  const container = document.getElementById("canvas-container");
  if (!container) return;

  const localUserId = socket?.id || `local-${role || "guest"}`;
  const { scene, camera, renderer } = createScene(container);

  buildEnvironment(scene);

  const { teacher, studentSlots, userToSlot, staticObstacles } = buildFurniture(scene);
  const { assignStudentToUser, moveAssignedStudent, moveTeacherByDirection } =
    createMovementController({
      studentSlots,
      userToSlot,
      staticObstacles,
      teacher,
    });

  const cameraController = createCameraController(camera, container, teacher);
  cameraController.initialize();

  let isFollowingLocalStudent = false;

  function updateLocalStudentCameraMode() {
    if (role !== "student") return;

    const slot = assignStudentToUser(localUserId);
    if (!slot) return;

    const dx = slot.student.position.x;
    const dz = slot.student.position.z - 0.8;
    const isAtSeat = (dx * dx + dz * dz) <= 0.01;

    if (isAtSeat) {
      if (isFollowingLocalStudent) {
        cameraController.endStudentFollowToFullView();
        isFollowingLocalStudent = false;
      }
      return;
    }

    cameraController.beginStudentFollow(slot.student);
    isFollowingLocalStudent = true;
  }

  if (role === "student") {
    assignStudentToUser(localUserId);
    updateLocalStudentCameraMode();
  }

  window.addEventListener("keydown", (e) => {
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
    updateLocalStudentCameraMode();

    const slot = assignStudentToUser(localUserId);
    if (!slot) return;

    socket.emit("move", {
      x: slot.student.position.x,
      z: slot.student.position.z,
    });
  });

  socket.on("student-assigned", ({ userId, slotIndex }) => {
    assignStudentToUser(userId, slotIndex);
    if (userId === localUserId) updateLocalStudentCameraMode();
  });

  socket.on("student-move-update", ({ userId, x, z }) => {
    moveAssignedStudent(userId, { x, z });
    if (userId === localUserId) updateLocalStudentCameraMode();
  });

  socket.on("update", ({ id, x, z }) => {
    moveAssignedStudent(id, { x, z });
    if (id === localUserId) updateLocalStudentCameraMode();
  });

  socket.on("teacher-student-instruction", ({ userId, direction }) => {
    moveAssignedStudent(userId, { direction });
    if (userId === localUserId) updateLocalStudentCameraMode();
  });

  socket.on("teacher-move-update", (data) => {
    teacher.position.x = data.x;
    teacher.position.z = data.z;
  });

  socket.on("teacher-instruction", ({ direction }) => {
    moveTeacherByDirection(direction);
  });

  function animate() {
    requestAnimationFrame(animate);
    cameraController.updateCameraTransition();
    camera.lookAt(cameraController.cameraTarget);
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
}
