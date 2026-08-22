import * as THREE from "three";

export type FillModel = {
  totalVolume: number;
  minHeight: number;
  maxHeight: number;
  volumeBelow(height: number): number;
};

const recordStride = 14;
const sliceSampleNodes = [0.15, 0.5, 0.85];

const lagrangeIntegralCoefficients = buildLagrangeIntegralCoefficients();

const fullLagrangeWeights = lagrangeIntegralCoefficients.map((row) => row[0] + row[1] + row[2]);

function buildLagrangeIntegralCoefficients() {
  return sliceSampleNodes.map((node, index) => {
    let poly: number[] = [1];
    let denominator = 1;

    for (let otherIndex = 0; otherIndex < sliceSampleNodes.length; otherIndex += 1) {
      if (otherIndex === index) {
        continue;
      }

      const other = sliceSampleNodes[otherIndex];
      const next = new Array<number>(poly.length + 1).fill(0);

      for (let k = 0; k < poly.length; k += 1) {
        next[k] -= poly[k] * other;
        next[k + 1] += poly[k];
      }

      poly = next;
      denominator *= node - other;
    }

    const a = poly[2] / denominator;
    const b = poly[1] / denominator;
    const c = poly[0] / denominator;

    return [a / 3, b / 2, c];
  });
}

const sliceX = new Float64Array(6);
const sliceZ = new Float64Array(6);
const sliceAngle = new Float64Array(6);
const sliceOrder = [0, 1, 2, 3, 4, 5];

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
  let signedVolume6 = 0;
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

    signedVolume6 += determinant;

    const base = recordCount * recordStride;
    writeSortedHeights(records, base, ay, by, cy);
    records[base + 4] = determinant / 6;

    for (let piece = 0; piece < 3; piece += 1) {
      const low = records[base + piece];
      const width = records[base + piece + 1] - low;

      if (width > 0) {
        samplePiece(records, base + 5 + piece * 3, low, width, ax, ay, az, bx, by, bz, cx, cy, cz);
      }
    }

    minHeight = Math.min(minHeight, records[base]);
    maxHeight = Math.max(maxHeight, records[base + 3]);

    recordCount += 1;
  }

  const totalVolume = Math.abs(signedVolume6) / 6;

  return {
    totalVolume,
    minHeight,
    maxHeight,
    volumeBelow(height: number) {
      if (height <= minHeight) {
        return 0;
      }

      if (height >= maxHeight) {
        return totalVolume;
      }

      let total = 0;

      for (let record = 0; record < recordCount; record += 1) {
        const base = record * recordStride;
        const lowest = records[base];
        const highest = records[base + 3];

        if (height <= lowest) {
          continue;
        }

        if (height >= highest) {
          total += records[base + 4];
          continue;
        }

        let tetTotal = 0;

        for (let piece = 0; piece < 3; piece += 1) {
          const low = records[base + piece];
          const high = records[base + piece + 1];
          const width = high - low;

          if (width <= 0) {
            continue;
          }

          const slot = base + 5 + piece * 3;

          if (height >= high) {
            tetTotal +=
              width *
              (records[slot] * fullLagrangeWeights[0] +
                records[slot + 1] * fullLagrangeWeights[1] +
                records[slot + 2] * fullLagrangeWeights[2]);
            continue;
          }

          if (height <= low) {
            break;
          }

          const u = (height - low) / width;

          const weight1 = ((lagrangeIntegralCoefficients[0][0] * u + lagrangeIntegralCoefficients[0][1]) * u + lagrangeIntegralCoefficients[0][2]) * u;
          const weight2 = ((lagrangeIntegralCoefficients[1][0] * u + lagrangeIntegralCoefficients[1][1]) * u + lagrangeIntegralCoefficients[1][2]) * u;
          const weight3 = ((lagrangeIntegralCoefficients[2][0] * u + lagrangeIntegralCoefficients[2][1]) * u + lagrangeIntegralCoefficients[2][2]) * u;

          tetTotal +=
            width *
            (records[slot] * weight1 +
              records[slot + 1] * weight2 +
              records[slot + 2] * weight3);
          break;
        }

        total += tetTotal;
      }

      return total;
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
  for (let nodeIndex = 0; nodeIndex < sliceSampleNodes.length; nodeIndex += 1) {
    const height = low + sliceSampleNodes[nodeIndex] * width;
    records[slot + nodeIndex] = tetSliceArea(ax, ay, az, bx, by, bz, cx, cy, cz, height);
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

  for (let i = 0; i < count; i += 1) {
    const from = sliceOrder[i];
    const to = sliceOrder[(i + 1) % count];
    doubledArea += sliceX[from] * sliceZ[to] - sliceX[to] * sliceZ[from];
  }

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
