export const centimetersPerSceneUnit = 10;

export const litersPerCubicSceneUnit = (centimetersPerSceneUnit / 10) ** 3;

export function cubicUnitsToLiters(volumeInCubicUnits: number) {
  return volumeInCubicUnits * litersPerCubicSceneUnit;
}

export function sceneUnitsToCentimeters(lengthInSceneUnits: number) {
  return lengthInSceneUnits * centimetersPerSceneUnit;
}

export function formatVolume(liters: number) {
  if (!Number.isFinite(liters)) {
    return "—";
  }

  if (liters >= 1) {
    return `${liters.toFixed(2)} L`;
  }

  return `${Math.round(liters * 1000)} ml`;
}

export function formatLength(cm: number) {
  if (!Number.isFinite(cm)) {
    return "—";
  }

  return `${cm.toFixed(1)} cm`;
}
