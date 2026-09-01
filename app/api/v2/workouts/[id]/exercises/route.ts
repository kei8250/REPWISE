import { getD1 } from '@/db';
import { apiError, jsonCreated } from '@/lib/workouts/api-route';
import { addWorkoutExercise } from '@/lib/workouts/server-store';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try { return jsonCreated(await addWorkoutExercise(getD1(), (await context.params).id, await request.json())); }
  catch (error) { return apiError(error); }
}
