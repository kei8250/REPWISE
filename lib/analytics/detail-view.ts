import type {
  AnalyticsRange,
  AnalyticsSnapshot,
  ExerciseAnalytics,
  PersonalRecordHistoryEvent,
  PersonalRecordType,
} from './model';

export type AnalyticsTrendKind = 'e1rm' | 'max_weight' | 'volume';
export const ALL_BODY_PARTS = 'all';

export function normalizedBodyPart(bodyPart: string) {
  return bodyPart.trim() && bodyPart !== 'unknown' ? bodyPart.trim() : 'その他';
}

export function analyticsRangeFromSearch(search: string): AnalyticsRange {
  const value = new URLSearchParams(search).get('range');
  return value === '7d' || value === '90d' || value === 'all' ? value : '30d';
}

export function analyticsExerciseIdFromSearch(search: string) {
  const value = new URLSearchParams(search).get('exerciseId');
  return value?.trim() || null;
}

export function analyticsBodyParts(exercises: ExerciseAnalytics[]) {
  return [
    ...new Set(
      exercises.map((exercise) => normalizedBodyPart(exercise.bodyPart)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ja'));
}

export function filterAnalyticsExercises(
  exercises: ExerciseAnalytics[],
  bodyPart: string,
) {
  return bodyPart === ALL_BODY_PARTS
    ? exercises
    : exercises.filter(
        (exercise) => normalizedBodyPart(exercise.bodyPart) === bodyPart,
      );
}

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7日',
  '30d': '30日',
  '90d': '90日',
  all: '全期間',
};

export interface AnalyticsChartPoint {
  key: string;
  localDate: string;
  value: number;
}

function latestExerciseDate(exercise: ExerciseAnalytics) {
  const dates = [
    ...exercise.maxWeightTrend.map((point) => point.localDate),
    ...exercise.personalRecordHistory.map((record) => record.localDate),
    exercise.currentAcceptedTarget?.sourceLocalDate,
  ].filter((date): date is string => Boolean(date));
  return dates.sort().at(-1) ?? '';
}

export function sortExercisesByRecent(exercises: ExerciseAnalytics[]) {
  return [...exercises].sort((left, right) => {
    const byDate = latestExerciseDate(right).localeCompare(
      latestExerciseDate(left),
    );
    return byDate || left.exerciseName.localeCompare(right.exerciseName, 'ja');
  });
}

export function selectAnalyticsExercise(
  analytics: AnalyticsSnapshot,
  exerciseId: string | null,
) {
  const exercises = sortExercisesByRecent(analytics.exercises);
  return (
    exercises.find((exercise) => exercise.exerciseId === exerciseId) ??
    exercises[0] ??
    null
  );
}

export function getAnalyticsTrend(
  exercise: ExerciseAnalytics,
  kind: AnalyticsTrendKind,
): AnalyticsChartPoint[] {
  const trend =
    kind === 'e1rm'
      ? exercise.e1rmTrend
      : kind === 'max_weight'
        ? exercise.maxWeightTrend
        : exercise.volumeTrend;
  return trend.map((point) => ({
    key: point.workoutId,
    localDate: point.localDate,
    value: point.value,
  }));
}

export function formatKilograms(grams: number, fractionDigits = 1) {
  return `${new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: fractionDigits,
  }).format(grams / 1000)}kg`;
}

export function formatShortAnalyticsDate(localDate: string) {
  const [, month, day] = localDate.split('-').map(Number);
  return `${month}/${day}`;
}

export function personalRecordTypeLabel(type: PersonalRecordType) {
  if (type === 'weight') return '重量PR';
  if (type === 'reps') return 'Rep PR';
  if (type === 'e1rm') return 'e1RM PR';
  return 'Volume PR';
}

export function formatPersonalRecordValue(record: PersonalRecordHistoryEvent) {
  if (record.type === 'reps') {
    return `${formatKilograms(record.loadGrams ?? 0)} × ${record.value}回`;
  }
  return formatKilograms(record.value);
}

export function formatPreviousPersonalRecordValue(
  record: PersonalRecordHistoryEvent,
) {
  if (record.previousValue === null) return null;
  if (record.type === 'reps') return `${record.previousValue}回から更新`;
  return `${formatKilograms(record.previousValue)}から更新`;
}
