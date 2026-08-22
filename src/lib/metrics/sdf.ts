import * as THREE from "three";

export type VoxelSdf = {
  dims: [number, number, number];
  minCorner: THREE.Vector3;
  cellSize: number;
  field: Float32Array;
  sampleDistance(point: THREE.Vector3): number;
  isInside(point: THREE.Vector3, margin?: number): boolean;
};

type ChamferOffset = [number, number, number, number];

const forwardChamferOffsets: ChamferOffset[] = [
  [1, 0, 0, 3],
  [0, 1, 0, 3],
  [0, 0, 1, 3],
  [1, 1, 0, 4],
  [-1, 1, 0, 4],
  [1, 0, 1, 4],
  [-1, 0, 1, 4],
  [0, 1, 1, 4],
  [0, -1, 1, 4],
  [1, 1, 1, 5],
  [-1, 1, 1, 5],
  [1, -1, 1, 5],
  [-1, -1, 1, 5]
];

const backwardChamferOffsets: ChamferOffset[] = forwardChamferOffsets.map(
  ([di, dj, dk, weight]) => [-di, -dj, -dk, weight] as ChamferOffset
);

function flattenOffsets(offsets: ChamferOffset[]) {
  const flat = new Int16Array(offsets.length * 4);

  for (let o = 0; o < offsets.length; o += 1) {
    flat[o * 4] = offsets[o][0];
    flat[o * 4 + 1] = offsets[o][1];
    flat[o * 4 + 2] = offsets[o][2];
    flat[o * 4 + 3] = offsets[o][3];
  }

  return flat;
}

function clampInt(value: number, low: number, high: number) {
  return value < low ? low : value > high ? high : value;
}

export function buildVoxelSdf(
  geometry: THREE.BufferGeometry,
  targetResolution = 64
): VoxelSdf {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox
    ? geometry.boundingBox.clone()
    : new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  const span = box.getSize(new THREE.Vector3());
  const maxSpan = Math.max(span.x, span.y, span.z) || 1;
  const cellSize = maxSpan / Math.max(targetResolution, 8);
  const padding = cellSize * 2;
  const minCorner = box.min.clone().subScalar(padding);
  const paddedSpan = box.max.clone().sub(minCorner);

  const nx = Math.ceil(paddedSpan.x / cellSize) + 1;
  const ny = Math.ceil(paddedSpan.y / cellSize) + 1;
  const nz = Math.ceil(paddedSpan.z / cellSize) + 1;

  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const vertexCount = index ? index.count : positions.count;

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error("buildVoxelSdf requires a triangulated mesh");
  }

  const triCount = vertexCount / 3;
  const triangles = new Float32Array(triCount * 9);
  const triangleMinY = new Float32Array(triCount);
  const triangleMaxY = new Float32Array(triCount);

  for (let t = 0; t < triCount; t += 1) {
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let corner = 0; corner < 3; corner += 1) {
      const vi = index ? index.getX(t * 3 + corner) : t * 3 + corner;
      const offset = t * 9 + corner * 3;

      triangles[offset] = positions.getX(vi);
      triangles[offset + 1] = positions.getY(vi);
      triangles[offset + 2] = positions.getZ(vi);

      if (triangles[offset + 1] < minY) minY = triangles[offset + 1];
      if (triangles[offset + 1] > maxY) maxY = triangles[offset + 1];
    }

    triangleMinY[t] = minY;
    triangleMaxY[t] = maxY;
  }

  const bins: number[][] = Array.from({ length: nx * ny }, () => []);

  for (let t = 0; t < triCount; t += 1) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    for (let corner = 0; corner < 3; corner += 1) {
      const x = triangles[t * 9 + corner * 3];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    const i0 = clampInt(Math.floor((minX - minCorner.x) / cellSize), 0, nx - 1);
    const i1 = clampInt(Math.floor((maxX - minCorner.x) / cellSize), 0, nx - 1);
    const j0 = clampInt(Math.floor((triangleMinY[t] - minCorner.y) / cellSize), 0, ny - 1);
    const j1 = clampInt(Math.floor((triangleMaxY[t] - minCorner.y) / cellSize), 0, ny - 1);

    for (let j = j0; j <= j1; j += 1) {
      const rowBase = j * nx;

      for (let i = i0; i <= i1; i += 1) {
        bins[rowBase + i].push(t);
      }
    }
  }

  const inside = new Uint8Array(nx * ny * nz);
  const crossings: number[] = [];
  const jitterX = cellSize * 1e-4;
  const jitterY = -cellSize * 1.7e-4;

  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const px = minCorner.x + (i + 0.5) * cellSize + jitterX;
      const py = minCorner.y + (j + 0.5) * cellSize + jitterY;
      const candidates = bins[j * nx + i];

      crossings.length = 0;

      for (let c = 0; c < candidates.length; c += 1) {
        const t = candidates[c];

        if (py < triangleMinY[t] || py > triangleMaxY[t]) {
          continue;
        }

        const base = t * 9;
        const v0x = triangles[base];
        const v0y = triangles[base + 1];
        const v0z = triangles[base + 2];
        const v1x = triangles[base + 3];
        const v1y = triangles[base + 4];
        const v1z = triangles[base + 5];
        const v2x = triangles[base + 6];
        const v2y = triangles[base + 7];
        const v2z = triangles[base + 8];

        const edge0 = (v1x - v0x) * (py - v0y) - (v1y - v0y) * (px - v0x);
        const edge1 = (v2x - v1x) * (py - v1y) - (v2y - v1y) * (px - v1x);
        const edge2 = (v0x - v2x) * (py - v2y) - (v0y - v2y) * (px - v2x);

        const positive = edge0 >= 0 && edge1 >= 0 && edge2 >= 0;
        const negative = edge0 <= 0 && edge1 <= 0 && edge2 <= 0;

        if (!positive && !negative) {
          continue;
        }

        const axisX = v1x - v0x;
        const axisY = v1y - v0y;
        const axisZ = v1z - v0z;
        const otherX = v2x - v0x;
        const otherY = v2y - v0y;
        const otherZ = v2z - v0z;
        const normalX = axisY * otherZ - axisZ * otherY;
        const normalY = axisZ * otherX - axisX * otherZ;
        const normalZ = axisX * otherY - axisY * otherX;

        if (Math.abs(normalZ) < 1e-10) {
          continue;
        }

        crossings.push(v0z - (normalX * (px - v0x) + normalY * (py - v0y)) / normalZ);
      }

      if (crossings.length < 2) {
        continue;
      }

      crossings.sort((a, b) => a - b);

      const pairs = Math.floor(crossings.length / 2);
      const columnBase = i + j * nx;

      for (let pair = 0; pair < pairs; pair += 1) {
        const zLow = crossings[pair * 2];
        const zHigh = crossings[pair * 2 + 1];
        const kStart = clampInt(Math.ceil((zLow - minCorner.z) / cellSize - 0.5), 0, nz - 1);
        const kEnd = clampInt(Math.floor((zHigh - minCorner.z) / cellSize - 0.5), 0, nz - 1);

        for (let k = kStart; k <= kEnd; k += 1) {
          inside[columnBase + k * nx * ny] = 1;
        }
      }
    }
  }

  const total = nx * ny * nz;
  const distanceUnits = new Float64Array(total);
  const largeDistance = 1e15;

  const statusAt = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : inside[i + j * nx + k * nx * ny];

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const idx = i + j * nx + k * nx * ny;
        const status = inside[idx];

        if (
          statusAt(i + 1, j, k) !== status ||
          statusAt(i - 1, j, k) !== status ||
          statusAt(i, j + 1, k) !== status ||
          statusAt(i, j - 1, k) !== status ||
          statusAt(i, j, k + 1) !== status ||
          statusAt(i, j, k - 1) !== status
        ) {
          distanceUnits[idx] = 0;
        } else {
          distanceUnits[idx] = largeDistance;
        }
      }
    }
  }

  const forwardFlat = flattenOffsets(forwardChamferOffsets);
  const backwardFlat = flattenOffsets(backwardChamferOffsets);

  const sweep = (offsets: Int16Array, kStart: number, kEnd: number, kStep: number) => {
    for (let k = kStart; k !== kEnd; k += kStep) {
      for (let j = 0; j < ny; j += 1) {
        const rowBase = j * nx;
        const layerBase = k * nx * ny;

        for (let i = 0; i < nx; i += 1) {
          const idx = i + rowBase + layerBase;
          let value = distanceUnits[idx];

          if (value === 0) {
            continue;
          }

          for (let o = 0; o < offsets.length; o += 4) {
            const ni = i + offsets[o];
            const nj = j + offsets[o + 1];
            const nk = k + offsets[o + 2];

            if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) {
              continue;
            }

            const candidate = distanceUnits[ni + nj * nx + nk * nx * ny] + offsets[o + 3];

            if (candidate < value) {
              value = candidate;
            }
          }

          distanceUnits[idx] = value;
        }
      }
    }
  };

  sweep(forwardFlat, 0, nz, 1);
  sweep(backwardFlat, nz - 1, -1, -1);

  const field = new Float32Array(total);
  const scale = cellSize / 3;

  for (let idx = 0; idx < total; idx += 1) {
    const magnitude = Math.min(distanceUnits[idx], largeDistance) * scale;

    field[idx] = inside[idx] === 1 ? -magnitude : magnitude;
  }

  return {
    dims: [nx, ny, nz],
    minCorner,
    cellSize,
    field,
    sampleDistance(point: THREE.Vector3) {
      const i = clampInt(Math.floor((point.x - minCorner.x) / cellSize), 0, nx - 1);
      const j = clampInt(Math.floor((point.y - minCorner.y) / cellSize), 0, ny - 1);
      const k = clampInt(Math.floor((point.z - minCorner.z) / cellSize), 0, nz - 1);

      return field[i + j * nx + k * nx * ny];
    },
    isInside(point: THREE.Vector3, margin = 0) {
      return this.sampleDistance(point) < -margin;
    }
  };
}
