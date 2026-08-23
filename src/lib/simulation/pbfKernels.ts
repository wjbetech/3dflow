import * as THREE from "three";

const PI = Math.PI;

export function poly6(r: number, h: number): number {
  if (r >= h || r < 0) return 0;
  const diff = h * h - r * r;
  return (315 / (64 * PI * Math.pow(h, 9))) * diff * diff * diff;
}

export function spikyGrad(rVec: THREE.Vector3, r: number, h: number, out: THREE.Vector3): THREE.Vector3 {
  if (r >= h || r < 1e-6) {
    out.set(0, 0, 0);
    return out;
  }
  const coeff = (-45 / (PI * Math.pow(h, 6))) * (h - r) * (h - r);
  out.copy(rVec).multiplyScalar(coeff / r);
  return out;
}

export function buildSpatialHash(
  positions: Float32Array,
  count: number,
  cellSize: number,
  map: Map<string, number[]>
): void {
  map.clear();
  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(i);
  }
}

export function forEachNeighbor(
  index: number,
  positions: Float32Array,
  cellSize: number,
  hash: Map<string, number[]>,
  callback: (neighborIndex: number) => void
): void {
  const x = positions[index * 3];
  const y = positions[index * 3 + 1];
  const z = positions[index * 3 + 2];
  const ix = Math.floor(x / cellSize);
  const iy = Math.floor(y / cellSize);
  const iz = Math.floor(z / cellSize);

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = `${ix + dx},${iy + dy},${iz + dz}`;
        const bucket = hash.get(key);
        if (!bucket) continue;
        for (const n of bucket) callback(n);
      }
    }
  }
}
