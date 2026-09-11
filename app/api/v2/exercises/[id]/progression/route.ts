import { getD1 } from '@/db';
import { getExerciseProgressionRecommendation } from '@/lib/progression/server-store';
import { apiError } from '@/lib/workouts/api-route';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      await getExerciseProgressionRecommendation(getD1(), id),
    );
  } catch (error) {
    return apiError(error);
  }
}
