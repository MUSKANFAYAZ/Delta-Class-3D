import * as THREE from "./three-cdn.js";

export function setupLighting(scene, options = {}) {
	const lowBandwidth = Boolean(options.lowBandwidth);

	const ambientLight = new THREE.AmbientLight(0xffffff, lowBandwidth ? 1.4 : 1.7);
	scene.add(ambientLight);

	if (lowBandwidth) {
		// A hemisphere light gives broad readability at lower cost than multiple localized lights.
		const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbfd8ff, 0.45);
		hemiLight.position.set(0, 10, 0);
		scene.add(hemiLight);
		return;
	}

	const keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
	keyLight.position.set(0, 9, 3);
	scene.add(keyLight);
}
