import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  applyDeformations,
  getDirectionalRadius,
  type ShapeField,
  type SurfaceDeformation
} from "../lib/shapes";

const handleDirections: Array<[number, number, number]> = [
  [0.62, 0.62, 0.62],
  [-0.62, 0.62, 0.62],
  [0.62, -0.62, 0.62],
  [-0.62, -0.62, 0.62],
  [0.62, 0.62, -0.62],
  [-0.62, 0.62, -0.62],
  [0.62, -0.62, -0.62],
  [-0.62, -0.62, -0.62],
  [0, 1, 0],
  [0, -1, 0]
];

function zeroedDeformation(origin: THREE.Vector3): SurfaceDeformation {
  return { origin: [origin.x, origin.y, origin.z], displacement: [0, 0, 0], radius: 0.55 };
}

type VesselHandlesProps = {
  field: ShapeField;
  deformations: SurfaceDeformation[];
  controlsRef: { current: { enabled: boolean } | null };
  onCommit: (index: number, deformation: SurfaceDeformation) => void;
};

export function VesselHandles({ field, deformations, controlsRef, onCommit }: VesselHandlesProps) {
  const { camera } = useThree();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragDisplacement, setDragDisplacement] = useState<THREE.Vector3 | null>(null);
  const plane = useMemo(() => new THREE.Plane(), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pointerNdc = useMemo(() => new THREE.Vector2(), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const groupRef = useRef<THREE.Group>(null);

  const restAnchors = useMemo(() => {
    return handleDirections.map((direction, directionIndex) => {
      const dir = new THREE.Vector3(...direction).normalize();
      const radius = getDirectionalRadius(field.recipe, dir);

      const anchor = new THREE.Vector3(
        dir.x * radius * field.scale.x,
        dir.y * radius * field.scale.y,
        dir.z * radius * field.scale.z
      ).sub(field.centerOffset);

      const [x, y, z] = applyDeformations(
        anchor.x,
        anchor.y,
        anchor.z,
        deformations.filter((_, i) => i !== directionIndex)
      );

      return new THREE.Vector3(x, y, z);
    });
  }, [field, deformations]);

  const basePositions = useMemo(() => {
    const attribute = field.cappedGeometry.getAttribute("position");

    return Float32Array.from(attribute.array as Float32Array);
  }, [field]);

  const effectiveDeformations = useMemo(() => {
    return handleDirections.map((_, index) => {
      const committed = deformations[index];
      const base =
        committed ??
        zeroedDeformation(new THREE.Vector3(restAnchors[index].x, restAnchors[index].y, restAnchors[index].z));

      if (draggingIndex !== index || !dragDisplacement) {
        return base;
      }

      return {
        ...base,
        displacement: [dragDisplacement.x, dragDisplacement.y, dragDisplacement.z] as [
          number,
          number,
          number
        ]
      };
    });
  }, [deformations, draggingIndex, restAnchors, dragDisplacement]);

  const applyPreview = useCallback(() => {
    const geometry = field.cappedGeometry;
    const attribute = geometry.getAttribute("position");
    const array = attribute.array as Float32Array;

    for (let v = 0; v < array.length; v += 3) {
      const [x, y, z] = applyDeformations(
        basePositions[v],
        basePositions[v + 1],
        basePositions[v + 2],
        effectiveDeformations
      );

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }

      array[v] = x;
      array[v + 1] = y;
      array[v + 2] = z;
    }

    attribute.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
  }, [basePositions, effectiveDeformations, field]);

  useEffect(() => {
    applyPreview();
  }, [applyPreview]);

  useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    []
  );

  const beginDrag = (
    index: number,
    event: { stopPropagation: () => void; pointerId: number; target: EventTarget | null }
  ) => {
    event.stopPropagation();

    if (event.target) {
      (event.target as Element).setPointerCapture?.(event.pointerId);
    }

    setDraggingIndex(index);
    setDragDisplacement(new THREE.Vector3());

    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }

    const anchorWorld = restAnchors[index].clone();
    groupRef.current?.localToWorld(anchorWorld);

    const cameraDirection = new THREE.Vector3();

    camera.getWorldDirection(cameraDirection);
    plane.setFromNormalAndCoplanarPoint(cameraDirection.negate(), anchorWorld);
  };

  const moveDrag = (clientX: number, clientY: number) => {
    if (draggingIndex === null) {
      return;
    }

    const canvas = document.querySelector("canvas");

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);

    if (!raycaster.ray.intersectPlane(plane, hitPoint)) {
      return;
    }

    const local = hitPoint.clone();

    groupRef.current?.worldToLocal(local);
    setDragDisplacement(local.clone().sub(restAnchors[draggingIndex]));
  };

  const endDrag = () => {
    if (draggingIndex === null || !dragDisplacement) {
      return;
    }

    onCommit(draggingIndex, {
      origin: [restAnchors[draggingIndex].x, restAnchors[draggingIndex].y, restAnchors[draggingIndex].z],
      displacement: [dragDisplacement.x, dragDisplacement.y, dragDisplacement.z],
      radius: 0.55
    });

    setDraggingIndex(null);
    setDragDisplacement(null);

    if (controlsRef.current) {
      controlsRef.current.enabled = true;
    }
  };

  useEffect(() => {
    if (draggingIndex === null) {
      return undefined;
    }

    const onMove = (event: PointerEvent) => {
      moveDrag(event.clientX, event.clientY);
    };
    const onUp = () => {
      endDrag();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  return (
    <group ref={groupRef}>
      {restAnchors.map((anchor, index) => {
        const isLive = draggingIndex === index;
        const position = isLive
          ? anchor.clone().add(dragDisplacement ?? new THREE.Vector3())
          : (() => {
              const [x, y, z] = applyDeformations(anchor.x, anchor.y, anchor.z, effectiveDeformations);

              return new THREE.Vector3(x, y, z);
            })();

        return (
          <mesh
            key={index}
            position={position}
            renderOrder={4}
            onPointerDown={(event) => {
              beginDrag(index, event);
            }}
            onPointerOver={() => {
              setHoveredIndex(index);
              document.body.style.cursor = "grab";
            }}
            onPointerOut={() => {
              setHoveredIndex((current) => (current === index ? null : current));
              document.body.style.cursor = "auto";
            }}
          >
            <sphereGeometry args={[isLive || hoveredIndex === index ? 0.055 : 0.038, 16, 16]} />
            <meshBasicMaterial
              color={isLive ? "#ff9f43" : "#72dfd6"}
              depthTest={false}
              transparent
              opacity={0.95}
            />
          </mesh>
        );
      })}
    </group>
  );
}
