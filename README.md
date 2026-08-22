# 3dflow

3dflow is a browser sandbox for exploring how water behaves inside irregular 3D vessels. Vessels are built parametrically, measured exactly, and can be tilted, filled, and spilled — with every number on screen backed by tests against closed-form physics.

## What is included

- A Vite + React + TypeScript app with a Three.js scene
- Preset irregular shape profiles plus a custom irregular vessel editor (seed, amplitude, ridges, twist, stretch, mouth opening)
- An irregularity check that flags low-variance shapes as regularized
- Exact measurement core: vessel capacity and water volume in liters/milliliters (1 scene unit = 10 cm), water-line height, live fluid center of mass, and rim headroom with spill warning states
- Two labeled solver modes: **Static (exact)** renders true free-surface planes perpendicular to gravity; **Preview (approximate)** animates the legacy settle dynamics with gravity and pouring effects
- Open-mouthed vessels: tilt past the rim threshold and the headroom readout flags spilling while the floor ring turns red
- A numeric test suite validated against closed-form references (cube ramps, faceted prisms, spherical caps, signed-tetrahedron knots) plus CI running typecheck, lint, tests, and build

## What this is not yet

The Preview mode is an honest approximation for interaction design, not a dynamic solver: water does not slosh or pour out as moving particles. Free-form shape authoring (drag handles, mesh import) is planned next. See the roadmap.

## Quick start

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal. Tests run with `npm test`.

## Project structure

```text
3dflow/
  docs/
    architecture.md
    roadmap.md
    vision.md
  src/
    components/   # R3F scene and rendering
    lib/          # shapes, fluid state, metrics stack
    lib/metrics/  # exact volume/fill/spill/unit math
```

## Documentation

- `docs/vision.md` defines the product goal, audience, and scientific bar.
- `docs/architecture.md` describes the current pipeline, measurement core, and module map.
- `docs/roadmap.md` breaks the work into phased milestones with acceptance criteria.

## Current phase

Phase 2 ("trusted numbers") is complete: static hydrostatics is shipped as exact physics with tests behind every displayed value. Phase 3 begins direct-manipulation shape authoring on a mesh-first representation.
