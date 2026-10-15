import type { WorkoutSet } from './types';

export type RepMode = 'standard' | 'per_side';
export type LoadBasis = 'per_rep' | 'paired_total';
export type SetRole = 'standard' | 'top' | 'backoff';
export function setMetadata(row: { role?: unknown; load_basis?: unknown }): {
  role?: SetRole;
  loadBasis?: LoadBasis;
} {
  return {
    ...(row.role === 'top' || row.role === 'backoff' ? { role: row.role } : {}),
    ...(row.load_basis === 'paired_total' ? { loadBasis: row.load_basis } : {}),
  };
}
export const setRoleLabel = (role?: SetRole) =>
  role === 'top' ? 'トップ' : role === 'backoff' ? 'バックオフ' : '通常';
export const loadBasisLabel = (basis?: LoadBasis) =>
  basis === 'paired_total' ? '左右合計（片側は半分）' : '片側1回で扱う重量';
export const loadBasisHelp = (basis?: LoadBasis) =>
  basis === 'paired_total'
    ? '例：右20kg・左20kgなら40kg。ボリュームは入力重量÷2×左右の回数合計です。目標重量と増量幅もこの基準で入力します。'
    : '片手種目は片手分。ブルガリアンなど片脚で両手の重りを支える種目は、保持する重りの合計。ボリュームは入力重量×左右の回数合計です。目標重量と増量幅もこの基準で入力します。';
export type SideReps = {
  loadBasis?: LoadBasis;
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
    ? ((set.actualRepsLeft ?? 0) + (set.actualRepsRight ?? 0)) /
        (set.loadBasis === 'paired_total' ? 2 : 1)
    : (set.actualReps ?? 0);
}

export function effectiveLoadGrams(
  set: SideReps & { actualLoadGrams: number | null },
) {
  return set.actualLoadGrams === null
    ? null
    : set.actualLoadGrams /
        (hasSideReps(set) && set.loadBasis === 'paired_total' ? 2 : 1);
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
