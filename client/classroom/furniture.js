import * as THREE from "three";

function createStudentAvatar(color) {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color }),
  );
  torso.position.y = 0.5;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffdbac }),
  );
  head.position.y = 1.1;
  group.add(head);

  return group;
}

function createDetailedTeacher() {
  const group = new THREE.Group();

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 1.4, 0.45),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  torso.position.y = 1.9;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xffdbac }),
  );
  head.position.y = 2.9;
  group.add(head);

  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.53, 0.18, 0.53),
    new THREE.MeshStandardMaterial({ color: 0x451a03 }),
  );
  hair.position.y = 3.2;
  group.add(hair);

  const glasses = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.14, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x000000 }),
  );
  glasses.position.set(0, 2.9, 0.26);
  group.add(glasses);

  const tie = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.8, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x1e293b }),
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

export function buildFurniture(scene) {
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
  const offWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfafaf9 });
  const studentColor = 0x2563eb;

  const studentSlots = [];
  const userToSlot = new Map();
  const staticObstacles = [];

  for (let r = 0; r < 4; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      if (c === 0) continue;

      const slotIndex = studentSlots.length;
      const deskGroup = new THREE.Group();

      const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 1.1), offWhiteMat);
      tableTop.position.y = 0.8;
      deskGroup.add(tableTop);

      [[0.8, 0.5], [-0.8, 0.5], [0.8, -0.5], [-0.8, -0.5]].forEach((p) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8), woodMat);
        leg.position.set(p[0], 0.4, p[1]);
        deskGroup.add(leg);
      });

      const chairGroup = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.7), woodMat);
      seat.position.set(0, 0.45, 0.8);
      chairGroup.add(seat);

      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.05), woodMat);
      backrest.position.set(0, 0.75, 1.15);
      chairGroup.add(backrest);

      [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]].forEach((p) => {
        const chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45), woodMat);
        chairLeg.position.set(p[0], 0.22, 0.8 + p[1]);
        chairGroup.add(chairLeg);
      });
      deskGroup.add(chairGroup);

      const student = createStudentAvatar(studentColor);
      student.position.set(0, 0.45, 0.8);
      deskGroup.add(student);

      studentSlots.push({
        slotIndex,
        student,
        deskGroup,
        seatPosition: new THREE.Vector3(c * 3.2, 0.45, r * 3.8 - 3.2),
        occupantId: null,
      });

      deskGroup.position.set(c * 3.2, 0, r * 3.8 - 4);
      scene.add(deskGroup);

      staticObstacles.push({
        kind: "desk",
        slotIndex,
        minX: deskGroup.position.x - 0.95,
        maxX: deskGroup.position.x + 0.95,
        minZ: deskGroup.position.z - 0.60,
        maxZ: deskGroup.position.z + 0.30,
      });
      staticObstacles.push({
        kind: "chairBack",
        slotIndex,
        minX: deskGroup.position.x - 0.40,
        maxX: deskGroup.position.x + 0.40,
        minZ: deskGroup.position.z + 1.12,
        maxZ: deskGroup.position.z + 1.25,
      });
    }
  }

  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.3, 3),
    new THREE.MeshStandardMaterial({ color: 0x451a03 }),
  );
  podium.position.set(0, 0.15, -11.5);
  scene.add(podium);

  const teacher = createDetailedTeacher();
  teacher.position.set(0, 0.3, -11);
  scene.add(teacher);

  staticObstacles.push({
    minX: podium.position.x - 3.1,
    maxX: podium.position.x + 3.1,
    minZ: podium.position.z - 1.6,
    maxZ: podium.position.z + 1.6,
  });

  return {
    teacher,
    studentSlots,
    userToSlot,
    staticObstacles,
  };
}
