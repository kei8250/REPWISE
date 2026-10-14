import { isLocalDate } from '@/lib/workouts/history';
import { getD1 } from '@/db';
import { getExerciseProgressionRecommendation } from '@/lib/progression/server-store';
import { apiError } from '@/lib/workouts/api-route';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    const beforeDate = query.get('beforeDate') ?? undefined;
    const beforeStartedAt = query.get('beforeStartedAt') ?? undefined;
    const excludeWorkoutId = query.get('excludeWorkoutId') ?? undefined;
    if ((beforeDate && !isLocalDate(beforeDate)) || (beforeStartedAt && !Number.isFinite(Date.parse(beforeStartedAt)))) return Response.json({ error: '参考記録の日付が正しくありません' }, { status: 400 });
    return Response.json(
      await getExerciseProgressionRecommendation(getD1(), id, {}, { beforeDate, beforeStartedAt, excludeWorkoutId }),
    );
  } catch (error) {
    return apiError(error);
  }
}
