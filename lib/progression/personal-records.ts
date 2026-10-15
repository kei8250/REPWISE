import { totalReps, effectiveLoadGrams } from '@/lib/workouts/reps';
import type { ProgressionPerformanceSet } from './engine';

export const E1RM_MAX_REPS = 12;

export interface PersonalRecordPerformance {
  workoutId: string;
  exerciseId: string;
  sets: ProgressionPerformanceSet[];
}

export type PersonalRecordEvaluationStatus =
  | 'evaluated'
  | 'first_record'
  | 'insufficient_data';

export interface PersonalRecordEvaluation {
  status: PersonalRecordEvaluationStatus;
  achieved: {
    weight: boolean;
    reps: boolean;
    e1rm: boolean;
    volume: boolean;
  };
  current: {
    maxLoadGrams: number | null;
    maxE1rmGrams: number | null;
    totalVolumeGramReps: number | null;
  };
  previousBest: {
    maxLoadGrams: number | null;
    maxE1rmGrams: number | null;
    maxVolumeGramReps: number | null;
  };
  repRecords: Array<{
    loadGrams: number;
    reps: number;
    previousBestReps: number;
  }>;
  e1rmExcludedHighRepSetCount: number;
}

function validWorkingSets(performance: PersonalRecordPerformance) {
  return performance.sets.filter(
    (set) =>
      !set.deletedAt &&
      set.setType === 'working' &&
      set.status === 'completed' &&
      Number.isInteger(set.actualLoadGrams) &&
      (set.actualLoadGrams ?? 0) > 0 &&
      Number.isInteger(set.actualReps) &&
      (set.actualReps ?? 0) > 0,
  );
}

export function calculateE1rmGrams(loadGrams: number, reps: number) {
  return (loadGrams * (30 + reps)) / 30;
}

function maxOrNull(values: number[]) {
  return values.length > 0 ? Math.max(...values) : null;
}

function emptyEvaluation(): PersonalRecordEvaluation {
  return {
    status: 'insufficient_data',
    achieved: { weight: false, reps: false, e1rm: false, volume: false },
    current: {
      maxLoadGrams: null,
      maxE1rmGrams: null,
      totalVolumeGramReps: null,
    },
    previousBest: {
      maxLoadGrams: null,
      maxE1rmGrams: null,
      maxVolumeGramReps: null,
    },
    repRecords: [],
    e1rmExcludedHighRepSetCount: 0,
  };
}

export function evaluatePersonalRecords(
  current: PersonalRecordPerformance,
  history: PersonalRecordPerformance[],
): PersonalRecordEvaluation {
  const currentSets = validWorkingSets(current);
  if (currentSets.length === 0) return emptyEvaluation();

  const historicalPerformances = history.filter(
    (performance) =>
      performance.workoutId !== current.workoutId &&
      performance.exerciseId === current.exerciseId,
  );
  const historicalSets = historicalPerformances.flatMap(validWorkingSets);
  const currentEligibleE1rmSets = currentSets.filter(
    (set) => (set.actualReps as number) <= E1RM_MAX_REPS,
  );
  const historicalEligibleE1rmSets = historicalSets.filter(
    (set) => (set.actualReps as number) <= E1RM_MAX_REPS,
  );
  const currentMaxLoad = maxOrNull(
    currentSets.map((set) => effectiveLoadGrams(set) as number),
  );
  const currentMaxE1rm = maxOrNull(
    currentEligibleE1rmSets.map((set) =>
      calculateE1rmGrams(
        effectiveLoadGrams(set) as number,
        set.actualReps as number,
      ),
    ),
  );
  const currentVolume = currentSets.reduce(
    (total, set) =>
      total + (set.actualLoadGrams as number) * totalReps(set),
    0,
  );
  const previousMaxLoad = maxOrNull(
    historicalSets.map((set) => effectiveLoadGrams(set) as number),
  );
  const previousMaxE1rm = maxOrNull(
    historicalEligibleE1rmSets.map((set) =>
      calculateE1rmGrams(
        effectiveLoadGrams(set) as number,
        set.actualReps as number,
      ),
    ),
  );
  const previousMaxVolume = maxOrNull(
    historicalPerformances
      .map((performance) => validWorkingSets(performance))
      .filter((sets) => sets.length > 0)
      .map((sets) =>
        sets.reduce(
          (total, set) =>
            total +
            (set.actualLoadGrams as number) * totalReps(set),
          0,
        ),
      ),
  );

  const base = {
    current: {
      maxLoadGrams: currentMaxLoad,
      maxE1rmGrams: currentMaxE1rm,
      totalVolumeGramReps: currentVolume,
    },
    previousBest: {
      maxLoadGrams: previousMaxLoad,
      maxE1rmGrams: previousMaxE1rm,
      maxVolumeGramReps: previousMaxVolume,
    },
    repRecords: [] as PersonalRecordEvaluation['repRecords'],
    e1rmExcludedHighRepSetCount:
      currentSets.length - currentEligibleE1rmSets.length,
  };

  if (historicalSets.length === 0) {
    return {
      ...base,
      status: 'first_record',
      achieved: { weight: false, reps: false, e1rm: false, volume: false },
    };
  }

  const currentBestRepsByLoad = new Map<number, number>();
  for (const set of currentSets) {
    const loadGrams = effectiveLoadGrams(set) as number;
    currentBestRepsByLoad.set(
      loadGrams,
      Math.max(
        currentBestRepsByLoad.get(loadGrams) ?? 0,
        set.actualReps as number,
      ),
    );
  }
  const repRecords = [...currentBestRepsByLoad]
    .map(([loadGrams, reps]) => {
      const previousBestReps = maxOrNull(
        historicalSets
          .filter((set) => effectiveLoadGrams(set) === loadGrams)
          .map((set) => set.actualReps as number),
      );
      return previousBestReps !== null && reps > previousBestReps
        ? { loadGrams, reps, previousBestReps }
        : null;
    })
    .filter(
      (record): record is PersonalRecordEvaluation['repRecords'][number] =>
        record !== null,
    )
    .sort((left, right) => left.loadGrams - right.loadGrams);

  return {
    ...base,
    repRecords,
    status: 'evaluated',
    achieved: {
      weight:
        previousMaxLoad !== null &&
        currentMaxLoad !== null &&
        currentMaxLoad > previousMaxLoad,
      reps: repRecords.length > 0,
      e1rm:
        previousMaxE1rm !== null &&
        currentMaxE1rm !== null &&
        currentMaxE1rm > previousMaxE1rm,
      volume: previousMaxVolume !== null && currentVolume > previousMaxVolume,
    },
  };
}

export function achievedPersonalRecordLabels(
  evaluation: PersonalRecordEvaluation,
) {
  const labels: string[] = [];
  if (evaluation.achieved.weight) labels.push('重量');
  if (evaluation.achieved.reps) labels.push('rep');
  if (evaluation.achieved.e1rm) labels.push('e1RM');
  if (evaluation.achieved.volume) labels.push('ボリューム');
  return labels;
}

export function formatE1rmKg(e1rmGrams: number) {
  return `${(e1rmGrams / 1000).toFixed(1)}kg`;
}

export function formatVolumeKg(volumeGramReps: number) {
  return `${new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 1,
  }).format(volumeGramReps / 1000)}kg`;
}
