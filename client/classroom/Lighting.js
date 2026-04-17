import * as THREE from "./three-cdn.js";

export function setupLighting(scene) {
	const ambientLight = new THREE.AmbientLight(0xffffff, 2);
	scene.add(ambientLight);

	const pointLight = new THREE.PointLight(0xffffff, 0.8);
	pointLight.position.set(0, 8, 0);
	scene.add(pointLight);
}
