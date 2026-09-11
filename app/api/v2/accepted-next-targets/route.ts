import { getD1 } from '@/db';
import { acceptNextTarget } from '@/lib/progression/accepted-next-target-store';
import { apiError, jsonCreated } from '@/lib/workouts/api-route';

export async function POST(request: Request) {
  try {
    const result = await acceptNextTarget(getD1(), await request.json());
    return result.duplicate ? Response.json(result) : jsonCreated(result);
  } catch (error) {
    return apiError(error);
  }
}
