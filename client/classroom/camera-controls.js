import * as THREE from "three";

export function createCameraController(camera, container, teacher) {
  const cameraTarget = new THREE.Vector3(0, 2, -5);
  const cameraGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const fullViewPosition = new THREE.Vector3(0, 10, 15);
  const fullViewTarget = new THREE.Vector3(0, 2, -5);
  const worldFollowPos = new THREE.Vector3();
  const followCameraGoal = new THREE.Vector3();
  const followLookGoal = new THREE.Vector3();
  const followCameraOffset = new THREE.Vector3(0, 3.5, 6.5);
  const followLookOffset = new THREE.Vector3(0, 1.3, -3);
  let cameraTransitionActive = false;
  let followStudent = null;

  function setCameraPreset(position, target, immediate = false) {
    followStudent = null;

    if (immediate) {
      camera.position.copy(position);
      cameraTarget.copy(target);
      cameraTransitionActive = false;
      return;
    }

    cameraGoal.copy(position);
    lookGoal.copy(target);
    cameraTransitionActive = true;
  }

  function setFullViewPreset(immediate = false) {
    setCameraPreset(fullViewPosition, fullViewTarget, immediate);
  }

  function updateCameraTransition() {
    if (followStudent?.parent) {
      followStudent.getWorldPosition(worldFollowPos);
      followCameraGoal.copy(worldFollowPos).add(followCameraOffset);
      followLookGoal.copy(worldFollowPos).add(followLookOffset);

      camera.position.lerp(followCameraGoal, 0.15);
      cameraTarget.lerp(followLookGoal, 0.15);
      cameraTransitionActive = false;
      return;
    }

    if (!cameraTransitionActive) return;

    camera.position.lerp(cameraGoal, 0.1);
    cameraTarget.lerp(lookGoal, 0.1);

    const closeEnough = 0.01;
    if (
      camera.position.distanceToSquared(cameraGoal) < closeEnough &&
      cameraTarget.distanceToSquared(lookGoal) < closeEnough
    ) {
      camera.position.copy(cameraGoal);
      cameraTarget.copy(lookGoal);
      cameraTransitionActive = false;
    }
  }

  function createCameraControls() {
    const existing = document.getElementById("camera-controls-root");
    if (existing) existing.remove();

    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    const root = document.createElement("div");
    root.id = "camera-controls-root";
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      fontFamily: "Segoe UI, sans-serif",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "absolute",
      left: "50%",
      bottom: "18px",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 14px",
      borderRadius: "999px",
      background: "rgba(15, 23, 42, 0.82)",
      border: "1px solid rgba(148, 163, 184, 0.45)",
      boxShadow: "0 12px 30px rgba(2, 6, 23, 0.35)",
      backdropFilter: "blur(8px)",
      pointerEvents: "auto",
      transition: "transform 260ms ease, opacity 260ms ease",
      opacity: "1",
    });

    const label = document.createElement("span");
    label.textContent = "CAMERA";
    Object.assign(label.style, {
      color: "#cbd5e1",
      fontSize: "11px",
      letterSpacing: "1.2px",
      fontWeight: "700",
      padding: "0 4px 0 2px",
      userSelect: "none",
    });
    panel.appendChild(label);

    function makeButton(labelText, onClick) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = labelText;
      Object.assign(button.style, {
        border: "1px solid rgba(148, 163, 184, 0.35)",
        background: "rgba(241, 245, 249, 0.98)",
        color: "#0f172a",
        borderRadius: "999px",
        padding: "8px 14px",
        minWidth: "110px",
        cursor: "pointer",
        fontWeight: "600",
        textAlign: "center",
        transition: "transform 120ms ease, background 120ms ease",
      });
      button.addEventListener("mouseenter", () => {
        button.style.background = "#ffffff";
      });
      button.addEventListener("mouseleave", () => {
        button.style.background = "rgba(241, 245, 249, 0.98)";
      });
      button.addEventListener("mousedown", () => {
        button.style.transform = "scale(0.97)";
      });
      button.addEventListener("mouseup", () => {
        button.style.transform = "scale(1)";
      });
      button.addEventListener("click", onClick);
      return button;
    }

    panel.appendChild(
      makeButton("Blackboard", () => {
        setCameraPreset(new THREE.Vector3(0, 6, -6), new THREE.Vector3(0, 6, -15));
      }),
    );
    panel.appendChild(
      makeButton("Full View", () => {
        setFullViewPreset();
      }),
    );
    panel.appendChild(
      makeButton("Teacher", () => {
        setCameraPreset(
          new THREE.Vector3(teacher.position.x, 4.5, teacher.position.z + 7),
          new THREE.Vector3(teacher.position.x, 2.2, teacher.position.z),
        );
      }),
    );

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "Hide Panel";
    Object.assign(toggle.style, {
      position: "absolute",
      right: "16px",
      bottom: "18px",
      border: "1px solid rgba(148, 163, 184, 0.45)",
      background: "rgba(15, 23, 42, 0.86)",
      color: "#f8fafc",
      borderRadius: "999px",
      padding: "8px 13px",
      cursor: "pointer",
      pointerEvents: "auto",
      fontWeight: "600",
      fontSize: "12px",
      letterSpacing: "0.2px",
    });

    let controlsVisible = true;
    toggle.addEventListener("click", () => {
      controlsVisible = !controlsVisible;
      panel.style.transform = controlsVisible
        ? "translateX(-50%)"
        : "translateX(-50%) translateY(95px)";
      panel.style.opacity = controlsVisible ? "1" : "0";
      panel.style.pointerEvents = controlsVisible ? "auto" : "none";
      toggle.textContent = controlsVisible ? "Hide Panel" : "Show Panel";
    });

    root.appendChild(panel);
    root.appendChild(toggle);
    container.appendChild(root);
  }

  function initialize() {
    setFullViewPreset(true);
    createCameraControls();
  }

  function beginStudentFollow(studentMesh) {
    if (!studentMesh) return;
    followStudent = studentMesh || null;
    cameraTransitionActive = false;
  }

  function endStudentFollowToFullView() {
    followStudent = null;
    setFullViewPreset();
  }

  return {
    cameraTarget,
    beginStudentFollow,
    endStudentFollowToFullView,
    setFullViewPreset,
    setCameraPreset,
    updateCameraTransition,
    initialize,
  };
}
