# Architecture

## Stack

- Vite for local development and build tooling
- React + TypeScript for the UI and control surface
- Three.js through React Three Fiber (+ drei) for rendering
- Vitest with numeric regression suites; ESLint + Prettier; GitHub Actions CI gating dev/main

## Shape pipeline

- Recipes (seed/amplitude/ridges/twist/stretch/mouth) deform a high-detail icosphere (detail 31, roughly twenty thousand triangles).
- Irregularity is estimated from the variance of vertex radii after deformation, with an Irregular/Regularized verdict at a fixed threshold.
- Vessels whose mouth fraction is below one are cut into a **watertight capped mesh**: wall triangles are clipped below the mouth plane and the opening is sealed by an angular centroid-fan lid. Lid vertices occupy a contiguous range (`lidVertexStart`) that rendering hides via geometry groups while metrics keep the watertight solid.
- The sealed original geometry remains available; every measurement integrates the capped solid so capacity, spill math, and visuals agree.

## Measurement core (exact)

All numbers surfaced in the UI come from two independent exact methods over triangle meshes, cross-tested against each other and against closed-form references:

- `metrics/solid` — volume and centroid by signed-tetrahedron integration (divergence theorem); works on indexed or non-indexed closed meshes.
- `metrics/fill` — volume below any plane: slice areas are exactly quadratic between consecutive vertex heights, captured by samples per piece and integrated through analytically exact Lagrange basis. Supports arbitrary slice directions (tangent-basis projection of records) plus ceilings. Directional models are cached per geometry: fine keys serve metrics, ~2-degree quantized keys serve rendering.
- `metrics/units` — scene calibration: 1 scene unit = 10 cm, therefore 1 cubic unit = exactly 1 liter; L/ml and cm formatting helpers.
- `metrics/spill` — spill onset: lowest rim projection along the local up vector, maximum contained volume from an oriented model of the capped solid, headroom versus current water volume.

Fill percent maps to a water-line height by bisection inversion against these models; submerged center of mass comes from first moments accumulated through the same spline machinery.

## Fluid presentation

Two labeled solver modes share one MarchingCubes surface:

- Static (exact): density is written as a plane signed-distance inside the solid, so MarchingCubes interpolates a smooth free surface landing exactly on the solved hydrostatic plane (offset found by bisection against an oriented model), clipped to walls and the mouth plane. The render path uses the quantized directional cache so tilt dragging never rebuilds records.
- Preview (approximate): legacy voxel equilibrium settle with smoothing and agitation knobs driven by gravity/pouring toggles.
- Water is clipped to vessel walls by a GLSL fragment discard that currently mirrors the parametric radius formula — slated for SDF-texture replacement in Phase 3.
- An orange marker renders the exact submerged centroid inside the tilting vessel group; the floor ring turns red while the current tilt would spill.

## Module map

- `src/lib/shapes.ts` — recipes, capped-mesh construction, irregularity scoring, implicit inside-test, fill cutoff inversion.
- `src/lib/fluid.ts` — voxel FluidState, preview stepper, static-surface writer.
- `src/lib/metrics/solid.ts`, `fill.ts`, `spill.ts`, `units.ts` — the exact measurement stack.
- `src/components/SceneView.tsx` — R3F scene: vessel and water rendering, solver modes, containment shader, CoM marker.
- `src/App.tsx` — control surface, measurements panel, honest-mode badges.

## Simulation roadmap

1. Preserve the renderer and controls as the interaction shell (done).
2. Exact statics as the default trustworthy mode (done).
3. Phase 3: mesh-first authoring with SDF-based inside-testing replacing the radial formula across fluid marking, containment shader, and scoring.
4. Phase 4: dedicated simulation layer (fixed timestep, worker isolation) graduating from reduced-order to position-based fluids/FLIP on the SDF collision grid.
5. Continuous validation: benchmark scenes and confidence indicators move in-step with any dynamic claims.

## Technical risks

- Star-shaped assumptions are embedded in three places today (fluid marking, containment shader, irregularity score). Phase 3 must migrate all three together or visuals and numbers diverge.
- Scientific credibility depends on validation discipline, not solver choice. No number reaches the UI without a test behind it.
- High-fidelity fluid on weak hardware is the standing perf risk; mitigations are workers, adaptive resolution, and the always-available exact-static mode as fallback.
