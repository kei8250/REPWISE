import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildAnalyticsInsights,
  buildFrequencyComparison,
  getInsightsForView,
  getDetailHighlights,
} from '@/lib/analytics/insights';
import type {
  AnalyticsSnapshot,
  ExerciseAnalytics,
  AcceptedTargetAnalytics,
} from '@/lib/analytics/model';
import { InsightsSection } from '@/components/analytics/insights-section';
import { buildHomeAnalyticsSummary } from '@/lib/analytics/home-summary';

function target(
  validity: AcceptedTargetAnalytics['validity'] = 'valid',
): AcceptedTargetAnalytics {
  return {
    id: 't',
    acceptedAt: '2026-09-29',
    updatedAt: '2026-09-29',
    sourceWorkoutId: 'w',
    sourceWorkoutVersion: 1,
    sourceLocalDate: '2026-09-28',
    status: 'accepted',
    appliedWorkoutId: null,
    targetLoadGrams: 102500,
    targetRepMin: 8,
    targetRepMax: 10,
    targetWorkingSets: 3,
    validity,
    outcome: 'not_applied',
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
    totalVolumeGramReps: 3000000,
    profile: null,
    progression: {
      status: 'keep_load',
      reasonCode: 'within_rep_range',
      currentLoadGrams: 100000,
      nextTarget: null,
      evaluatedSetIds: [],
      sourceWorkoutId: 'w',
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
    e1rmTrend: [{ workoutId: 'w', localDate: '2026-09-28', value: 133333 }],
    maxWeightTrend: [
      { workoutId: 'w', localDate: '2026-09-28', value: 100000 },
    ],
    volumeTrend: [],
    repTrend: [],
    personalRecordHistory: [],
    acceptedTargetHistory: [],
    currentAcceptedTarget: null,
    ...overrides,
  };
}
function snapshot(exercises = [exercise()]): AnalyticsSnapshot {
  return {
    generatedAt: '2026-09-30',
    period: {
      range: '30d',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      dayCount: 30,
    },
    workouts: {
      completedWorkoutCount: 6,
      trainingDayCount: 5,
      weeklyAverageWorkoutCount: 1.4,
      workingSetCount: 18,
      totalVolumeGramReps: 6000000,
      volumeByWorkout: [],
    },
    exercises,
    bodyParts: [],
  };
}
const types = (data: AnalyticsSnapshot) =>
  buildAnalyticsInsights(data).items.map((item) => item.type);

describe('Phase 4D insight engine', () => {
  it('A: existing progression produces a positive insight with matching evidence', () => {
    expect(types(snapshot())).toContain('progressing');
    const data = snapshot([
      exercise({
        progression: {
          ...exercise().progression,
          status: 'increase_load',
          reasonCode: 'all_sets_at_rep_max',
          evaluatedSetIds: ['a', 'b', 'c'],
        },
      }),
    ]);
    expect(buildAnalyticsInsights(data).items[0].supportingData).toMatchObject({
      reasonCode: 'all_sets_at_rep_max',
    });
  });
  it('B: existing stagnation is high priority and suppresses positive duplicate', () => {
    const data = snapshot([
      exercise({
        stagnation: {
          ...exercise().stagnation,
          status: 'stagnating',
          reasonCode: 'no_recent_progress',
        },
      }),
    ]);
    const result = buildAnalyticsInsights(data);
    expect(result.items[0]).toMatchObject({
      type: 'stagnation',
      priority: 'high',
    });
    expect(types(data)).not.toContain('progressing');
  });
  it('C: valid unused accepted target', () =>
    expect(
      types(snapshot([exercise({ currentAcceptedTarget: target() })])),
    ).toContain('accepted_target'));
  it('D: stale target is review only; deleted/applied/superseded are excluded', () => {
    const stale = target('stale_source_version');
    expect(
      types(snapshot([exercise({ acceptedTargetHistory: [stale] })])),
    ).toContain('target_review');
    for (const t of [
      target('invalid_source'),
      { ...target(), status: 'applied' as const, appliedWorkoutId: 'new' },
      { ...target(), status: 'superseded' as const },
    ])
      expect(
        types(
          snapshot([
            exercise({ currentAcceptedTarget: t, acceptedTargetHistory: [t] }),
          ]),
        ),
      ).not.toContain('accepted_target');
  });
  it('E/F: existing PRs in one workout group into one insight', () => {
    const records = ['weight', 'e1rm'].map((type) => ({
      workoutId: 'pr',
      localDate: '2026-09-28',
      type: type as 'weight' | 'e1rm',
      value: 102500,
      loadGrams: 102500,
      previousValue: 100000,
    }));
    const result = buildAnalyticsInsights(
      snapshot([exercise({ personalRecordHistory: records })]),
    );
    const prs = result.items.filter((i) => i.type === 'recent_pr');
    expect(prs).toHaveLength(1);
    expect(prs[0].message).toContain('重量・e1RM');
    expect(prs[0].supportingData.values).toHaveLength(3);
  });
  it('old PRs and first record produce no recent PR insight', () => {
    expect(types(snapshot())).not.toContain('recent_pr');
    expect(
      types(
        snapshot([
          exercise({
            personalRecordHistory: [
              {
                workoutId: 'old',
                localDate: '2026-08-01',
                type: 'weight',
                value: 100000,
                loadGrams: 100000,
                previousValue: null,
              },
            ],
          }),
        ]),
      ),
    ).not.toContain('recent_pr');
  });
  it('G/H: body balance needs sufficient days, difference and ratio', () => {
    const data = snapshot();
    const part = (bodyPart: string, workingSetCount: number) => ({
      bodyPart,
      workingSetCount,
      trainingDayCount: 3,
      exerciseCount: 1,
      totalVolumeGramReps: 0,
    });
    data.bodyParts = [part('脚', 10), part('背中', 12)];
    expect(types(data)).not.toContain('body_part_balance');
    data.bodyParts = [part('脚', 8), part('背中', 16)];
    expect(types(data)).toContain('body_part_balance');
    data.bodyParts[0].trainingDayCount = 1;
    expect(types(data)).not.toContain('body_part_balance');
  });
  it('I: equal previous window comparison supports increase and decrease', () => {
    const data = snapshot();
    const comparison = {
      previousStart: '2026-08-02',
      previousEnd: '2026-08-31',
      previousWorkoutCount: 3,
      previousTrainingDays: 3,
      hasCoverage: true,
    };
    expect(
      buildAnalyticsInsights(data, comparison).items.find(
        (i) => i.type === 'training_frequency',
      )?.title,
    ).toContain('増え');
    data.workouts.completedWorkoutCount = 1;
    expect(
      buildAnalyticsInsights(data, comparison).items.find(
        (i) => i.type === 'training_frequency',
      )?.title,
    ).toContain('減っ');
  });
  it('J: lack of coverage and small previous sample do not imply low frequency', () => {
    const data = snapshot();
    const comparison = {
      previousStart: '2026-08-02',
      previousEnd: '2026-08-31',
      previousWorkoutCount: 3,
      previousTrainingDays: 3,
      hasCoverage: false,
    };
    expect(
      buildAnalyticsInsights(data, comparison).items.some(
        (i) => i.type === 'training_frequency',
      ),
    ).toBe(false);
    expect(
      buildAnalyticsInsights(data, {
        ...comparison,
        hasCoverage: true,
        previousTrainingDays: 1,
      }).items.some((i) => i.type === 'training_frequency'),
    ).toBe(false);
  });
  it('comparison counts workouts and unique days independently, all has none', () => {
    const result = buildFrequencyComparison(
      [
        { localDate: '2026-08-02' },
        { localDate: '2026-08-03' },
        { localDate: '2026-08-03' },
        { localDate: '2026-09-01' },
      ],
      snapshot().period,
    );
    expect(result).toMatchObject({
      previousWorkoutCount: 3,
      previousTrainingDays: 2,
      hasCoverage: true,
    });
    expect(
      buildFrequencyComparison([], {
        ...snapshot().period,
        startDate: null,
        dayCount: null,
      }),
    ).toBeUndefined();
  });
  it('K: shared view adapter sorts priority and caps Home3/detail8', () => {
    const data = snapshot(
      Array.from({ length: 10 }, (_, i) =>
        exercise({ exerciseId: String(i), currentAcceptedTarget: target() }),
      ),
    );
    data.exercises[9].stagnation = {
      ...exercise().stagnation,
      status: 'stagnating',
      reasonCode: 'no_recent_progress',
    };
    expect(getInsightsForView(data, 'home').items).toHaveLength(3);
    expect(getInsightsForView(data, 'detail').items).toHaveLength(8);
    expect(getInsightsForView(data, 'home').items[0].priority).toBe('high');
  });
  it('L: insufficient data is neither stagnation nor frequency shortage', () => {
    const data = snapshot([]);
    data.workouts.workingSetCount = 0;
    const result = buildAnalyticsInsights(data);
    expect(result).toEqual({ status: 'insufficient_data', items: [] });
    expect(
      renderToStaticMarkup(createElement(InsightsSection, { summary: result })),
    ).toContain('まだ分析に十分な記録がありません');
  });
  it('no useful insight stays silent', () => {
    const data = snapshot([
      exercise({
        maxWeightTrend: [],
        stagnation: { ...exercise().stagnation, status: 'insufficient_data' },
      }),
    ]);
    const result = buildAnalyticsInsights(data);
    expect(result.status).toBe('no_insight');
    expect(
      renderToStaticMarkup(createElement(InsightsSection, { summary: result })),
    ).toContain('現在、特に注目すべき変化はありません');
  });
  it('M/N: Home and detail share server insight data, supporting evidence appears in detail', () => {
    const data = snapshot();
    data.insights = buildAnalyticsInsights(data);
    expect(buildHomeAnalyticsSummary(data).insights).toEqual(
      getInsightsForView(data, 'home'),
    );
    expect(
      renderToStaticMarkup(
        createElement(InsightsSection, {
          summary: getInsightsForView(data, 'detail'),
          detailed: true,
        }),
      ),
    ).toContain('133.3kg');
  });
});

describe('compact detailed highlights', () => {
  it('deduplicates an exercise and prioritizes the concrete period comparison', () => {
    const data = snapshot([
      exercise({
        currentAcceptedTarget: target(),
        periodProgress: {
          before: {
            workoutId: 'old',
            localDate: '2026-08-31',
            loadGrams: 100000,
            bestReps: 8,
          },
          after: {
            workoutId: 'new',
            localDate: '2026-09-28',
            loadGrams: 102500,
            bestReps: 8,
          },
          baseline: 'before_period',
        },
      }),
    ]);
    const highlights = getDetailHighlights(data);
    expect(highlights.items).toHaveLength(1);
    expect(highlights.items[0].type).toBe('period_progress');
    expect(highlights.items[0].message).toContain(
      '100kg × 8回 → 2026-09-28 102.5kg × 8回',
    );
    expect(getDetailHighlights(data, '脚').items).toHaveLength(0);
    expect(getDetailHighlights(data, '胸').items).toHaveLength(1);
  });
  it('shows three points by default with an accessible way to expand', () => {
    const data = snapshot(
      Array.from({ length: 5 }, (_, i) =>
        exercise({ exerciseId: `e${i}`, exerciseName: `種目${i}` }),
      ),
    );
    const html = renderToStaticMarkup(
      createElement(InsightsSection, {
        summary: getDetailHighlights(data),
        compact: true,
      }),
    );
    expect(html).toContain('もっと見る（全5件）');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('種目2');
    expect(html).not.toContain('種目3');
  });
});
