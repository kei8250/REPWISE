import { getD1 } from '@/db';
import { apiError } from '@/lib/workouts/api-route';
import { applyWorkoutMutation, getWorkout } from '@/lib/workouts/server-store';
import type { WorkoutMutationInput } from '@/lib/workouts/types';
import {
  WorkoutConflictError,
  WorkoutNotFoundError,
  WorkoutValidationError,
} from '@/lib/workouts/validation';

const REVIEW_HOST = 'repwise-phase1a-review.keikei8250.chatgpt.site';

export async function POST(request: Request) {
  try {
    if (new URL(request.url).hostname !== REVIEW_HOST) {
      return new Response(null, { status: 404 });
    }
    const input = (await request.json()) as { workoutId?: unknown };
    const workoutId =
      typeof input.workoutId === 'string' ? input.workoutId.trim() : '';
    if (!workoutId || !/^[A-Za-z0-9_-]+$/.test(workoutId)) {
      throw new WorkoutValidationError([
        { path: 'workoutId', message: 'ワークアウトIDが正しくありません' },
      ]);
    }
    const db = getD1();
    const current = await getWorkout(db, workoutId);
    if (!current) throw new WorkoutNotFoundError();
    if (current.status !== 'active') {
      throw new WorkoutConflictError(
        '完了済みワークアウトは競合検証に使用できません',
      );
    }
    const marker = `[競合検証 server v${current.version + 1}]`;
    const mutation: WorkoutMutationInput = {
      mutationId: crypto.randomUUID(),
      entityType: 'workout',
      entityId: current.id,
      operation: 'replace',
      baseVersion: current.version,
      payload: {
        workout: {
          ...current,
          overallNote: current.overallNote
            ? `${current.overallNote}\n${marker}`
            : marker,
          updatedAt: new Date().toISOString(),
        },
      },
      createdAt: new Date().toISOString(),
    };
    const result = await applyWorkoutMutation(db, mutation);
    return Response.json({
      mutationId: result.mutationId,
      serverVersion: result.workout.version,
      marker,
    });
  } catch (error) {
    return apiError(error);
  }
}
