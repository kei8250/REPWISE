import { isLocalDate } from '@/lib/workouts/history';
import { getD1 } from '@/db';
import { apiError, jsonCreated } from '@/lib/workouts/api-route';
import { createWorkout, listWorkouts } from '@/lib/workouts/server-store';
import { validateCreateWorkoutInput } from '@/lib/workouts/validation';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const limitValue = Number(url.searchParams.get('limit') ?? 30);
    const limit = Number.isInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 30;
    if (status && !['draft', 'active', 'completed', 'abandoned'].includes(status)) return Response.json({ error: 'statusが正しくありません' }, { status: 400 });
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;
    const offset = Number(url.searchParams.get('offset') ?? 0);
    if ((from && !isLocalDate(from)) || (to && !isLocalDate(to)) ||
        (from && to && from > to) || !Number.isSafeInteger(offset) || offset < 0) {
      return Response.json({ error: '日付またはページの指定が正しくありません' }, { status: 400 });
    }
    return Response.json(await listWorkouts(getD1(), status, limit, { from, to, offset }));
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try { return jsonCreated(await createWorkout(getD1(), validateCreateWorkoutInput(await request.json()))); }
  catch (error) { return apiError(error); }
}
