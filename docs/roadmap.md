# Roadmap

Status legend: `[done]` complete · `[active]` current focus · `[planned]` future · dates intentionally omitted.

Guiding decisions (from product review):

1. End-state bar is validated physics: every number surfaced in the UI must be defensible, benchmarked, and labeled with its confidence level.
2. Primary audience is students and educators: guided flows, honest labels, and performance on modest hardware outrank raw visual spectacle.
3. The near-term milestone is trusted numbers: true volumetric fill (L/ml), live center of mass during tilt, and spill onset — all testable against closed-form results.
4. Static hydrostatics is exact physics, not an approximation. Shipping it first gives the product real scientific footing long before a dynamic solver exists.
5. Browser-only deployment; WASM and WebGPU compute are acceptable when fidelity demands it.

## Phase 1: Foundation [done]

Shipped in the starter:

- Vite + React + TypeScript app with a React Three Fiber viewport
- Parametric irregular shapes (seed/amplitude/ridges/twist/stretch) with preset library
- Custom-recipe editor with sliders and reset
- Radial-variance irregularity score with Irregular/Regularized verdict
- Fill %, tilt X/Y controls; functional-gravity and pouring toggles
- Voxel equilibrium fluid (20³) rendered through MarchingCubes with shader-side vessel clipping
- Product, architecture, and roadmap documentation

## Phase 2: Measurement core — "trusted numbers" [active]

Goal: make the numbers real before making the motion real. Everything here is exact math over the existing implicit/mesh shape, no solver required.

- Geometry analytics module (`src/lib/metrics/`):
  - Exact volume and centroid via signed-tetrahedron integration over the deformed mesh
  - Height-to-volume inversion (root-find on integrated slice area) replacing the Monte-Carlo `fillVolumeProfile`
  - Live center-of-mass marker rendered inside the vessel, updating with tilt
  - Spill onset estimate: lowest rim point versus free-surface plane under current tilt
- Quasi-static mode promoted to a first-class, labeled "Static (exact)" mode: free surface is the plane perpendicular to gravity, clipped to the vessel interior. This replaces the settle-hack for the default view.
- Units and scale: explicit scene-unit to liters mapping; readouts in L/ml.
- Honest-mode labeling carried into the UI: Static (exact) versus Preview (approximate) badges.
- Engineering hygiene required for anything "validated":
  - Vitest with numeric regression suites against closed-form cases (sphere, cube, cylinder, cone, tilted-cylinder partial fills)
  - ESLint + Prettier; GitHub Actions CI running typecheck, lint, tests

Acceptance criteria:

- Fill % maps to liters within 0.5% of the analytical reference on benchmark primitives
- Center-of-mass readout matches independent numerical integration to floating-point tolerance
- Spill onset tilt angle matches hand-computed reference cases
- CI green on every PR

## Phase 3: Shape authoring — direct manipulation [planned]

Goal: users push and pull the actual vessel, not sliders. This phase removes the star-shaped-solid assumption everywhere it is currently baked in.

- Mesh-first shape representation:
  - Recipes remain as generators, but the canonical shape becomes an editable mesh
  - Drag handles with localized falloff deformations; mirror/symmetry toggle; reset and variant branching
- Inside-testing upgrade:
  - Mesh-to-SDF voxelization (or fast generalized winding number) replaces `getDirectionalRadius`
  - Fluid solid-marking, fill profiling, and metrics all consume the SDF going forward
- Containment rendering upgrade:
  - Replace the GLSL copy of the recipe formula with 3D-texture SDF sampling so water clips correctly inside arbitrary meshes (removes duplicated shape logic between TS and GLSL)
- Irregularity scoring v2:
  - Symmetry deviation, curvature statistics, and primitive-fit residuals (sphere/cylinder/box fit)
  - Verdict pill reports which criterion failed, not just a scalar
- Authoring ergonomics: undo/redo history, saved custom presets, JSON shape import/export

Acceptance criteria:

- A hand-deformed non-star-shaped vessel (overhang, waist) renders, fills, tilts, and scores correctly
- Undo/redo survives shape switches without leaking geometries
- Water containment holds visually at vessel walls for arbitrary meshes

## Phase 4: Dynamic simulation fidelity [planned]

Goal: replace the equilibrium approximator with a real solver for sloshing, pouring over the rim, and impact behavior — while keeping classroom hardware alive.

- Dedicated simulation layer (`src/lib/simulation/`):
  - Fixed-timestep loop decoupled from React render cadence; Web Worker isolation with interpolated rendering
- Solver path (reduced-order first, graduate upward):
  - Start: position-based fluids or FLIP on the SDF collision grid at modest particle counts
  - Compute: WASM (Rust) core and/or WebGPU compute, chosen by benchmark on integrated GPUs
- Behaviors unlocked: dynamic sloshing, true pour-out with tracked mass loss, impact and bounce response, viscosity and surface-tension parameter presets
- Conservation instrumentation: volume/mass conservation tracked and displayed live; drift beyond tolerance flags the view as approximate
- Validation discipline moves in-step with the solver (pulled forward from old Phase 4):
  - Benchmark scenes with expected outcomes (dam-break equivalents, settled fill heights, sloshing frequencies in cylinders)
  - Confidence indicators and error bounds surfaced in the UI; Preview versus Validated mode distinction enforced

Acceptance criteria:

- Mass conserved to within stated tolerance over a 60-second sloshing session, or drift is visibly flagged
- Pour-over-rim transfers the correct spilled volume to a floor collection metric
- Solver maintains interactive framerates on integrated graphics via adaptive resolution

## Phase 5: Classroom product polish [planned]

Goal: turn a credible tool into a teachable product.

- Guided labs: scenario presets framed as exercises, annotation overlays explaining free-surface orientation, center-of-mass shifts, and spill conditions
- Comparison mode: two vessels side-by-side under identical fill/tilt conditions
- Shareable scenarios: reproducible URLs encoding shape, fill, tilt, and mode; preset gallery
- Performance: quality presets and adaptive resolution targeting school Chromebooks; profiling hooks
- Deployment, opt-in analytics, structured feedback loop, accessibility pass

## Cross-cutting risks

- Star-shaped assumptions are embedded in three places today (fluid marking, containment shader, irregularity score). Phase 3 must migrate all three together or visuals and numbers diverge.
- Scientific credibility depends on validation discipline, not solver choice. No number reaches the UI without a test behind it.
- High-fidelity fluid on weak hardware is the standing perf risk; mitigations are workers, adaptive resolution, and an always-available exact-static mode as fallback.
- Scope risk in free-form authoring; the parametric recipe path remains supported throughout so authoring work never blocks the core loop.

## Dependency notes

- Phase 2 needs nothing it does not already have; it is pure addition plus test infrastructure.
- Phase 3's SDF pipeline is a prerequisite for Phase 4 collision handling; doing authoring before the solver avoids building solver collision twice.
- Phase 5 sharing and labs depend on stable serialization formats introduced across Phases 2–3 (shape JSON, scenario JSON).
