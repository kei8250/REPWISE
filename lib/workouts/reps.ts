import type { WorkoutSet } from './types';

export type RepMode = 'standard' | 'per_side';
export type SideReps = {
  actualRepsLeft?: number | null;
  actualRepsRight?: number | null;
  actualReps: number | null;
};

export function hasSideReps(set: SideReps) {
  return set.actualRepsLeft != null || set.actualRepsRight != null;
}

export function minimumSideReps(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  return left == null || right == null ? null : Math.min(left, right);
}

export function effectiveReps(set: SideReps) {
  return hasSideReps(set)
    ? minimumSideReps(set.actualRepsLeft, set.actualRepsRight)
    : set.actualReps;
}

export function totalReps(set: SideReps) {
  return hasSideReps(set)
    ? (set.actualRepsLeft ?? 0) + (set.actualRepsRight ?? 0)
    : (set.actualReps ?? 0);
}

export function repsLabel(set: SideReps) {
  return hasSideReps(set)
    ? `右 ${set.actualRepsRight ?? '—'} / 左 ${set.actualRepsLeft ?? '—'} 回`
    : `${set.actualReps ?? '—'} 回`;
}

// The last edited bound wins. Adjust the other bound before making a snapshot.
export function editTargetRange(
  set: WorkoutSet,
  field: 'targetRepMin' | 'targetRepMax',
  value: number | null,
): WorkoutSet {
  const next = { ...set, [field]: value };
  if (
    next.targetRepMin !== null &&
    next.targetRepMax !== null &&
    next.targetRepMin > next.targetRepMax
  ) {
    if (field === 'targetRepMin') next.targetRepMax = value;
    else next.targetRepMin = value;
  }
  return next;
}
