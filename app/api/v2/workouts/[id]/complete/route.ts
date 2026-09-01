import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { completeWorkout } from '@/lib/workouts/server-store';

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try { return Response.json(await completeWorkout(getD1(), (await context.params).id)); }
  catch (error) { return apiError(error); }
}
