import { createSceneSetup } from "../classroom/SceneSetup.js";
import { setupLighting } from "../classroom/Lighting.js";
import { setupEnvironment } from "../classroom/Environment.js";
import { createClassroomFurniture } from "../classroom/Furniture.js";
import { createClassroomMovement } from "../classroom/Movement.js";
import { attachStudentKeyboardControls } from "../classroom/InputControls.js";
import { attachClassroomSocketSync } from "../classroom/SocketSync.js";
import { setupCameraSystem } from "../classroom/CameraSystem.js";

export function startClassroom(socket, role) {
  const container = document.getElementById("canvas-container");
  if (!container) {
    throw new Error("Missing canvas-container element");
  }

  const localUserId = socket?.id || `local-${role || "guest"}`;

  const { scene, camera, renderer } = createSceneSetup(container);
  setupLighting(scene);
  setupEnvironment(scene);

  const { studentSlots, staticObstacles, teacher } = createClassroomFurniture(scene);

  const cameraSystem = setupCameraSystem({
    container,
    scene,
    camera,
    renderer,
    teacher,
  });

  const movement = createClassroomMovement({
    studentSlots,
    staticObstacles,
    teacher,
    onStudentMoved: ({ userId, worldPosition, seated }) => {
      if (role !== "student" || userId !== localUserId) return;

      if (seated) {
        cameraSystem.setFullView(true);
        return;
      }

      cameraSystem.followStudent(worldPosition);
    },
  });

  attachStudentKeyboardControls({
    socket,
    role,
    localUserId,
    assignStudentToUser: movement.assignStudentToUser,
    moveAssignedStudent: movement.moveAssignedStudent,
  });

  attachClassroomSocketSync({
    socket,
    assignStudentToUser: movement.assignStudentToUser,
    moveAssignedStudent: movement.moveAssignedStudent,
    moveTeacherByDirection: movement.moveTeacherByDirection,
    teacher,
  });
}
