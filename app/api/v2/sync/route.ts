import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { applyWorkoutMutation } from '@/lib/workouts/server-store';
import { validateWorkoutMutation } from '@/lib/workouts/validation';

export async function POST(request: Request) {
  try {
    const mutation = validateWorkoutMutation(await request.json());
    return Response.json(await applyWorkoutMutation(getD1(), mutation));
  } catch (error) {
    return apiError(error);
  }
}
