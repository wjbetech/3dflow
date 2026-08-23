import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import {
  createFluidState,
  setFluidFillPercent,
  stepFluidState,
  type FluidState
} from "../lib/fluid";
import { getFillModelForDirection } from "../lib/metrics/fill";
import { packSdfToBytes, sdfByteEncodingRange } from "../lib/metrics/sdf";
import { buildWaterBody } from "../lib/metrics/waterMesh";
import { getFillCutoffY, type ShapeField, type SurfaceDeformation } from "../lib/shapes";
import { VesselHandles } from "./VesselHandles";

type SceneViewProps = {
  field: ShapeField;
  fillPercent: number;
  tiltX: number;
  tiltY: number;
  mode: "static" | "preview";
  gravityEnabled: boolean;
  pouringEnabled: boolean;
  spilling: boolean;
  maxContainedUnits: number | null;
  deformations: SurfaceDeformation[];
  sculptingEnabled: boolean;
  onCommitDeformation: (index: number, deformation: SurfaceDeformation) => void;
};

const fluidResolution = 20;

const vesselGlassMaterialProps = {
  color: "#d7e8f6",
  transparent: true,
  opacity: 0.06,
  roughness: 0.08,
  metalness: 0.04,
  transmission: 0.18,
  thickness: 1.15,
  side: THREE.DoubleSide,
  depthWrite: false
};

export function SceneView(props: SceneViewProps) {
  const controlsRef = useRef<{ enabled: boolean } | null>(null);

  return (
    <Canvas
      camera={{ position: [3.1, 2.3, 3.6], fov: 42 }}
      gl={{ alpha: true }}
      onCreated={(state) => {
        (window as unknown as Record<string, unknown>).__glRenderer = state.gl;
      }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 5, 3]} intensity={1.6} castShadow />
      <directionalLight position={[-3, 2, -4]} intensity={0.45} color="#74c0fc" />

      <group rotation={[-0.18, 0.3, 0]}>
        <FluidShape {...props} controlsRef={controlsRef} />
      </group>

      <ContactShadows position={[0, -1.55, 0]} opacity={0.42} scale={7} blur={2.4} far={3.2} />
      <OrbitControls
        enablePan={false}
        minDistance={2.2}
        maxDistance={7}
        ref={(instance) => {
          controlsRef.current = instance as unknown as { enabled: boolean } | null;
        }}
      />
    </Canvas>
  );
}

function FluidShape({
  field,
  fillPercent,
  tiltX,
  tiltY,
  mode,
  gravityEnabled,
  pouringEnabled,
  spilling,
  maxContainedUnits,
  deformations,
  sculptingEnabled,
  onCommitDeformation,
  controlsRef
}: SceneViewProps & { controlsRef: { current: { enabled: boolean } | null } }) {
  const fluidState = useMemo(() => createFluidState(field, fillPercent, fluidResolution), [field]);
  const vesselRef = useRef<THREE.Group>(null);
  const targetQuaternion = useRef(new THREE.Quaternion());
  const targetEuler = useRef(new THREE.Euler());

  useEffect(
    () => () => {
      field.geometry.dispose();
      if (field.cappedGeometry !== field.geometry) {
        field.cappedGeometry.dispose();
      }
    },
    [field]
  );
  useEffect(() => {
    setFluidFillPercent(fluidState, fillPercent);
  }, [fillPercent, fluidState]);

  useFrame((_, delta) => {
    if (!vesselRef.current) {
      return;
    }

    targetEuler.current.set(
      THREE.MathUtils.degToRad(tiltX),
      0,
      THREE.MathUtils.degToRad(-tiltY),
      "XYZ"
    );
    targetQuaternion.current.setFromEuler(targetEuler.current);
    vesselRef.current.quaternion.slerp(targetQuaternion.current, 1 - Math.exp(-delta * 5));
  });

  return (
    <group>
      <group ref={vesselRef}>
        <mesh geometry={field.cappedGeometry} scale={1.015} castShadow receiveShadow renderOrder={2}>
          {field.lidVertexStart === Number.POSITIVE_INFINITY ? (
            <meshPhysicalMaterial {...vesselGlassMaterialProps} />
          ) : (
            <>
              <meshPhysicalMaterial {...vesselGlassMaterialProps} attach="material-0" />
              <meshBasicMaterial visible={false} attach="material-1" />
            </>
          )}
        </mesh>

        <ContainedFluid
          key={`${field.recipe.id}-${mode}-${gravityEnabled}-${pouringEnabled}`}
          field={field}
          state={fluidState}
          fillPercent={fillPercent}
          mode={mode}
          gravityEnabled={gravityEnabled}
          pouringEnabled={pouringEnabled}
          maxContainedUnits={maxContainedUnits}
          vesselRef={vesselRef}
        />

        <FluidCentreMarker field={field} fillPercent={fillPercent} />

        {sculptingEnabled ? (
          <VesselHandles
            field={field}
            deformations={deformations}
            controlsRef={controlsRef}
            onCommit={onCommitDeformation}
          />
        ) : null}
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.58, 0]}>
        <ringGeometry args={[1.45, 1.9, 80]} />
        <meshBasicMaterial
          color={spilling ? "#ff6b6b" : field.irregularityReport.irregular ? "#ffb86c" : "#b0bec5"}
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

type FluidCentreMarkerProps = {
  field: ShapeField;
  fillPercent: number;
};

function FluidCentreMarker({ field, fillPercent }: FluidCentreMarkerProps) {
  const centre = useMemo(() => {
    const height = getFillCutoffY(field, fillPercent);
    return field.fillModel.centroidBelow(height)?.centroid ?? null;
  }, [field, fillPercent]);

  if (!centre) {
    return null;
  }

  return (
    <mesh position={centre} renderOrder={3}>
      <sphereGeometry args={[0.04, 20, 20]} />
      <meshBasicMaterial color="#ffb86c" depthTest={false} />
    </mesh>
  );
}

type ContainedFluidProps = {
  field: ShapeField;
  state: FluidState;
  fillPercent: number;
  mode: "static" | "preview";
  gravityEnabled: boolean;
  pouringEnabled: boolean;
  maxContainedUnits: number | null;
  vesselRef: React.RefObject<THREE.Group | null>;
};

function ContainedFluid({
  field,
  state,
  fillPercent,
  mode,
  gravityEnabled,
  pouringEnabled,
  maxContainedUnits,
  vesselRef
}: ContainedFluidProps) {
  const [marchingCubesVisible, setMarchingCubesVisible] = useState(mode === "preview");
  const vesselWorldQuaternion = useRef(new THREE.Quaternion());
  const inverseWorldQuaternion = useRef(new THREE.Quaternion());
  const inverseVesselMatrix = useRef(new THREE.Matrix4());
  const localGravity = useRef(new THREE.Vector3());
  const previousQuaternion = useRef(new THREE.Quaternion());
  const waterRuntime = useRef({
    offset: 0,
    initialized: false,
    fieldGeometry: null as THREE.BufferGeometry | null
  });
  const builtWaterState = useRef({
    dirX: 0,
    dirY: 1,
    dirZ: 0,
    offset: 0,
    has: false,
    fieldGeometry: null as THREE.BufferGeometry | null
  });
  const size = useMemo(() => field.bounds.getSize(new THREE.Vector3()), [field]);
  const center = useMemo(() => field.bounds.getCenter(new THREE.Vector3()), [field]);
  const sdfMap = useMemo(() => {
    const data = packSdfToBytes(field.sdf);
    const [nx, ny, nz] = field.sdf.dims;
    const texture = new THREE.Data3DTexture(data, nx, ny, nz);

    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    return texture;
  }, [field]);

  const fluidMaterial = useMemo(
    () => createContainedFluidMaterial(field, sdfMap),
    [field, sdfMap]
  );
  const waterVolumeMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#58b7ff"),
        emissive: new THREE.Color("#123b5d"),
        emissiveIntensity: 0.3,
        roughness: 0.12,
        metalness: 0.01,
        transparent: false,
        opacity: 1,
        transmission: 0,
        thickness: 0.2,
        depthWrite: true,
        side: THREE.DoubleSide
      }),
    []
  );
  const surface = useMemo(() => {
    const object = new MarchingCubes(fluidResolution, fluidMaterial, false, false, 60000);
    object.position.copy(center);
    object.scale.copy(size);
    object.isolation = 52;
    object.castShadow = true;
    object.receiveShadow = true;
    object.renderOrder = 1;
    return object;
  }, [center, fluidMaterial, size]);
  const waterMesh = useMemo(() => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), waterVolumeMaterial);

    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;

    return mesh;
  }, [waterVolumeMaterial]);

  useEffect(
    () => () => {
      surface.geometry.dispose();
      fluidMaterial.dispose();
      waterVolumeMaterial.dispose();
      sdfMap.dispose();
    },
    [fluidMaterial, waterVolumeMaterial, sdfMap, surface]
  );

  useEffect(() => {
    const debug = () => {
      const shader = fluidMaterial.userData.shader as
        | { uniforms: Record<string, { value: THREE.Matrix4 }> }
        | undefined;
      const matrix = shader?.uniforms?.uInverseContainmentMatrix?.value;

      return {
        marchingCubesVisible,
        waterVertices: waterMesh.geometry.getAttribute("position")?.count ?? 0,
        waterVisibleFlag: !marchingCubesVisible,
        invMatrixElements: matrix ? Array.from(matrix.elements).map((v) => Number(v.toFixed(3))) : null,
        sdfRange: [field.sdf.minCorner.toArray(), field.sdf.dims, field.sdf.cellSize]
      };
    };

    (window as unknown as Record<string, unknown>).__waterDebug = debug;
    (window as unknown as Record<string, unknown>).__waterTune = (margin: number) => {
      const shader = fluidMaterial.userData.shader as
        | { uniforms: Record<string, { value: number }> }
        | undefined;

      if (shader) {
        shader.uniforms.uContainmentMargin.value = margin;
      }
    };
    (window as unknown as Record<string, unknown>).__waterMeshRef = waterMesh;

    return () => {
      delete (window as unknown as Record<string, unknown>).__waterDebug;
      delete (window as unknown as Record<string, unknown>).__waterTune;
      delete (window as unknown as Record<string, unknown>).__waterMeshRef;
    };
  }, [fluidMaterial, marchingCubesVisible, waterMesh, field.sdf]);

  // eslint-disable-next-line react-hooks/immutability
  useFrame((_, delta) => {
    if (!vesselRef.current) {
      return;
    }

    vesselRef.current.getWorldQuaternion(vesselWorldQuaternion.current);
    inverseWorldQuaternion.current.copy(vesselWorldQuaternion.current).invert();
    inverseVesselMatrix.current.copy(vesselRef.current.matrixWorld).invert();

    localGravity.current.set(0, gravityEnabled ? -5.8 : -4.6, 0).applyQuaternion(inverseWorldQuaternion.current);

    const fieldStrength = gravityEnabled ? 110 : 96;

    if ("userData" in fluidMaterial && fluidMaterial.userData.shader) {
      const uniforms = fluidMaterial.userData.shader.uniforms;

      if (uniforms.uInverseContainmentMatrix) {
        uniforms.uInverseContainmentMatrix.value.copy(inverseVesselMatrix.current);
      }
    }

    const localUp = scratchUp
      .copy(localGravity.current)
      .normalize()
      .negate();

    if (mode === "static") {
      if (marchingCubesVisible) {
        setMarchingCubesVisible(false);
      }

      const capacity = field.fillModel.totalVolume;
      let targetVolume = (fillPercent / 100) * capacity;

      if (
        maxContainedUnits !== null &&
        maxContainedUnits < capacity &&
        maxContainedUnits < targetVolume
      ) {
        targetVolume = Math.max(maxContainedUnits, 0);
      }

      const renderModel = getFillModelForDirection(field.cappedGeometry, localUp, Number.POSITIVE_INFINITY, Math.PI / 90);

      let low = renderModel.minHeight;
      let high = renderModel.maxHeight;
      const range = high - low;

      for (let iteration = 0; iteration < 60 && high - low > range * 1e-9; iteration += 1) {
        const mid = (low + high) / 2;

        if (renderModel.volumeBelow(mid) < targetVolume) {
          low = mid;
        } else {
          high = mid;
        }
      }

      const targetOffset = (low + high) / 2;
      const runtime = waterRuntime.current;

      if (
        !runtime.initialized ||
        runtime.fieldGeometry !== field.cappedGeometry
      ) {
        runtime.offset = targetOffset;
        runtime.initialized = true;
        runtime.fieldGeometry = field.cappedGeometry;
      } else {
        runtime.offset += (targetOffset - runtime.offset) * Math.min(1, delta * 7);
      }

      const built = builtWaterState.current;
      const dot =
        !built.has
          ? -1
          : built.dirX * localUp.x + built.dirY * localUp.y + built.dirZ * localUp.z;
      const needsRebuild =
        !built.has ||
        built.fieldGeometry !== field.cappedGeometry ||
        Math.abs(built.offset - runtime.offset) > 0.0015 ||
        dot < 0.99995;

      if (needsRebuild) {
        const previous = waterMesh.geometry;
        // eslint-disable-next-line react-hooks/immutability
        waterMesh.geometry = buildWaterBody(field.cappedGeometry, localUp, runtime.offset);
        previous.dispose();

        built.dirX = localUp.x;
        built.dirY = localUp.y;
        built.dirZ = localUp.z;
        built.offset = runtime.offset;
        built.fieldGeometry = field.cappedGeometry;
        built.has = true;
      }

      return;
    }

    if (!marchingCubesVisible) {
      setMarchingCubesVisible(true);
    }

    builtWaterState.current.has = false;
    const angleDelta = previousQuaternion.current.angleTo(vesselWorldQuaternion.current);
    const angularSpeed = delta > 0 ? angleDelta / delta : 0;
    previousQuaternion.current.copy(vesselWorldQuaternion.current);

    const motionAmount =
      pouringEnabled || angularSpeed > 0.002 ? Math.min(1, angularSpeed * 0.18 + (pouringEnabled ? 0.04 : 0)) : 0;

    stepFluidState(state, localGravity.current, motionAmount);

    surface.reset();

    const gridSize = state.size;

    for (let z = 0; z < gridSize; z += 1) {
      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          const index = x + y * gridSize + z * gridSize * gridSize;

          if (state.solid[index] === 0) {
            surface.setCell(x, y, z, 0);
            continue;
          }

          surface.setCell(x, y, z, state.density[index] * fieldStrength);
        }
      }
    }

    surface.blur(0.1);
    surface.update();
  });

  return (
    <>
      <primitive object={surface} visible={marchingCubesVisible} />
      <primitive object={waterMesh} visible={!marchingCubesVisible} />
    </>
  );
}

const scratchUp = new THREE.Vector3();

function createContainedFluidMaterial(field: ShapeField, sdfMap: THREE.Data3DTexture) {
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#58b7ff"),
    emissive: new THREE.Color("#123b5d"),
    emissiveIntensity: 0.3,
    roughness: 0.12,
    metalness: 0.01,
    transparent: false,
    opacity: 1,
    transmission: 0,
    thickness: 0.2,
    depthWrite: true,
    side: THREE.DoubleSide
  });

  const sdf = field.sdf;
  const uvScale = new THREE.Vector3(
    1 / (sdf.dims[0] * sdf.cellSize),
    1 / (sdf.dims[1] * sdf.cellSize),
    1 / (sdf.dims[2] * sdf.cellSize)
  );

    material.onBeforeCompile = (shader) => {
      material.userData.shader = shader;
      shader.uniforms.uSdfMap = { value: sdfMap };
      shader.uniforms.uSdfMinCorner = { value: sdf.minCorner.clone() };
      shader.uniforms.uSdfUvScale = { value: uvScale };
      shader.uniforms.uContainmentMargin = { value: 0.012 };
      shader.uniforms.uInverseContainmentMatrix = { value: new THREE.Matrix4() };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vContainmentPosition;
uniform mat4 uInverseContainmentMatrix;
`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vec4 containmentWorldPosition = modelMatrix * vec4(transformed, 1.0);
vContainmentPosition = (uInverseContainmentMatrix * containmentWorldPosition).xyz;
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vContainmentPosition;
uniform highp sampler3D uSdfMap;
uniform vec3 uSdfMinCorner;
uniform vec3 uSdfUvScale;
uniform float uContainmentMargin;

float sampleVesselDistance(vec3 position) {
  vec3 uvw = (position - uSdfMinCorner) * uSdfUvScale;
  return (texture(uSdfMap, clamp(uvw, vec3(0.001), vec3(0.999))).r - 0.5) * ${sdfByteEncodingRange};
}
`
      )
      .replace(
        "#include <dithering_fragment>",
        `
if (sampleVesselDistance(vContainmentPosition) > -uContainmentMargin) {
  discard;
}

#include <dithering_fragment>`
      );
  };

  material.customProgramCacheKey = () => "sdf-containment-v1";

  return material;
}
