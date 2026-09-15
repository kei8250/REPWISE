import { getAnalyticsInput } from '@/lib/analytics/server-store';
import { buildAnalytics } from '@/lib/analytics/engine';
import { getWorkout, listWorkouts } from '@/lib/workouts/server-store';
import { buildCoachContext } from './context';
import type { CoachContext } from './model';

// Deliberately not exposed as an HTTP endpoint or imported by client UI.
// The future authenticated coach entrypoint supplies the server's DB binding.
export async function getCoachContext(
  db: D1Database,
  now = new Date(),
): Promise<CoachContext> {
  if (typeof window !== 'undefined')
    throw new Error('CoachContextService is server-only');
  const [input, active] = await Promise.all([
    getAnalyticsInput(db, '30d', now),
    listWorkouts(db, 'active', 1)
      .then(async (rows) => ({
        workout: rows[0] ? await getWorkout(db, rows[0].id) : null,
        unavailable: false,
      }))
      .catch(() => ({ workout: null, unavailable: true })),
  ]);
  return buildCoachContext(
    input,
    buildAnalytics(input),
    active.workout,
    active.unavailable,
  );
}
