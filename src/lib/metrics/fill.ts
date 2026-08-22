import * as THREE from "three";

export type FillModel = {
  totalVolume: number;
  minHeight: number;
  maxHeight: number;
  volumeBelow(height: number): number;
  centroidBelow(height: number): { volume: number; centroid: THREE.Vector3 } | null;
};

export type CreateFillModelOptions = {
  direction?: THREE.Vector3;
  ceiling?: number;
};

export type SubmergedState = {
  volume: number;
  momentX: number;
  momentY: number;
  momentZ: number;
};

const recordStride = 56;
const pieceBlockStride = 16;
const pieceSampleNodes = [0.11, 0.37, 0.63, 0.89];

const lagrangeIntegralCoefficients = buildLagrangeIntegralCoefficients(pieceSampleNodes);

const fullPieceWeights = lagrangeIntegralCoefficients.map((row) =>
  row.reduce((total, coefficient) => total + coefficient, 0)
);

function buildLagrangeIntegralCoefficients(nodes: number[]) {
  return nodes.map((node, index) => {
    let poly: number[] = [1];
    let denominator = 1;

    for (let otherIndex = 0; otherIndex < nodes.length; otherIndex += 1) {
      if (otherIndex === index) {
        continue;
      }

      const other = nodes[otherIndex];
      const next = new Array<number>(poly.length + 1).fill(0);

      for (let k = 0; k < poly.length; k += 1) {
        next[k] -= poly[k] * other;
        next[k + 1] += poly[k];
      }

      poly = next;
      denominator *= node - other;
    }

    return poly.map((coefficient, power) => coefficient / denominator / (power + 1));
  });
}

function evaluateRow(row: number[], u: number) {
  let value = 0;

  for (let k = row.length - 1; k >= 0; k -= 1) {
    value = value * u + row[k];
  }

  return value * u;
}

function evaluateRowAt(rowIndex: number, u: number) {
  return evaluateRow(lagrangeIntegralCoefficients[rowIndex], u);
}

const sliceX = new Float64Array(6);
const sliceZ = new Float64Array(6);
const sliceAngle = new Float64Array(6);
const sliceOrder = [0, 1, 2, 3, 4, 5];
const sliceResult = new Float64Array(3);
let activeBasis: ProjectionBasis | null = null;

type ProjectionBasis = {
  ux: number;
  uy: number;
  uz: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
};

function buildProjectionBasis(up: THREE.Vector3): ProjectionBasis {
  const helperX = Math.abs(up.y) < 0.9 ? 0 : 1;
  const helperY = helperX === 0 ? 1 : 0;
  const dot = helperX * up.x + helperY * up.y;

  let ax = helperX - dot * up.x;
  let ay = helperY - dot * up.y;
  const az = -dot * up.z;
  const lengthA = Math.hypot(ax, ay, az);

  ax /= lengthA;
  ay /= lengthA;

  const bx = up.y * az - up.z * ay;
  const by = up.z * ax - up.x * az;
  const bz = up.x * ay - up.y * ax;

  return { ux: up.x, uy: up.y, uz: up.z, ax, ay, az, bx, by, bz };
}

export function createFillModel(
  geometry: THREE.BufferGeometry,
  options: CreateFillModelOptions = {}
): FillModel {
  const positions = geometry.getAttribute("position");

  if (!positions || positions.itemSize !== 3) {
    throw new Error("createFillModel requires a geometry with a vec3 position attribute");
  }

  const index = geometry.getIndex();
  const vertexCount = index ? index.count : positions.count;

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error("createFillModel requires a triangulated mesh");
  }

  const direction = options.direction ?? new THREE.Vector3(0, 1, 0);
  const basis = buildProjectionBasis(direction.clone().normalize());
  const rawCeiling = options.ceiling ?? Number.POSITIVE_INFINITY;
  activeBasis = basis;

  const records = new Float64Array((vertexCount / 3) * recordStride);
  let recordCount = 0;
  let totalVolume = 0;
  let totalMomentX = 0;
  let totalMomentY = 0;
  let totalMomentZ = 0;
  let minHeight = Number.POSITIVE_INFINITY;
  let rawMaxHeight = Number.NEGATIVE_INFINITY;

  const heights = new Float64Array(4);
  const sliceA = new Float64Array(4);
  const sliceB = new Float64Array(4);

  for (let start = 0; start < vertexCount; start += 3) {
    const ia = index ? index.getX(start) : start;
    const ib = index ? index.getX(start + 1) : start + 1;
    const ic = index ? index.getX(start + 2) : start + 2;

    const ax = positions.getX(ia);
    const ay = positions.getY(ia);
    const az = positions.getZ(ia);
    const bx = positions.getX(ib);
    const by = positions.getY(ib);
    const bz = positions.getZ(ib);
    const cx = positions.getX(ic);
    const cy = positions.getY(ic);
    const cz = positions.getZ(ic);

    const determinant =
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);

    const volume = determinant / 6;
    const centroidX = (ax + bx + cx) / 4;
    const centroidY = (ay + by + cy) / 4;
    const centroidZ = (az + bz + cz) / 4;

    heights[0] = ax * basis.ux + ay * basis.uy + az * basis.uz;
    heights[1] = bx * basis.ux + by * basis.uy + bz * basis.uz;
    heights[2] = cx * basis.ux + cy * basis.uy + cz * basis.uz;
    heights[3] = 0;

    sliceA[0] = ax * basis.ax + ay * basis.ay + az * basis.az;
    sliceA[1] = bx * basis.ax + by * basis.ay + bz * basis.az;
    sliceA[2] = cx * basis.ax + cy * basis.ay + cz * basis.az;
    sliceA[3] = 0;

    sliceB[0] = ax * basis.bx + ay * basis.by + az * basis.bz;
    sliceB[1] = bx * basis.bx + by * basis.by + bz * basis.bz;
    sliceB[2] = cx * basis.bx + cy * basis.by + cz * basis.bz;
    sliceB[3] = 0;

    totalVolume += volume;
    totalMomentX += volume * centroidX;
    totalMomentY += volume * centroidY;
    totalMomentZ += volume * centroidZ;

    const base = recordCount * recordStride;
    writeSortedProjections(records, base, heights);
    records[base + 4] = volume;
    records[base + 5] = volume * centroidX;
    records[base + 6] = volume * centroidY;
    records[base + 7] = volume * centroidZ;

    for (let piece = 0; piece < 3; piece += 1) {
      const low = records[base + piece];
      const width = records[base + piece + 1] - low;

      if (width > 0) {
        samplePiece(records, base + 8 + piece * pieceBlockStride, low, width, sliceA, sliceB, heights);
      }
    }

    minHeight = Math.min(minHeight, records[base]);
    rawMaxHeight = Math.max(rawMaxHeight, records[base + 3]);

    recordCount += 1;
  }

  const state: SubmergedState = { volume: 0, momentX: 0, momentY: 0, momentZ: 0 };

  const walkRecords = (height: number) => {
    state.volume = 0;
    state.momentX = 0;
    state.momentY = 0;
    state.momentZ = 0;

    for (let record = 0; record < recordCount; record += 1) {
      const base = record * recordStride;
      const lowest = records[base];
      const highest = records[base + 3];

      if (height <= lowest) {
        continue;
      }

      if (height >= highest) {
        state.volume += records[base + 4];
        state.momentX += records[base + 5];
        state.momentY += records[base + 6];
        state.momentZ += records[base + 7];
        continue;
      }

      let pieceVolume = 0;
      let pieceMomentX = 0;
      let pieceMomentY = 0;
      let pieceMomentZ = 0;

      for (let piece = 0; piece < 3; piece += 1) {
        const low = records[base + piece];
        const high = records[base + piece + 1];
        const width = high - low;

        if (width <= 0) {
          continue;
        }

        const slot = base + 8 + piece * pieceBlockStride;

        if (height >= high) {
          for (let nodeIndex = 0; nodeIndex < pieceSampleNodes.length; nodeIndex += 1) {
            const areaWeight = fullPieceWeights[nodeIndex];
            const area = records[slot + nodeIndex];
            const momentX = records[slot + 4 + nodeIndex];
            const momentZ = records[slot + 12 + nodeIndex];
            const sampleHeight = low + pieceSampleNodes[nodeIndex] * width;

            pieceVolume += width * area * areaWeight;
            pieceMomentX += width * momentX * areaWeight;
            pieceMomentZ += width * momentZ * areaWeight;
            pieceMomentY += width * sampleHeight * area * areaWeight;
          }

          continue;
        }

        if (height <= low) {
          break;
        }

        const u = (height - low) / width;

        for (let nodeIndex = 0; nodeIndex < pieceSampleNodes.length; nodeIndex += 1) {
          const weight = evaluateRowAt(nodeIndex, u);
          const area = records[slot + nodeIndex];
          const momentX = records[slot + 4 + nodeIndex];
          const momentZ = records[slot + 12 + nodeIndex];
          const sampleHeight = low + pieceSampleNodes[nodeIndex] * width;

          pieceVolume += width * area * weight;
          pieceMomentX += width * momentX * weight;
          pieceMomentZ += width * momentZ * weight;
          pieceMomentY += width * sampleHeight * area * weight;
        }

        break;
      }

      state.volume += pieceVolume;
      state.momentX += pieceMomentX;
      state.momentY += pieceMomentY;
      state.momentZ += pieceMomentZ;
    }

    return state;
  };

  const maxHeight = Math.min(rawMaxHeight, rawCeiling);
  let grandVolume = totalVolume;
  let grandMomentX = totalMomentX;
  let grandMomentY = totalMomentY;
  let grandMomentZ = totalMomentZ;

  if (rawCeiling < rawMaxHeight && maxHeight > minHeight) {
    walkRecords(maxHeight);
    grandVolume = Math.abs(state.volume);
    grandMomentX = state.momentX;
    grandMomentY = state.momentY;
    grandMomentZ = state.momentZ;
  } else {
    grandVolume = Math.abs(grandVolume);
  }

  const evaluate = (height: number) => {
    if (height <= minHeight) {
      state.volume = 0;
      state.momentX = 0;
      state.momentY = 0;
      state.momentZ = 0;
      return state;
    }

    const effective = Math.min(height, maxHeight);

    if (effective >= maxHeight) {
      state.volume = grandVolume;
      state.momentX = grandMomentX;
      state.momentY = grandMomentY;
      state.momentZ = grandMomentZ;
      return state;
    }

    return walkRecords(effective);
  };

  return {
    totalVolume: grandVolume,
    minHeight,
    maxHeight,
    volumeBelow(height: number) {
      return evaluate(height).volume;
    },
    centroidBelow(height: number) {
      const result = evaluate(height);

      if (Math.abs(result.volume) < 1e-9) {
        return null;
      }

      return {
        volume: result.volume,
        centroid: new THREE.Vector3(
          result.momentX / result.volume,
          result.momentY / result.volume,
          result.momentZ / result.volume
        )
      };
    }
  };
}

const directionalCacheLimit = 16;
const directionalCache = new WeakMap<THREE.BufferGeometry, Map<string, FillModel>>();

export function getFillModelForDirection(
  geometry: THREE.BufferGeometry,
  direction: THREE.Vector3,
  ceiling = Number.POSITIVE_INFINITY
) {
  const normalized = direction.clone().normalize();
  const key = [
    Math.round(normalized.x * 4096),
    Math.round(normalized.y * 4096),
    Math.round(normalized.z * 4096),
    Number.isFinite(ceiling) ? Math.round(ceiling * 4096) : "inf"
  ].join("|");

  let cachedModels = directionalCache.get(geometry);

  if (!cachedModels) {
    cachedModels = new Map();
    directionalCache.set(geometry, cachedModels);
  }

  const existing = cachedModels.get(key);

  if (existing) {
    cachedModels.delete(key);
    cachedModels.set(key, existing);
    return existing;
  }

  const model = createFillModel(geometry, { direction: normalized, ceiling });

  while (cachedModels.size >= directionalCacheLimit) {
    const oldest = cachedModels.keys().next();

    if (oldest.done) {
      break;
    }

    cachedModels.delete(oldest.value);
  }

  cachedModels.set(key, model);
  return model;
}

function writeSortedProjections(records: Float64Array, base: number, heights: Float64Array) {
  const sorted = [heights[0], heights[1], heights[2], heights[3]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    let j = i - 1;

    while (j >= 0 && sorted[j] > current) {
      sorted[j + 1] = sorted[j];
      j -= 1;
    }

    sorted[j + 1] = current;
  }

  records[base] = sorted[0];
  records[base + 1] = sorted[1];
  records[base + 2] = sorted[2];
  records[base + 3] = sorted[3];
}

function samplePiece(
  records: Float64Array,
  slot: number,
  low: number,
  width: number,
  sliceA: Float64Array,
  sliceB: Float64Array,
  heights: Float64Array
) {
  for (let nodeIndex = 0; nodeIndex < pieceSampleNodes.length; nodeIndex += 1) {
    const height = low + pieceSampleNodes[nodeIndex] * width;
    const area = tetSliceArea(sliceA, sliceB, heights, height);

    records[slot + nodeIndex] = area;
    records[slot + 4 + nodeIndex] = sliceResult[0];
    records[slot + 12 + nodeIndex] = sliceResult[2];
  }
}

function tetSliceArea(sliceA: Float64Array, sliceB: Float64Array, heights: Float64Array, height: number) {
  let count = 0;

  count = appendCrossing(count, sliceA[0], heights[0], sliceB[0], sliceA[1], heights[1], sliceB[1], height);
  count = appendCrossing(count, sliceA[0], heights[0], sliceB[0], sliceA[2], heights[2], sliceB[2], height);
  count = appendCrossing(count, sliceA[1], heights[1], sliceB[1], sliceA[2], heights[2], sliceB[2], height);

  count = appendCrossing(count, sliceA[0], heights[0], sliceB[0], 0, 0, 0, height);
  count = appendCrossing(count, sliceA[1], heights[1], sliceB[1], 0, 0, 0, height);
  count = appendCrossing(count, sliceA[2], heights[2], sliceB[2], 0, 0, 0, height);

  if (count < 3) {
    sliceResult[0] = 0;
    sliceResult[1] = 0;
    sliceResult[2] = 0;
    return 0;
  }

  let meanX = 0;
  let meanZ = 0;

  for (let i = 0; i < count; i += 1) {
    meanX += sliceX[i];
    meanZ += sliceZ[i];
  }

  meanX /= count;
  meanZ /= count;

  for (let i = 0; i < count; i += 1) {
    sliceAngle[i] = Math.atan2(sliceZ[i] - meanZ, sliceX[i] - meanX);
    sliceOrder[i] = i;
  }

  for (let i = 1; i < count; i += 1) {
    const current = sliceOrder[i];
    let j = i - 1;

    while (j >= 0 && sliceAngle[sliceOrder[j]] > sliceAngle[current]) {
      sliceOrder[j + 1] = sliceOrder[j];
      j -= 1;
    }

    sliceOrder[j + 1] = current;
  }

  let doubledArea = 0;
  let momentSumX = 0;
  let momentSumZ = 0;

  for (let i = 0; i < count; i += 1) {
    const from = sliceOrder[i];
    const to = sliceOrder[(i + 1) % count];
    const cross = sliceX[from] * sliceZ[to] - sliceX[to] * sliceZ[from];

    doubledArea += cross;
    momentSumX += (sliceX[from] + sliceX[to]) * cross;
    momentSumZ += (sliceZ[from] + sliceZ[to]) * cross;
  }

  const momentA = momentSumX / 6;
  const momentB = momentSumZ / 6;
  const basis = activeBasis;

  if (basis) {
    sliceResult[0] = basis.ax * momentA + basis.bx * momentB;
    sliceResult[2] = basis.az * momentA + basis.bz * momentB;
  } else {
    sliceResult[0] = momentA;
    sliceResult[2] = momentB;
  }

  sliceResult[1] = 0;

  return Math.abs(doubledArea) / 2;
}

function appendCrossing(
  count: number,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  height: number
) {
  const side1 = y1 - height;
  const side2 = y2 - height;

  if ((side1 < 0) === (side2 < 0)) {
    return count;
  }

  const t = side1 / (side1 - side2);
  sliceX[count] = x1 + (x2 - x1) * t;
  sliceZ[count] = z1 + (z2 - z1) * t;
  return count + 1;
}
