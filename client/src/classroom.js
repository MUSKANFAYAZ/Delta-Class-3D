import { createSceneSetup } from "../classroom/SceneSetup.js";
import { setupLighting } from "../classroom/Lighting.js";
import { setupEnvironment } from "../classroom/Environment.js";
import { createClassroomFurniture } from "../classroom/Furniture.js";
import { attachClassroomSocketSync } from "../classroom/SocketSync.js";
import { createClassroomMovement } from "../classroom/Movement.js";
import { attachStudentKeyboardControls } from "../classroom/InputControls.js";

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

  const { studentSlots, staticObstacles, teacher } = createClassroomFurniture(scene, { lowBandwidth, strictLowBandwidth });
  const movement = createClassroomMovement({
    studentSlots,
    staticObstacles,
    teacher,
  });

  attachClassroomSocketSync({
    socket,
    assignStudentToUser: movement.assignStudentToUser,
    moveAssignedStudent: movement.moveAssignedStudent,
    moveTeacherByDirection: movement.moveTeacherByDirection,
    teacher,
  });

  let controlsAttached = false;
  const attachLocalControls = () => {
    if (controlsAttached) return;
    controlsAttached = true;

    if (role === "student") {
      attachStudentKeyboardControls({
        socket,
        role,
        localUserId: socket.id,
        assignStudentToUser: movement.assignStudentToUser,
        moveAssignedStudent: movement.moveAssignedStudent,
      });
      return;
    }

    if (role === "teacher") {
      const keyToDirection = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      window.addEventListener("keydown", (event) => {
        const direction = keyToDirection[event.key];
        if (!direction || event.target?.closest?.("input, textarea, select, button")) return;
        event.preventDefault();
        movement.moveTeacherByDirection(direction);
        socket.emit("teacher-move", {
          x: teacher.position.x,
          z: teacher.position.z,
        });
      });
    }
  };

  if (socket.connected && socket.id) {
    attachLocalControls();
  } else {
    socket.once("connect", attachLocalControls);
  }

  // Presentation synchronization via ImageSync
  import("../classroom/ImageSync.js").then(({ setupImageSync }) => {
    const presentationButton = document.getElementById("presentation-button");
    const appRoot = document.getElementById("app");
    setupImageSync({
      socket,
      role,
      presentationButton,
      appRoot
    });
  }).catch((error) => {
    console.error("Failed to initialize Image Sync module:", error);
  });

  // Defer heavier interaction modules so first classroom render appears faster on slow networks.
  Promise.all([
    import("../classroom/CameraSystem.js"),
    import("../classroom/Blackboard.js"),
  ]).then(([cameraSystemModule, blackboardModule]) => {
    const cameraSystem = cameraSystemModule.setupCameraSystem({
      container,
      scene,
      camera,
      renderer,
      teacher,
      lowBandwidth,
      strictLowBandwidth,
    });

    const onBlackboardDrawStart = () => {
      cameraSystem.setBlackboardView(true);
      cameraSystem.requestRenderOnce();
    };
    window.addEventListener("dc-blackboard-draw-start", onBlackboardDrawStart);

    // Render an initial frame immediately so UI doesn't appear blank
    cameraSystem.requestRenderOnce();

    // On constrained networks, avoid continuous rendering. Start rendering on user interaction for a short burst.
    if (!lowBandwidth) {
      cameraSystem.start();
    } else {
      let interactionTimer = null;
      const startForShort = () => {
        cameraSystem.start();
        clearTimeout(interactionTimer);
        interactionTimer = setTimeout(() => {
          cameraSystem.stop();
        }, 4000);
      };

      const interactionEvents = ["pointermove", "click", "wheel", "keydown"];
      interactionEvents.forEach((ev) => {
        container.addEventListener(ev, startForShort, { passive: true });
      });
    }

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
