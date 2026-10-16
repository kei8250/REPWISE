import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HomeAnalyticsSection } from '@/components/home-analytics-summary';
import { HomeV2 } from '@/components/home-v2';
import {
  createHomeAnalyticsCache,
  HOME_ANALYTICS_TTL_MS,
} from '@/lib/analytics/home-cache';
import {
  buildHomeAnalyticsSummary,
  type HomeAnalyticsSummary,
} from '@/lib/analytics/home-summary';
import type {
  AcceptedTargetAnalytics,
  AnalyticsSnapshot,
  ExerciseAnalytics,
} from '@/lib/analytics/model';

function target(
  overrides: Partial<AcceptedTargetAnalytics> = {},
): AcceptedTargetAnalytics {
  return {
    id: 'target-1',
    acceptedAt: '2026-09-29T09:00:00.000Z',
    updatedAt: '2026-09-29T09:00:00.000Z',
    sourceWorkoutId: 'source',
    sourceWorkoutVersion: 1,
    sourceLocalDate: '2026-09-28',
    status: 'accepted',
    appliedWorkoutId: null,
    targetLoadGrams: 102_500,
    targetRepMin: 8,
    targetRepMax: 10,
    targetWorkingSets: 3,
    validity: 'valid',
    outcome: 'not_applied',
    ...overrides,
  };
}

function exercise(
  overrides: Partial<ExerciseAnalytics> = {},
): ExerciseAnalytics {
  return {
    exerciseId: 'bench',
    exerciseName: 'ベンチプレス',
    bodyPart: '胸',
    workoutCount: 3,
    trainingDayCount: 3,
    workingSetCount: 9,
    totalVolumeGramReps: 2_900_000,
    profile: null,
    progression: {
      status: 'keep_load',
      reasonCode: 'within_rep_range',
      currentLoadGrams: 100_000,
      nextTarget: null,
      evaluatedSetIds: [],
      sourceWorkoutId: 'workout-3',
      sourceWorkoutVersion: 1,
    },
    stagnation: {
      status: 'progressing',
      reasonCode: 'recent_rep_progress',
      validHistoryCount: 3,
      requiredHistoryCount: 3,
      recentHistoryCount: 3,
      consecutiveAcceptedTargetMisses: 0,
    },
    e1rmTrend: [],
    maxWeightTrend: [],
    volumeTrend: [],
    repTrend: [],
    personalRecordHistory: [],
    acceptedTargetHistory: [],
    currentAcceptedTarget: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<AnalyticsSnapshot> = {},
): AnalyticsSnapshot {
  return {
    generatedAt: '2026-09-30T12:00:00.000Z',
    period: {
      range: '30d',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      dayCount: 30,
    },
    workouts: {
      completedWorkoutCount: 3,
      trainingDayCount: 2,
      weeklyAverageWorkoutCount: 0.7,
      workingSetCount: 12,
      totalVolumeGramReps: 4_000_000,
      volumeByWorkout: [
        {
          workoutId: 'old',
          localDate: '2026-09-20',
          workingSetCount: 4,
          volumeGramReps: 1_000_000,
        },
        {
          workoutId: 'recent',
          localDate: '2026-09-28',
          workingSetCount: 8,
          volumeGramReps: 3_000_000,
        },
      ],
    },
    exercises: [exercise()],
    bodyParts: [],
    ...overrides,
  };
}

function summary(
  overrides: Partial<HomeAnalyticsSummary> = {},
): HomeAnalyticsSummary {
  return {
    hasTrainingData: true,
    workoutCount30d: 3,
    trainingDayCount30d: 2,
    weeklyAverageWorkoutCount: 0.7,
    workingSetCount7d: 8,
    recentPersonalRecords: [],
    stagnatingExercises: [],
    acceptedTargets: [],
    ...overrides,
  };
}

describe('Phase 4B Home analytics summary', () => {
  it('A/B: analytics loading中もHomeの開始・履歴導線を初期描画する', () => {
    const markup = renderToStaticMarkup(createElement(HomeV2));
    expect(markup).toContain('ワークアウトを開始');
    expect(markup).not.toContain('履歴を開く');
    expect(markup).not.toContain('前回のトレーニング');
    expect(markup).toContain('目標設定へ');
    expect(markup).toContain('分析を読み込み中');
  });

  it('C: analytics errorはHome全体でなく分析部分だけに表示しretryできる', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeAnalyticsSection, {
        state: { status: 'error', data: null },
        onRetry: vi.fn(),
      }),
    );
    expect(markup).toContain('分析データを取得できませんでした');
    expect(markup).toContain('再試行');
  });

  it('D: PRを新しい順に最大3件へまとめる', () => {
    const analytics = snapshot({
      exercises: [
        exercise({
          personalRecordHistory: [
            {
              workoutId: 'w1',
              localDate: '2026-09-25',
              type: 'weight',
              value: 100_000,
              loadGrams: 100_000,
              previousValue: 97_500,
            },
            {
              workoutId: 'w2',
              localDate: '2026-09-28',
              type: 'reps',
              value: 10,
              loadGrams: 100_000,
              previousValue: 9,
            },
            {
              workoutId: 'w3',
              localDate: '2026-09-29',
              type: 'e1rm',
              value: 133_333,
              loadGrams: null,
              previousValue: 130_000,
            },
            {
              workoutId: 'w4',
              localDate: '2026-09-30',
              type: 'volume',
              value: 3_000_000,
              loadGrams: null,
              previousValue: 2_900_000,
            },
          ],
        }),
      ],
    });
    const result = buildHomeAnalyticsSummary(analytics);
    expect(result.recentPersonalRecords).toHaveLength(3);
    expect(
      result.recentPersonalRecords.map((record) => record.localDate),
    ).toEqual(['2026-09-30', '2026-09-29', '2026-09-28']);
  });

  it('E: PRがない場合は空のPRカードを描画しない', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeAnalyticsSection, {
        state: { status: 'success', data: summary() },
        onRetry: vi.fn(),
      }),
    );
    expect(markup).not.toContain('最近のPR');
  });

  it('F: stagnating exerciseを自然な理由付きで最大3件表示する', () => {
    const analytics = snapshot({
      exercises: [
        exercise({
          stagnation: {
            status: 'stagnating',
            reasonCode: 'no_recent_progress',
            validHistoryCount: 3,
            requiredHistoryCount: 3,
            recentHistoryCount: 3,
            consecutiveAcceptedTargetMisses: 0,
          },
        }),
      ],
    });
    expect(buildHomeAnalyticsSummary(analytics).stagnatingExercises[0]).toEqual(
      {
        exerciseId: 'bench',
        exerciseName: 'ベンチプレス',
        reason: '直近3回で明確な伸びが見られません',
      },
    );
  });

  it('G: stagnatingがなければ大きな停滞なしを表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeAnalyticsSection, {
        state: { status: 'success', data: summary() },
        onRetry: vi.fn(),
      }),
    );
    expect(markup).toContain('現在、大きな停滞はありません');
  });

  it('H: 有効かつ未適用のaccepted targetだけを次回目標へ出す', () => {
    const result = buildHomeAnalyticsSummary(
      snapshot({
        exercises: [exercise({ currentAcceptedTarget: target() })],
      }),
    );
    expect(result.acceptedTargets).toEqual([
      {
        exerciseId: 'bench',
        exerciseName: 'ベンチプレス',
        targetLoadGrams: 102_500,
        targetRepMin: 8,
        targetRepMax: 10,
        targetWorkingSets: 3,
      },
    ]);
  });

  it.each([
    ['applied', target({ status: 'applied', appliedWorkoutId: 'next' })],
    ['stale', target({ validity: 'stale_source_version' })],
    ['superseded', target({ status: 'superseded' })],
  ])('I: %s targetを未実施の次回目標として表示しない', (_label, value) => {
    const result = buildHomeAnalyticsSummary(
      snapshot({
        exercises: [exercise({ currentAcceptedTarget: value })],
      }),
    );
    expect(result.acceptedTargets).toEqual([]);
  });

  it('J: 完了履歴0件ではdummy値を出さずデータ不足を表示する', () => {
    const empty = buildHomeAnalyticsSummary(
      snapshot({
        workouts: {
          completedWorkoutCount: 0,
          trainingDayCount: 0,
          weeklyAverageWorkoutCount: 0,
          workingSetCount: 0,
          totalVolumeGramReps: 0,
          volumeByWorkout: [],
        },
        exercises: [],
      }),
    );
    const markup = renderToStaticMarkup(
      createElement(HomeAnalyticsSection, {
        state: { status: 'success', data: empty },
        onRetry: vi.fn(),
      }),
    );
    expect(markup).toContain('まだ分析できる記録がありません');
    expect(markup).not.toContain('0回 / 0日');
  });

  it('直近7日のworking setsを30日レスポンスから算出する', () => {
    expect(buildHomeAnalyticsSummary(snapshot()).workingSetCount7d).toBe(8);
  });

  it('同時loadを1リクエストに共有しTTL内は再取得しない', async () => {
    let now = 1_000;
    const fetch = vi.fn(async () => summary());
    const cache = createHomeAnalyticsCache({ fetch, now: () => now });
    await Promise.all([cache.load(), cache.load()]);
    await cache.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    now += HOME_ANALYTICS_TTL_MS + 1;
    await cache.load();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retryのforce loadと明示invalidateで短期cacheを破棄できる', async () => {
    const fetch = vi.fn(async () => summary());
    const cache = createHomeAnalyticsCache({ fetch, now: () => 1_000 });
    await cache.load();
    await cache.load(true);
    cache.invalidate();
    await cache.load();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('Homeの最近のPRと停滞種目からexercise ID付き分析へ遷移できる', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeAnalyticsSection, {
        state: {
          status: 'success',
          data: summary({
            stagnatingExercises: [
              {
                exerciseId: 'bench press',
                exerciseName: 'ベンチプレス',
                reason: '直近3回で明確な伸びが見られません',
              },
            ],
            recentPersonalRecords: [
              {
                workoutId: 'workout-1',
                exerciseId: 'bench press',
                exerciseName: 'ベンチプレス',
                localDate: '2026-09-30',
                type: 'weight',
                value: 102_500,
                loadGrams: 102_500,
              },
            ],
          }),
        },
        onRetry: vi.fn(),
      }),
    );
    expect(
      markup.match(/href="\/analytics\?exerciseId=bench%20press"/g),
    ).toHaveLength(2);
  });
});

it('ホームでは期間集計を隠し、分析への導線を残す', () => {
  const html = renderToStaticMarkup(
    createElement(HomeAnalyticsSection, {
      state: { status: 'success', data: summary() },
      onRetry: vi.fn(),
      showPeriodMetrics: false,
    }),
  );
  expect(html).not.toContain('直近30日');
  expect(html).not.toContain('直近7日');
  expect(html).toContain('詳しい分析を見る');
});
