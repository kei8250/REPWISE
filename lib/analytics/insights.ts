import type { AnalyticsSnapshot, AnalyticsPeriod } from './model';
import { stagnationReasonLabel } from '@/lib/progression/stagnation';

export const INSIGHT_RULES = {
  homeLimit: 3,
  detailLimit: 8,
  recentDays: 30,
  bodyPartMinDays: 2,
  bodyPartMinMaxSets: 12,
  bodyPartMinDifference: 8,
  bodyPartRatio: 2,
  frequencyMinPreviousWorkouts: 3,
  frequencyMinPreviousDays: 3,
  frequencyMinDifference: 2,
  frequencyRatio: 1.5,
} as const;

export type InsightType =
  | 'progressing'
  | 'stagnation'
  | 'accepted_target'
  | 'target_review'
  | 'recent_pr'
  | 'training_frequency'
  | 'body_part_balance';
export interface AnalyticsInsight {
  id: string;
  type: InsightType;
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  exerciseId?: string;
  exerciseName?: string;
  bodyParts?: string[];
  supportingData: {
    period?: AnalyticsPeriod;
    reasonCode?: string;
    values: Array<{
      label: string;
      value: number | string;
      unit?: string;
      date?: string;
    }>;
  };
}
export interface AnalyticsInsightSummary {
  status: 'success' | 'insufficient_data' | 'no_insight';
  items: AnalyticsInsight[];
}
export interface FrequencyComparison {
  previousStart: string;
  previousEnd: string;
  previousWorkoutCount: number;
  previousTrainingDays: number;
  hasCoverage: boolean;
}

function daysAgo(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function kg(grams: number) {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(grams / 1000)}kg`;
}

// Coverage is deliberately conservative: no comparison until a record predates
// the previous window. Absence of earlier records is not evidence of inactivity.
export function buildFrequencyComparison(
  workouts: Array<{ localDate: string }>,
  period: AnalyticsPeriod,
): FrequencyComparison | undefined {
  if (!period.startDate || !period.dayCount) return undefined;
  const previousEnd = daysAgo(period.startDate, 1);
  const previousStart = daysAgo(period.startDate, period.dayCount);
  const previous = workouts.filter(
    (w) => w.localDate >= previousStart && w.localDate <= previousEnd,
  );
  return {
    previousStart,
    previousEnd,
    previousWorkoutCount: previous.length,
    previousTrainingDays: new Set(previous.map((w) => w.localDate)).size,
    hasCoverage: workouts.some((w) => w.localDate <= previousStart),
  };
}

export function limitInsights(
  summary: AnalyticsInsightSummary,
  limit: number,
): AnalyticsInsightSummary {
  return { ...summary, items: summary.items.slice(0, Math.max(0, limit)) };
}

export function getInsightsForView(
  analytics: AnalyticsSnapshot,
  view: 'home' | 'detail',
) {
  return limitInsights(
    analytics.insights ?? buildAnalyticsInsights(analytics),
    view === 'home' ? INSIGHT_RULES.homeLimit : INSIGHT_RULES.detailLimit,
  );
}

export function buildAnalyticsInsights(
  analytics: AnalyticsSnapshot,
  comparison?: FrequencyComparison,
): AnalyticsInsightSummary {
  const items: AnalyticsInsight[] = [];
  const recentStart = daysAgo(
    analytics.period.endDate,
    INSIGHT_RULES.recentDays - 1,
  );
  for (const exercise of analytics.exercises) {
    const identity = {
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
    };
    const recent = exercise.maxWeightTrend.some(
      (p) =>
        p.localDate >= recentStart && p.localDate <= analytics.period.endDate,
    );
    const historyValues = exercise.e1rmTrend
      .slice(-3)
      .map((p) => ({
        label: 'e1RM',
        value: p.value,
        unit: 'grams',
        date: p.localDate,
      }));
    if (recent && exercise.stagnation.status === 'stagnating') {
      items.push({
        id: `state:${exercise.exerciseId}`,
        type: 'stagnation',
        priority: 'high',
        title: `${exercise.exerciseName}が停滞傾向です`,
        message: stagnationReasonLabel(exercise.stagnation),
        ...identity,
        supportingData: {
          reasonCode: exercise.stagnation.reasonCode,
          values: historyValues,
        },
      });
    } else if (
      recent &&
      (exercise.stagnation.status === 'progressing' ||
        exercise.progression.status === 'increase_load')
    ) {
      items.push({
        id: `state:${exercise.exerciseId}`,
        type: 'progressing',
        priority: 'low',
        title: `${exercise.exerciseName}は順調です`,
        message:
          exercise.progression.status === 'increase_load'
            ? '全working setで上限repを達成しています'
            : stagnationReasonLabel(exercise.stagnation),
        ...identity,
        supportingData: {
          reasonCode: exercise.stagnation.reasonCode,
          values: historyValues,
        },
      });
    }
    const target = exercise.currentAcceptedTarget;
    if (
      target?.status === 'accepted' &&
      !target.appliedWorkoutId &&
      target.validity === 'valid'
    ) {
      items.push({
        id: `target:${exercise.exerciseId}`,
        type: 'accepted_target',
        priority: 'medium',
        title: `${exercise.exerciseName}の次回目標`,
        message: `${kg(target.targetLoadGrams)} / ${target.targetRepMin}〜${target.targetRepMax}回 × ${target.targetWorkingSets}セット`,
        ...identity,
        supportingData: {
          values: [
            { label: 'targetId', value: target.id },
            { label: 'sourceWorkoutId', value: target.sourceWorkoutId },
            { label: 'sourceVersion', value: target.sourceWorkoutVersion },
            {
              label: 'targetLoad',
              value: target.targetLoadGrams,
              unit: 'grams',
            },
          ],
        },
      });
    } else {
      const stale =
        exercise.currentTargetForReview ??
        exercise.acceptedTargetHistory
          .filter(
            (t) =>
              t.status === 'accepted' &&
              !t.appliedWorkoutId &&
              t.validity === 'stale_source_version',
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (stale)
        items.push({
          id: `target:${exercise.exerciseId}`,
          type: 'target_review',
          priority: 'high',
          title: `${exercise.exerciseName}の次回目標は再確認が必要です`,
          message: '元の記録が変更されています。現在の評価を確認してください',
          ...identity,
          supportingData: {
            reasonCode: stale.validity,
            values: [
              { label: 'targetId', value: stale.id },
              { label: 'sourceWorkoutId', value: stale.sourceWorkoutId },
              {
                label: 'acceptedSourceVersion',
                value: stale.sourceWorkoutVersion,
              },
            ],
          },
        });
    }
    const records = exercise.personalRecordHistory
      .filter(
        (p) =>
          p.localDate >= recentStart && p.localDate <= analytics.period.endDate,
      )
      .sort((a, b) =>
        `${b.localDate}:${b.workoutId}`.localeCompare(
          `${a.localDate}:${a.workoutId}`,
        ),
      );
    const latest = records[0];
    if (latest) {
      const grouped = records.filter((p) => p.workoutId === latest.workoutId);
      const names = {
        weight: '重量',
        reps: 'rep',
        e1rm: 'e1RM',
        volume: 'Volume',
      };
      items.push({
        id: `pr:${exercise.exerciseId}`,
        type: 'recent_pr',
        priority: 'medium',
        title: `${exercise.exerciseName}でPRを更新しました`,
        message: `${[...new Set(grouped.map((p) => names[p.type]))].join('・')} PR（${latest.localDate}）`,
        ...identity,
        supportingData: {
          values: [
            ...grouped.map((p) => ({
              label: p.type,
              value: p.value,
              unit:
                p.type === 'reps'
                  ? 'reps'
                  : p.type === 'volume'
                    ? 'gram_reps'
                    : 'grams',
              date: p.localDate,
            })),
            {
              label: 'workoutId',
              value: latest.workoutId,
              date: latest.localDate,
            },
          ],
        },
      });
    }
  }
  const parts = analytics.bodyParts
    .filter(
      (p) =>
        p.bodyPart !== 'unknown' &&
        p.trainingDayCount >= INSIGHT_RULES.bodyPartMinDays &&
        p.workingSetCount > 0,
    )
    .sort(
      (a, b) =>
        b.workingSetCount - a.workingSetCount ||
        a.bodyPart.localeCompare(b.bodyPart),
    );
  const highest = parts[0],
    lowest = parts.at(-1);
  if (
    highest &&
    lowest &&
    highest !== lowest &&
    analytics.workouts.trainingDayCount >= 3 &&
    highest.workingSetCount >= INSIGHT_RULES.bodyPartMinMaxSets &&
    highest.workingSetCount - lowest.workingSetCount >=
      INSIGHT_RULES.bodyPartMinDifference &&
    highest.workingSetCount >=
      lowest.workingSetCount * INSIGHT_RULES.bodyPartRatio
  ) {
    items.push({
      id: 'body-part-balance',
      type: 'body_part_balance',
      priority: 'low',
      title: '部位ごとのセット数に差があります',
      message: `この期間は${highest.bodyPart}に比べて${lowest.bodyPart}のセット数が少なめです`,
      bodyParts: [lowest.bodyPart, highest.bodyPart],
      supportingData: {
        period: analytics.period,
        values: [lowest, highest].map((p) => ({
          label: p.bodyPart,
          value: p.workingSetCount,
          unit: 'sets',
        })),
      },
    });
  }
  if (
    comparison?.hasCoverage &&
    comparison.previousWorkoutCount >=
      INSIGHT_RULES.frequencyMinPreviousWorkouts &&
    comparison.previousTrainingDays >= INSIGHT_RULES.frequencyMinPreviousDays
  ) {
    const current = analytics.workouts.completedWorkoutCount,
      previous = comparison.previousWorkoutCount;
    const increase = current >= previous * INSIGHT_RULES.frequencyRatio;
    const decrease = current <= previous / INSIGHT_RULES.frequencyRatio;
    if (
      Math.abs(current - previous) >= INSIGHT_RULES.frequencyMinDifference &&
      (increase || decrease)
    )
      items.push({
        id: 'training-frequency',
        type: 'training_frequency',
        priority: 'low',
        title: `トレーニング回数が${increase ? '増えています' : '減っています'}`,
        message: `前の同期間 ${previous}回 → 今回 ${current}回。ご自身の履歴内での比較です`,
        supportingData: {
          period: analytics.period,
          values: [
            { label: 'previousStart', value: comparison.previousStart },
            { label: 'previousEnd', value: comparison.previousEnd },
            { label: 'previousWorkouts', value: previous, unit: 'workouts' },
            { label: 'currentWorkouts', value: current, unit: 'workouts' },
          ],
        },
      });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  const deduped = [
    ...new Map(items.map((item) => [item.id, item])).values(),
  ].sort(
    (a, b) => rank[a.priority] - rank[b.priority] || a.id.localeCompare(b.id),
  );
  return {
    status: deduped.length
      ? 'success'
      : analytics.workouts.workingSetCount === 0 ||
          analytics.exercises.every(
            (e) =>
              e.stagnation.validHistoryCount <
              e.stagnation.requiredHistoryCount,
          )
        ? 'insufficient_data'
        : 'no_insight',
    items: deduped,
  };
}
