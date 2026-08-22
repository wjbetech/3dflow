import * as THREE from "three";

export type SolidMetrics = {
  volume: number;
  centroid: THREE.Vector3;
};

export function computeSolidMetrics(geometry: THREE.BufferGeometry): SolidMetrics {
  const positions = geometry.getAttribute("position");

  if (!positions || positions.itemSize !== 3) {
    throw new Error("computeSolidMetrics requires a geometry with a vec3 position attribute");
  }

  const index = geometry.getIndex();
  const vertexCount = index ? index.count : positions.count;

  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error("computeSolidMetrics requires a triangulated mesh");
  }

  let signedVolume6 = 0;
  let momentX = 0;
  let momentY = 0;
  let momentZ = 0;

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

    const det =
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);

    signedVolume6 += det;
    momentX += det * (ax + bx + cx);
    momentY += det * (ay + by + cy);
    momentZ += det * (az + bz + cz);
  }

  if (Math.abs(signedVolume6) < 1e-12) {
    throw new Error(
      "computeSolidMetrics requires a closed mesh with consistent outward winding"
    );
  }

  return {
    volume: Math.abs(signedVolume6) / 6,
    centroid: new THREE.Vector3(
      momentX / (signedVolume6 * 4),
      momentY / (signedVolume6 * 4),
      momentZ / (signedVolume6 * 4)
    )
  };
}
