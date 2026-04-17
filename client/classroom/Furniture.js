import * as THREE from "./three-cdn.js";
import { createStudentAvatar, createTeacherAvatar } from "./Avatars.js";

const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
const offWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfafaf9 });

export function createDeskGroup() {
  const group = new THREE.Group();

  // Table
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 1.1), offWhiteMat);
  tableTop.position.y = 0.8;
  group.add(tableTop);

  [[0.8, 0.5], [-0.8, 0.5], [0.8, -0.5], [-0.8, -0.5]].forEach((p) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.8), woodMat);
    leg.position.set(p[0], 0.4, p[1]);
    group.add(leg);
  });

  // Chair
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.7), woodMat);
  seat.position.set(0, 0.45, 0.8);
  group.add(seat);

  const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.05), woodMat);
  backrest.position.set(0, 0.75, 1.15);
  group.add(backrest);

  [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]].forEach((p) => {
    const cLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45), woodMat);
    cLeg.position.set(p[0], 0.22, 0.8 + p[1]);
    group.add(cLeg);
  });

  return group;
}

export function createClassroomFurniture(scene) {
  const studentSlots = [];
  const staticObstacles = [];

  for (let r = 0; r < 3; r++) {
    for (let c = -2; c <= 2; c++) {
      if (c === 0) continue;

      const slotIndex = studentSlots.length;
      const deskGroup = createDeskGroup();

      const student = createStudentAvatar(0x2563eb);
      student.position.set(0, 0.45, 0.8);
      deskGroup.add(student);

      deskGroup.position.set(c * 3.2, 0, r * 3.8 - 4);
      scene.add(deskGroup);

      studentSlots.push({
        slotIndex,
        student,
        deskGroup,
        seatPosition: new THREE.Vector3(c * 3.2, 0.45, r * 3.8 - 3.2),
        occupantId: null,
      });

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
    new THREE.MeshStandardMaterial({ color: 0x451a03 })
  );
  podium.position.set(0, 0.15, -11.5);
  scene.add(podium);

  const teacher = createTeacherAvatar();
  teacher.position.set(0, 0.3, -11);
  scene.add(teacher);

  staticObstacles.push({
    minX: podium.position.x - 3.1,
    maxX: podium.position.x + 3.1,
    minZ: podium.position.z - 1.6,
    maxZ: podium.position.z + 1.6,
  });

  return { studentSlots, staticObstacles, teacher };
}