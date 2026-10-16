import {
  defaultRmMethod,
  estimateRm,
  equivalentRmLoad,
  type RmMethod,
} from './rm';
import type { ExerciseAnalytics, RepTrendPoint } from '@/lib/analytics/model';

export interface TrainingGoal {
  rmMethod?: RmMethod;
  id: string;
  exerciseId: string;
  exerciseName: string;
  bodyPart: string;
  startDate: string;
  deadline: string;
  startLoadGrams: number;
  targetLoadGrams: number;
  targetReps: number;
  incrementGrams: number;
  status: 'active' | 'paused' | 'archived';
  note: string;
  updatedAt: string;
}
const DAY = 86400000;
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function date(value: string) {
  return new Date(`${value}T00:00:00Z`);
}
export function addMonths(value: string, months: number) {
  const original = date(value);
  const next = new Date(
    Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + months + 1, 0),
  );
  next.setUTCDate(Math.min(original.getUTCDate(), next.getUTCDate()));
  return next.toISOString().slice(0, 10);
}
function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date(value).getTime()) &&
    date(value).toISOString().slice(0, 10) === value
  );
}
export function validateGoal(goal: TrainingGoal) {
  if (
    !goal ||
    typeof goal !== 'object' ||
    ![goal.id, goal.exerciseId, goal.exerciseName].every(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= 300,
    ) ||
    typeof goal.bodyPart !== 'string' ||
    typeof goal.updatedAt !== 'string'
  )
    throw new Error('種目を選択してください');
  if (
    !validDate(goal.startDate) ||
    !validDate(goal.deadline) ||
    goal.deadline <= goal.startDate ||
    date(goal.deadline).getTime() - date(goal.startDate).getTime() >
      DAY * 366 * 5
  )
    throw new Error('期限は開始日より後、5年以内で指定してください');
  if (
    ![
      goal.startLoadGrams,
      goal.targetLoadGrams,
      goal.incrementGrams,
      goal.targetReps,
    ].every(Number.isSafeInteger) ||
    goal.startLoadGrams < 0 ||
    goal.targetLoadGrams <= goal.startLoadGrams ||
    goal.targetLoadGrams > 2000000 ||
    goal.incrementGrams <= 0 ||
    goal.incrementGrams > 100000 ||
    goal.targetReps < 1 ||
    goal.targetReps > 100
  )
    throw new Error(
      '目標重量は開始重量より大きく2,000kg以下、回数は1〜100回、増量幅は0より大きく100kg以下で指定してください',
    );
  if (
    goal.rmMethod !== undefined &&
    goal.rmMethod !== 'bench' &&
    goal.rmMethod !== 'squat_deadlift'
  )
    throw new Error('RM換算方式が正しくありません');
  if (
    !['active', 'paused', 'archived'].includes(goal.status) ||
    typeof goal.note !== 'string' ||
    goal.note.length > 500
  )
    throw new Error('目標の状態またはメモが正しくありません');
  return goal;
}
export function bestGoalPerformance(
  points: RepTrendPoint[],
  reps: number,
  today: string,
  startDate?: string,
) {
  return (
    points
      .filter(
        (p) =>
          p.bestReps >= reps &&
          p.localDate <= today &&
          (!startDate || p.localDate >= startDate),
      )
      .sort(
        (a, b) =>
          b.loadGrams - a.loadGrams ||
          b.localDate.localeCompare(a.localDate) ||
          b.bestReps - a.bestReps,
      )
      .at(0) ?? null
  );
}
export function goalProgress(
  goal: TrainingGoal,
  points: RepTrendPoint[],
  today: string,
) {
  const method = goal.rmMethod ?? defaultRmMethod(goal.exerciseName);
  const targetRmGrams = estimateRm(
    goal.targetLoadGrams,
    goal.targetReps,
    method,
  );
  const candidates = points
    .filter((p) => p.localDate <= today)
    .map((point) => ({
      point,
      rm: estimateRm(point.loadGrams, point.bestReps, method),
    }))
    .filter(
      (item): item is { point: RepTrendPoint; rm: number } => item.rm !== null,
    )
    .sort(
      (a, b) =>
        b.rm - a.rm || b.point.localDate.localeCompare(a.point.localDate),
    );
  const best = candidates.at(0);
  const actual = best?.point ?? null;
  const currentRmGrams = best?.rm ?? null;
  const directActual = bestGoalPerformance(points, goal.targetReps, today);
  const current =
    currentRmGrams && targetRmGrams
      ? equivalentRmLoad(currentRmGrams, goal.targetReps, method)!
      : goal.startLoadGrams;
  const ratio =
    currentRmGrams && targetRmGrams ? currentRmGrams / targetRmGrams : null;
  const span = date(goal.deadline).getTime() - date(goal.startDate).getTime();
  const plannedAt = (at: string) => {
    const fraction = Math.max(
      0,
      Math.min(1, (date(at).getTime() - date(goal.startDate).getTime()) / span),
    );
    if (fraction === 0) return goal.startLoadGrams;
    return Math.min(
      goal.targetLoadGrams,
      goal.startLoadGrams +
        Math.ceil(
          ((goal.targetLoadGrams - goal.startLoadGrams) * fraction) /
            goal.incrementGrams,
        ) *
          goal.incrementGrams,
    );
  };
  const checkpoints: Array<{ date: string; loadGrams: number }> = [];
  const firstMonthEnd = new Date(
    Date.UTC(
      date(goal.startDate).getUTCFullYear(),
      date(goal.startDate).getUTCMonth() + 1,
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);
  for (let i = 0; i < 61; i++) {
    const month = addMonths(firstMonthEnd, i);
    const monthEnd = new Date(
      Date.UTC(date(month).getUTCFullYear(), date(month).getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);
    const at = monthEnd < goal.deadline ? monthEnd : goal.deadline;
    checkpoints.push({ date: at, loadGrams: plannedAt(at) });
    if (at === goal.deadline) break;
  }
  const milestone =
    checkpoints.find((p) => p.date >= today) ?? checkpoints.at(-1)!;
  return {
    actual,
    currentLoadGrams: current,
    method,
    targetReps: goal.targetReps,
    targetLoadGrams: goal.targetLoadGrams,
    currentRmGrams,
    targetRmGrams,
    directActual,
    percent: ratio === null ? null : Math.round(ratio * 1000) / 10,
    barPercent: ratio === null ? 0 : Math.min(100, Math.max(0, ratio * 100)),
    estimatedReached: ratio !== null && ratio >= 1,
    achieved: !!directActual && directActual.loadGrams >= goal.targetLoadGrams,
    overdue: today > goal.deadline,
    remainingGrams: Math.max(0, goal.targetLoadGrams - current),
    daysLeft: Math.max(
      0,
      Math.ceil((date(goal.deadline).getTime() - date(today).getTime()) / DAY),
    ),
    milestone,
    checkpoints,
    monthlyIncreaseGrams: Math.max(0, milestone.loadGrams - current),
    plannedTodayGrams: plannedAt(today),
  };
}

export function goalPerformancePoints(
  exercise: Pick<ExerciseAnalytics, 'repTrend' | 'rmRepTrend'> | undefined,
): RepTrendPoint[] {
  return exercise ? [...exercise.repTrend, ...(exercise.rmRepTrend ?? [])] : [];
}
