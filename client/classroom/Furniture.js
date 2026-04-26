import * as THREE from "./three-cdn.js";
import { createStudentAvatar, createTeacherAvatar } from "./Avatars.js";

const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
const offWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfafaf9 });
const podiumMat = new THREE.MeshStandardMaterial({ color: 0x451a03 });

const tableTopGeo = new THREE.BoxGeometry(1.8, 0.05, 1.1);
const tableLegGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8);
const tableLegGeoLow = new THREE.BoxGeometry(0.08, 0.8, 0.08);
const chairSeatGeo = new THREE.BoxGeometry(0.7, 0.05, 0.7);
const chairBackGeo = new THREE.BoxGeometry(0.7, 0.6, 0.05);
const chairLegGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.45);
const chairLegGeoLow = new THREE.BoxGeometry(0.05, 0.45, 0.05);
const podiumGeo = new THREE.BoxGeometry(6, 0.3, 3);

export function createDeskGroup(options = {}) {
  const lowBandwidth = Boolean(options.lowBandwidth);
  const group = new THREE.Group();
  const tableLegGeometry = lowBandwidth ? tableLegGeoLow : tableLegGeo;
  const chairLegGeometry = lowBandwidth ? chairLegGeoLow : chairLegGeo;

  // Table
  const tableTop = new THREE.Mesh(tableTopGeo, offWhiteMat);
  tableTop.position.y = 0.8;
  group.add(tableTop);

  [[0.8, 0.5], [-0.8, 0.5], [0.8, -0.5], [-0.8, -0.5]].forEach((p) => {
    const leg = new THREE.Mesh(tableLegGeometry, woodMat);
    leg.position.set(p[0], 0.4, p[1]);
    group.add(leg);
  });

  // Chair
  const seat = new THREE.Mesh(chairSeatGeo, woodMat);
  seat.position.set(0, 0.45, 0.8);
  group.add(seat);

  const backrest = new THREE.Mesh(chairBackGeo, woodMat);
  backrest.position.set(0, 0.75, 1.15);
  group.add(backrest);

  if (lowBandwidth) {
    return group;
  }

  [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]].forEach((p) => {
    const cLeg = new THREE.Mesh(chairLegGeometry, woodMat);
    cLeg.position.set(p[0], 0.22, 0.8 + p[1]);
    group.add(cLeg);
  });

  return group;
}

export function createClassroomFurniture(scene, options = {}) {
  const lowBandwidth = Boolean(options.lowBandwidth);
  const strictLowBandwidth = Boolean(options.strictLowBandwidth);
  const studentSlots = [];
  const staticObstacles = [];

  const rowCount = strictLowBandwidth ? 1 : (lowBandwidth ? 2 : 3);
  const seatColumns = strictLowBandwidth ? [-1, 1] : [-2, -1, 1, 2];

  for (let r = 0; r < rowCount; r++) {
    for (const c of seatColumns) {

      const slotIndex = studentSlots.length;
      const deskGroup = createDeskGroup({ lowBandwidth: lowBandwidth || strictLowBandwidth });

      const student = createStudentAvatar(0x2563eb, { lowBandwidth: lowBandwidth || strictLowBandwidth });
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

  const podium = new THREE.Mesh(podiumGeo, podiumMat);
  podium.position.set(0, 0.15, -11.5);
  scene.add(podium);

  const teacher = createTeacherAvatar({ lowBandwidth: lowBandwidth || strictLowBandwidth });
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