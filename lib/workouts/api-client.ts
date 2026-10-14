import type { ExerciseHistoryPage, WorkoutHistoryFilter } from './history';
import type {
  CreateExerciseMasterInput,
  UpdateExerciseMasterInput,
  CreateWorkoutInput,
  ExerciseMaster,
  Workout,
  WorkoutMutationInput,
  WorkoutMutationResult,
  WorkoutSummary,
  WorkoutVersionConflictDetails,
} from './types';
import type { ExerciseProgressionRecommendation } from '@/lib/progression/engine';
import type { WorkoutCompletionProgressionSummary } from '@/lib/progression/completion-summary';
import type {
  AcceptNextTargetInput,
  AcceptNextTargetResult,
} from '@/lib/progression/accepted-next-target';
import type { AnalyticsRange, AnalyticsSnapshot } from '@/lib/analytics/model';

export class WorkoutApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues: Array<{ path: string; message: string }> = [],
    public readonly code: string | null = null,
    public readonly conflict: WorkoutVersionConflictDetails | null = null,
  ) {
    super(message);
    this.name = 'WorkoutApiError';
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function request<T>(
  path: string,
  init: RequestInit = {},
  fetcher: FetchLike = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetcher(path, {
    ...init,
    headers,
  });
  const body = (await response.json().catch(() => null)) as
    | {
        error?: string;
        issues?: Array<{ path: string; message: string }>;
        code?: string;
        conflict?: WorkoutVersionConflictDetails;
      }
    | T
    | null;
  if (!response.ok) {
    const errorBody =
      body && typeof body === 'object'
        ? (body as {
            error?: string;
            issues?: Array<{ path: string; message: string }>;
            code?: string;
            conflict?: WorkoutVersionConflictDetails;
          })
        : null;
    throw new WorkoutApiError(
      response.status === 401 || response.status === 403
        ? `ログイン状態またはアクセス権を確認してください（${response.status}）。端末の記録は保持されています。`
        : errorBody?.error ?? `サーバーへの接続に失敗しました（${response.status}）`,
      response.status,
      errorBody?.issues ?? [],
      errorBody?.code ?? null,
      errorBody?.conflict ?? null,
    );
  }
  if (body === null)
    throw new WorkoutApiError('サーバーから正しい応答がありませんでした', 502);
  return body as T;
}

export function listExerciseMasters(fetcher?: FetchLike) {
  return request<ExerciseMaster[]>('/api/v2/exercises', {}, fetcher);
}

export function createExerciseMaster(
  input: CreateExerciseMasterInput,
  fetcher?: FetchLike,
) {
  return request<ExerciseMaster>(
    '/api/v2/exercises',
    { method: 'POST', body: JSON.stringify(input) },
    fetcher,
  );
}

export function getExerciseProgressionRecommendation(
  exerciseId: string,
  fetcher?: FetchLike,
) {
  return request<ExerciseProgressionRecommendation>(
    `/api/v2/exercises/${encodeURIComponent(exerciseId)}/progression`,
    {},
    fetcher,
  );
}

export function updateExerciseMaster(id: string, input: UpdateExerciseMasterInput, fetcher?: FetchLike) {
  return request<ExerciseMaster>(`/api/v2/exercises/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }, fetcher);
}

export function createWorkout(input: CreateWorkoutInput, fetcher?: FetchLike) {
  return request<Workout>(
    '/api/v2/workouts',
    { method: 'POST', body: JSON.stringify(input) },
    fetcher,
  );
}

export function listWorkouts(
  status?: Workout['status'],
  limit = 30,
  fetcher?: FetchLike,
  filter: WorkoutHistoryFilter = {},
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (status) query.set('status', status);
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  if (filter.offset) query.set('offset', String(filter.offset));
  return request<WorkoutSummary[]>(`/api/v2/workouts?${query}`, {}, fetcher);
}

export function getWorkout(id: string, fetcher?: FetchLike) {
  return request<Workout>(
    `/api/v2/workouts/${encodeURIComponent(id)}`,
    {},
    fetcher,
  );
}

export function getWorkoutCompletionProgressionSummary(
  id: string,
  fetcher?: FetchLike,
) {
  return request<WorkoutCompletionProgressionSummary>(
    `/api/v2/workouts/${encodeURIComponent(id)}/progression-summary`,
    {},
    fetcher,
  );
}

export function acceptWorkoutNextTarget(
  input: AcceptNextTargetInput,
  fetcher?: FetchLike,
) {
  return request<AcceptNextTargetResult>(
    '/api/v2/accepted-next-targets',
    { method: 'POST', body: JSON.stringify(input) },
    fetcher,
  );
}

export function getAnalytics(
  range: AnalyticsRange = '30d',
  fetcher?: FetchLike,
) {
  return request<AnalyticsSnapshot>(
    `/api/v2/analytics?range=${encodeURIComponent(range)}`,
    {},
    fetcher,
  );
}

export function saveWorkout(workout: Workout, fetcher?: FetchLike) {
  return request<Workout>(
    `/api/v2/workouts/${encodeURIComponent(workout.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(workout),
    },
    fetcher,
  );
}

export function finishWorkout(id: string, fetcher?: FetchLike) {
  return request<Workout>(
    `/api/v2/workouts/${encodeURIComponent(id)}/complete`,
    { method: 'POST' },
    fetcher,
  );
}

export function syncWorkoutMutation(
  mutation: WorkoutMutationInput,
  fetcher?: FetchLike,
) {
  return request<WorkoutMutationResult>(
    '/api/v2/sync',
    { method: 'POST', body: JSON.stringify(mutation) },
    fetcher,
  );
}

export function getExerciseHistory(
  exerciseId: string,
  options: { beforeDate?: string; beforeStartedAt?: string; excludeWorkoutId?: string; offset?: number } = {},
  fetcher?: FetchLike,
) {
  const query = new URLSearchParams();
  if (options.beforeDate) query.set('beforeDate', options.beforeDate);
  if (options.beforeStartedAt) query.set('beforeStartedAt', options.beforeStartedAt);
  if (options.excludeWorkoutId) query.set('excludeWorkoutId', options.excludeWorkoutId);
  if (options.offset) query.set('offset', String(options.offset));
  return request<ExerciseHistoryPage>(
    `/api/v2/exercises/${encodeURIComponent(exerciseId)}/history?${query}`,
    {},
    fetcher,
  );
}
