import type { ExerciseMaster } from '@/lib/workouts/types';

export type ProgressionType = 'double_progression';

export interface ProgressionProfile {
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
  id: string;
  position: number;
  status: string;
  setType: string;
  actualLoadGrams: number | null;
  actualReps: number | null;
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
  | 'inconsistent_load';

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

export interface ProgressionDecision {
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
  if (workingSets.length !== profile.workingSets)
    return insufficient('working_set_count_mismatch', performance);
  if (workingSets.some((set) => set.status !== 'completed'))
    return insufficient('incomplete_working_set', performance);
  if (
    workingSets.some(
      (set) =>
        !Number.isInteger(set.actualLoadGrams) ||
        (set.actualLoadGrams ?? 0) <= 0 ||
        !Number.isInteger(set.actualReps) ||
        (set.actualReps ?? 0) <= 0,
    )
  )
    return insufficient('invalid_actuals', performance);

  const loads = new Set(workingSets.map((set) => set.actualLoadGrams));
  if (loads.size !== 1) return insufficient('inconsistent_load', performance);

  const currentLoadGrams = workingSets[0].actualLoadGrams as number;
  const reps = workingSets.map((set) => set.actualReps as number);
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
