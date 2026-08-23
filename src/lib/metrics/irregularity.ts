import * as THREE from "three";
import type { VoxelSdf } from "./sdf";

export type IrregularityCriterionKey = "symmetry" | "undulation" | "primitiveFit";

export type IrregularityCriterion = {
  key: IrregularityCriterionKey;
  label: string;
  score: number;
  passed: boolean;
};

export type IrregularityReport = {
  score: number;
  irregular: boolean;
  criteria: IrregularityCriterion[];
  failedLabels: string[];
};

const SAMPLE_LIMIT = 3600;
const RIM_EXCLUSION_BAND = 0.09;
const UNDULATION_PASS_RATIO = 0.3;
const PRIMITIVE_FIT_BASELINE = 0.02;

type Vec3Tuple = [number, number, number];

export function analyzeIrregularity(
  sourceGeometry: THREE.BufferGeometry,
  sdf: VoxelSdf,
  mouthY: number | null,
  bounds: THREE.Box3
): IrregularityReport {
  const srcPositions = sourceGeometry.getAttribute("position");
  const srcIndex = sourceGeometry.getIndex();
  const srcVertexCount = srcPositions.count;

  if ((!srcIndex && !srcVertexCount) || (srcIndex && srcIndex.count === 0)) {
    throw new Error("analyzeIrregularity requires a triangulated mesh");
  }

  let vx: Float64Array;
  let vy: Float64Array;
  let vz: Float64Array;
  let corners: Uint32Array;

  if (srcIndex) {
    const count = srcIndex.count;
    vx = new Float64Array(srcVertexCount);
    vy = new Float64Array(srcVertexCount);
    vz = new Float64Array(srcVertexCount);

    for (let i = 0; i < srcVertexCount; i += 1) {
      vx[i] = srcPositions.getX(i);
      vy[i] = srcPositions.getY(i);
      vz[i] = srcPositions.getZ(i);
    }

    corners = new Uint32Array(count);

    for (let c = 0; c < count; c += 1) {
      corners[c] = srcIndex.getX(c);
    }
  } else {
    const vertexMap = new Map<string, number>();
    const welded: number[] = [];

    corners = new Uint32Array(srcVertexCount);

    for (let i = 0; i < srcVertexCount; i += 1) {
      const x = srcPositions.getX(i);
      const y = srcPositions.getY(i);
      const z = srcPositions.getZ(i);
      const key = `${x}|${y}|${z}`;
      let mapped = vertexMap.get(key);

      if (mapped === undefined) {
        mapped = vertexMap.size;
        vertexMap.set(key, mapped);
        welded.push(x, y, z);
      }

      corners[i] = mapped;
    }

    const uniqueCount = vertexMap.size;

    vx = new Float64Array(uniqueCount);
    vy = new Float64Array(uniqueCount);
    vz = new Float64Array(uniqueCount);

    for (let v = 0; v < uniqueCount; v += 1) {
      vx[v] = welded[v * 3];
      vy[v] = welded[v * 3 + 1];
      vz[v] = welded[v * 3 + 2];
    }
  }

  const vertexTotal = vx.length;
  const characteristicLength = bounds.getSize(new THREE.Vector3()).length() / 2 || 1;
  const neighbourX = new Float64Array(vertexTotal);
  const neighbourY = new Float64Array(vertexTotal);
  const neighbourZ = new Float64Array(vertexTotal);
  const degree = new Uint32Array(vertexTotal);
  const indexCount = corners.length;
  let totalEdgeLength = 0;

  const readX = (i: number) => vx[i];
  const readY = (i: number) => vy[i];
  const readZ = (i: number) => vz[i];

  for (let start = 0; start < indexCount; start += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = corners[start + corner];
      const b = corners[start + ((corner + 1) % 3)];

      neighbourX[a] += readX(b);
      neighbourY[a] += readY(b);
      neighbourZ[a] += readZ(b);
      degree[a] += 1;

      neighbourX[b] += readX(a);
      neighbourY[b] += readY(a);
      neighbourZ[b] += readZ(a);
      degree[b] += 1;

      totalEdgeLength += Math.hypot(readX(a) - readX(b), readY(a) - readY(b), readZ(a) - readZ(b));
    }
  }

  const meanEdgeLength = totalEdgeLength / Math.max(indexCount, 1);
  const undulationSamples: number[] = [];

  const sampleStride = Math.max(1, Math.floor(vertexTotal / SAMPLE_LIMIT));
  const samplePoints: Vec3Tuple[] = [];

  for (let i = 0; i < vertexTotal; i += 1) {
    const y = vy[i];
    const nearMouth = mouthY !== null && Math.abs(y - mouthY) < RIM_EXCLUSION_BAND;

    if (!nearMouth && degree[i] > 0) {
      const lx = vx[i] - neighbourX[i] / degree[i];
      const ly = y - neighbourY[i] / degree[i];
      const lz = vz[i] - neighbourZ[i] / degree[i];

      undulationSamples.push(lx * lx + ly * ly + lz * lz);
    }

    if (!nearMouth && i % sampleStride === 0) {
      samplePoints.push([vx[i], y, vz[i]]);
    }
  }

  const medianLaplacian =
    undulationSamples.length > 0 ? medianOf(undulationSamples) : 0;
  const medianLaplacianLength = Math.sqrt(Math.max(medianLaplacian, 0));
  let absoluteDeviationSum = 0;

  for (const squared of undulationSamples) {
    absoluteDeviationSum += Math.abs(Math.sqrt(squared) - medianLaplacianLength);
  }

  const laplacianCv =
    undulationSamples.length > 0
      ? absoluteDeviationSum /
        undulationSamples.length /
        Math.max(medianLaplacianLength, 1e-9)
      : 0;
  const edgeSquared = meanEdgeLength * meanEdgeLength;
  const flatnessGate = Math.min(
    1,
    medianLaplacianLength / Math.max(0.05 * edgeSquared, 1e-12)
  );
  const presenceGate = Math.min(
    1,
    medianLaplacianLength / Math.max(sdf.cellSize * 0.02, 1e-12)
  );
  const undulationRatio =
    (laplacianCv * flatnessGate * presenceGate) / UNDULATION_PASS_RATIO;
  const symmetryRatio = measureInversionAsymmetry(
    vx,
    vy,
    vz,
    vertexTotal,
    sampleStride,
    sdf,
    mouthY
  );
  const primitiveFitRatio =
    measurePrimitiveFitResidual(samplePoints) / characteristicLength / PRIMITIVE_FIT_BASELINE;

  const criteria: IrregularityCriterion[] = [
    {
      key: "symmetry",
      label: "asymmetry",
      score: clampScore(symmetryRatio),
      passed: symmetryRatio <= 1
    },
    {
      key: "undulation",
      label: "surface waviness",
      score: clampScore(undulationRatio),
      passed: undulationRatio <= 1
    },
    {
      key: "primitiveFit",
      label: "no simple primitive match",
      score: clampScore(primitiveFitRatio),
      passed: primitiveFitRatio <= 1
    }
  ];

  const failed = criteria.filter((criterion) => !criterion.passed);

  return {
    score: criteria.reduce((worst, criterion) => Math.max(worst, criterion.score), 0),
    irregular: failed.length > 0,
    criteria,
    failedLabels: failed.map((criterion) => criterion.label)
  };
}

function measureInversionAsymmetry(
  vx: Float64Array,
  vy: Float64Array,
  vz: Float64Array,
  vertexTotal: number,
  sampleStride: number,
  sdf: VoxelSdf,
  mouthY: number | null
) {
  let total = 0;
  let count = 0;
  const point = new THREE.Vector3();
  const mirror = new THREE.Vector3();

  for (let i = 0; i < vertexTotal; i += sampleStride) {
    const x = vx[i];
    const y = vy[i];
    const z = vz[i];

    point.set(x, y, z);
    mirror.set(-x, -y, -z);

    if (mouthY !== null && Math.abs(y - mouthY) < RIM_EXCLUSION_BAND) {
      continue;
    }

    if (mouthY !== null && mirror.y > mouthY - RIM_EXCLUSION_BAND) {
      continue;
    }

    total += Math.abs(sdf.sampleDistance(point) + sdf.sampleDistance(mirror));
    count += 1;

    if (count >= SAMPLE_LIMIT) {
      break;
    }
  }

  if (count === 0) {
    return 0;
  }

  return total / count / 6;
}

function measurePrimitiveFitResidual(samplePoints: Vec3Tuple[]) {
  if (samplePoints.length < 16) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(fitSphereResidual(samplePoints), fitOrientedBoxResidual(samplePoints));
}

function fitSphereResidual(points: Vec3Tuple[]) {
  const matrix: Float64Array[] = [
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4),
    new Float64Array(4)
  ];
  const rhs = new Float64Array(4);

  for (const [x, y, z] of points) {
    const quadratic = x * x + y * y + z * z;

    matrix[0][0] += 4 * x * x;
    matrix[0][1] += 4 * x * y;
    matrix[0][2] += 4 * x * z;
    matrix[0][3] += 2 * x;
    rhs[0] += 2 * x * quadratic;

    matrix[1][1] += 4 * y * y;
    matrix[1][2] += 4 * y * z;
    matrix[1][3] += 2 * y;
    rhs[1] += 2 * y * quadratic;

    matrix[2][2] += 4 * z * z;
    matrix[2][3] += 2 * z;
    rhs[2] += 2 * z * quadratic;

    matrix[3][3] += 1;
    rhs[3] += quadratic;
  }

  matrix[1][0] = matrix[0][1];
  matrix[2][0] = matrix[0][2];
  matrix[3][0] = matrix[0][3];
  matrix[2][1] = matrix[1][2];
  matrix[3][1] = matrix[1][3];
  matrix[3][2] = matrix[2][3];

  const solution = solveLinearSystem4(matrix, rhs);

  if (!solution) {
    return Number.POSITIVE_INFINITY;
  }

  const radiusSquared = solution[3] + solution[0] ** 2 + solution[1] ** 2 + solution[2] ** 2;

  if (!(radiusSquared > 0)) {
    return Number.POSITIVE_INFINITY;
  }

  const radius = Math.sqrt(radiusSquared);
  let sumSquared = 0;

  for (const [x, y, z] of points) {
    const residual = Math.hypot(x - solution[0], y - solution[1], z - solution[2]) - radius;

    sumSquared += residual * residual;
  }

  return Math.sqrt(sumSquared / points.length);
}

function solveLinearSystem4(matrix: Float64Array[], rhs: Float64Array) {
  const a = matrix.map((row) => Float64Array.from(row));
  const b = Float64Array.from(rhs);

  for (let column = 0; column < 4; column += 1) {
    let pivotRow = column;

    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivotRow][column])) {
        pivotRow = row;
      }
    }

    if (Math.abs(a[pivotRow][column]) < 1e-12) {
      return null;
    }

    if (pivotRow !== column) {
      const swapRow = a[column];
      a[column] = a[pivotRow];
      a[pivotRow] = swapRow;

      const swapValue = b[column];
      b[column] = b[pivotRow];
      b[pivotRow] = swapValue;
    }

    const pivot = a[column][column];

    for (let row = column + 1; row < 4; row += 1) {
      const factor = a[row][column] / pivot;

      if (factor === 0) {
        continue;
      }

      for (let k = column; k < 4; k += 1) {
        a[row][k] -= factor * a[column][k];
      }

      b[row] -= factor * b[column];
    }
  }

  const solution = new Float64Array(4);

  for (let row = 3; row >= 0; row -= 1) {
    let value = b[row];

    for (let k = row + 1; k < 4; k += 1) {
      value -= a[row][k] * solution[k];
    }

    solution[row] = value / a[row][row];
  }

  return solution;
}

function fitOrientedBoxResidual(points: Vec3Tuple[]) {
  let cx = 0;
  let cy = 0;
  let cz = 0;

  for (const [x, y, z] of points) {
    cx += x;
    cy += y;
    cz += z;
  }

  cx /= points.length;
  cy /= points.length;
  cz /= points.length;

  const covariance: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (const [x, y, z] of points) {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;

    covariance[0][0] += dx * dx;
    covariance[0][1] += dx * dy;
    covariance[0][2] += dx * dz;
    covariance[1][1] += dy * dy;
    covariance[1][2] += dy * dz;
    covariance[2][2] += dz * dz;
  }

  covariance[1][0] = covariance[0][1];
  covariance[2][0] = covariance[0][2];
  covariance[2][1] = covariance[1][2];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      covariance[row][col] /= points.length;
    }
  }

  const [axes] = jacobiEigenDecomposition(covariance);

  const extentsMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const extentsMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const projected: Vec3Tuple[] = [];

  for (const [x, y, z] of points) {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const u = axes[0][0] * dx + axes[0][1] * dy + axes[0][2] * dz;
    const v = axes[1][0] * dx + axes[1][1] * dy + axes[1][2] * dz;
    const w = axes[2][0] * dx + axes[2][1] * dy + axes[2][2] * dz;

    projected.push([u, v, w]);

    extentsMin[0] = Math.min(extentsMin[0], u);
    extentsMax[0] = Math.max(extentsMax[0], u);
    extentsMin[1] = Math.min(extentsMin[1], v);
    extentsMax[1] = Math.max(extentsMax[1], v);
    extentsMin[2] = Math.min(extentsMin[2], w);
    extentsMax[2] = Math.max(extentsMax[2], w);
  }

  const centres = [
    (extentsMin[0] + extentsMax[0]) / 2,
    (extentsMin[1] + extentsMax[1]) / 2,
    (extentsMin[2] + extentsMax[2]) / 2
  ];
  const halves = [
    (extentsMax[0] - extentsMin[0]) / 2,
    (extentsMax[1] - extentsMin[1]) / 2,
    (extentsMax[2] - extentsMin[2]) / 2
  ];
  const smallestHalf = Math.min(halves[0], halves[1], halves[2]);

  if (smallestHalf < 1e-6) {
    return Number.POSITIVE_INFINITY;
  }

  let sumSquared = 0;

  for (const [u, v, w] of projected) {
    const exceed = Math.max(
      Math.abs(u - centres[0]) / halves[0],
      Math.abs(v - centres[1]) / halves[1],
      Math.abs(w - centres[2]) / halves[2]
    );

    const residual = (exceed - 1) * smallestHalf;

    sumSquared += residual * residual;
  }

  return Math.sqrt(sumSquared / points.length);
}

function jacobiEigenDecomposition(input: number[][]) {
  const a = input.map((row) => [...row]);
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  for (let sweep = 0; sweep < 24; sweep += 1) {
    const offDiagonal = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);

    if (offDiagonal < 1e-14) {
      break;
    }

    for (let p = 0; p < 2; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) {
          continue;
        }

        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const tangent = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cosine = 1 / Math.sqrt(tangent * tangent + 1);
        const sine = tangent * cosine;

        for (let k = 0; k < 3; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = cosine * akp - sine * akq;
          a[k][q] = sine * akp + cosine * akq;
        }

        for (let k = 0; k < 3; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = cosine * apk - sine * aqk;
          a[q][k] = sine * apk + cosine * aqk;
        }

        for (let k = 0; k < 3; k += 1) {
          const vkp = vectors[k][p];
          const vkq = vectors[k][q];
          vectors[k][p] = cosine * vkp - sine * vkq;
          vectors[k][q] = sine * vkp + cosine * vkq;
        }
      }
    }
  }

  return [vectors, [a[0][0], a[1][1], a[2][2]]] as const;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(value, 10));
}

function medianOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
