import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { createSdfBoundary } from "../lib/simulation/boundary";
import { SimulationController } from "../lib/simulation/controller";
import { createPbfSolver } from "../lib/simulation/pbfSolver";
import { seedParticlesInBoundary } from "../lib/simulation/seed";
import type { ShapeField } from "../lib/shapes";

type Props = {
  field: ShapeField;
  fillPercent: number;
  tiltX: number;
  tiltY: number;
};

export function ParticleFluid({ field, fillPercent, tiltX, tiltY }: Props) {
  const count = Math.max(200, Math.round((fillPercent / 100) * 3500));
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { controller, positions } = useMemo(() => {
    const boundary = createSdfBoundary(field.sdf);
    const state = seedParticlesInBoundary(count, boundary, field.bounds, 0.045);
    const solver = createPbfSolver({ particleRadius: 0.045 });
    const ctrl = new SimulationController(solver, state, boundary, { fixedDt: 1 / 60, maxSubSteps: 4 });
    const buf = new Float32Array(count * 3);
    return { controller: ctrl, positions: buf };
  }, [field, count]);

  useEffect(() => {
    const boundary = createSdfBoundary(field.sdf);
    controller.setBoundary(boundary);
  }, [field, controller]);

  useFrame((_, delta) => {
    const tiltQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(tiltX), 0, THREE.MathUtils.degToRad(-tiltY), "XYZ")
    );
    const gravity = new THREE.Vector3(0, -9.81, 0).applyQuaternion(tiltQuat.clone().invert());
    (controller as unknown as { solver: { config: { gravity: THREE.Vector3 } } }).solver.config.gravity.copy(gravity);

    controller.update(delta);
    controller.interpolatePositions(positions);

    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < count; i += 1) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.045, 8, 8]} />
      <meshPhysicalMaterial color="#58b7ff" roughness={0.2} transparent opacity={0.9} />
    </instancedMesh>
  );
}
