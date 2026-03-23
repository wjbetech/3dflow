# 3dflow

3dflow is a starter application for exploring irregular 3D vessel shapes and how fluid volume behaves inside them. This initial version sets up the interaction model, starter visual simulation, and planning docs needed to evolve it into a more scientifically rigorous fluid-and-shape mechanics tool.

## What is included

- A Vite + React + TypeScript app with a Three.js scene
- Preset irregular shape profiles plus a custom irregular vessel editor
- An irregularity check that flags low-variance shapes as regularized
- X axis, Y axis, and fill-volume controls for water-level previews
- Interaction toggles for functional gravity and pouring effects
- Initial product, architecture, and roadmap documentation

## What this starter is not yet

The rendered water uses a clipped inner mesh to provide an honest visual prototype. It is useful for interaction design, shape authoring, and UX iteration, but it is not yet a validated CFD or SPH solver.

## Quick start

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

## Project structure

```text
3dflow/
  docs/
    architecture.md
    roadmap.md
    vision.md
  src/
    components/
    lib/
```

## Documentation

- `docs/vision.md` defines the product goal, audience, and scientific bar.
- `docs/architecture.md` describes the current stack and the planned simulation path.
- `docs/roadmap.md` breaks the work into phased milestones.

## Suggested next steps

1. Replace the clipped water proxy with a particle or grid-based solver.
2. Add a true custom-shape authoring workflow with constraints, undo, and import/export.
3. Record measurable fluid metrics such as center of mass, pressure estimates, and spill rate.
4. Build validation scenes that compare simulated behavior against known reference cases.

