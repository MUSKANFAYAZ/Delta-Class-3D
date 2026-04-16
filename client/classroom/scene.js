import * as THREE from "three";

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const ambientLight = new THREE.AmbientLight(0xffffff, 2);
  scene.add(ambientLight);

  const pointLight = new THREE.PointLight(0xffffff, 0.8);
  pointLight.position.set(0, 8, 0);
  scene.add(pointLight);

  return { scene, camera, renderer };
}
