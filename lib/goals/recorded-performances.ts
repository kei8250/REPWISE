import { loadAnalyticsDetail } from '@/lib/analytics/detail-cache';
import { readLocalWorkoutSources } from '@/lib/workouts/local-drafts';
import { effectiveLoadGrams, effectiveReps } from '@/lib/workouts/reps';
import type { RepTrendPoint } from '@/lib/analytics/model';
import type { LocalWorkoutDraft } from '@/lib/workouts/local-drafts';
import type { WorkoutMutation } from '@/lib/workouts/types';
export interface GoalAnalyticsData {
  exercises: Array<{
    exerciseId: string;
    repTrend: RepTrendPoint[];
    rmRepTrend?: RepTrendPoint[];
  }>;
  generatedAt?: string;
}
export function includeLocalRecordedPerformances(
  data: GoalAnalyticsData,
  drafts: LocalWorkoutDraft[],
  mutations: WorkoutMutation[],
): GoalAnalyticsData {
  const pending = new Set(mutations.map((m) => m.workoutId));
  const overlays = drafts.filter(
    (d) =>
      d.draftStatus === 'completed' &&
      d.workout.status === 'completed' &&
      !d.workout.deletedAt &&
      (pending.has(d.workoutId) ||
        d.serverUpdatedAt === null ||
        Date.parse(d.serverUpdatedAt) > Date.parse(data.generatedAt ?? '')),
  );
  const excluded = new Set([
    ...drafts
      .filter((d) => d.draftStatus === 'deleted' || d.workout.deletedAt)
      .map((d) => d.workoutId),
    ...overlays.map((d) => d.workoutId),
  ]);
  const exercises = new Map(
    data.exercises.map((e) => [
      e.exerciseId,
      {
        exerciseId: e.exerciseId,
        repTrend: e.repTrend.filter((p) => !excluded.has(p.workoutId)),
        rmRepTrend: e.rmRepTrend?.filter((p) => !excluded.has(p.workoutId)),
      },
    ]),
  );
  for (const draft of overlays)
    for (const exercise of draft.workout.exercises) {
      const points = exercise.sets
        .filter(
          (s) =>
            s.status === 'completed' &&
            (effectiveLoadGrams(s) ?? 0) > 0 &&
            (effectiveReps(s) ?? 0) > 0,
        )
        .map((s) => ({
          workoutId: draft.workoutId,
          localDate: draft.workout.localDate,
          loadGrams: effectiveLoadGrams(s)!,
          bestReps: effectiveReps(s)!,
        }));
      const previous = exercises.get(exercise.exerciseId) ?? {
        exerciseId: exercise.exerciseId,
        repTrend: [],
        rmRepTrend: [],
      };
      exercises.set(exercise.exerciseId, {
        ...previous,
        repTrend: [...previous.repTrend, ...points],
      });
    }
  return { generatedAt: data.generatedAt, exercises: [...exercises.values()] };
}
export async function loadGoalRecordedPerformances(
  force = false,
): Promise<GoalAnalyticsData> {
  const data = await loadAnalyticsDetail('all', force);
  const local = await readLocalWorkoutSources();
  return includeLocalRecordedPerformances(data, local.drafts, local.mutations);
}
