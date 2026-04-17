import * as THREE from "./three-cdn.js";

export function createWalls(scene) {
  const accentWallMat = new THREE.MeshStandardMaterial({ color: 0xd1d5c0, roughness: 1.0 });
  const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(25, 12), accentWallMat);
  frontWall.position.set(0, 6, -15);
  scene.add(frontWall);

  const sideWallMat = new THREE.MeshStandardMaterial({ color: 0xdbe4ee, roughness: 1.0 });
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), sideWallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-12, 6, 0);
  scene.add(leftWall);

  const rightWall = leftWall.clone();
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(12, 6, 0);
  scene.add(rightWall);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 40),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 12;
  scene.add(ceiling);
}

export function createBlackboard(scene) {
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

export function setupEnvironment(scene) {
  createWalls(scene);
  createBlackboard(scene);
}