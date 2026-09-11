import type {
  ExerciseProgressionRecommendation,
  ProgressionPerformanceSet,
  ProgressionTarget,
} from './engine';
import type { WorkoutExercise, WorkoutSet } from '@/lib/workouts/types';

export type SetComparisonStatus = 'above' | 'equal' | 'below' | 'unavailable';

export interface SetComparison {
  status: SetComparisonStatus;
  label: string | null;
}

export interface PreviousPerformanceSummary {
  localDate: string;
  loadLabel: string;
  repsLabel: string;
}

export type StoredTargetSummary =
  | {
      kind: 'uniform';
      loadGrams: number;
      repMin: number;
      repMax: number;
      workingSets: number;
    }
  | { kind: 'set_specific' };

export interface ActiveProgressionSummary {
  previous: PreviousPerformanceSummary | null;
  storedTarget: StoredTargetSummary | null;
  suggestion: ProgressionTarget | null;
  displayedTargetSource: 'stored' | 'suggestion' | 'none';
  showSeparateSuggestion: boolean;
}

export interface ProgressionRequestCache {
  get(exerciseId: string): Promise<ExerciseProgressionRecommendation>;
  invalidate(exerciseId: string): void;
}

type ProgressionLoader = (
  exerciseId: string,
) => Promise<ExerciseProgressionRecommendation>;

function isPositiveInteger(value: number | null) {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

export function formatLoadGrams(loadGrams: number) {
  return `${loadGrams / 1000}kg`;
}

export function getPreviousWorkingSets(
  recommendation: ExerciseProgressionRecommendation | null,
) {
  const performance = recommendation?.performance;
  if (
    !performance ||
    performance.workoutStatus !== 'completed' ||
    performance.workoutDeletedAt ||
    performance.exerciseStatus !== 'completed'
  ) {
    return [];
  }
  return performance.sets
    .filter((set) => !set.deletedAt && set.setType === 'working')
    .sort((left, right) => left.position - right.position);
}

export function summarizePreviousPerformance(
  recommendation: ExerciseProgressionRecommendation | null,
): PreviousPerformanceSummary | null {
  const performance = recommendation?.performance;
  const sets = getPreviousWorkingSets(recommendation);
  if (
    !performance ||
    sets.length === 0 ||
    sets.some(
      (set) =>
        set.status !== 'completed' ||
        !isPositiveInteger(set.actualLoadGrams) ||
        !isPositiveInteger(set.actualReps),
    )
  )
    return null;
  const loads = new Set(sets.map((set) => set.actualLoadGrams as number));
  if (loads.size === 1) {
    return {
      localDate: performance.workoutLocalDate,
      loadLabel: formatLoadGrams(sets[0].actualLoadGrams as number),
      repsLabel: sets.map((set) => set.actualReps).join(' / '),
    };
  }
  return {
    localDate: performance.workoutLocalDate,
    loadLabel: 'セット別重量',
    repsLabel: sets
      .map(
        (set) =>
          `${formatLoadGrams(set.actualLoadGrams as number)}×${set.actualReps}`,
      )
      .join(' / '),
  };
}

export function getStoredTargetSummary(
  exercise: WorkoutExercise,
): StoredTargetSummary | null {
  const workingSets = exercise.sets.filter((set) => set.setType === 'working');
  const hasStoredTarget = workingSets.some(
    (set) =>
      set.targetLoadGrams !== null ||
      set.targetRepMin !== null ||
      set.targetRepMax !== null,
  );
  if (!hasStoredTarget) return null;
  const complete = workingSets.every(
    (set) =>
      isPositiveInteger(set.targetLoadGrams) &&
      isPositiveInteger(set.targetRepMin) &&
      isPositiveInteger(set.targetRepMax),
  );
  if (!complete || workingSets.length === 0) return { kind: 'set_specific' };
  const first = workingSets[0];
  const uniform = workingSets.every(
    (set) =>
      set.targetLoadGrams === first.targetLoadGrams &&
      set.targetRepMin === first.targetRepMin &&
      set.targetRepMax === first.targetRepMax,
  );
  if (!uniform) return { kind: 'set_specific' };
  return {
    kind: 'uniform',
    loadGrams: first.targetLoadGrams as number,
    repMin: first.targetRepMin as number,
    repMax: first.targetRepMax as number,
    workingSets: workingSets.length,
  };
}

function targetMatchesSuggestion(
  stored: StoredTargetSummary,
  suggestion: ProgressionTarget,
) {
  return (
    stored.kind === 'uniform' &&
    stored.loadGrams === suggestion.loadGrams &&
    stored.repMin === suggestion.repMin &&
    stored.repMax === suggestion.repMax &&
    stored.workingSets === suggestion.workingSets
  );
}

export function buildActiveProgressionSummary(
  exercise: WorkoutExercise,
  recommendation: ExerciseProgressionRecommendation | null,
): ActiveProgressionSummary {
  const storedTarget = getStoredTargetSummary(exercise);
  const suggestion = recommendation?.decision.nextTarget ?? null;
  return {
    previous: summarizePreviousPerformance(recommendation),
    storedTarget,
    suggestion,
    displayedTargetSource: storedTarget
      ? 'stored'
      : suggestion
        ? 'suggestion'
        : 'none',
    showSeparateSuggestion:
      !!storedTarget &&
      !!suggestion &&
      !targetMatchesSuggestion(storedTarget, suggestion),
  };
}

export function compareWorkingSet(
  current: WorkoutSet,
  previous: ProgressionPerformanceSet | null,
): SetComparison {
  if (
    current.setType !== 'working' ||
    current.status !== 'completed' ||
    !isPositiveInteger(current.actualLoadGrams) ||
    !isPositiveInteger(current.actualReps) ||
    !previous ||
    previous.setType !== 'working' ||
    previous.status !== 'completed' ||
    previous.deletedAt ||
    !isPositiveInteger(previous.actualLoadGrams) ||
    !isPositiveInteger(previous.actualReps)
  ) {
    return { status: 'unavailable', label: null };
  }
  const loadDifference =
    (current.actualLoadGrams as number) - (previous.actualLoadGrams as number);
  if (loadDifference !== 0) {
    const sign = loadDifference > 0 ? '+' : '-';
    return {
      status: loadDifference > 0 ? 'above' : 'below',
      label: `前回より重量 ${sign}${formatLoadGrams(Math.abs(loadDifference))}`,
    };
  }
  const repDifference =
    (current.actualReps as number) - (previous.actualReps as number);
  if (repDifference === 0) return { status: 'equal', label: '前回同等' };
  const sign = repDifference > 0 ? '+' : '';
  return {
    status: repDifference > 0 ? 'above' : 'below',
    label: `前回 ${sign}${repDifference}rep`,
  };
}

export function createProgressionRequestCache(
  load: ProgressionLoader,
): ProgressionRequestCache {
  const requests = new Map<
    string,
    Promise<ExerciseProgressionRecommendation>
  >();
  return {
    get(exerciseId) {
      const existing = requests.get(exerciseId);
      if (existing) return existing;
      const request = load(exerciseId);
      requests.set(exerciseId, request);
      return request;
    },
    invalidate(exerciseId) {
      requests.delete(exerciseId);
    },
  };
}
