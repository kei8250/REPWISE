import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsPage from '@/app/analytics/page';
import {
  AnalyticsDashboard,
  AnalyticsDataView,
  AnalyticsErrorPanel,
} from '@/components/analytics/analytics-dashboard';
import { TrendChart } from '@/components/analytics/trend-chart';
import {
  ANALYTICS_DETAIL_TTL_MS,
  createAnalyticsDetailCache,
} from '@/lib/analytics/detail-cache';
import {
  ALL_BODY_PARTS,
  analyticsBodyParts,
  analyticsExerciseIdFromSearch,
  filterAnalyticsExercises,
  getAnalyticsTrend,
  selectAnalyticsExercise,
  sortExercisesByRecent,
} from '@/lib/analytics/detail-view';
import type {
  AnalyticsSnapshot,
  ExerciseAnalytics,
} from '@/lib/analytics/model';

vi.mock('next/navigation', () => ({ usePathname: () => '/analytics' }));

function exercise(
  id: string,
  name: string,
  localDate: string,
  overrides: Partial<ExerciseAnalytics> = {},
): ExerciseAnalytics {
  return {
    exerciseId: id,
    exerciseName: name,
    bodyPart: id === 'bench' ? '胸' : '脚',
    workoutCount: 3,
    trainingDayCount: 3,
    workingSetCount: 9,
    totalVolumeGramReps: 3_000_000,
    profile: null,
    progression: {
      status: 'increase_load',
      reasonCode: 'all_sets_at_rep_max',
      currentLoadGrams: 100_000,
      nextTarget: {
        loadGrams: 102_500,
        repMin: 8,
        repMax: 10,
        workingSets: 3,
        sets: [],
      },
      evaluatedSetIds: [],
      sourceWorkoutId: `${id}-latest`,
      sourceWorkoutVersion: 1,
    },
    stagnation: {
      status: 'progressing',
      reasonCode: 'recent_load_progress',
      validHistoryCount: 3,
      requiredHistoryCount: 3,
      recentHistoryCount: 3,
      consecutiveAcceptedTargetMisses: 0,
    },
    e1rmTrend: [
      { workoutId: `${id}-1`, localDate: '2026-09-01', value: 120_000 },
      { workoutId: `${id}-2`, localDate, value: 133_333 },
    ],
    maxWeightTrend: [
      { workoutId: `${id}-1`, localDate: '2026-09-01', value: 100_000 },
      { workoutId: `${id}-2`, localDate, value: 102_500 },
    ],
    volumeTrend: [
      { workoutId: `${id}-1`, localDate: '2026-09-01', value: 2_700_000 },
      { workoutId: `${id}-2`, localDate, value: 3_000_000 },
    ],
    repTrend: [],
    personalRecordHistory: [
      {
        workoutId: `${id}-2`,
        localDate,
        type: 'weight',
        value: 102_500,
        loadGrams: 102_500,
        previousValue: 100_000,
      },
    ],
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
      completedWorkoutCount: 5,
      trainingDayCount: 4,
      weeklyAverageWorkoutCount: 1.17,
      workingSetCount: 18,
      totalVolumeGramReps: 6_000_000,
      volumeByWorkout: [],
    },
    exercises: [
      exercise('bench', 'ベンチプレス', '2026-09-20'),
      exercise('squat', 'バックスクワット', '2026-09-28'),
    ],
    bodyParts: [
      {
        bodyPart: '胸',
        exerciseCount: 1,
        trainingDayCount: 3,
        workingSetCount: 9,
        totalVolumeGramReps: 3_000_000,
      },
      {
        bodyPart: '脚',
        exerciseCount: 1,
        trainingDayCount: 2,
        workingSetCount: 6,
        totalVolumeGramReps: 3_000_000,
      },
    ],
    ...overrides,
  };
}

function renderData(
  analytics = snapshot(),
  selectedExerciseId: string | null = 'bench',
) {
  return renderToStaticMarkup(
    createElement(AnalyticsDataView, {
      analytics,
      selectedExerciseId,
      onSelectExercise: vi.fn(),
      trendKind: 'e1rm',
      onTrendKindChange: vi.fn(),
    }),
  );
}

describe('Phase 4C detailed analytics', () => {
  it('A: /analyticsのshellと期間操作を初期表示する', () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsPage));
    expect(markup).toContain('詳細分析');
    expect(markup).toContain('表示期間');
    expect(markup).toContain('分析データを読み込み中');
  });

  it('B: 7d / 30d / 90d / allを正しいrangeで取得し期間別にcacheする', async () => {
    let now = 1_000;
    const fetch = vi.fn(async (range) =>
      snapshot({ period: { ...snapshot().period, range } }),
    );
    const cache = createAnalyticsDetailCache({ fetch, now: () => now });
    await Promise.all([cache.load('30d'), cache.load('30d')]);
    await cache.load('7d');
    await cache.load('90d');
    await cache.load('all');
    expect(fetch.mock.calls.map(([range]) => range)).toEqual([
      '30d',
      '7d',
      '90d',
      'all',
    ]);
    now += ANALYTICS_DETAIL_TTL_MS + 1;
    await cache.load('30d');
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('C: exercise IDで選択し最近実施した種目を上位にする', () => {
    const analytics = snapshot();
    expect(sortExercisesByRecent(analytics.exercises)[0].exerciseId).toBe(
      'squat',
    );
    expect(selectAnalyticsExercise(analytics, 'bench')?.exerciseName).toBe(
      'ベンチプレス',
    );
  });

  it('deep linkのexercise IDを読み取り、有効IDは該当種目・無効IDは安全な既定種目を選ぶ', () => {
    const analytics = snapshot();
    const validId = analyticsExerciseIdFromSearch('?exerciseId=bench');
    const invalidId = analyticsExerciseIdFromSearch('?exerciseId=missing');
    expect(selectAnalyticsExercise(analytics, validId)?.exerciseId).toBe(
      'bench',
    );
    expect(selectAnalyticsExercise(analytics, invalidId)?.exerciseId).toBe(
      'squat',
    );
  });

  it('現在状態は実データの部位で絞り込み、unknownをその他として扱う', () => {
    const exercises = [
      ...snapshot().exercises,
      exercise('unknown', '部位未設定種目', '2026-09-29', {
        bodyPart: 'unknown',
      }),
    ];
    expect(analyticsBodyParts(exercises)).toEqual(['その他', '脚', '胸']);
    expect(
      filterAnalyticsExercises(exercises, '胸').map((item) => item.exerciseId),
    ).toEqual(['bench']);
    expect(filterAnalyticsExercises(exercises, ALL_BODY_PARTS)).toHaveLength(3);
  });

  it('現在状態の各行をexercise切替ボタンとして表示する', () => {
    const markup = renderData();
    expect(markup).toContain('aria-label="ベンチプレスの分析を表示"');
    expect(markup).toContain('aria-label="部位で絞り込む"');
    expect(markup).toContain('>すべて</button>');
  });

  it('D: e1RM trendはAPIの既存値を再計算せず使用する', () => {
    const bench = snapshot().exercises[0];
    expect(
      getAnalyticsTrend(bench, 'e1rm').map((point) => point.value),
    ).toEqual([120_000, 133_333]);
  });

  it('E: max weight trendはworkoutごとの既存最大重量を使用する', () => {
    expect(
      getAnalyticsTrend(snapshot().exercises[0], 'max_weight').map(
        (point) => point.value,
      ),
    ).toEqual([100_000, 102_500]);
  });

  it('F: volume trendはexercise workout volumeの既存値を使用する', () => {
    expect(
      getAnalyticsTrend(snapshot().exercises[0], 'volume').map(
        (point) => point.value,
      ),
    ).toEqual([2_700_000, 3_000_000]);
  });

  it('G: body partのset / day / exercise数を表示する', () => {
    const markup = renderData();
    expect(markup).toContain('部位別バランス');
    expect(markup).toContain('9 sets · 3日 · 1種目');
    expect(markup).toContain('6 sets · 2日 · 1種目');
  });

  it('H: 選択exerciseの期間内PR履歴だけを表示する', () => {
    const markup = renderData();
    expect(markup).toContain('重量PR');
    expect(markup).toContain('102.5kg');
    expect(markup).toContain('100kgから更新');
  });

  it('I: progression / stagnationの既存判定と日本語理由を表示する', () => {
    const markup = renderData();
    expect(markup).toContain('目標達成');
    expect(markup).toContain('全セットで上限repを達成');
    expect(markup).toContain('順調');
    expect(markup).toContain('直近で重量が伸びています');
  });

  it('accepted targetは有効かつ未実施の場合だけoverviewへ表示する', () => {
    const analytics = snapshot({
      exercises: [
        exercise('bench', 'ベンチプレス', '2026-09-20', {
          currentAcceptedTarget: {
            id: 'target-1',
            acceptedAt: '2026-09-20T10:00:00.000Z',
            updatedAt: '2026-09-20T10:00:00.000Z',
            sourceWorkoutId: 'bench-2',
            sourceWorkoutVersion: 1,
            sourceLocalDate: '2026-09-20',
            status: 'accepted',
            appliedWorkoutId: null,
            targetLoadGrams: 105_000,
            targetRepMin: 8,
            targetRepMax: 10,
            targetWorkingSets: 3,
            validity: 'valid',
            outcome: 'not_applied',
          },
        }),
      ],
    });
    expect(renderData(analytics)).toContain('105kg / 8〜10回 × 3');
  });

  it('J: dataなしでは空グラフや0の羅列を表示しない', () => {
    const markup = renderData(
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
        bodyParts: [],
      }),
      null,
    );
    expect(markup).toContain('この期間に分析できる記録がありません');
    expect(markup).not.toContain('<polyline');
    expect(markup).not.toContain('0回');
  });

  it('trendが1件なら空の折れ線でなく追加記録案内を表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(TrendChart, {
        points: [{ key: 'w1', localDate: '2026-09-20', value: 100_000 }],
        label: 'ベンチプレスの推定1RM',
        formatValue: (value: number) => `${value / 1000}kg`,
      }),
    );
    expect(markup).toContain('あと1回記録すると推移が見やすくなります');
    expect(markup).not.toContain('<svg');
  });

  it('K: API遅延中もshellと期間操作を表示する', () => {
    const markup = renderToStaticMarkup(createElement(AnalyticsDashboard));
    expect(markup).toContain('7日');
    expect(markup).toContain('30日');
    expect(markup).toContain('90日');
    expect(markup).toContain('全期間');
    expect(markup).toContain('分析データを読み込み中');
  });

  it('L: API失敗時はerrorとretryを表示する', () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsErrorPanel, { onRetry: vi.fn() }),
    );
    expect(markup).toContain('分析データを取得できませんでした');
    expect(markup).toContain('再試行');
  });

  it('M: HomeからAnalyticsへ通常リンクで遷移できる', () => {
    const source = fs.readFileSync(
      'components/home-analytics-summary.tsx',
      'utf8',
    );
    expect(source).toContain('href={APP_ROUTES.analytics}');
    expect(source).toContain('詳しい分析を見る');
  });

  it('N: グラフ実装はAnalytics routeだけが読み込みHomeへ混入しない', () => {
    const home = fs.readFileSync('components/home-v2.tsx', 'utf8');
    const route = fs.readFileSync('app/analytics/page.tsx', 'utf8');
    expect(home).not.toContain('analytics-dashboard');
    expect(home).not.toContain('trend-chart');
    expect(home).not.toContain('recharts');
    expect(route).toContain('analytics-dashboard');
  });
});
