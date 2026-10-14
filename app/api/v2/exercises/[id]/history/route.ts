import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { isLocalDate } from '@/lib/workouts/history';
import { getExerciseHistory } from '@/lib/workouts/history-server-store';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const beforeDate = query.get('beforeDate') ?? undefined;
    const offset = Number(query.get('offset') ?? 0);
    const beforeStartedAt = query.get('beforeStartedAt') ?? undefined;
    if (
      (beforeDate && !isLocalDate(beforeDate)) ||
      (beforeStartedAt &&
        (!beforeDate || Number.isNaN(Date.parse(beforeStartedAt)))) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      return Response.json(
        { error: '履歴の検索条件が正しくありません' },
        { status: 400 },
      );
    }
    return Response.json(
      await getExerciseHistory(getD1(), id, {
        beforeDate,
        beforeStartedAt,
        excludeWorkoutId: query.get('excludeWorkoutId') ?? undefined,
        offset,
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
