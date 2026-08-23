import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as THREE from "three";
import { SceneView } from "./components/SceneView";
import {
  buildIrregularGeometry,
  customRecipeDefaults,
  getFillCutoffY,
  getRecipeById,
  shapePresets,
  type ShapeRecipe
} from "./lib/shapes";
import {
  cubicUnitsToLiters,
  formatLength,
  formatVolume,
  sceneUnitsToCentimeters
} from "./lib/metrics/units";
import { computeSpillState } from "./lib/metrics/spill";
import { useHistory } from "./lib/useHistory";

function App() {
  const [shapeId, setShapeId] = useState(shapePresets[0].id);
  const [fillPercent, setFillPercent] = useState(56);
  const [tiltX, setTiltX] = useState(12);
  const [tiltY, setTiltY] = useState(-9);
  const [gravityEnabled, setGravityEnabled] = useState(true);
  const [pouringEnabled, setPouringEnabled] = useState(true);
  const [solverMode, setSolverMode] = useState<"static" | "preview" | "dynamic">("static");
  const [viscosity, setViscosity] = useState(0.01);
  const [surfaceTension, setSurfaceTension] = useState(0.02);
  const recipeHistory = useHistory<ShapeRecipe>(customRecipeDefaults);
  const customRecipe = recipeHistory.present;
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeRecipe = useMemo(
    () => (shapeId === "custom" ? customRecipe : getRecipeById(shapeId)),
    [customRecipe, shapeId]
  );
  const activeField = useMemo(() => buildIrregularGeometry(activeRecipe), [activeRecipe]);
  const irregularityReport = activeField.irregularityReport;
  const irregularityVerdict = irregularityReport.irregular ? "Irregular" : "Regularized";

  const waterLine = useMemo(() => getFillCutoffY(activeField, fillPercent), [activeField, fillPercent]);
  const submerged = useMemo(
    () => activeField.fillModel.centroidBelow(waterLine),
    [activeField, waterLine]
  );
  const tiltQuaternion = useMemo(
    () =>
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(tiltX),
          0,
          THREE.MathUtils.degToRad(-tiltY),
          "XYZ"
        )
      ),
    [tiltX, tiltY]
  );
  const spillState = useMemo(
    () => computeSpillState(activeField, tiltQuaternion, submerged?.volume ?? 0),
    [activeField, tiltQuaternion, submerged]
  );

  const capacityLiters = cubicUnitsToLiters(activeField.metrics.volume);
  const waterVolumeLiters = cubicUnitsToLiters(submerged?.volume ?? 0);
  const waterLineCm = sceneUnitsToCentimeters(waterLine - activeField.bounds.min.y);
  const fluidCentreLabel = submerged
    ? `${formatLength(sceneUnitsToCentimeters(submerged.centroid.y - activeField.bounds.min.y))} above base`
    : "—";

  const headroomTone = spillState
    ? spillState.spilling
      ? "danger"
      : spillState.headroomVolume < 0.05
        ? "warn"
        : "ok"
    : "muted";
  const headroomLabel = !spillState
    ? "Sealed vessel"
    : spillState.spilling
      ? "Spilling"
      : formatVolume(cubicUnitsToLiters(spillState.headroomVolume));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || shapeId !== "custom") {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        recipeHistory.undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        recipeHistory.redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shapeId, recipeHistory.undo, recipeHistory.redo, recipeHistory]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-icon" aria-hidden="true">
            <span />
          </span>
          <span className="brand-wordmark">3dflow</span>
        </div>

        <nav className="social-nav" aria-label="Social links">
          <SocialLink href="https://github.com" label="GitHub">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 .5A12 12 0 0 0 8.21 23.9c.6.11.82-.26.82-.58l-.02-2.04c-3.34.73-4.05-1.41-4.05-1.41-.55-1.37-1.33-1.74-1.33-1.74-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.82 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.48-1.31-5.48-5.82 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.52.12-3.16 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.28-1.53 3.29-1.21 3.29-1.21.65 1.64.24 2.86.12 3.16.77.83 1.23 1.88 1.23 3.17 0 4.52-2.81 5.51-5.49 5.81.43.37.82 1.1.82 2.23l-.02 3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"
              />
            </svg>
          </SocialLink>
          <SocialLink href="https://x.com" label="X">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.9 2H22l-6.77 7.74L23.2 22h-6.27l-4.91-7.45L5.5 22H2.4l7.24-8.28L1.8 2h6.43l4.44 6.76L18.9 2Zm-1.1 18h1.74L7.3 3.9H5.43L17.8 20Z"
              />
            </svg>
          </SocialLink>
          <SocialLink href="https://instagram.com" label="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M7.75 2h8.5A5.76 5.76 0 0 1 22 7.75v8.5A5.76 5.76 0 0 1 16.25 22h-8.5A5.76 5.76 0 0 1 2 16.25v-8.5A5.76 5.76 0 0 1 7.75 2Zm0 1.8A3.96 3.96 0 0 0 3.8 7.75v8.5a3.96 3.96 0 0 0 3.95 3.95h8.5a3.96 3.96 0 0 0 3.95-3.95v-8.5a3.96 3.96 0 0 0-3.95-3.95h-8.5Zm8.93 1.35a1.17 1.17 0 1 1 0 2.34 1.17 1.17 0 0 1 0-2.34ZM12 6.85A5.15 5.15 0 1 1 6.85 12 5.16 5.16 0 0 1 12 6.85Zm0 1.8A3.35 3.35 0 1 0 15.35 12 3.35 3.35 0 0 0 12 8.65Z"
              />
            </svg>
          </SocialLink>
        </nav>
      </header>

      <section className="playground-shell">
        {!sidebarOpen ? (
          <button
            type="button"
            className="drawer-button"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}

        <aside className={sidebarOpen ? "sidebar open" : "sidebar"} aria-label="3dflow controls">
          <div className="sidebar-header">
            <div>
              <p className="sidebar-kicker">Controls</p>
              <h1>Playground</h1>
            </div>
            <button
              type="button"
              className="sidebar-close"
              aria-label="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              <span />
              <span />
            </button>
          </div>

          <div className="sidebar-content">
            <section className="control-group">
              <div className="control-group__header">
                <h2>Shape</h2>
                <div className="status-pill" title={irregularityReport.criteria.map((c) => `${c.label}: ${c.score.toFixed(1)}${c.passed ? "" : " (failed)"}`).join(", ")}>
                  <strong>{irregularityVerdict}</strong>
                  <span>
                    {irregularityReport.irregular
                      ? irregularityReport.failedLabels.join(" · ")
                      : "all checks passed"}
                  </span>
                </div>
              </div>

              <label className="field">
                <span>Preset</span>
                <select value={shapeId} onChange={(event) => setShapeId(event.target.value)}>
                  {shapePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom irregular vessel</option>
                </select>
              </label>

              {shapeId === "custom" ? (
                <>
                  <div className="inline-actions">
                    <span className="mini-label">Custom recipe</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        recipeHistory.update(
                          (current) => ({
                            ...customRecipeDefaults,
                            deformations: current.deformations
                          }),
                          "reset-sliders"
                        )
                      }
                    >
                      Reset sliders
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        recipeHistory.update((current) => ({ ...current, deformations: [] }), "clear-sculpt")
                      }
                    >
                      Clear sculpting
                    </button>
                  </div>
                  <div className="inline-actions">
                    <span className="mini-label">History</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!recipeHistory.canUndo}
                      onClick={() => recipeHistory.undo()}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={!recipeHistory.canRedo}
                      onClick={() => recipeHistory.redo()}
                    >
                      Redo
                    </button>
                  </div>
                  <p className="group-note">
                    Drag the teal handles on the vessel to sculpt it. Changes apply on release. Ctrl+Z /
                    Ctrl+Shift+Z to undo and redo.
                  </p>
                  <Slider
                    label="Seed"
                    min={0}
                    max={12}
                    step={0.1}
                    value={customRecipe.seed}
                    onChange={(value) =>
                      recipeHistory.update((current) => ({ ...current, seed: value }), "slider:seed")
                    }
                  />
                  <Slider
                    label="Amplitude"
                    min={0}
                    max={0.45}
                    step={0.01}
                    value={customRecipe.amplitude}
                    onChange={(value) =>
                      recipeHistory.update((current) => ({ ...current, amplitude: value }), "slider:amplitude")
                    }
                  />
                  <Slider
                    label="Ridges"
                    min={2}
                    max={12}
                    step={1}
                    value={customRecipe.ridges}
                    onChange={(value) =>
                      recipeHistory.update((current) => ({ ...current, ridges: value }), "slider:ridges")
                    }
                  />
                  <Slider
                    label="Twist"
                    min={-0.3}
                    max={0.3}
                    step={0.01}
                    value={customRecipe.twist}
                    onChange={(value) =>
                      recipeHistory.update((current) => ({ ...current, twist: value }), "slider:twist")
                    }
                  />
                  <Slider
                    label="Mouth"
                    min={0.55}
                    max={1}
                    step={0.01}
                    value={customRecipe.mouth}
                    onChange={(value) =>
                      recipeHistory.update((current) => ({ ...current, mouth: value }), "slider:mouth")
                    }
                  />
                  <Slider
                    label="Stretch X"
                    min={-0.35}
                    max={0.35}
                    step={0.01}
                    value={customRecipe.stretch.x}
                    onChange={(value) =>
                      recipeHistory.update(
                        (current) => ({
                          ...current,
                          stretch: { ...current.stretch, x: value }
                        }),
                        "slider:stretch-x"
                      )
                    }
                  />
                  <Slider
                    label="Stretch Y"
                    min={-0.35}
                    max={0.35}
                    step={0.01}
                    value={customRecipe.stretch.y}
                    onChange={(value) =>
                      recipeHistory.update(
                        (current) => ({
                          ...current,
                          stretch: { ...current.stretch, y: value }
                        }),
                        "slider:stretch-y"
                      )
                    }
                  />
                  <Slider
                    label="Stretch Z"
                    min={-0.35}
                    max={0.35}
                    step={0.01}
                    value={customRecipe.stretch.z}
                    onChange={(value) =>
                      recipeHistory.update(
                        (current) => ({
                          ...current,
                          stretch: { ...current.stretch, z: value }
                        }),
                        "slider:stretch-z"
                      )
                    }
                  />
                </>
              ) : (
                <p className="group-note">{activeRecipe.summary}</p>
              )}
            </section>

            <section className="control-group">
              <div className="control-group__header">
                <h2>Fluid</h2>
                <span className="mini-label">{fillPercent}% filled</span>
              </div>
              <Slider label="Fill" min={0} max={100} step={1} value={fillPercent} onChange={setFillPercent} />
              <Slider label="Tilt X" min={-35} max={35} step={1} value={tiltX} onChange={setTiltX} />
              <Slider label="Tilt Y" min={-35} max={35} step={1} value={tiltY} onChange={setTiltY} />
            </section>

            <section className="control-group">
              <div className="control-group__header">
                <h2>Measurements</h2>
                <span className="mini-label">
                  {solverMode === "static" ? "Static · exact" : "Preview · approximate"} · 1 unit = 10 cm
                </span>
              </div>
              <StatRow label="Capacity" value={formatVolume(capacityLiters)} />
              <StatRow label="Water volume" value={formatVolume(waterVolumeLiters)} />
              <StatRow label="Water line" value={formatLength(waterLineCm)} />
              <StatRow label="Fluid CoM" value={fluidCentreLabel} />
              <StatRow label="Rim headroom" value={headroomLabel} tone={headroomTone} />
            </section>

            <section className="control-group">
              <div className="control-group__header">
                <h2>Solver</h2>
                <span className="mini-label">{solverMode === "static" ? "Static solver" : "Preview solver"}</span>
              </div>
              <div className="segmented">
                <button
                  type="button"
                  className={solverMode === "static" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setSolverMode("static")}
                >
                  Static
                  <span>exact</span>
                </button>
                <button
                  type="button"
                  className={solverMode === "preview" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setSolverMode("preview")}
                >
                  Preview
                  <span>approximate</span>
                </button>
                <button
                  type="button"
                  className={solverMode === "dynamic" ? "segmented-button active" : "segmented-button"}
                  onClick={() => setSolverMode("dynamic")}
                >
                  Dynamic
                  <span>PBF</span>
                </button>
              </div>
              {solverMode === "dynamic" && (
                <>
                  <Slider label="Viscosity" min={0} max={0.05} step={0.001} value={viscosity} onChange={setViscosity} />
                  <Slider
                    label="Surface tension"
                    min={0}
                    max={0.1}
                    step={0.001}
                    value={surfaceTension}
                    onChange={setSurfaceTension}
                  />
                </>
              )}
              <Toggle
                label="Functional gravity"
                checked={gravityEnabled}
                onChange={() => setGravityEnabled((current) => !current)}
              />
              <Toggle
                label="Pouring effects"
                checked={pouringEnabled}
                onChange={() => setPouringEnabled((current) => !current)}
              />
            </section>
          </div>
        </aside>

        <section className="model-stage">
          <div className="grid-backdrop" aria-hidden="true" />
          <SceneView
            field={activeField}
            fillPercent={fillPercent}
            tiltX={tiltX}
            tiltY={tiltY}
            mode={solverMode}
            viscosity={viscosity}
            surfaceTension={surfaceTension}
            gravityEnabled={gravityEnabled}
            pouringEnabled={pouringEnabled}
            spilling={spillState?.spilling ?? false}
            maxContainedUnits={spillState?.maxContainedVolume ?? null}
            deformations={customRecipe.deformations ?? []}
            sculptingEnabled={shapeId === "custom"}
            onCommitDeformation={(index, deformation) => {
              recipeHistory.update((current) => {
                const next = [...(current.deformations ?? [])];

                while (next.length <= index) {
                  next.push({
                    origin: [0, 0, 0],
                    displacement: [0, 0, 0],
                    radius: 0.55
                  });
                }

                next[index] = deformation;

                return { ...current, deformations: next };
              });
            }}
          />
        </section>
      </section>
    </main>
  );
}

type SliderProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

function Slider({ label, min, max, step, value, onChange }: SliderProps) {
  return (
    <label className="field">
      <div className="field-header">
        <span>{label}</span>
        <strong>{Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: () => void;
};

type StatRowProps = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger" | "muted";
};

function StatRow({ label, value, tone = "ok" }: StatRowProps) {
  return (
    <div className={`stat-row stat-row--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <button type="button" className={checked ? "toggle-pill active" : "toggle-pill"} onClick={onChange}>
        <span />
      </button>
    </label>
  );
}

type SocialLinkProps = {
  href: string;
  label: string;
  children: ReactNode;
};

function SocialLink({ href, label, children }: SocialLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className="social-link">
      {children}
    </a>
  );
}

export default App;
