import * as THREE from "three";

export type FillModel = {
  totalVolume: number;
  minHeight: number;
  maxHeight: number;
  volumeBelow(height: number): number;
  centroidBelow(height: number): { volume: number; centroid: THREE.Vector3 } | null;
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

export function createFillModel(geometry: THREE.BufferGeometry): FillModel {
  const positions = geometry.getAttribute("position");

  if (!positions || positions.itemSize !== 3) {
    throw new Error("createFillModel requires a geometry with a vec3 position attribute");
  }

  const index = geometry.getIndex();
  const vertexCount = index ? index.count : positions.count;

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error("createFillModel requires a triangulated mesh");
  }

  const records = new Float64Array((vertexCount / 3) * recordStride);
  let recordCount = 0;
  let totalVolume = 0;
  let totalMomentX = 0;
  let totalMomentY = 0;
  let totalMomentZ = 0;
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;

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

    totalVolume += volume;
    totalMomentX += volume * centroidX;
    totalMomentY += volume * centroidY;
    totalMomentZ += volume * centroidZ;

    const base = recordCount * recordStride;
    writeSortedHeights(records, base, ay, by, cy);
    records[base + 4] = volume;
    records[base + 5] = volume * centroidX;
    records[base + 6] = volume * centroidY;
    records[base + 7] = volume * centroidZ;

    for (let piece = 0; piece < 3; piece += 1) {
      const low = records[base + piece];
      const width = records[base + piece + 1] - low;

      if (width > 0) {
        samplePiece(
          records,
          base + 8 + piece * pieceBlockStride,
          low,
          width,
          ax,
          ay,
          az,
          bx,
          by,
          bz,
          cx,
          cy,
          cz
        );
      }
    }

    minHeight = Math.min(minHeight, records[base]);
    maxHeight = Math.max(maxHeight, records[base + 3]);

    recordCount += 1;
  }

  totalVolume = Math.abs(totalVolume);

  const state: SubmergedState = { volume: 0, momentX: 0, momentY: 0, momentZ: 0 };

  const evaluate = (height: number) => {
    state.volume = 0;
    state.momentX = 0;
    state.momentY = 0;
    state.momentZ = 0;

    if (height <= minHeight) {
      return state;
    }

    if (height >= maxHeight) {
      state.volume = totalVolume;
      state.momentX = totalMomentX;
      state.momentY = totalMomentY;
      state.momentZ = totalMomentZ;
      return state;
    }

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

  return {
    totalVolume,
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

function writeSortedHeights(records: Float64Array, base: number, ay: number, by: number, cy: number) {
  const heights = [ay, by, cy, 0];

  for (let i = 1; i < heights.length; i += 1) {
    const current = heights[i];
    let j = i - 1;

    while (j >= 0 && heights[j] > current) {
      heights[j + 1] = heights[j];
      j -= 1;
    }

    heights[j + 1] = current;
  }

  records[base] = heights[0];
  records[base + 1] = heights[1];
  records[base + 2] = heights[2];
  records[base + 3] = heights[3];
}

function samplePiece(
  records: Float64Array,
  slot: number,
  low: number,
  width: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
) {
  for (let nodeIndex = 0; nodeIndex < pieceSampleNodes.length; nodeIndex += 1) {
    const height = low + pieceSampleNodes[nodeIndex] * width;
    const area = tetSliceArea(ax, ay, az, bx, by, bz, cx, cy, cz, height);

    records[slot + nodeIndex] = area;
    records[slot + 4 + nodeIndex] = sliceResult[0];
    records[slot + 12 + nodeIndex] = sliceResult[2];
  }
}

function tetSliceArea(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  height: number
) {
  let count = 0;

  count = appendCrossing(count, ax, ay, az, bx, by, bz, height);
  count = appendCrossing(count, ax, ay, az, cx, cy, cz, height);
  count = appendCrossing(count, bx, by, bz, cx, cy, cz, height);

  count = appendCrossing(count, ax, ay, az, 0, 0, 0, height);
  count = appendCrossing(count, bx, by, bz, 0, 0, 0, height);
  count = appendCrossing(count, cx, cy, cz, 0, 0, 0, height);

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

  sliceResult[0] = momentSumX / 6;
  sliceResult[1] = 0;
  sliceResult[2] = momentSumZ / 6;

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
