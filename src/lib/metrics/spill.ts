import * as THREE from "three";
import { getFillModelForDirection } from "./fill";
import type { ShapeField } from "../shapes";

export type SpillState = {
  maxContainedVolume: number;
  headroomVolume: number;
  spilling: boolean;
};

export function computeSpillState(
  field: ShapeField,
  tiltQuaternion: THREE.Quaternion,
  waterVolume: number
): SpillState | null {
  if (field.mouthY === null || field.rimPoints.length === 0) {
    return null;
  }

  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(tiltQuaternion.clone().invert());
  let rimLowest = Number.POSITIVE_INFINITY;

  for (let index = 0; index < field.rimPoints.length; index += 3) {
    const projection =
      field.rimPoints[index] * localUp.x +
      field.rimPoints[index + 1] * localUp.y +
      field.rimPoints[index + 2] * localUp.z;

    if (projection < rimLowest) {
      rimLowest = projection;
    }
  }

  const directionalModel = getFillModelForDirection(field.cappedGeometry, localUp);
  const maxContainedVolume = directionalModel.volumeBelow(rimLowest);
  const headroomVolume = maxContainedVolume - waterVolume;

  return {
    maxContainedVolume,
    headroomVolume,
    spilling: headroomVolume <= 1e-9
  };
}
