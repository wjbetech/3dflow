# Architecture

## Current starter stack

- Vite for local development and build tooling
- React + TypeScript for the UI and control surface
- Three.js through React Three Fiber for rendering
- A lightweight geometric irregularity scorer based on radial variance

## Current runtime model

The first implementation deliberately separates interface scaffolding from scientific claims.

- Shape generation starts from an icosahedron and applies directional distortion, ridge waves, twist, and stretch terms.
- Irregularity is estimated from the variance of vertex radii after deformation.
- Water is visualized as an inner mesh clipped by a tilt-aware plane.
- Gravity mode damps the water surface toward a settle target.
- Splash mode adds stylized agitation so interaction design can progress before the full solver exists.

## Simulation roadmap

The likely evolution path is:

1. Preserve the current renderer and controls as the interaction shell.
2. Introduce a dedicated simulation layer that owns state independent of React render cadence.
3. Start with a 2.5D or reduced-order fill model for performance and validation.
4. Graduate to SPH, FLIP, PIC/FLIP, or a grid-based Navier-Stokes approach when fidelity requirements justify the cost.
5. Add calibration scenes and benchmarking against known fluid cases.

## Suggested module growth

- `src/lib/shapes.ts`
  Own preset definitions, custom shape recipes, geometry creation, and irregularity scoring.
- `src/components/SceneView.tsx`
  Own rendering, camera, lighting, and visual water presentation.
- Future `src/lib/simulation/`
  Should own integrators, collision resolution, gravity models, and validation fixtures.
- Future `src/lib/metrics/`
  Should compute derived outputs such as fill fraction by volume, center of mass, and spill onset.

## Technical risks

- Scientific accuracy will depend more on solver choice and validation discipline than rendering quality.
- Irregularity checks based only on radial variance will need stronger geometric criteria over time.
- High-fidelity fluid simulation can become GPU-bound quickly, especially with free-form geometry.

