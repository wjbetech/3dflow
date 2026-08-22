import * as THREE from "three";
import { createFillModel, type FillModel } from "./metrics/fill";
import { computeSolidMetrics, type SolidMetrics } from "./metrics/solid";
import { buildVoxelSdf, type VoxelSdf } from "./metrics/sdf";

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
  lidVertexStart: number;
  irregularity: number;
  centerOffset: THREE.Vector3;
  bounds: THREE.Box3;
  scale: THREE.Vector3;
  metrics: SolidMetrics;
  fillModel: FillModel;
  sdf: VoxelSdf;
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
  const capped =
    mouthY === null
      ? { geometry, lidVertexStart: Number.POSITIVE_INFINITY }
      : buildCappedGeometry(geometry, mouthY);
  const cappedGeometry = capped.geometry;
  const rimPoints = mouthY === null ? [] : collectRimLoop(cappedGeometry, mouthY);
  const fillModel = createFillModel(cappedGeometry);
  const sdf = buildVoxelSdf(cappedGeometry, 52);

  return {
    recipe,
    geometry,
    cappedGeometry,
    lidVertexStart: capped.lidVertexStart,
    irregularity,
    centerOffset,
    bounds,
    scale,
    metrics,
    fillModel,
    sdf,
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

    emitClippedTriangle(tri, mouthY, outPositions);
  }

  const lidVertexStart = outPositions.length / 3;

  appendLidFromBoundary(source, mouthY, outPositions);

  const capped = new THREE.BufferGeometry();
  capped.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));

  const wallVertexCount = lidVertexStart;
  const lidVertexCount = outPositions.length / 3 - lidVertexStart;

  if (lidVertexCount > 0) {
    capped.addGroup(0, wallVertexCount, 0);
    capped.addGroup(wallVertexCount, lidVertexCount, 1);
  }

  capped.computeVertexNormals();

  return { geometry: capped, lidVertexStart };
}

function emitClippedTriangle(
  triangle: Array<[number, number, number]>,
  mouthY: number,
  out: number[]
) {
  const kept: Array<[number, number, number]> = [];

  for (let i = 0; i < 3; i += 1) {
    const current = triangle[i];
    const next = triangle[(i + 1) % 3];
    const currentBelow = current[1] <= mouthY;
    const nextBelow = next[1] <= mouthY;

    if (currentBelow) {
      kept.push(current);
    }

    if (currentBelow !== nextBelow) {
      let low = current;
      let high = next;

      if (low[1] > high[1]) {
        const swap = low;
        low = high;
        high = swap;
      }

      const t = (mouthY - low[1]) / (high[1] - low[1]);
      kept.push([
        low[0] + (high[0] - low[0]) * t,
        mouthY,
        low[2] + (high[2] - low[2]) * t
      ]);
    }
  }

  if (kept.length < 3) {
    return;
  }

  for (let i = 1; i < kept.length - 1; i += 1) {
    pushTriangle(out, kept[0], kept[i], kept[i + 1]);
  }
}

function appendLidFromBoundary(
  source: THREE.BufferGeometry,
  mouthY: number,
  out: number[]
) {
  const srcPositions = source.getAttribute("position");
  const srcIndex = source.getIndex();
  const srcCount = srcIndex ? srcIndex.count : srcPositions.count;
  const points: Array<[number, number]> = [];
  const seen = new Set<string>();

  for (let start = 0; start < srcCount; start += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const i0 = srcIndex ? srcIndex.getX(start + corner) : start + corner;
      const i1 = srcIndex ? srcIndex.getX(start + ((corner + 1) % 3)) : start + ((corner + 1) % 3);

      const y0 = srcPositions.getY(i0);
      const y1 = srcPositions.getY(i1);

      if ((y0 < mouthY) === (y1 < mouthY)) {
        continue;
      }

      const t = (mouthY - y0) / (y1 - y0);
      const x = srcPositions.getX(i0) + (srcPositions.getX(i1) - srcPositions.getX(i0)) * t;
      const z = srcPositions.getZ(i0) + (srcPositions.getZ(i1) - srcPositions.getZ(i0)) * t;
      const key = `${x.toFixed(5)}:${z.toFixed(5)}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      points.push([x, z]);
    }
  }

  if (points.length < 3) {
    return;
  }

  let centroidX = 0;
  let centroidZ = 0;

  for (const [x, z] of points) {
    centroidX += x;
    centroidZ += z;
  }

  centroidX /= points.length;
  centroidZ /= points.length;

  points.sort(
    (a, b) =>
      Math.atan2(a[1] - centroidZ, a[0] - centroidX) -
      Math.atan2(b[1] - centroidZ, b[0] - centroidX)
  );

  let doubledArea = 0;

  for (let i = 0; i < points.length; i += 1) {
    const from = points[i];
    const to = points[(i + 1) % points.length];
    doubledArea += from[0] * to[1] - to[0] * from[1];
  }

  if (Math.abs(doubledArea) < 1e-9) {
    return;
  }

  const ordered = doubledArea > 0 ? [...points].reverse() : points;

  for (let i = 0; i < ordered.length; i += 1) {
    const from = ordered[i];
    const to = ordered[(i + 1) % ordered.length];

    out.push(
      centroidX,
      mouthY,
      centroidZ,
      from[0],
      mouthY,
      from[1],
      to[0],
      mouthY,
      to[1]
    );
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

export function measureIrregularity(recipe: ShapeRecipe) {
  const { geometry, irregularity } = buildIrregularGeometry(recipe);
  geometry.dispose();
  return irregularity;
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
