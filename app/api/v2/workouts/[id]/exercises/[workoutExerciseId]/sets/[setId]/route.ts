import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { deleteWorkoutSet, updateWorkoutSet } from '@/lib/workouts/server-store';

type Context = { params: Promise<{ id: string; workoutExerciseId: string; setId: string }> };

export async function PUT(request: Request, context: Context) {
  try { const { id, workoutExerciseId, setId } = await context.params; return Response.json(await updateWorkoutSet(getD1(), id, workoutExerciseId, setId, await request.json())); }
  catch (error) { return apiError(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try { const { id, workoutExerciseId, setId } = await context.params; return Response.json(await deleteWorkoutSet(getD1(), id, workoutExerciseId, setId)); }
  catch (error) { return apiError(error); }
}
