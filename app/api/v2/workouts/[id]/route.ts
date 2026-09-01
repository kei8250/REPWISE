import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { getWorkout, replaceWorkout } from '@/lib/workouts/server-store';
import { validateWorkoutSnapshot, WorkoutNotFoundError } from '@/lib/workouts/validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const workout = await getWorkout(getD1(), id);
    if (!workout) throw new WorkoutNotFoundError('ワークアウトが見つかりません');
    return Response.json(workout);
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(await replaceWorkout(getD1(), validateWorkoutSnapshot(await request.json(), id)));
  } catch (error) { return apiError(error); }
}
