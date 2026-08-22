import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { createFluidState, setFluidFillPercent, stepFluidState, type FluidState } from "../lib/fluid";
import { getFillCutoffY, type ShapeField } from "../lib/shapes";

type SceneViewProps = {
  field: ShapeField;
  fillPercent: number;
  tiltX: number;
  tiltY: number;
  gravityEnabled: boolean;
  pouringEnabled: boolean;
  spilling: boolean;
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
  return (
    <Canvas camera={{ position: [3.1, 2.3, 3.6], fov: 42 }} gl={{ alpha: true }}>
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 5, 3]} intensity={1.6} castShadow />
      <directionalLight position={[-3, 2, -4]} intensity={0.45} color="#74c0fc" />

      <group rotation={[-0.18, 0.3, 0]}>
        <FluidShape {...props} />
      </group>

      <ContactShadows position={[0, -1.55, 0]} opacity={0.42} scale={7} blur={2.4} far={3.2} />
      <OrbitControls enablePan={false} minDistance={2.2} maxDistance={7} />
    </Canvas>
  );
}

function FluidShape({
  field,
  fillPercent,
  tiltX,
  tiltY,
  gravityEnabled,
  pouringEnabled,
  spilling
}: SceneViewProps) {
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
          key={`${field.recipe.id}-${gravityEnabled}-${pouringEnabled}`}
          field={field}
          state={fluidState}
          gravityEnabled={gravityEnabled}
          pouringEnabled={pouringEnabled}
          vesselRef={vesselRef}
        />

        <FluidCentreMarker field={field} fillPercent={fillPercent} />
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.58, 0]}>
        <ringGeometry args={[1.45, 1.9, 80]} />
        <meshBasicMaterial
          color={spilling ? "#ff6b6b" : field.irregularity >= 7.5 ? "#ffb86c" : "#b0bec5"}
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
  gravityEnabled: boolean;
  pouringEnabled: boolean;
  vesselRef: React.RefObject<THREE.Group | null>;
};

function ContainedFluid({ field, state, gravityEnabled, pouringEnabled, vesselRef }: ContainedFluidProps) {
  const vesselWorldQuaternion = useRef(new THREE.Quaternion());
  const inverseWorldQuaternion = useRef(new THREE.Quaternion());
  const inverseVesselMatrix = useRef(new THREE.Matrix4());
  const localGravity = useRef(new THREE.Vector3());
  const previousQuaternion = useRef(new THREE.Quaternion());
  const size = useMemo(() => field.bounds.getSize(new THREE.Vector3()), [field]);
  const center = useMemo(() => field.bounds.getCenter(new THREE.Vector3()), [field]);
  const fluidMaterial = useMemo(() => createContainedFluidMaterial(field), [field]);
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

  useEffect(
    () => () => {
      surface.geometry.dispose();
      fluidMaterial.dispose();
    },
    [fluidMaterial, surface]
  );

  useFrame((_, delta) => {
    if (!vesselRef.current) {
      return;
    }

    vesselRef.current.getWorldQuaternion(vesselWorldQuaternion.current);
    inverseWorldQuaternion.current.copy(vesselWorldQuaternion.current).invert();
    inverseVesselMatrix.current.copy(vesselRef.current.matrixWorld).invert();

    localGravity.current.set(0, gravityEnabled ? -5.8 : -4.6, 0).applyQuaternion(inverseWorldQuaternion.current);

    const angleDelta = previousQuaternion.current.angleTo(vesselWorldQuaternion.current);
    const angularSpeed = delta > 0 ? angleDelta / delta : 0;
    previousQuaternion.current.copy(vesselWorldQuaternion.current);

    const motionAmount =
      pouringEnabled || angularSpeed > 0.002 ? Math.min(1, angularSpeed * 0.18 + (pouringEnabled ? 0.04 : 0)) : 0;

    if ("userData" in fluidMaterial && fluidMaterial.userData.shader) {
      fluidMaterial.userData.shader.uniforms.uInverseContainmentMatrix.value.copy(inverseVesselMatrix.current);
    }

    stepFluidState(state, localGravity.current, motionAmount);

    surface.reset();

    const gridSize = state.size;
    const fieldStrength = gravityEnabled ? 110 : 96;

    for (let z = 0; z < gridSize; z += 1) {
      for (let y = 0; y < gridSize; y += 1) {
        for (let x = 0; x < gridSize; x += 1) {
          const index = x + y * gridSize + z * gridSize * gridSize;

          if (state.solid[index] === 0) {
            surface.setCell(x, y, z, 0);
            continue;
          }

          const density = state.density[index];
          surface.setCell(x, y, z, density * fieldStrength);
        }
      }
    }

    surface.blur(0.1);
    surface.update();
  });

  return <primitive object={surface} />;
}

function createContainedFluidMaterial(field: ShapeField) {
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

  const centerOffset = field.centerOffset.clone();
  const scale = field.scale.clone();
  const recipe = field.recipe;

  material.onBeforeCompile = (shader) => {
    material.userData.shader = shader;
    shader.uniforms.uShapeCenterOffset = { value: centerOffset };
    shader.uniforms.uShapeScale = { value: scale };
    shader.uniforms.uRecipeSeed = { value: recipe.seed };
    shader.uniforms.uRecipeAmplitude = { value: recipe.amplitude };
    shader.uniforms.uRecipeRidges = { value: recipe.ridges };
    shader.uniforms.uRecipeTwist = { value: recipe.twist };
    shader.uniforms.uContainmentMargin = { value: 0.002 };
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
uniform vec3 uShapeCenterOffset;
uniform vec3 uShapeScale;
uniform float uRecipeSeed;
uniform float uRecipeAmplitude;
uniform float uRecipeRidges;
uniform float uRecipeTwist;
uniform float uContainmentMargin;

float getContainmentRadius(vec3 direction) {
  float waveA = sin(direction.x * uRecipeRidges + uRecipeSeed);
  float waveB = cos(direction.y * (uRecipeRidges + 1.0) - uRecipeSeed * 1.3);
  float waveC = sin(direction.z * (uRecipeRidges + 2.0) + uRecipeSeed * 0.6);
  float compound = (waveA + waveB + waveC) / 3.0;
  float wobble = uRecipeTwist * direction.x * direction.y * direction.z * 8.0;
  return max(0.65, 1.22 * (1.0 + compound * uRecipeAmplitude + wobble));
}
`
      )
      .replace(
        "#include <dithering_fragment>",
        `
vec3 containmentPoint = vContainmentPosition + uShapeCenterOffset;
vec3 scaledContainmentPoint = containmentPoint / uShapeScale;
float containmentDistance = length(scaledContainmentPoint);

if (containmentDistance > 0.0001) {
  vec3 containmentDirection = scaledContainmentPoint / containmentDistance;
  float containmentRadius = max(0.02, getContainmentRadius(containmentDirection) - uContainmentMargin);

  if (containmentDistance > containmentRadius) {
    discard;
  }
}

#include <dithering_fragment>`
      );
  };

  material.customProgramCacheKey = () =>
    [
      recipe.seed,
      recipe.amplitude,
      recipe.ridges,
      recipe.twist,
      scale.x,
      scale.y,
      scale.z,
      centerOffset.x,
      centerOffset.y,
      centerOffset.z,
      "margin:0.002"
    ].join(":");

  return material;
}
