import { describe, expect, it } from 'vitest';
import {
  evaluateProgression,
  resolveProgressionProfile,
  type ProgressionExercisePerformance,
  type ProgressionPerformanceSet,
  type ProgressionProfile,
} from '@/lib/progression/engine';
import type { ExerciseMaster } from '@/lib/workouts/types';

const profile: ProgressionProfile = {
  exerciseId: 'ex-bench-press',
  repMin: 8,
  repMax: 10,
  workingSets: 3,
  incrementGrams: 2_500,
  progressionType: 'double_progression',
};

function workingSet(
  position: number,
  reps: number | null,
  loadGrams = 100_000,
  overrides: Partial<ProgressionPerformanceSet> = {},
): ProgressionPerformanceSet {
  return {
    id: `set-${position}`,
    position,
    status: 'completed',
    setType: 'working',
    actualLoadGrams: loadGrams,
    actualReps: reps,
    deletedAt: null,
    ...overrides,
  };
}

function performance(
  reps: number[],
  overrides: Partial<ProgressionExercisePerformance> = {},
): ProgressionExercisePerformance {
  return {
    workoutId: 'workout-1',
    workoutVersion: 4,
    workoutLocalDate: '2026-09-10',
    workoutUpdatedAt: '2026-09-11T09:00:00.000Z',
    workoutStatus: 'completed',
    workoutDeletedAt: null,
    workoutExerciseId: 'workout-exercise-1',
    exerciseId: profile.exerciseId,
    exerciseStatus: 'completed',
    sets: reps.map((repsValue, position) => workingSet(position, repsValue)),
    ...overrides,
  };
}

describe('Phase 3A double progression', () => {
  it('A: 100kgで10/10/10なら102.5kgへ増量する', () => {
    const decision = evaluateProgression(performance([10, 10, 10]), profile);

    expect(decision).toMatchObject({
      status: 'increase_load',
      reasonCode: 'all_sets_at_rep_max',
      currentLoadGrams: 100_000,
      nextTarget: {
        loadGrams: 102_500,
        repMin: 8,
        repMax: 10,
        workingSets: 3,
      },
      sourceWorkoutId: 'workout-1',
      sourceWorkoutVersion: 4,
    });
    expect(decision.nextTarget?.sets).toEqual([
      {
        position: 0,
        targetLoadGrams: 102_500,
        targetRepMin: 8,
        targetRepMax: 10,
      },
      {
        position: 1,
        targetLoadGrams: 102_500,
        targetRepMin: 8,
        targetRepMax: 10,
      },
      {
        position: 2,
        targetLoadGrams: 102_500,
        targetRepMin: 8,
        targetRepMax: 10,
      },
    ]);
  });

  it.each([
    ['B: 10/9/8', [10, 9, 8]],
    ['C: 8/8/8', [8, 8, 8]],
  ])('%sなら同重量を維持する', (_label, reps) => {
    expect(evaluateProgression(performance(reps), profile)).toMatchObject({
      status: 'keep_load',
      reasonCode: 'within_rep_range',
      currentLoadGrams: 100_000,
      nextTarget: { loadGrams: 100_000 },
    });
  });

  it('D: repMin未満を含む場合は理由を示して増量しない', () => {
    expect(evaluateProgression(performance([7, 8, 8]), profile)).toMatchObject({
      status: 'keep_load',
      reasonCode: 'below_rep_min',
      nextTarget: { loadGrams: 100_000 },
    });
  });

  it('E: 必要3セットに対して2セットならデータ不足にする', () => {
    expect(evaluateProgression(performance([10, 10]), profile)).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'working_set_count_mismatch',
      nextTarget: null,
    });
  });

  it('F: 未完了working setを含む場合はデータ不足にする', () => {
    const input = performance([10, 10, 10]);
    input.sets[1] = workingSet(1, 10, 100_000, { status: 'planned' });

    expect(evaluateProgression(input, profile)).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'incomplete_working_set',
    });
  });

  it('G: warmupを除外しworking setだけで判定する', () => {
    const input = performance([10, 10, 10]);
    input.sets.unshift(
      workingSet(-1, 5, 50_000, { id: 'warmup-1', setType: 'warmup' }),
    );

    const decision = evaluateProgression(input, profile);
    expect(decision.status).toBe('increase_load');
    expect(decision.evaluatedSetIds).toEqual(['set-0', 'set-1', 'set-2']);
  });

  it('H: working set間で重量が違う場合は単一重量へ丸めない', () => {
    const input = performance([10, 10, 10]);
    input.sets[1].actualLoadGrams = 97_500;

    expect(evaluateProgression(input, profile)).toMatchObject({
      status: 'set_specific',
      reasonCode: 'set_specific_progression',
      nextTarget: null,
    });
    expect(evaluateProgression(input, profile).setDecisions?.map(set => set.targetLoadGrams)).toEqual([102500, 100000, 102500]);
  });

  it('I: 永続キャッシュを使わず編集後の入力から再評価する', () => {
    const input = performance([10, 10, 10]);
    expect(evaluateProgression(input, profile).status).toBe('increase_load');

    input.sets[1].actualReps = 9;
    input.workoutVersion = 5;
    expect(evaluateProgression(input, profile)).toMatchObject({
      status: 'keep_load',
      sourceWorkoutVersion: 5,
    });
  });

  it('J: soft deleted workoutを判定対象外にする', () => {
    expect(
      evaluateProgression(
        performance([10, 10, 10], {
          workoutDeletedAt: '2026-09-11T10:00:00.000Z',
        }),
        profile,
      ),
    ).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'workout_deleted',
    });
  });

  it.each([
    ['未完了workout', { workoutStatus: 'active' }, 'workout_not_completed'],
    [
      '未完了exercise',
      { exerciseStatus: 'in_progress' },
      'exercise_not_completed',
    ],
  ])('%sを判定対象外にする', (_label, overrides, reasonCode) => {
    expect(
      evaluateProgression(performance([10, 10, 10], overrides), profile),
    ).toMatchObject({ status: 'insufficient_data', reasonCode });
  });

  it('actual欠損を推測で補完しない', () => {
    const input = performance([10, 10, 10]);
    input.sets[2].actualReps = null;

    expect(evaluateProgression(input, profile)).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'invalid_actuals',
    });
  });
});

describe('Phase 3A progression profile', () => {
  const exercise: ExerciseMaster = {
    id: 'ex-bench-press',
    name: 'ベンチプレス',
    normalizedName: 'ベンチプレス',
    bodyPart: '胸',
    measurementType: 'weight_reps',
    defaultRepMin: 8,
    defaultRepMax: 10,
    defaultWorkingSets: 3,
    defaultIncrementGrams: 2_500,
    defaultRestSeconds: 120,
  };

  it('exercise masterの既存defaultをprofileとして利用する', () => {
    expect(resolveProgressionProfile(exercise)).toEqual(profile);
  });

  it('将来の種目別上書きをdefaultと合成できる', () => {
    expect(
      resolveProgressionProfile(exercise, {
        repMin: 5,
        repMax: 8,
        incrementGrams: 5_000,
      }),
    ).toEqual({
      ...profile,
      repMin: 5,
      repMax: 8,
      incrementGrams: 5_000,
    });
  });

  it('不完全または不正なprofileを有効扱いしない', () => {
    expect(
      resolveProgressionProfile({
        ...exercise,
        defaultRepMin: null,
        defaultRepMax: null,
      }),
    ).toBeNull();
    expect(resolveProgressionProfile(exercise, { repMin: 11 })).toBeNull();
  });
});
