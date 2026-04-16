import * as THREE from "three";

export function createStudentAvatar(color = 0x2563eb) {
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color }));
  torso.position.y = 0.5;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffdbac }));
  head.position.y = 1.1;
  group.add(head);
  return group;
}

export function createTeacherAvatar() {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 1.4, 0.45),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  torso.position.y = 1.9;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffdbac })
  );
  head.position.y = 2.9;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.53, 0.18, 0.53),
    new THREE.MeshStandardMaterial({ color: 0x451a03 })
  );
  hair.position.y = 3.2;
  group.add(hair);

  const glasses = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x000000 })
  );
  glasses.position.set(0, 2.9, 0.26);
  group.add(glasses);

  const tie = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.8, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x1e293b })
  );
  tie.position.set(0, 1.9, 0.24);
  group.add(tie);

  const legGeo = new THREE.BoxGeometry(0.3, 1.2, 0.35);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x334155 });

  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.18, 0.6, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.18, 0.6, 0);
  group.add(rightLeg);

  return group;
}