import * as THREE from "./three-cdn.js";

const studentTorsoGeoHigh = new THREE.CapsuleGeometry(0.25, 0.8, 4, 8);
const studentTorsoGeoLow = new THREE.CapsuleGeometry(0.22, 0.7, 2, 4);
const studentHeadGeoHigh = new THREE.SphereGeometry(0.2, 8, 8);
const studentHeadGeoLow = new THREE.SphereGeometry(0.18, 6, 6);
const studentHeadMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });

const teacherTorsoGeo = new THREE.BoxGeometry(0.65, 1.4, 0.45);
const teacherHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
const teacherHairGeo = new THREE.BoxGeometry(0.53, 0.18, 0.53);
const teacherGlassesGeo = new THREE.BoxGeometry(0.55, 0.14, 0.05);
const teacherTieGeo = new THREE.BoxGeometry(0.14, 0.8, 0.03);
const teacherLegGeo = new THREE.BoxGeometry(0.3, 1.2, 0.35);

const teacherTorsoMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
const teacherHeadMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });
const teacherHairMat = new THREE.MeshStandardMaterial({ color: 0x451a03 });
const teacherGlassesMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
const teacherTieMat = new THREE.MeshStandardMaterial({ color: 0x1e293b });
const teacherLegMat = new THREE.MeshStandardMaterial({ color: 0x334155 });

export function createStudentAvatar(color = 0x2563eb, options = {}) {
  const lowBandwidth = Boolean(options.lowBandwidth);
  const group = new THREE.Group();
  const torsoGeo = lowBandwidth ? studentTorsoGeoLow : studentTorsoGeoHigh;
  const headGeo = lowBandwidth ? studentHeadGeoLow : studentHeadGeoHigh;

  const torso = new THREE.Mesh(torsoGeo, new THREE.MeshStandardMaterial({ color }));
  torso.position.y = 0.5;
  group.add(torso);
  const head = new THREE.Mesh(headGeo, studentHeadMat);
  head.position.y = 1.1;
  group.add(head);
  return group;
}

export function createTeacherAvatar(options = {}) {
  const lowBandwidth = Boolean(options.lowBandwidth);
  const group = new THREE.Group();

  const torso = new THREE.Mesh(teacherTorsoGeo, teacherTorsoMat);
  torso.position.y = 1.9;
  group.add(torso);

  const head = new THREE.Mesh(teacherHeadGeo, teacherHeadMat);
  head.position.y = 2.9;
  group.add(head);

  const hair = new THREE.Mesh(teacherHairGeo, teacherHairMat);
  hair.position.y = 3.2;
  group.add(hair);

  if (lowBandwidth) {
    const leftLeg = new THREE.Mesh(teacherLegGeo, teacherLegMat);
    leftLeg.position.set(-0.18, 0.6, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(teacherLegGeo, teacherLegMat);
    rightLeg.position.set(0.18, 0.6, 0);
    group.add(rightLeg);

    return group;
  }

  const glasses = new THREE.Mesh(teacherGlassesGeo, teacherGlassesMat);
  glasses.position.set(0, 2.9, 0.26);
  group.add(glasses);

  const tie = new THREE.Mesh(teacherTieGeo, teacherTieMat);
  tie.position.set(0, 1.9, 0.24);
  group.add(tie);

  const leftLeg = new THREE.Mesh(teacherLegGeo, teacherLegMat);
  leftLeg.position.set(-0.18, 0.6, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(teacherLegGeo, teacherLegMat);
  rightLeg.position.set(0.18, 0.6, 0);
  group.add(rightLeg);

  return group;
}