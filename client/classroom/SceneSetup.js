import * as THREE from "three";

export function createSceneSetup(container) {
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

  return { scene, camera, renderer };
}
