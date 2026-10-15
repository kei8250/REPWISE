import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { getWorkout } from '@/lib/workouts/server-store';

// Distinguish missing from deleted without making normal detail routes expose deleted records.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ workout: await getWorkout(getD1(), id, true) }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) { return apiError(error); }
}
