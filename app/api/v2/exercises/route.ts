import { getD1 } from '@/db';
import { apiError, jsonCreated } from '@/lib/workouts/api-route';
import { createExerciseMaster, listExerciseMasters } from '@/lib/workouts/server-store';

export async function GET() {
  try { return Response.json(await listExerciseMasters(getD1())); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try { return jsonCreated(await createExerciseMaster(getD1(), await request.json())); }
  catch (error) { return apiError(error); }
}
