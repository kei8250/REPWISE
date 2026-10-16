import { describe, expect, it } from 'vitest';
import {
  buildAnalytics,
  resolveAnalyticsPeriod,
  type AnalyticsAcceptedTargetInput,
  type AnalyticsExerciseHistoryInput,
} from '@/lib/analytics/engine';
import type { AnalyticsRange } from '@/lib/analytics/model';
import { getAnalytics } from '@/lib/workouts/api-client';
import type {
  ProgressionPerformanceSet,
  ProgressionProfile,
} from '@/lib/progression/engine';

const profile: ProgressionProfile = {
  exerciseId: 'bench',
  repMin: 8,
  repMax: 10,
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

function history(
  workoutId: string,
  localDate: string,
  loadGrams: number,
  reps: number,
  options: {
    exerciseId?: string;
    exerciseName?: string;
    bodyPart?: string | null;
    sets?: ProgressionPerformanceSet[];
    workoutDeletedAt?: string | null;
    workoutStatus?: string;
    exerciseStatus?: string;
    profile?: ProgressionProfile | null;
  } = {},
): AnalyticsExerciseHistoryInput {
  const exerciseId = options.exerciseId ?? 'bench';
  return {
    exerciseName: options.exerciseName ?? 'ベンチプレス',
    bodyPart: options.bodyPart === undefined ? '胸' : options.bodyPart,
    profile:
      options.profile === undefined
        ? { ...profile, exerciseId }
        : options.profile,
    performance: {
      workoutId,
      workoutVersion: 1,
      workoutLocalDate: localDate,
      workoutUpdatedAt: `${localDate}T10:00:00.000Z`,
      workoutStatus: options.workoutStatus ?? 'completed',
      workoutDeletedAt: options.workoutDeletedAt ?? null,
      workoutExerciseId: `${workoutId}-${exerciseId}`,
      exerciseId,
      exerciseStatus: options.exerciseStatus ?? 'completed',
      sets: options.sets ?? [set(`${workoutId}-set`, loadGrams, reps)],
    },
  };
}

function acceptedTarget(
  overrides: Partial<AnalyticsAcceptedTargetInput> = {},
): AnalyticsAcceptedTargetInput {
  return {
    id: 'target-1',
    exerciseId: 'bench',
    sourceWorkoutId: 'workout-1',
    sourceWorkoutVersion: 1,
    sourceCurrentVersion: 1,
    sourceWorkoutStatus: 'completed',
    sourceLocalDate: '2026-09-01',
    acceptedAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    sourceDeletedAt: null,
    status: 'applied',
    appliedWorkoutId: 'workout-2',
    appliedWorkoutStatus: 'completed',
    appliedWorkoutDeletedAt: null,
    targetLoadGrams: 100_000,
    targetRepMin: 8,
    targetRepMax: 10,
    targetWorkingSets: 1,
    ...overrides,
  };
}

function analytics(
  exerciseHistory: AnalyticsExerciseHistoryInput[],
  options: {
    range?: AnalyticsRange;
    acceptedTargets?: AnalyticsAcceptedTargetInput[];
    extraWorkouts?: Array<{ id: string; localDate: string }>;
  } = {},
) {
  const workouts = new Map(
    exerciseHistory.map((item) => [
      item.performance.workoutId,
      {
        id: item.performance.workoutId,
        localDate: item.performance.workoutLocalDate,
      },
    ]),
  );
  for (const workout of options.extraWorkouts ?? [])
    workouts.set(workout.id, workout);
  return buildAnalytics({
    range: options.range ?? 'all',
    today: '2026-09-30',
    generatedAt: '2026-09-30T12:00:00.000Z',
    workouts: [...workouts.values()],
    exerciseHistory,
    acceptedTargets: options.acceptedTargets ?? [],
  });
}

describe('Phase 4A analytics engine', () => {
  it('1: 7/30/90日と全期間の境界を解決する', () => {
    expect(resolveAnalyticsPeriod('7d', '2026-09-30').startDate).toBe(
      '2026-09-24',
    );
    expect(resolveAnalyticsPeriod('30d', '2026-09-30').startDate).toBe(
      '2026-09-01',
    );
    expect(resolveAnalyticsPeriod('90d', '2026-09-30').startDate).toBe(
      '2026-07-03',
    );
    expect(resolveAnalyticsPeriod('all', '2026-09-30')).toMatchObject({
      startDate: null,
      dayCount: null,
    });
  });

  it('2: workout数と同日をまとめたtraining day数を分ける', () => {
    const result = analytics([history('w1', '2026-09-28', 100_000, 8)], {
      range: '7d',
      extraWorkouts: [
        { id: 'w2', localDate: '2026-09-28' },
        { id: 'w3', localDate: '2026-09-30' },
      ],
    });
    expect(result.workouts).toMatchObject({
      completedWorkoutCount: 3,
      trainingDayCount: 2,
      weeklyAverageWorkoutCount: 3,
    });
  });

  it('3: exerciseごとのworkout回数・実施日数・working set数を集計する', () => {
    const result = analytics([
      history('w1', '2026-09-28', 100_000, 8, {
        sets: [set('a', 100_000, 8), set('b', 100_000, 8)],
      }),
      history('w2', '2026-09-28', 100_000, 9),
    ]);
    expect(result.exercises[0]).toMatchObject({
      workoutCount: 2,
      trainingDayCount: 1,
      workingSetCount: 3,
    });
  });

  it('4: body part別のset・日数・exercise数を集計し未設定をunknownにする', () => {
    const result = analytics([
      history('w1', '2026-09-28', 100_000, 8),
      history('w2', '2026-09-29', 80_000, 10, {
        exerciseId: 'fly',
        exerciseName: 'フライ',
      }),
      history('w3', '2026-09-30', 50_000, 10, {
        exerciseId: 'unknown-exercise',
        exerciseName: '未分類',
        bodyPart: null,
      }),
    ]);
    expect(result.bodyParts).toContainEqual({
      bodyPart: '胸',
      exerciseCount: 2,
      trainingDayCount: 2,
      workingSetCount: 2,
      totalVolumeGramReps: 1_600_000,
    });
    expect(
      result.bodyParts.find((part) => part.bodyPart === 'unknown'),
    ).toMatchObject({
      exerciseCount: 1,
      workingSetCount: 1,
    });
  });

  it('5: workout/exercise/body part volumeをgrams×repsの整数で算出する', () => {
    const result = analytics([
      history('w1', '2026-09-30', 100_000, 10, {
        sets: [set('a', 100_000, 10), set('b', 100_000, 9)],
      }),
    ]);
    expect(result.workouts.totalVolumeGramReps).toBe(1_900_000);
    expect(result.workouts.volumeByWorkout[0].volumeGramReps).toBe(1_900_000);
    expect(result.exercises[0].totalVolumeGramReps).toBe(1_900_000);
    expect(result.exercises[0].volumeTrend).toEqual([
      {
        workoutId: 'w1',
        localDate: '2026-09-30',
        value: 1_900_000,
      },
    ]);
    expect(result.bodyParts[0].totalVolumeGramReps).toBe(1_900_000);
  });

  it('6: e1RM trendはEpley式を再利用し12rep超を除外する', () => {
    const result = analytics([
      history('w1', '2026-09-29', 100_000, 10),
      history('w2', '2026-09-30', 100_000, 13),
    ]);
    expect(result.exercises[0].e1rmTrend).toHaveLength(1);
    expect(result.exercises[0].e1rmTrend[0].value).toBeCloseTo(133_333.3333);
  });

  it('7: workoutごとの最大working-set重量を時系列で返す', () => {
    const result = analytics([
      history('w1', '2026-09-29', 100_000, 8, {
        sets: [set('a', 90_000, 10), set('b', 100_000, 8)],
      }),
      history('w2', '2026-09-30', 102_500, 8),
    ]);
    expect(
      result.exercises[0].maxWeightTrend.map((point) => point.value),
    ).toEqual([100_000, 102_500]);
  });

  it('8: rep trendは異なる重量を混ぜず同一重量ごとのbest repsにする', () => {
    const result = analytics([
      history('w1', '2026-09-30', 100_000, 10, {
        sets: [
          set('a', 90_000, 15),
          set('b', 100_000, 9),
          set('c', 100_000, 10),
        ],
      }),
    ]);
    expect(result.exercises[0].repTrend).toEqual([
      {
        workoutId: 'w1',
        localDate: '2026-09-30',
        loadGrams: 90_000,
        bestReps: 15,
      },
      {
        workoutId: 'w1',
        localDate: '2026-09-30',
        loadGrams: 100_000,
        bestReps: 10,
      },
    ]);
  });

  it('9: PR historyは初回をPRにせずPhase 3C-2判定から値付きイベントを作る', () => {
    const result = analytics([
      history('w1', '2026-09-28', 100_000, 8),
      history('w2', '2026-09-29', 100_000, 10),
      history('w3', '2026-09-30', 102_500, 10),
    ]);
    const events = result.exercises[0].personalRecordHistory;
    expect(events.some((event) => event.workoutId === 'w1')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workoutId: 'w2',
          type: 'reps',
          value: 10,
          loadGrams: 100_000,
        }),
        expect.objectContaining({ workoutId: 'w2', type: 'e1rm' }),
        expect.objectContaining({ workoutId: 'w2', type: 'volume' }),
        expect.objectContaining({
          workoutId: 'w3',
          type: 'weight',
          value: 102_500,
        }),
      ]),
    );
  });

  it('10: 最新実績のprogression statusをPhase 3Aで評価する', () => {
    const result = analytics([history('w1', '2026-09-30', 100_000, 10)]);
    expect(result.exercises[0].progression).toMatchObject({
      status: 'increase_load',
      nextTarget: { loadGrams: 102_500 },
    });
  });

  it('11: 現在のstagnation statusをPhase 3C-4で評価する', () => {
    const result = analytics([
      history('w1', '2026-09-28', 100_000, 8),
      history('w2', '2026-09-29', 100_000, 8),
      history('w3', '2026-09-30', 100_000, 8),
    ]);
    expect(result.exercises[0].stagnation).toMatchObject({
      status: 'stagnating',
      reasonCode: 'no_recent_progress',
    });
  });

  it('12: accepted targetの採用履歴とapplied workoutの達成を返す', () => {
    const result = analytics(
      [
        history('workout-1', '2026-09-01', 100_000, 10),
        history('workout-2', '2026-09-03', 100_000, 10),
      ],
      { acceptedTargets: [acceptedTarget()] },
    );
    expect(result.exercises[0].acceptedTargetHistory[0]).toMatchObject({
      id: 'target-1',
      appliedWorkoutId: 'workout-2',
      outcome: 'achieved',
    });
  });

  it('13: accepted target未達とデータ不足を既存progression定義で区別する', () => {
    const missed = analytics(
      [
        history('workout-1', '2026-09-01', 100_000, 10),
        history('workout-2', '2026-09-03', 100_000, 9),
      ],
      { acceptedTargets: [acceptedTarget()] },
    );
    expect(missed.exercises[0].acceptedTargetHistory[0].outcome).toBe('missed');
    const insufficient = analytics(
      [
        history('workout-1', '2026-09-01', 100_000, 10),
        history('workout-2', '2026-09-03', 100_000, 10, {
          sets: [set('a', 100_000, 10), set('b', 100_000, 10)],
        }),
      ],
      { acceptedTargets: [acceptedTarget()] },
    );
    expect(insufficient.exercises[0].acceptedTargetHistory[0].outcome).toBe(
      'insufficient_data',
    );
  });

  it('14: 履歴編集後はvolume/e1RM/PRを固定値でなく再計算する', () => {
    const entries = [
      history('w1', '2026-09-29', 100_000, 8),
      history('w2', '2026-09-30', 100_000, 9),
    ];
    const before = analytics(entries);
    entries[0].performance.sets[0].actualReps = 10;
    const after = analytics(entries);
    expect(after.workouts.totalVolumeGramReps).toBeGreaterThan(
      before.workouts.totalVolumeGramReps,
    );
    expect(
      after.exercises[0].personalRecordHistory.some(
        (event) => event.workoutId === 'w2' && event.type === 'reps',
      ),
    ).toBe(false);
  });

  it('15: soft deleteを全分析から除外しrestoreで再反映する', () => {
    const entries = [
      history('w1', '2026-09-29', 100_000, 8),
      history('w2', '2026-09-30', 110_000, 8, {
        workoutDeletedAt: '2026-09-30T12:00:00.000Z',
      }),
    ];
    let result = analytics(
      entries.filter((item) => !item.performance.workoutDeletedAt),
    );
    expect(result.workouts.completedWorkoutCount).toBe(1);
    expect(result.exercises[0].maxWeightTrend.at(-1)?.value).toBe(100_000);
    entries[1].performance.workoutDeletedAt = null;
    result = analytics(entries);
    expect(result.workouts.completedWorkoutCount).toBe(2);
    expect(result.exercises[0].maxWeightTrend.at(-1)?.value).toBe(110_000);
  });

  it('16: warmup・未完了・invalid actualをset/volume/trendから除外する', () => {
    const result = analytics([
      history('w1', '2026-09-30', 100_000, 8, {
        sets: [
          set('valid', 100_000, 8),
          set('warmup', 200_000, 20, { setType: 'warmup' }),
          set('planned', 200_000, 10, { status: 'planned' }),
          set('invalid', 0, 10),
        ],
      }),
    ]);
    expect(result.workouts).toMatchObject({
      workingSetCount: 1,
      totalVolumeGramReps: 800_000,
    });
    expect(result.exercises[0].maxWeightTrend[0].value).toBe(100_000);
  });

  it('17: 期間外実績を集計から外しつつPR比較の過去基準には残す', () => {
    const result = analytics(
      [
        history('old', '2026-09-01', 100_000, 8),
        history('recent', '2026-09-30', 102_500, 8),
      ],
      { range: '7d' },
    );
    expect(result.workouts.completedWorkoutCount).toBe(1);
    expect(result.exercises[0].workoutCount).toBe(1);
    expect(result.exercises[0].personalRecordHistory).toContainEqual(
      expect.objectContaining({ workoutId: 'recent', type: 'weight' }),
    );
  });

  it('18: soft deleted sourceのaccepted targetは分析対象から除外する', () => {
    const result = analytics(
      [
        history('workout-1', '2026-09-01', 100_000, 10),
        history('workout-2', '2026-09-03', 100_000, 10),
      ],
      {
        acceptedTargets: [
          acceptedTarget({ sourceDeletedAt: '2026-09-04T00:00:00.000Z' }),
        ],
      },
    );
    expect(result.exercises[0].acceptedTargetHistory).toEqual([]);
  });

  it('19: current accepted targetは期間外の履歴を根拠にしていても有効なら返す', () => {
    const result = analytics(
      [history('workout-1', '2026-08-01', 100_000, 10)],
      {
        range: '7d',
        acceptedTargets: [
          acceptedTarget({ status: 'accepted', appliedWorkoutId: null }),
        ],
      },
    );
    expect(result.exercises[0].currentAcceptedTarget).toMatchObject({
      id: 'target-1',
      validity: 'valid',
      appliedWorkoutId: null,
    });
  });

  it('20: staleまたはappliedのaccepted targetは現在の次回目標にしない', () => {
    const stale = analytics([history('workout-1', '2026-09-01', 100_000, 10)], {
      acceptedTargets: [
        acceptedTarget({
          status: 'accepted',
          appliedWorkoutId: null,
          sourceCurrentVersion: 2,
        }),
      ],
    });
    expect(stale.exercises[0].currentAcceptedTarget).toBeNull();

    const applied = analytics(
      [history('workout-1', '2026-09-01', 100_000, 10)],
      { acceptedTargets: [acceptedTarget()] },
    );
    expect(applied.exercises[0].currentAcceptedTarget).toBeNull();
  });

  it('21: clientは期間を1つのanalytics APIへ渡してwaterfallを作らない', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      expect(requestUrl).toBe('/api/v2/analytics?range=90d');
      return new Response(
        JSON.stringify(
          analytics([history('w1', '2026-09-30', 100_000, 8)], {
            range: '90d',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    expect((await getAnalytics('90d', fetcher)).period.range).toBe('90d');
  });
});

it('builds period comparisons from valid completed sets before the visible window', () => {
  const result = analytics(
    [
      history('base', '2026-09-23', 50000, 8),
      history('deleted', '2026-09-23', 90000, 8, {
        workoutDeletedAt: '2026-09-24',
      }),
      history('now', '2026-09-30', 52500, 10, {
        sets: [
          set('heavy', 52500, 10),
          set('warmup', 90000, 20, { setType: 'warmup' }),
          set('deleted-set', 100000, 8, { deletedAt: '2026-09-30' }),
        ],
      }),
    ],
    { range: '7d' },
  );
  expect(result.exercises[0].maxWeightTrend).toHaveLength(1);
  expect(result.exercises[0].periodProgress).toMatchObject({
    before: { loadGrams: 50000, bestReps: 8 },
    after: { loadGrams: 52500, bestReps: 10 },
    baseline: 'before_period',
  });
});
