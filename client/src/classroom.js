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

  if (typeof window.stopActiveClassroom === "function") {
    try {
      window.stopActiveClassroom();
    } catch (err) {
      console.warn("Failed to stop previous classroom runtime:", err);
    }
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

  let wakeCameraSystem = () => {};
  let cameraSystem = null;
  let blackboardTeardown = null;
  let teacherKeydownHandler = null;
  let visibilityHandler = null;
  let blackboardDrawHandler = null;
  let stopped = false;

  attachClassroomSocketSync({
    socket,
    assignStudentToUser: movement.assignStudentToUser,
    moveAssignedStudent: movement.moveAssignedStudent,
    moveTeacherByDirection: movement.moveTeacherByDirection,
    teacher,
    onNetworkActivity: () => {
      wakeCameraSystem();
    },
  });

  let controlsAttached = false;
  const attachLocalControls = () => {
    if (controlsAttached || stopped) return;
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
      teacherKeydownHandler = (event) => {
        const direction = keyToDirection[event.key];
        if (!direction || event.target?.closest?.("input, textarea, select, button")) return;
        event.preventDefault();
        movement.moveTeacherByDirection(direction);
        socket.emit("teacher-move", {
          x: teacher.position.x,
          z: teacher.position.z,
        });
        wakeCameraSystem();
      };
      window.addEventListener("keydown", teacherKeydownHandler);
    }
  };

  if (socket.connected && socket.id) {
    attachLocalControls();
  } else {
    socket.once("connect", attachLocalControls);
  }

  import("../classroom/ImageSync.js").then(({ setupImageSync }) => {
    if (stopped) return;
    const presentationButton = document.getElementById("presentation-button");
    const appRoot = document.getElementById("app");
    setupImageSync({
      socket,
      role,
      presentationButton,
      appRoot,
    });
  }).catch((error) => {
    console.error("Failed to initialize Image Sync module:", error);
  });

  Promise.all([
    import("../classroom/CameraSystem.js"),
    import("../classroom/Blackboard.js"),
  ]).then(([cameraSystemModule, blackboardModule]) => {
    if (stopped) return;

    cameraSystem = cameraSystemModule.setupCameraSystem({
      container,
      scene,
      camera,
      renderer,
      teacher,
      lowBandwidth,
      strictLowBandwidth,
    });

    visibilityHandler = () => {
      if (!document.hidden && cameraSystem) {
        cameraSystem.start();
        cameraSystem.requestRenderOnce();
      }
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    blackboardDrawHandler = () => {
      cameraSystem.setBlackboardView(true);
      cameraSystem.requestRenderOnce();
    };
    window.addEventListener("dc-blackboard-draw-start", blackboardDrawHandler);

    cameraSystem.requestRenderOnce();

    let interactionTimer = null;
    const startForShort = () => {
      cameraSystem.start();
      clearTimeout(interactionTimer);
      interactionTimer = setTimeout(() => {
        cameraSystem.stop();
      }, 4000);
    };

    wakeCameraSystem = () => {
      if (!lowBandwidth) {
        cameraSystem.start();
      } else {
        startForShort();
      }
    };

    if (!lowBandwidth) {
      cameraSystem.start();
    } else {
      const interactionEvents = ["pointermove", "click", "wheel", "keydown"];
      interactionEvents.forEach((ev) => {
        container.addEventListener(ev, startForShort, { passive: true });
      });
    }

    const blackboardApi = blackboardModule.setupBlackboardSystem({
      container,
      renderer,
      camera,
      blackboard,
      socket,
      canWrite: canWriteBlackboard,
      lowBandwidth,
      strictLowBandwidth,
    });
    if (typeof blackboardApi?.destroy === "function") {
      blackboardTeardown = blackboardApi.destroy;
    }
  }).catch((error) => {
    console.error("Failed to initialize deferred classroom modules:", error);
  });

  const stopClassroom = () => {
    if (stopped) return;
    stopped = true;

    if (teacherKeydownHandler) {
      window.removeEventListener("keydown", teacherKeydownHandler);
      teacherKeydownHandler = null;
    }

    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }

    if (blackboardDrawHandler) {
      window.removeEventListener("dc-blackboard-draw-start", blackboardDrawHandler);
      blackboardDrawHandler = null;
    }

    try {
      blackboardTeardown?.();
    } catch (err) {
      console.warn("Blackboard teardown failed:", err);
    }

    try {
      cameraSystem?.dispose?.();
    } catch (err) {
      console.warn("Camera teardown failed:", err);
    }

    try {
      renderer.dispose();
      renderer.forceContextLoss?.();
    } catch (err) {
      console.warn("Renderer teardown failed:", err);
    }

    try {
      container.innerHTML = "";
    } catch (err) {
      console.warn("Canvas container cleanup failed:", err);
    }
  };

  window.stopActiveClassroom = stopClassroom;
  return stopClassroom;
}
