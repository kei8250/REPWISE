import type {
  ProgressionExercisePerformance,
  ProgressionProfile,
} from './engine';
import { evaluateProgression } from './engine';
import { calculateE1rmGrams, E1RM_MAX_REPS } from './personal-records';

export const STAGNATION_MIN_HISTORY = 3;
export const STAGNATION_HISTORY_WINDOW = 3;

export type StagnationStatus =
  | 'progressing'
  | 'stagnating'
  | 'insufficient_data';

export type StagnationReasonCode =
  | 'recent_load_progress'
  | 'recent_rep_progress'
  | 'recent_e1rm_progress'
  | 'recent_progression_success'
  | 'no_recent_progress'
  | 'repeated_target_miss'
  | 'not_enough_history'
  | 'invalid_history';

export interface AppliedAcceptedTargetAttempt {
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  targetWorkingSets: number;
}

export type AcceptedTargetAttemptOutcome =
  | 'achieved'
  | 'missed'
  | 'insufficient_data';

export interface StagnationHistoryEntry {
  performance: ProgressionExercisePerformance;
  acceptedTarget?: AppliedAcceptedTargetAttempt | null;
}

export interface StagnationEvaluation {
  status: StagnationStatus;
  reasonCode: StagnationReasonCode;
  validHistoryCount: number;
  requiredHistoryCount: number;
  recentHistoryCount: number;
  consecutiveAcceptedTargetMisses: number;
}

type HistoryMetrics = {
  entry: StagnationHistoryEntry;
  sets: Array<{ loadGrams: number; reps: number }>;
  maxLoadGrams: number;
  uniformLoadGrams: number | null;
  totalReps: number;
  maxE1rmGrams: number | null;
};

function metricsForEntry(entry: StagnationHistoryEntry): HistoryMetrics | null {
  const performance = entry.performance;
  if (
    performance.workoutStatus !== 'completed' ||
    performance.workoutDeletedAt ||
    performance.exerciseStatus !== 'completed'
  ) {
    return null;
  }

  const sets = performance.sets
    .filter(
      (set) =>
        !set.deletedAt &&
        set.setType === 'working' &&
        set.status === 'completed' &&
        Number.isInteger(set.actualLoadGrams) &&
        (set.actualLoadGrams ?? 0) > 0 &&
        Number.isInteger(set.actualReps) &&
        (set.actualReps ?? 0) > 0,
    )
    .map((set) => ({
      loadGrams: set.actualLoadGrams as number,
      reps: set.actualReps as number,
    }));
  if (sets.length === 0) return null;

  const loads = new Set(sets.map((set) => set.loadGrams));
  const e1rms = sets
    .filter((set) => set.reps <= E1RM_MAX_REPS)
    .map((set) => calculateE1rmGrams(set.loadGrams, set.reps));
  return {
    entry,
    sets,
    maxLoadGrams: Math.max(...sets.map((set) => set.loadGrams)),
    uniformLoadGrams: loads.size === 1 ? sets[0].loadGrams : null,
    totalReps: sets.reduce((total, set) => total + set.reps, 0),
    maxE1rmGrams: e1rms.length > 0 ? Math.max(...e1rms) : null,
  };
}

function compareChronology(left: HistoryMetrics, right: HistoryMetrics) {
  const leftKey = `${left.entry.performance.workoutLocalDate}\u0000${left.entry.performance.workoutUpdatedAt}\u0000${left.entry.performance.workoutId}`;
  const rightKey = `${right.entry.performance.workoutLocalDate}\u0000${right.entry.performance.workoutUpdatedAt}\u0000${right.entry.performance.workoutId}`;
  return leftKey.localeCompare(rightKey);
}

export function evaluateAcceptedTargetAttempt(
  performance: ProgressionExercisePerformance,
  target: AppliedAcceptedTargetAttempt,
): AcceptedTargetAttemptOutcome {
  const metrics = metricsForEntry({ performance, acceptedTarget: target });
  if (!metrics || metrics.sets.length !== target.targetWorkingSets) {
    return 'insufficient_data';
  }
  return metrics.sets.every(
    (set) =>
      set.loadGrams >= target.targetLoadGrams &&
      set.reps >= target.targetRepMax,
  )
    ? 'achieved'
    : 'missed';
}

function acceptedTargetOutcome(metrics: HistoryMetrics) {
  const target = metrics.entry.acceptedTarget;
  if (!target) return null;
  return evaluateAcceptedTargetAttempt(metrics.entry.performance, target);
}

function consecutiveAcceptedTargetMisses(recent: HistoryMetrics[]) {
  let misses = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const outcome = acceptedTargetOutcome(recent[index]);
    if (outcome !== 'missed') break;
    misses += 1;
  }
  return misses;
}

function result(
  status: StagnationStatus,
  reasonCode: StagnationReasonCode,
  validHistoryCount: number,
  recentHistoryCount: number,
  consecutiveMisses = 0,
): StagnationEvaluation {
  return {
    status,
    reasonCode,
    validHistoryCount,
    requiredHistoryCount: STAGNATION_MIN_HISTORY,
    recentHistoryCount,
    consecutiveAcceptedTargetMisses: consecutiveMisses,
  };
}

export function evaluateStagnation(
  history: StagnationHistoryEntry[],
  profile: ProgressionProfile | null,
): StagnationEvaluation {
  const valid = history
    .map(metricsForEntry)
    .filter((entry): entry is HistoryMetrics => entry !== null)
    .sort(compareChronology);

  if (valid.length < STAGNATION_MIN_HISTORY) {
    return result(
      'insufficient_data',
      history.length > valid.length ? 'invalid_history' : 'not_enough_history',
      valid.length,
      valid.length,
    );
  }

  const recent = valid.slice(-STAGNATION_HISTORY_WINDOW);
  let loadProgress = false;
  let repProgress = false;
  let e1rmProgress = false;
  for (let index = 1; index < recent.length; index += 1) {
    const previous = recent[index - 1];
    const current = recent[index];
    if (current.maxLoadGrams > previous.maxLoadGrams) loadProgress = true;
    if (
      previous.uniformLoadGrams !== null &&
      current.uniformLoadGrams === previous.uniformLoadGrams &&
      current.sets.length === previous.sets.length &&
      current.totalReps > previous.totalReps
    ) {
      repProgress = true;
    }
    if (
      previous.maxE1rmGrams !== null &&
      current.maxE1rmGrams !== null &&
      current.maxE1rmGrams > previous.maxE1rmGrams
    ) {
      e1rmProgress = true;
    }
  }

  const progressionSuccess = recent.some(
    (entry) =>
      evaluateProgression(entry.entry.performance, profile).status ===
      'increase_load',
  );
  const consecutiveMisses = consecutiveAcceptedTargetMisses(recent);

  if (loadProgress)
    return result(
      'progressing',
      'recent_load_progress',
      valid.length,
      recent.length,
      consecutiveMisses,
    );
  if (repProgress)
    return result(
      'progressing',
      'recent_rep_progress',
      valid.length,
      recent.length,
      consecutiveMisses,
    );
  if (e1rmProgress)
    return result(
      'progressing',
      'recent_e1rm_progress',
      valid.length,
      recent.length,
      consecutiveMisses,
    );
  if (progressionSuccess)
    return result(
      'progressing',
      'recent_progression_success',
      valid.length,
      recent.length,
      consecutiveMisses,
    );
  return result(
    'stagnating',
    consecutiveMisses >= 2 ? 'repeated_target_miss' : 'no_recent_progress',
    valid.length,
    recent.length,
    consecutiveMisses,
  );
}

export function stagnationStatusLabel(status: StagnationStatus) {
  if (status === 'progressing') return '順調';
  if (status === 'stagnating') return '停滞傾向';
  return 'データ不足';
}

export function stagnationReasonLabel(evaluation: StagnationEvaluation) {
  const labels: Record<StagnationReasonCode, string> = {
    recent_load_progress: '直近で重量が伸びています',
    recent_rep_progress: '同重量でrepが伸びています',
    recent_e1rm_progress: '直近で推定1RMが伸びています',
    recent_progression_success: '直近で目標上限を達成しています',
    no_recent_progress: `直近${evaluation.recentHistoryCount}回で明確な伸びが見られません`,
    repeated_target_miss: '次回目標の未達が続き、ほかの伸びも見られません',
    not_enough_history: `判定にはあと${Math.max(0, evaluation.requiredHistoryCount - evaluation.validHistoryCount)}回分の記録が必要です`,
    invalid_history: '判定に使える有効な実績が不足しています',
  };
  return labels[evaluation.reasonCode];
}
