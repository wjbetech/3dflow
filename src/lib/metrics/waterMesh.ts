import * as THREE from "three";

type Vec3Tuple = [number, number, number];

function signedDistance(point: Vec3Tuple, normal: THREE.Vector3, offset: number) {
  return point[0] * normal.x + point[1] * normal.y + point[2] * normal.z - offset;
}

export function buildWaterBody(
  source: THREE.BufferGeometry,
  normal: THREE.Vector3,
  offset: number
): THREE.BufferGeometry {
  const positions = source.getAttribute("position");
  const index = source.getIndex();
  const cornerCount = index ? index.count : positions.count;

  const readPoint = (i: number): Vec3Tuple => {
    const vi = index ? index.getX(i) : i;

    return [positions.getX(vi), positions.getY(vi), positions.getZ(vi)];
  };

  const out: number[] = [];
  const cutPoints: Vec3Tuple[] = [];
  const seenCuts = new Set<string>();

  for (let start = 0; start < cornerCount; start += 3) {
    const tri = [readPoint(start), readPoint(start + 1), readPoint(start + 2)];
    const distances = tri.map((p) => signedDistance(p, normal, offset));

    const allIn = distances[0] <= 0 && distances[1] <= 0 && distances[2] <= 0;
    const allOut = distances[0] >= 0 && distances[1] >= 0 && distances[2] >= 0;

    if (allOut) {
      continue;
    }

    if (allIn) {
      pushTriangle(out, tri[0], tri[1], tri[2]);
      continue;
    }

    const kept: Vec3Tuple[] = [];
    let cutA: Vec3Tuple | null = null;
    let cutB: Vec3Tuple | null = null;

    for (let i = 0; i < 3; i += 1) {
      const current = tri[i];
      const next = tri[(i + 1) % 3];
      const currentIn = distances[i] <= 0;
      const nextIn = distances[(i + 1) % 3] <= 0;

      if (currentIn) {
        kept.push(current);
      }

      if (currentIn !== nextIn) {
        const t = distances[i] / (distances[i] - distances[(i + 1) % 3]);
        const point: Vec3Tuple = [
          current[0] + (next[0] - current[0]) * t,
          current[1] + (next[1] - current[1]) * t,
          current[2] + (next[2] - current[2]) * t
        ];

        kept.push(point);

        if (!cutA) {
          cutA = point;
        } else {
          cutB = point;
        }
      }
    }

    if (kept.length < 3) {
      continue;
    }

    if (cutA && cutB) {
      const keyA = `${cutA[0].toFixed(5)}:${cutA[1].toFixed(5)}:${cutA[2].toFixed(5)}`;
      const keyB = `${cutB[0].toFixed(5)}:${cutB[1].toFixed(5)}:${cutB[2].toFixed(5)}`;

      if (!seenCuts.has(keyA)) {
        seenCuts.add(keyA);
        cutPoints.push(cutA);
      }

      if (!seenCuts.has(keyB)) {
        seenCuts.add(keyB);
        cutPoints.push(cutB);
      }
    }

    for (let i = 1; i < kept.length - 1; i += 1) {
      pushTriangle(out, kept[0], kept[i], kept[i + 1]);
    }
  }

  appendSurfaceFan(out, cutPoints, normal);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

function appendSurfaceFan(out: number[], cutPoints: Vec3Tuple[], normal: THREE.Vector3) {
  if (cutPoints.length < 3) {
    return;
  }

  const tangentA = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = new THREE.Vector3().crossVectors(tangentA, normal).normalize();
  const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();

  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;

  for (const [x, y, z] of cutPoints) {
    centroidX += x;
    centroidY += y;
    centroidZ += z;
  }

  centroidX /= cutPoints.length;
  centroidY /= cutPoints.length;
  centroidZ /= cutPoints.length;

  const ordered = [...cutPoints].sort((a, b) => {
    const angleA = Math.atan2(
      (a[0] - centroidX) * e2.x + (a[1] - centroidY) * e2.y + (a[2] - centroidZ) * e2.z,
      (a[0] - centroidX) * e1.x + (a[1] - centroidY) * e1.y + (a[2] - centroidZ) * e1.z
    );
    const angleB = Math.atan2(
      (b[0] - centroidX) * e2.x + (b[1] - centroidY) * e2.y + (b[2] - centroidZ) * e2.z,
      (b[0] - centroidX) * e1.x + (b[1] - centroidY) * e1.y + (b[2] - centroidZ) * e1.z
    );

    return angleA - angleB;
  });

  for (let i = 0; i < ordered.length; i += 1) {
    const from = ordered[i];
    const to = ordered[(i + 1) % ordered.length];

    pushTriangle(out, [centroidX, centroidY, centroidZ], from, to);
  }
}

function pushTriangle(out: number[], a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}
