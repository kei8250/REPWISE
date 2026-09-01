import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { deleteWorkoutExercise, updateWorkoutExercise } from '@/lib/workouts/server-store';

type Context = { params: Promise<{ id: string; workoutExerciseId: string }> };

export async function PUT(request: Request, context: Context) {
  try { const { id, workoutExerciseId } = await context.params; return Response.json(await updateWorkoutExercise(getD1(), id, workoutExerciseId, await request.json())); }
  catch (error) { return apiError(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try { const { id, workoutExerciseId } = await context.params; return Response.json(await deleteWorkoutExercise(getD1(), id, workoutExerciseId)); }
  catch (error) { return apiError(error); }
}
