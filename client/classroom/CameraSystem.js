import * as THREE from "./three-cdn.js";

export function setupCameraSystem({ container, scene, camera, renderer, teacher }) {
  const cameraTarget = new THREE.Vector3(0, 2, -5);
  const cameraGoal = new THREE.Vector3();
  const lookGoal = new THREE.Vector3();
  const followTarget = new THREE.Vector3();
  const followCameraPosition = new THREE.Vector3();
  const followLookTarget = new THREE.Vector3();
  const fullViewPosition = new THREE.Vector3(0, 10, 15);
  const fullViewTarget = new THREE.Vector3(0, 2, -5);
  const blackboardPosition = new THREE.Vector3(0, 6, -6);
  const blackboardTarget = new THREE.Vector3(0, 6, -15);
  const teacherPosition = new THREE.Vector3();
  const teacherTarget = new THREE.Vector3();
  const followOffset = new THREE.Vector3(0, 5.5, 8);
  const followLookOffset = new THREE.Vector3(0, 1.25, 0);

  let cameraTransitionActive = false;
  let cameraMode = "fullView";

  function setCameraPreset(position, target, immediate = false) {
    cameraMode = "preset";

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

  function setBlackboardView(immediate = false) {
    setCameraPreset(blackboardPosition, blackboardTarget, immediate);
  }

  function setFullView(immediate = false) {
    setCameraPreset(fullViewPosition, fullViewTarget, immediate);
  }

  function setTeacherView(immediate = false) {
    teacherPosition.set(teacher.position.x, 4.5, teacher.position.z + 7);
    teacherTarget.set(teacher.position.x, 2.2, teacher.position.z);
    setCameraPreset(teacherPosition, teacherTarget, immediate);
  }

  function followStudent(worldPosition) {
    if (!worldPosition) return;

    followTarget.copy(worldPosition);
    cameraMode = "follow";
  }

  function updateFollowCamera() {
    followCameraPosition.copy(followTarget).add(followOffset);
    followLookTarget.copy(followTarget).add(followLookOffset);

    camera.position.lerp(followCameraPosition, 0.12);
    cameraTarget.lerp(followLookTarget, 0.12);
  }

  function updateCameraTransition() {
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
    makeButton("Whiteboard", () => {
      setBlackboardView();
    }),
  );
  panel.appendChild(
    makeButton("Full View", () => {
      setFullView();
    }),
  );
  panel.appendChild(
    makeButton("Teacher", () => {
      setTeacherView();
    }),
  );

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Hide";
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

  setFullView(true);

  function animate() {
    requestAnimationFrame(animate);
    if (cameraMode === "follow") {
      updateFollowCamera();
    } else {
      updateCameraTransition();
    }
    camera.lookAt(cameraTarget);
    renderer.render(scene, camera);
  }
  animate();

  const onResize = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  window.addEventListener("resize", onResize);

  return { followStudent, setBlackboardView, setFullView, setTeacherView };
}
