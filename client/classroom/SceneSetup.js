import * as THREE from "./three-cdn.js";

export function createSceneSetup(container, options = {}) {
  const lowBandwidth = Boolean(options.lowBandwidth);
  const strictLowBandwidth = Boolean(options.strictLowBandwidth);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f5f9);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );

  const renderer = new THREE.WebGLRenderer({
    antialias: !lowBandwidth,
    powerPreference: lowBandwidth ? "low-power" : "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, strictLowBandwidth ? 0.75 : (lowBandwidth ? 1 : 1.5)));
  container.appendChild(renderer.domElement);

  return { scene, camera, renderer };
}
