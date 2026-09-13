import { describe, expect, it } from 'vitest';
import type {
  ProgressionExercisePerformance,
  ProgressionPerformanceSet,
  ProgressionProfile,
} from '@/lib/progression/engine';
import {
  evaluateStagnation,
  stagnationReasonLabel,
  stagnationStatusLabel,
  type AppliedAcceptedTargetAttempt,
  type StagnationHistoryEntry,
} from '@/lib/progression/stagnation';

const profile: ProgressionProfile = {
  exerciseId: 'bench',
  repMin: 8,
  repMax: 12,
  workingSets: 1,
  incrementGrams: 2_500,
  progressionType: 'double_progression',
};

function set(
  id: string,
  loadGrams: number,
  reps: number,
  overrides: Partial<ProgressionPerformanceSet> = {},
): ProgressionPerformanceSet {
  return {
    id,
    position: 0,
    status: 'completed',
    setType: 'working',
    actualLoadGrams: loadGrams,
    actualReps: reps,
    deletedAt: null,
    ...overrides,
  };
}

function entry(
  index: number,
  loadGrams: number,
  reps: number,
  options: {
    extraSets?: ProgressionPerformanceSet[];
    acceptedTarget?: AppliedAcceptedTargetAttempt | null;
    deletedAt?: string | null;
  } = {},
): StagnationHistoryEntry {
  const day = String(index).padStart(2, '0');
  const performance: ProgressionExercisePerformance = {
    workoutId: `workout-${day}`,
    workoutVersion: 1,
    workoutLocalDate: `2026-09-${day}`,
    workoutUpdatedAt: `2026-09-${day}T10:00:00.000Z`,
    workoutStatus: 'completed',
    workoutDeletedAt: options.deletedAt ?? null,
    workoutExerciseId: `workout-exercise-${day}`,
    exerciseId: 'bench',
    exerciseStatus: 'completed',
    sets: [set(`set-${day}`, loadGrams, reps), ...(options.extraSets ?? [])],
  };
  return { performance, acceptedTarget: options.acceptedTarget ?? null };
}

const missedTarget: AppliedAcceptedTargetAttempt = {
  targetLoadGrams: 102_500,
  targetRepMin: 8,
  targetRepMax: 10,
  targetWorkingSets: 1,
};

describe('Phase 3C-4 stagnation detection', () => {
  it('A: 有効履歴が3回未満ならinsufficient_dataにする', () => {
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 9)],
      profile,
    );
    expect(result).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'not_enough_history',
      validHistoryCount: 2,
      requiredHistoryCount: 3,
    });
    expect(stagnationStatusLabel(result.status)).toBe('データ不足');
    expect(stagnationReasonLabel(result)).toBe(
      '判定にはあと1回分の記録が必要です',
    );
  });

  it('B: 同重量で8→9→10repならprogressingにする', () => {
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 9), entry(3, 100_000, 10)],
      profile,
    );
    expect(result).toMatchObject({
      status: 'progressing',
      reasonCode: 'recent_rep_progress',
    });
  });

  it('C: 100kgから102.5kgへの増量があればprogressingにする', () => {
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 10), entry(3, 102_500, 8)],
      profile,
    );
    expect(result).toMatchObject({
      status: 'progressing',
      reasonCode: 'recent_load_progress',
    });
  });

  it('D: Phase 3C-2と同じEpley式でe1RM更新を検知する', () => {
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 8), entry(3, 95_000, 11)],
      profile,
    );
    expect(result).toMatchObject({
      status: 'progressing',
      reasonCode: 'recent_e1rm_progress',
    });
  });

  it('E: 3回連続で重量・rep・e1RMに改善がなければstagnatingにする', () => {
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 8), entry(3, 100_000, 8)],
      profile,
    );
    expect(result).toMatchObject({
      status: 'stagnating',
      reasonCode: 'no_recent_progress',
    });
  });

  it('F: accepted target未達1回だけでは即stagnatingにしない', () => {
    const result = evaluateStagnation(
      [
        entry(1, 100_000, 8),
        entry(2, 100_000, 8, { acceptedTarget: missedTarget }),
      ],
      profile,
    );
    expect(result.status).toBe('insufficient_data');
  });

  it('G: accepted target複数回未達かつ他指標改善なしを停滞理由にする', () => {
    const result = evaluateStagnation(
      [
        entry(1, 100_000, 8, { acceptedTarget: missedTarget }),
        entry(2, 100_000, 8, { acceptedTarget: missedTarget }),
        entry(3, 100_000, 8, { acceptedTarget: missedTarget }),
      ],
      profile,
    );
    expect(result).toMatchObject({
      status: 'stagnating',
      reasonCode: 'repeated_target_miss',
      consecutiveAcceptedTargetMisses: 3,
    });
  });

  it('H: warmupだけの変化は判定に影響しない', () => {
    const histories = [1, 2, 3].map((index) =>
      entry(index, 100_000, 8, {
        extraSets: [
          set(`warmup-${index}`, 40_000 + index * 10_000, 20, {
            setType: 'warmup',
          }),
        ],
      }),
    );
    expect(evaluateStagnation(histories, profile).status).toBe('stagnating');
  });

  it('I: 履歴編集後は固定値でなく現在データから再計算する', () => {
    const histories = [
      entry(1, 100_000, 8),
      entry(2, 100_000, 8),
      entry(3, 100_000, 8),
    ];
    expect(evaluateStagnation(histories, profile).status).toBe('stagnating');
    histories[2].performance.sets[0].actualReps = 9;
    expect(evaluateStagnation(histories, profile)).toMatchObject({
      status: 'progressing',
      reasonCode: 'recent_rep_progress',
    });
  });

  it('J/K: soft deleteで除外し、restore後は再び判定へ含める', () => {
    const histories = [
      entry(1, 100_000, 8),
      entry(2, 100_000, 8),
      entry(3, 100_000, 8, { deletedAt: '2026-09-04T00:00:00.000Z' }),
    ];
    expect(evaluateStagnation(histories, profile).status).toBe(
      'insufficient_data',
    );
    histories[2].performance.workoutDeletedAt = null;
    expect(evaluateStagnation(histories, profile).status).toBe('stagnating');
  });

  it('未完了setだけの履歴はinvalid_historyとして数えない', () => {
    const invalid = entry(3, 100_000, 8);
    invalid.performance.sets[0].status = 'planned';
    const result = evaluateStagnation(
      [entry(1, 100_000, 8), entry(2, 100_000, 8), invalid],
      profile,
    );
    expect(result).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'invalid_history',
      validHistoryCount: 2,
    });
  });
});
