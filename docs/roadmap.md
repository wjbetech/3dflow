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

## Phase 2: Measurement core — "trusted numbers" [done]

Delivered across PRs #2–#7:

- `src/lib/metrics/solid.ts` — exact volume and centroid for closed meshes (indexed or not) via signed-tetrahedron integration, validated against cube/tetrahedron/faceted-prism closed forms and UV-sphere convergence
- Tessellation fix surfaced by that validation: vessels build at icosahedron detail 31 (~20k faces) instead of detail 5 (720 faces), closing a ~2% systematic volume underestimate
- `src/lib/metrics/fill.ts` — deterministic height-to-volume inversion replacing the Monte-Carlo profile: slice areas are exactly quadratic between vertex heights, integrated through analytically exact Lagrange splines; supports arbitrary slice directions (tangent-basis projection) with a geometry-keyed directional cache
- `src/lib/metrics/units.ts` — 1 scene unit = 10 cm, therefore 1 cubic unit = exactly 1 liter; L/ml formatting
- Parametric vessel mouths: watertight capped meshes (triangle clipping plus angular-fan lids) so capacity, spill math, and visuals agree; lid vertices hidden at render time while metrics stay watertight
- `src/lib/metrics/spill.ts` — spill onset from the lowest rim projection along local up, capacity taken from an oriented model of the capped solid
- Measurements panel: capacity, water volume (L/ml), water line height, live fluid center of mass, rim headroom with ok/warn/danger tones; orange CoM marker riding the tilting vessel
- Solver switch with honest labels: "Static - exact" renders true free-surface planes perpendicular to gravity; "Preview - approximate" keeps the legacy settle dynamics
- Engineering hygiene: Vitest suites against closed-form references, ESLint + Prettier, GitHub Actions CI gating dev/main

Acceptance criteria — met:

- Fill % maps to liters within tolerance: benchmark primitives exact to machine precision (cube ramp ~1e-16); irregular shapes cross-checked against direct quadrature of the continuous field within 0.5%
- Center-of-mass readout matches closed forms to ~1e-9 on cube and synthetic tetrahedron fixtures; symmetry identities hold on spheres
- Spill behavior verified: upright headroom equals capacity exactly, capacity decays monotonically under tilt sweeps, upside-down retains approximately zero
- CI green on every merged PR

## Phase 3: Shape authoring — direct manipulation [active]

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
