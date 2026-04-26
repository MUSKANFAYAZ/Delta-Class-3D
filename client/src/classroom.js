import { createSceneSetup } from "../classroom/SceneSetup.js";
import { setupLighting } from "../classroom/Lighting.js";
import { setupEnvironment } from "../classroom/Environment.js";
import { createClassroomFurniture } from "../classroom/Furniture.js";
import { attachClassroomSocketSync } from "../classroom/SocketSync.js";

export function startClassroom(socket, role, options = {}) {
  const container = document.getElementById("canvas-container");
  if (!container) {
    throw new Error("Missing canvas-container element");
  }

  const canWriteBlackboard = Boolean(options.canWriteBlackboard);
  const lowBandwidth = Boolean(options.lowBandwidth);
  const strictLowBandwidth = Boolean(options.strictLowBandwidth);

  const { scene, camera, renderer } = createSceneSetup(container, { lowBandwidth, strictLowBandwidth });
  setupLighting(scene, { lowBandwidth });
  const { blackboard } = setupEnvironment(scene);

  const { teacher } = createClassroomFurniture(scene, { lowBandwidth, strictLowBandwidth });

  const noop = () => {};

  attachClassroomSocketSync({
    socket,
    assignStudentToUser: noop,
    moveAssignedStudent: noop,
    moveTeacherByDirection: noop,
    teacher,
  });

  // Defer heavier interaction modules so first classroom render appears faster on slow networks.
  Promise.all([
    import("../classroom/CameraSystem.js"),
    import("../classroom/Blackboard.js"),
  ]).then(([cameraSystemModule, blackboardModule]) => {
    cameraSystemModule.setupCameraSystem({
      container,
      scene,
      camera,
      renderer,
      teacher,
    });

    blackboardModule.setupBlackboardSystem({
      container,
      renderer,
      camera,
      blackboard,
      socket,
      canWrite: canWriteBlackboard,
      lowBandwidth,
      strictLowBandwidth,
    });
  }).catch((error) => {
    console.error("Failed to initialize deferred classroom modules:", error);
  });
}
