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
  mouth: number;
  stretch: {
    x: number;
    y: number;
    z: number;
  };
};

export type ShapeField = {
  recipe: ShapeRecipe;
  geometry: THREE.BufferGeometry;
  cappedGeometry: THREE.BufferGeometry;
  irregularity: number;
  centerOffset: THREE.Vector3;
  bounds: THREE.Box3;
  scale: THREE.Vector3;
  metrics: SolidMetrics;
  fillModel: FillModel;
  mouthY: number | null;
  rimPoints: number[];
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
    mouth: 0.84,
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
    mouth: 0.8,
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
    mouth: 0.88,
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
  mouth: 0.85,
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

  const mouthY =
    recipe.mouth >= 1 ? null : bounds.min.y + recipe.mouth * (bounds.max.y - bounds.min.y);
  const cappedGeometry =
    mouthY === null ? geometry : buildCappedGeometry(geometry, mouthY);
  const rimPoints = mouthY === null ? [] : collectRimLoop(cappedGeometry, mouthY);
  const fillModel = createFillModel(cappedGeometry);

  return {
    recipe,
    geometry,
    cappedGeometry,
    irregularity,
    centerOffset,
    bounds,
    scale,
    metrics,
    fillModel,
    mouthY,
    rimPoints
  };
}

function collectRimLoop(geometry: THREE.BufferGeometry, mouthY: number) {
  const positions = geometry.getAttribute("position");
  const points: number[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < positions.count; i += 1) {
    if (Math.abs(positions.getY(i) - mouthY) > 1e-6) {
      continue;
    }

    const key = `${positions.getX(i).toFixed(5)}:${positions.getZ(i).toFixed(5)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    points.push(positions.getX(i), positions.getY(i), positions.getZ(i));
  }

  return points;
}

function buildCappedGeometry(source: THREE.BufferGeometry, mouthY: number) {
  const srcPositions = source.getAttribute("position");
  const srcIndex = source.getIndex();
  const srcCount = srcIndex ? srcIndex.count : srcPositions.count;

  const outPositions: number[] = [];
  const cutSegments: Array<[[number, number], [number, number]]> = [];
  const readVertex = (i: number) => [
    srcPositions.getX(i),
    srcPositions.getY(i),
    srcPositions.getZ(i)
  ] as [number, number, number];

  for (let start = 0; start < srcCount; start += 3) {
    const tri = [
      readVertex(srcIndex ? srcIndex.getX(start) : start),
      readVertex(srcIndex ? srcIndex.getX(start + 1) : start + 1),
      readVertex(srcIndex ? srcIndex.getX(start + 2) : start + 2)
    ];

    emitClippedTriangle(tri, mouthY, outPositions, cutSegments);
  }

  appendLidFans(outPositions, cutSegments, mouthY);

  const capped = new THREE.BufferGeometry();
  capped.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
  capped.computeVertexNormals();
  return capped;
}

function emitClippedTriangle(
  triangle: Array<[number, number, number]>,
  mouthY: number,
  out: number[],
  cutSegments: Array<[[number, number], [number, number]]>
) {
  const kept: Array<[number, number, number]> = [];
  let segmentA: [number, number] | null = null;
  let segmentB: [number, number] | null = null;

  for (let i = 0; i < 3; i += 1) {
    const current = triangle[i];
    const next = triangle[(i + 1) % 3];
    const currentBelow = current[1] <= mouthY;
    const nextBelow = next[1] <= mouthY;

    if (currentBelow) {
      kept.push(current);
    }

    if (currentBelow !== nextBelow) {
      const t = (mouthY - current[1]) / (next[1] - current[1]);
      const point: [number, number, number] = [
        current[0] + (next[0] - current[0]) * t,
        mouthY,
        current[2] + (next[2] - current[2]) * t
      ];
      kept.push(point);

      const flatPoint: [number, number] = [point[0], point[2]];
      if (!segmentA) {
        segmentA = flatPoint;
      } else {
        segmentB = flatPoint;
      }
    }
  }

  if (kept.length < 3) {
    return;
  }

  if (segmentA && segmentB) {
    cutSegments.push([segmentA, segmentB]);
  }

  for (let i = 1; i < kept.length - 1; i += 1) {
    pushTriangle(out, kept[0], kept[i], kept[i + 1]);
  }
}

function appendLidFans(
  out: number[],
  rawSegments: Array<[[number, number], [number, number]]>,
  mouthY: number
) {
  const adjacency = new Map<string, Array<[number, number]>>();
  const keyOf = (p: [number, number]) => `${p[0].toFixed(5)}:${p[1].toFixed(5)}`;
  const seenSegments = new Set<string>();

  for (const [a, b] of rawSegments) {
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) {
      continue;
    }

    const forwardKey = `${keyOf(a)}>${keyOf(b)}`;
    const backwardKey = `${keyOf(b)}>${keyOf(a)}`;

    if (seenSegments.has(forwardKey) || seenSegments.has(backwardKey)) {
      continue;
    }

    seenSegments.add(forwardKey);
    pushToMap(adjacency, keyOf(a), b);
    pushToMap(adjacency, keyOf(b), a);
  }

  while (adjacency.size > 0) {
    const startEntry = adjacency.keys().next();

    if (startEntry.done || !startEntry.value) {
      break;
    }

    const startKey = startEntry.value;
    const loop: Array<[number, number]> = [];
    let cursorKey: string | null = startKey;
    let closed = false;

    while (cursorKey && adjacency.has(cursorKey)) {
      const cursorParts = cursorKey.split(":").map(Number);
      loop.push([cursorParts[0], cursorParts[1]]);

      const candidates = adjacency.get(cursorKey);

      if (!candidates || candidates.length === 0) {
        adjacency.delete(cursorKey);
        break;
      }

      const nextPoint = candidates.pop() as [number, number];
      const remaining = adjacency.get(cursorKey);

      if (!remaining || remaining.length === 0) {
        adjacency.delete(cursorKey);
      }

      const nextKey = keyOf(nextPoint);

      if (nextKey === startKey) {
        closed = true;
        break;
      }

      cursorKey = nextKey;
    }

    const dedupedLoop: Array<[number, number]> = [];

    for (const point of loop) {
      const previous = dedupedLoop[dedupedLoop.length - 1];

      if (!previous || Math.hypot(previous[0] - point[0], previous[1] - point[1]) > 1e-7) {
        dedupedLoop.push(point);
      }
    }

    if (!closed || dedupedLoop.length < 3) {
      continue;
    }

    let centroidX = 0;
    let centroidZ = 0;

    for (const [x, z] of dedupedLoop) {
      centroidX += x;
      centroidZ += z;
    }

    centroidX /= dedupedLoop.length;
    centroidZ /= dedupedLoop.length;

    let doubledArea = 0;

    for (let i = 0; i < dedupedLoop.length; i += 1) {
      const from = dedupedLoop[i];
      const to = dedupedLoop[(i + 1) % dedupedLoop.length];
      doubledArea += from[0] * to[1] - to[0] * from[1];
    }

    if (Math.abs(doubledArea) < 1e-9) {
      continue;
    }

    const orderedLoop = doubledArea > 0 ? [...dedupedLoop].reverse() : dedupedLoop;
    const centre: [number, number] = [centroidX, centroidZ];

    for (let i = 0; i < orderedLoop.length; i += 1) {
      const from = orderedLoop[i];
      const to = orderedLoop[(i + 1) % orderedLoop.length];

      pushTriangleFlat(out, centre, from, to, mouthY);
    }
  }
}

function pushToMap<K>(map: Map<K, Array<[number, number]>>, key: K, value: [number, number]) {
  const list = map.get(key);

  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function pushTriangle(
  out: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function pushTriangleFlat(
  out: number[],
  a: [number, number],
  b: [number, number],
  c: [number, number],
  y: number
) {
  out.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
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
