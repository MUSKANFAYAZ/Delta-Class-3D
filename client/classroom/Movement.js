import * as THREE from "three";

export function createClassroomMovement({
  studentSlots,
  staticObstacles,
  teacher,
  onStudentMoved,
}) {
  const userToSlot = new Map();

  function emitStudentMove(slot, userId) {
    if (!onStudentMoved) return;

    const worldPosition = getWorldStudentPosition(slot, slot.student.position.x, slot.student.position.z);
    const seatedDistance = worldPosition.distanceToSquared(slot.seatPosition);
    const seated = seatedDistance <= (0.45 * 0.45);

    onStudentMoved({
      userId,
      slot,
      worldPosition,
      seated,
    });
  }

  function assignStudentToUser(userId, preferredSlotIndex = null) {
    if (!userId) return null;
    if (userToSlot.has(userId)) {
      return studentSlots[userToSlot.get(userId)] || null;
    }

    let slotIndex = Number.isInteger(preferredSlotIndex) ? preferredSlotIndex : -1;
    if (slotIndex < 0 || slotIndex >= studentSlots.length || studentSlots[slotIndex].occupantId) {
      slotIndex = studentSlots.findIndex((slot) => !slot.occupantId);
    }
    if (slotIndex < 0) return null;

    const slot = studentSlots[slotIndex];
    slot.occupantId = userId;
    userToSlot.set(userId, slotIndex);
    slot.student.position.set(0, 0.45, 0.8);
    emitStudentMove(slot, userId);
    return slot;
  }

  function getWorldStudentPosition(slot, localX, localZ) {
    const worldPos = new THREE.Vector3(localX, 0.45, localZ);
    slot.deskGroup.localToWorld(worldPos);
    return worldPos;
  }

  function circleIntersectsRect(x, z, radius, rect) {
    const clampedX = Math.max(rect.minX, Math.min(x, rect.maxX));
    const clampedZ = Math.max(rect.minZ, Math.min(z, rect.maxZ));
    const dx = x - clampedX;
    const dz = z - clampedZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  function canMoveStudentTo(slot, localX, localZ) {
    const avatarRadius = 0.22;
    const nextWorld = getWorldStudentPosition(slot, localX, localZ);
    const ownSeatWorld = getWorldStudentPosition(slot, 0, 0.8);
    const isReturningToOwnSeat = nextWorld.distanceToSquared(ownSeatWorld) <= (0.55 * 0.55);

    if (nextWorld.x < -11.5 || nextWorld.x > 11.5 || nextWorld.z < -14.2 || nextWorld.z > 14.5) {
      return false;
    }

    for (const rect of staticObstacles) {
      if (
        rect.kind === "chairBack" &&
        rect.slotIndex === slot.slotIndex &&
        isReturningToOwnSeat
      ) {
        continue;
      }
      if (circleIntersectsRect(nextWorld.x, nextWorld.z, avatarRadius, rect)) {
        return false;
      }
    }

    const teacherRadius = 0.45;
    const dxTeacher = nextWorld.x - teacher.position.x;
    const dzTeacher = nextWorld.z - teacher.position.z;
    if ((dxTeacher * dxTeacher + dzTeacher * dzTeacher) <= ((avatarRadius + teacherRadius) ** 2)) {
      return false;
    }

    for (const otherSlot of studentSlots) {
      if (!otherSlot.occupantId || otherSlot === slot) continue;

      const otherWorld = getWorldStudentPosition(
        otherSlot,
        otherSlot.student.position.x,
        otherSlot.student.position.z,
      );
      const dx = nextWorld.x - otherWorld.x;
      const dz = nextWorld.z - otherWorld.z;
      const minDistance = avatarRadius * 2;
      if ((dx * dx + dz * dz) <= (minDistance * minDistance)) {
        return false;
      }
    }

    return true;
  }

  function moveAssignedStudent(userId, payload) {
    if (!userId || !payload) return;

    const slot = assignStudentToUser(userId);
    if (!slot) return;

    let nextX = slot.student.position.x;
    let nextZ = slot.student.position.z;
    const speed = 0.2;

    if (typeof payload.x === "number") nextX = payload.x;
    if (typeof payload.z === "number") nextZ = payload.z;
    if (payload.direction === "up") nextZ -= speed;
    if (payload.direction === "down") nextZ += speed;
    if (payload.direction === "left") nextX -= speed;
    if (payload.direction === "right") nextX += speed;

    if (!canMoveStudentTo(slot, nextX, nextZ)) return;
    slot.student.position.set(nextX, 0.45, nextZ);
    emitStudentMove(slot, userId);
  }

  function moveTeacherByDirection(direction) {
    const speed = 0.2;
    if (direction === "up") teacher.position.z -= speed;
    if (direction === "down") teacher.position.z += speed;
    if (direction === "left") teacher.position.x -= speed;
    if (direction === "right") teacher.position.x += speed;
  }

  return {
    assignStudentToUser,
    moveAssignedStudent,
    moveTeacherByDirection,
  };
}
