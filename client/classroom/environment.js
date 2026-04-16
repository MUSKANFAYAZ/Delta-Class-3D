import * as THREE from "three";

function createPosterTexture(title, subtitle, accentColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 768;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = accentColor;
  ctx.fillRect(0, 0, canvas.width, 120);

  ctx.fillStyle = "rgba(15, 23, 42, 0.10)";
  ctx.fillRect(60, 170, 390, 70);
  ctx.fillRect(60, 270, 300, 18);
  ctx.fillRect(60, 310, 350, 18);
  ctx.fillRect(60, 350, 290, 18);

  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(405, 520, 55, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(390, 520);
  ctx.lineTo(420, 520);
  ctx.moveTo(405, 505);
  ctx.lineTo(405, 535);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 48px Segoe UI";
  ctx.fillText(title, 28, 76);

  ctx.fillStyle = "#0f172a";
  ctx.font = "600 34px Segoe UI";
  ctx.fillText(subtitle, 60, 430);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function addEducationalPoster(scene, config) {
  const { title, subtitle, accentColor, position, rotationY } = config;
  const posterTexture = createPosterTexture(title, subtitle, accentColor);
  if (!posterTexture) return;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.3, 4.7, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x3f2a1d, roughness: 0.9 }),
  );
  frame.position.copy(position);
  frame.rotation.y = rotationY;
  scene.add(frame);

  const poster = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 4.4),
    new THREE.MeshBasicMaterial({ map: posterTexture }),
  );
  poster.position.copy(position);
  poster.position.x += Math.sin(rotationY) * 0.05;
  poster.position.z += Math.cos(rotationY) * 0.05;
  poster.rotation.y = rotationY;
  scene.add(poster);
}

export function buildEnvironment(scene) {
  const accentWallMat = new THREE.MeshStandardMaterial({ color: 0xd1d5c0, roughness: 1.0 });
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(25, 12), accentWallMat);
  frontWall.position.set(0, 6, -15);
  scene.add(frontWall);

  const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xdbe4ee, roughness: 1.0 });
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), sideWallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-12, 6, 0);
  scene.add(leftWall);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 12;
  scene.add(ceiling);

  const rightWall = leftWall.clone();
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(12, 6, 0);
  scene.add(rightWall);

  addEducationalPoster(scene, {
    title: "MATHEMATICS",
    subtitle: "a^2 + b^2 = c^2",
    accentColor: "#0ea5e9",
    position: new THREE.Vector3(-11.92, 6.8, -9),
    rotationY: Math.PI / 2,
  });

  addEducationalPoster(scene, {
    title: "GEOGRAPHY",
    subtitle: "Map Compass Climate",
    accentColor: "#f59e0b",
    position: new THREE.Vector3(11.92, 6.8, -9),
    rotationY: -Math.PI / 2,
  });

  addEducationalPoster(scene, {
    title: "READING",
    subtitle: "Read Think Create",
    accentColor: "#ef4444",
    position: new THREE.Vector3(11.92, 6.8, 7),
    rotationY: -Math.PI / 2,
  });

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x451a03 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(17.4, 8.4), frameMat);
  frame.position.set(0, 6, -14.95);
  scene.add(frame);

  const boardMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const blackboard = new THREE.Mesh(new THREE.PlaneGeometry(17, 8), boardMat);
  blackboard.position.set(0, 6, -14.94);
  scene.add(blackboard);

  const ledge = new THREE.Mesh(new THREE.BoxGeometry(17, 0.1, 0.2), frameMat);
  ledge.position.set(0, 2.0, -14.85);
  scene.add(ledge);
}
