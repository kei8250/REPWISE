import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { updateExerciseMaster } from '@/lib/workouts/exercise-settings-store';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(
      await updateExerciseMaster(getD1(), id, await request.json()),
    );
  } catch (error) {
    return apiError(error);
  }
}
