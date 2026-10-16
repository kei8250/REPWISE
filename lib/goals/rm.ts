export type RmMethod = 'bench' | 'squat_deadlift';
export const RM_MAX_REPS = 12;
export const RM_METHODS = {
  bench: { label: 'ベンチ用', coefficient: 40 },
  squat_deadlift: { label: 'スクワット・デッドリフト用', coefficient: 33.3 },
} as const;
export function defaultRmMethod(name: string): RmMethod {
  return /ベンチ|bench/i.test(name) ? 'bench' : 'squat_deadlift';
}
export function rmFactor(reps: number, method: RmMethod) {
  if (!Number.isInteger(reps) || reps < 1 || reps > RM_MAX_REPS) return null;
  // A measured single already represents 1RM; do not inflate it by a rep factor.
  return reps === 1 ? 1 : 1 + reps / RM_METHODS[method].coefficient;
}
export function estimateRm(loadGrams: number, reps: number, method: RmMethod) {
  const factor = rmFactor(reps, method);
  return factor && Number.isFinite(loadGrams) && loadGrams > 0
    ? loadGrams * factor
    : null;
}
export function equivalentRmLoad(
  oneRmGrams: number,
  reps: number,
  method: RmMethod,
) {
  const factor = rmFactor(reps, method);
  return factor && Number.isFinite(oneRmGrams) && oneRmGrams > 0
    ? oneRmGrams / factor
    : null;
}
