import {
  effectiveReps,
  type LoadBasis,
  type SetRole,
} from '@/lib/workouts/reps';
import type { ExerciseMaster } from '@/lib/workouts/types';

export type ProgressionType = 'double_progression';

export interface ProgressionProfile {
  loadBasis?: LoadBasis;
  exerciseId: string;
  repMin: number;
  repMax: number;
  workingSets: number;
  incrementGrams: number;
  progressionType: ProgressionType;
}

export type ProgressionProfileOverride = Partial<
  Omit<ProgressionProfile, 'exerciseId'>
>;

export interface ProgressionPerformanceSet {
  role?: SetRole;
  loadBasis?: LoadBasis;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  id: string;
  position: number;
  status: string;
  setType: string;
  actualLoadGrams: number | null;
  actualReps: number | null;
  actualRepsLeft?: number | null;
  actualRepsRight?: number | null;
  deletedAt?: string | null;
}

export interface ProgressionExercisePerformance {
  workoutId: string;
  workoutVersion: number;
  workoutLocalDate: string;
  workoutUpdatedAt: string;
  workoutStatus: string;
  workoutDeletedAt: string | null;
  workoutExerciseId: string;
  exerciseId: string;
  exerciseStatus: string;
  sets: ProgressionPerformanceSet[];
}

export type ProgressionDecisionStatus =
  | 'increase_load'
  | 'keep_load'
  | 'set_specific'
  | 'insufficient_data';

export type ProgressionReasonCode =
  | 'all_sets_at_rep_max'
  | 'within_rep_range'
  | 'below_rep_min'
  | 'no_completed_history'
  | 'invalid_profile'
  | 'exercise_mismatch'
  | 'workout_not_completed'
  | 'workout_deleted'
  | 'exercise_not_completed'
  | 'working_set_count_mismatch'
  | 'incomplete_working_set'
  | 'invalid_actuals'
  | 'inconsistent_load'
  | 'set_specific_progression'
  | 'load_basis_changed';

export interface ProgressionTargetSet {
  position: number;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
}

export interface ProgressionTarget {
  loadGrams: number;
  repMin: number;
  repMax: number;
  workingSets: number;
  sets: ProgressionTargetSet[];
}

export interface SetProgressionDecision {
  actualRepsLeft?: number | null;
  actualRepsRight?: number | null;
  position: number;
  role?: SetRole;
  loadBasis?: LoadBasis;
  currentLoadGrams: number;
  actualReps: number;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  increase: boolean;
}

export interface ProgressionDecision {
  setDecisions?: SetProgressionDecision[];
  status: ProgressionDecisionStatus;
  reasonCode: ProgressionReasonCode;
  currentLoadGrams: number | null;
  nextTarget: ProgressionTarget | null;
  evaluatedSetIds: string[];
  sourceWorkoutId: string | null;
  sourceWorkoutVersion: number | null;
}

export interface ExerciseProgressionRecommendation {
  exerciseId: string;
  profile: ProgressionProfile | null;
  performance: ProgressionExercisePerformance | null;
  decision: ProgressionDecision;
}

export function resolveProgressionProfile(
  exercise: ExerciseMaster,
  override: ProgressionProfileOverride = {},
): ProgressionProfile | null {
  const profile: ProgressionProfile = {
    exerciseId: exercise.id,
    ...(exercise.loadBasis ? { loadBasis: exercise.loadBasis } : {}),
    repMin: override.repMin ?? exercise.defaultRepMin ?? 0,
    repMax: override.repMax ?? exercise.defaultRepMax ?? 0,
    workingSets: override.workingSets ?? exercise.defaultWorkingSets ?? 0,
    incrementGrams:
      override.incrementGrams ?? exercise.defaultIncrementGrams ?? 0,
    progressionType: override.progressionType ?? 'double_progression',
  };
  return isValidProfile(profile) ? profile : null;
}

function isValidProfile(profile: ProgressionProfile) {
  return (
    profile.progressionType === 'double_progression' &&
    Number.isInteger(profile.repMin) &&
    profile.repMin > 0 &&
    Number.isInteger(profile.repMax) &&
    profile.repMax >= profile.repMin &&
    Number.isInteger(profile.workingSets) &&
    profile.workingSets > 0 &&
    Number.isInteger(profile.incrementGrams) &&
    profile.incrementGrams > 0
  );
}

function insufficient(
  reasonCode: ProgressionReasonCode,
  performance: ProgressionExercisePerformance | null,
): ProgressionDecision {
  return {
    status: 'insufficient_data',
    reasonCode,
    currentLoadGrams: null,
    nextTarget: null,
    evaluatedSetIds: [],
    sourceWorkoutId: performance?.workoutId ?? null,
    sourceWorkoutVersion: performance?.workoutVersion ?? null,
  };
}

function buildTarget(
  loadGrams: number,
  profile: ProgressionProfile,
): ProgressionTarget {
  return {
    loadGrams,
    repMin: profile.repMin,
    repMax: profile.repMax,
    workingSets: profile.workingSets,
    sets: Array.from({ length: profile.workingSets }, (_, position) => ({
      position,
      targetLoadGrams: loadGrams,
      targetRepMin: profile.repMin,
      targetRepMax: profile.repMax,
    })),
  };
}

export function evaluateProgression(
  performance: ProgressionExercisePerformance | null,
  profile: ProgressionProfile | null,
): ProgressionDecision {
  if (!profile || !isValidProfile(profile))
    return insufficient('invalid_profile', performance);
  if (!performance) return insufficient('no_completed_history', null);
  if (performance.exerciseId !== profile.exerciseId)
    return insufficient('exercise_mismatch', performance);
  if (performance.workoutStatus !== 'completed')
    return insufficient('workout_not_completed', performance);
  if (performance.workoutDeletedAt)
    return insufficient('workout_deleted', performance);
  if (performance.exerciseStatus !== 'completed')
    return insufficient('exercise_not_completed', performance);

  const workingSets = performance.sets
    .filter((set) => !set.deletedAt && set.setType === 'working')
    .sort((a, b) => a.position - b.position);
  const validCompleted = workingSets.filter(
    (set) =>
      set.status === 'completed' &&
      Number.isInteger(set.actualLoadGrams) &&
      (set.actualLoadGrams ?? 0) > 0 &&
      Number.isInteger(effectiveReps(set)) &&
      (effectiveReps(set) ?? 0) > 0,
  );
  const loads = new Set(validCompleted.map((set) => set.actualLoadGrams));
  if (
    workingSets.some((set) => set.role && set.role !== 'standard') ||
    loads.size > 1
  ) {
    if (!validCompleted.length)
      return insufficient('invalid_actuals', performance);
    if (
      validCompleted.some(
        (set) =>
          (set.loadBasis ?? 'per_rep') !== (profile.loadBasis ?? 'per_rep'),
      )
    )
      return insufficient('load_basis_changed', performance);
    const setDecisions = validCompleted.map((set) => {
      const validRange =
        set.targetRepMin != null &&
        set.targetRepMax != null &&
        set.targetRepMin > 0 &&
        set.targetRepMax >= set.targetRepMin;
      const min = validRange ? set.targetRepMin! : profile.repMin;
      const max = validRange ? set.targetRepMax! : profile.repMax;
      const actualReps = effectiveReps(set)!;
      const increase = actualReps >= max;
      return {
        position: set.position,
        ...(set.role ? { role: set.role } : {}),
        ...(set.loadBasis ? { loadBasis: set.loadBasis } : {}),
        ...(set.actualRepsLeft != null || set.actualRepsRight != null
          ? {
              actualRepsLeft: set.actualRepsLeft,
              actualRepsRight: set.actualRepsRight,
            }
          : {}),
        currentLoadGrams: set.actualLoadGrams!,
        actualReps,
        targetLoadGrams:
          set.actualLoadGrams! + (increase ? profile.incrementGrams : 0),
        targetRepMin: min,
        targetRepMax: max,
        increase,
      };
    });
    return {
      status: 'set_specific',
      reasonCode: 'set_specific_progression',
      currentLoadGrams: null,
      nextTarget: null,
      setDecisions,
      evaluatedSetIds: validCompleted.map((set) => set.id),
      sourceWorkoutId: performance.workoutId,
      sourceWorkoutVersion: performance.workoutVersion,
    };
  }
  if (workingSets.length !== profile.workingSets)
    return insufficient('working_set_count_mismatch', performance);
  if (workingSets.some((set) => set.status !== 'completed'))
    return insufficient('incomplete_working_set', performance);
  if (
    workingSets.some(
      (set) =>
        !Number.isInteger(set.actualLoadGrams) ||
        (set.actualLoadGrams ?? 0) <= 0 ||
        !Number.isInteger(effectiveReps(set)) ||
        (effectiveReps(set) ?? 0) <= 0,
    )
  )
    return insufficient('invalid_actuals', performance);

  if (
    workingSets.some(
      (set) =>
        (set.loadBasis ?? 'per_rep') !== (profile.loadBasis ?? 'per_rep'),
    )
  )
    return insufficient('load_basis_changed', performance);

  const currentLoadGrams = workingSets[0].actualLoadGrams as number;
  const reps = workingSets.map((set) => effectiveReps(set) as number);
  const increase = reps.every((repsValue) => repsValue >= profile.repMax);
  const belowRange = reps.some((repsValue) => repsValue < profile.repMin);
  const nextLoadGrams = increase
    ? currentLoadGrams + profile.incrementGrams
    : currentLoadGrams;
  return {
    status: increase ? 'increase_load' : 'keep_load',
    reasonCode: increase
      ? 'all_sets_at_rep_max'
      : belowRange
        ? 'below_rep_min'
        : 'within_rep_range',
    currentLoadGrams,
    nextTarget: buildTarget(nextLoadGrams, profile),
    evaluatedSetIds: workingSets.map((set) => set.id),
    sourceWorkoutId: performance.workoutId,
    sourceWorkoutVersion: performance.workoutVersion,
  };
}
