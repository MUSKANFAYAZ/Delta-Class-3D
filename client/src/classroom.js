import { createSceneSetup } from "../classroom/SceneSetup.js";
import { setupLighting } from "../classroom/Lighting.js";
import { setupEnvironment } from "../classroom/Environment.js";
import { createClassroomFurniture } from "../classroom/Furniture.js";
import { attachClassroomSocketSync } from "../classroom/SocketSync.js";
import { setupCameraSystem } from "../classroom/CameraSystem.js";

export function startClassroom(socket, role) {
  const container = document.getElementById("canvas-container");
  if (!container) {
    throw new Error("Missing canvas-container element");
  }

  const { scene, camera, renderer } = createSceneSetup(container);
  setupLighting(scene);
  setupEnvironment(scene);

  const { teacher } = createClassroomFurniture(scene);

  setupCameraSystem({
    container,
    scene,
    camera,
    renderer,
    teacher,
  });

  const noop = () => {};

  attachClassroomSocketSync({
    socket,
    assignStudentToUser: noop,
    moveAssignedStudent: noop,
    moveTeacherByDirection: noop,
    teacher,
  });
}
