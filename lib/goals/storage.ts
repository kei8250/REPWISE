import { validateGoal, type TrainingGoal } from './model';
export const GOALS_KEY = 'repwise-training-goals-v1';
export function parseGoals(raw: string | null): TrainingGoal[] {
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== 'object' ||
    !('version' in data) ||
    data.version !== 1 ||
    !('goals' in data) ||
    !Array.isArray(data.goals) ||
    data.goals.length > 500
  )
    throw new Error('目標ファイルの形式が正しくありません');
  const goals = data.goals.map((g) => validateGoal(g));
  if (new Set(goals.map((g) => g.id)).size !== goals.length)
    throw new Error('目標IDが重複しています');
  return goals;
}
export function serializeGoals(goals: TrainingGoal[]) {
  goals.forEach(validateGoal);
  return JSON.stringify({ version: 1, goals }, null, 2);
}
// Re-read before each mutation to preserve other tabs' goals. Same-goal conflicts are explicit.
export function saveGoal(
  goal: TrainingGoal,
  expectedUpdatedAt?: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
) {
  validateGoal(goal);
  const goals = parseGoals(storage.getItem(GOALS_KEY));
  const existing = goals.find((g) => g.id === goal.id);
  if (existing && existing.updatedAt !== expectedUpdatedAt)
    throw new Error(
      '別の画面で目標が更新されました。最新の内容を読み直してください',
    );
  if (!existing && expectedUpdatedAt)
    throw new Error('目標が見つかりません。読み直してください');
  if (
    goals.some(
      (g) =>
        g.id !== goal.id &&
        g.exerciseId === goal.exerciseId &&
        g.status !== 'archived' &&
        goal.status !== 'archived',
    )
  )
    throw new Error(
      'この種目には管理中の目標があります。既存の目標を編集するか終了してください',
    );
  const next = [...goals.filter((g) => g.id !== goal.id), goal];
  if (next.length > 500) throw new Error('目標は500件まで保存できます');
  storage.setItem(GOALS_KEY, serializeGoals(next));
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('repwise-goals-change'));
  return next;
}
export function mergeGoals(
  imported: TrainingGoal[],
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
) {
  const existing = parseGoals(storage.getItem(GOALS_KEY));
  const merged = new Map(existing.map((g) => [g.id, g]));
  for (const goal of imported) {
    if (merged.has(goal.id)) continue; // Never overwrite an existing goal on import.
    if (
      goal.status !== 'archived' &&
      [...merged.values()].some(
        (g) => g.exerciseId === goal.exerciseId && g.status !== 'archived',
      )
    )
      throw new Error(
        '同じ種目の管理中の目標があるため、読み込めません。既存目標を終了してから再試行してください',
      );
    merged.set(goal.id, goal);
  }
  if (merged.size > 500) throw new Error('目標は500件まで保存できます');
  const result = [...merged.values()];
  storage.setItem(GOALS_KEY, serializeGoals(result));
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('repwise-goals-change'));
  return result;
}
