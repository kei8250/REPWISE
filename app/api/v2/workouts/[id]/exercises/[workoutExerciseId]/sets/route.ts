import { getD1 } from '@/db';
import { apiError, jsonCreated } from '@/lib/workouts/api-route';
import { addWorkoutSet } from '@/lib/workouts/server-store';

type Context = { params: Promise<{ id: string; workoutExerciseId: string }> };

export async function POST(request: Request, context: Context) {
  try { const { id, workoutExerciseId } = await context.params; return jsonCreated(await addWorkoutSet(getD1(), id, workoutExerciseId, await request.json())); }
  catch (error) { return apiError(error); }
}
