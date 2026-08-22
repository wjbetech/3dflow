import * as THREE from "three";
import { createFillModel, type FillModel } from "./metrics/fill";
import { computeSolidMetrics, type SolidMetrics } from "./metrics/solid";

export type ShapeRecipe = {
  id: string;
  label: string;
  summary: string;
  seed: number;
  amplitude: number;
  ridges: number;
  twist: number;
  stretch: {
    x: number;
    y: number;
    z: number;
  };
};

export type ShapeField = {
  recipe: ShapeRecipe;
  geometry: THREE.BufferGeometry;
  irregularity: number;
  centerOffset: THREE.Vector3;
  bounds: THREE.Box3;
  scale: THREE.Vector3;
  metrics: SolidMetrics;
  fillModel: FillModel;
};

export const shapePresets: ShapeRecipe[] = [
  {
    id: "tidal-shell",
    label: "Tidal shell",
    summary: "A soft marine vessel with asymmetric shoulders and a stable basin for fill testing.",
    seed: 2.4,
    amplitude: 0.19,
    ridges: 6,
    twist: 0.05,
    stretch: { x: 0.18, y: -0.06, z: 0.12 }
  },
  {
    id: "reef-stone",
    label: "Reef stone",
    summary: "Chunkier and more uneven, useful for seeing water slices across sharper local variation.",
    seed: 5.8,
    amplitude: 0.24,
    ridges: 9,
    twist: -0.08,
    stretch: { x: -0.1, y: 0.15, z: 0.07 }
  },
  {
    id: "melt-column",
    label: "Melt column",
    summary: "Tall and compressed across one axis, good for tilt and pour experiments.",
    seed: 8.6,
    amplitude: 0.17,
    ridges: 5,
    twist: 0.14,
    stretch: { x: -0.16, y: 0.3, z: -0.08 }
  }
];

export const customRecipeDefaults: ShapeRecipe = {
  id: "custom",
  label: "Custom irregular vessel",
  summary: "User-authored irregular vessel.",
  seed: 4.2,
  amplitude: 0.18,
  ridges: 7,
  twist: 0.04,
  stretch: { x: 0.08, y: 0.02, z: -0.06 }
};

const baseRadius = 1.22;
const vesselTessellationDetail = 31;

export function getRecipeById(id: string) {
  return shapePresets.find((recipe) => recipe.id === id) ?? shapePresets[0];
}

export function buildIrregularGeometry(recipe: ShapeRecipe): ShapeField {
  const geometry = new THREE.IcosahedronGeometry(baseRadius, vesselTessellationDetail);
  const positions = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const centerOffset = new THREE.Vector3();
  const scale = getShapeScale(recipe);

  let radiusTotal = 0;
  let radiusSquaredTotal = 0;

  for (let index = 0; index < positions.count; index += 1) {
    vertex.fromBufferAttribute(positions, index);
    const direction = vertex.normalize();
    const radius = getDirectionalRadius(recipe, direction);

    vertex.set(
      direction.x * radius * scale.x,
      direction.y * radius * scale.y,
      direction.z * radius * scale.z
    );

    positions.setXYZ(index, vertex.x, vertex.y, vertex.z);

    const measuredRadius = vertex.length();
    radiusTotal += measuredRadius;
    radiusSquaredTotal += measuredRadius * measuredRadius;
  }

  positions.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.boundingBox?.getCenter(centerOffset);
  geometry.translate(-centerOffset.x, -centerOffset.y, -centerOffset.z);
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();

  const meanRadius = radiusTotal / positions.count;
  const variance = radiusSquaredTotal / positions.count - meanRadius * meanRadius;
  const irregularity = Math.max(0, Math.sqrt(Math.max(variance, 0)) * 100);
  const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3();
  const metrics = computeSolidMetrics(geometry);
  const fillModel = createFillModel(geometry);

  return {
    recipe,
    geometry,
    irregularity,
    centerOffset,
    bounds,
    scale,
    metrics,
    fillModel
  };
}

export function measureIrregularity(recipe: ShapeRecipe) {
  const { geometry, irregularity } = buildIrregularGeometry(recipe);
  geometry.dispose();
  return irregularity;
}

export function isPointInsideField(field: ShapeField, point: THREE.Vector3, margin = 0) {
  const uncentered = point.clone().add(field.centerOffset);
  const scaledPoint = new THREE.Vector3(
    uncentered.x / field.scale.x,
    uncentered.y / field.scale.y,
    uncentered.z / field.scale.z
  );
  const distance = scaledPoint.length();

  if (distance <= 1e-5) {
    return true;
  }

  const direction = scaledPoint.multiplyScalar(1 / distance);
  const boundary = Math.max(0.02, getDirectionalRadius(field.recipe, direction) - margin);
  return distance <= boundary;
}

export function projectPointInsideField(
  field: ShapeField,
  point: THREE.Vector3,
  margin = 0,
  target = new THREE.Vector3()
) {
  const uncentered = point.clone().add(field.centerOffset);
  const scaledPoint = new THREE.Vector3(
    uncentered.x / field.scale.x,
    uncentered.y / field.scale.y,
    uncentered.z / field.scale.z
  );
  const distance = scaledPoint.length();

  if (distance <= 1e-5) {
    return target.copy(point);
  }

  const direction = scaledPoint.multiplyScalar(1 / distance);
  const boundary = Math.max(0.02, getDirectionalRadius(field.recipe, direction) - margin);

  if (distance <= boundary) {
    return target.copy(point);
  }

  const corrected = direction.multiplyScalar(boundary);
  return target
    .set(corrected.x * field.scale.x, corrected.y * field.scale.y, corrected.z * field.scale.z)
    .sub(field.centerOffset);
}

export function sampleFillPoints(field: ShapeField, fillPercent: number, count: number) {
  const points: THREE.Vector3[] = [];
  const cutoffY = getFillCutoffY(field, fillPercent);
  const size = field.bounds.getSize(new THREE.Vector3());
  const origin = field.bounds.min;
  const candidate = new THREE.Vector3();
  const fallbackDirection = new THREE.Vector3();
  const maxAttempts = Math.max(600, count * 140);

  for (let attempt = 0; attempt < maxAttempts && points.length < count; attempt += 1) {
    candidate.set(
      origin.x + Math.random() * size.x,
      origin.y + Math.random() * size.y,
      origin.z + Math.random() * size.z
    );

    if (candidate.y <= cutoffY && isPointInsideField(field, candidate, 0.16)) {
      points.push(candidate.clone());
    }
  }

  while (points.length < count) {
    fallbackDirection
      .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      .normalize()
      .multiplyScalar(Math.random() * 0.58);

    candidate.copy(fallbackDirection);
    candidate.y = Math.min(candidate.y, cutoffY - 0.04);

    if (isPointInsideField(field, candidate, 0.16)) {
      points.push(candidate.clone());
    }
  }

  return points;
}

export function getFillCutoffY(field: ShapeField, fillPercent: number) {
  const model = field.fillModel;
  const clampedFill = THREE.MathUtils.clamp(fillPercent / 100, 0, 1);

  if (clampedFill <= 0) {
    return model.minHeight;
  }

  if (clampedFill >= 1) {
    return model.maxHeight;
  }

  const targetVolume = clampedFill * model.totalVolume;
  let low = model.minHeight;
  let high = model.maxHeight;
  const range = high - low;

  for (let iteration = 0; iteration < 80 && high - low > range * 1e-9; iteration += 1) {
    const mid = (low + high) / 2;

    if (model.volumeBelow(mid) < targetVolume) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function getShapeScale(recipe: ShapeRecipe) {
  return new THREE.Vector3(1 + recipe.stretch.x, 1 + recipe.stretch.y, 1 + recipe.stretch.z);
}

export function getDirectionalRadius(recipe: ShapeRecipe, direction: THREE.Vector3) {
  const waveA = Math.sin(direction.x * recipe.ridges + recipe.seed);
  const waveB = Math.cos(direction.y * (recipe.ridges + 1) - recipe.seed * 1.3);
  const waveC = Math.sin(direction.z * (recipe.ridges + 2) + recipe.seed * 0.6);
  const compound = (waveA + waveB + waveC) / 3;
  const wobble = recipe.twist * direction.x * direction.y * direction.z * 8;

  return Math.max(0.65, baseRadius * (1 + compound * recipe.amplitude + wobble));
}
