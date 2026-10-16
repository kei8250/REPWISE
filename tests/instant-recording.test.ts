import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  createLocalWorkout,
  createWorkoutExercise,
} from '@/lib/workouts/draft';
import { normalizeRecordedWorkout } from '@/lib/workouts/instant-recording';
import {
  saveWorkoutDraftAndEnqueueMutation,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  acknowledgeWorkoutMutation,
  closeLocalDraftDatabase,
} from '@/lib/workouts/local-drafts';
import { includeLocalRecordedPerformances } from '@/lib/goals/recorded-performances';
const master = {
  id: 'squat',
  name: 'スクワット',
  normalizedName: 'squat',
  bodyPart: '脚',
  measurementType: 'weight_reps' as const,
  defaultRepMin: 3,
  defaultRepMax: 5,
  defaultWorkingSets: 1,
  defaultIncrementGrams: 2500,
  defaultRestSeconds: 90,
};
function record() {
  const value = createLocalWorkout({
    name: '記録',
    localDate: '2026-10-16',
    timezone: 'Asia/Tokyo',
  });
  value.exercises = [createWorkoutExercise(master, 0)];
  return value;
}
describe('automatic recording', () => {
  it('records valid inputs automatically while retaining partial fields and explicit skipped sets', () => {
    const value = record();
    value.exercises[0].sets[0].actualLoadGrams = 160000;
    const partial = normalizeRecordedWorkout(value);
    expect(partial.status).toBe('completed');
    expect(partial.exercises[0].sets[0]).toMatchObject({
      status: 'planned',
      actualLoadGrams: 160000,
      actualReps: null,
    });
    partial.exercises[0].sets[0].actualReps = 3;
    const done = normalizeRecordedWorkout(partial);
    expect(done.exercises[0].status).toBe('completed');
    expect(done.exercises[0].sets[0].status).toBe('completed');
    done.exercises[0].sets[0].status = 'skipped';
    expect(normalizeRecordedWorkout(done).exercises[0].sets[0].status).toBe(
      'skipped',
    );
  });
  it('requires both sides and supports zero-load bodyweight sets', () => {
    const value = record();
    value.exercises[0].repMode = 'per_side';
    value.exercises[0].sets[0] = {
      ...value.exercises[0].sets[0],
      actualLoadGrams: 0,
      actualRepsLeft: 8,
    };
    expect(normalizeRecordedWorkout(value).exercises[0].sets[0].status).toBe(
      'planned',
    );
    value.exercises[0].sets[0].actualRepsRight = 6;
    expect(normalizeRecordedWorkout(value).exercises[0].sets[0]).toMatchObject({
      status: 'completed',
      actualReps: 6,
    });
  });
  it('keeps create/edit ordering and acknowledgements as recorded data instead of unsaved edit drafts', async () => {
    const databaseName = 'instant-' + crypto.randomUUID();
    try {
      const value = normalizeRecordedWorkout(record());
      await saveWorkoutDraftAndEnqueueMutation(value, 'create', {
        databaseName,
        serverUpdatedAt: null,
      });
      value.exercises[0].sets[0].actualLoadGrams = 160000;
      value.exercises[0].sets[0].actualReps = 3;
      const filled = normalizeRecordedWorkout(value);
      await saveWorkoutDraftAndEnqueueMutation(filled, 'edit', {
        databaseName,
        autoRecord: true,
      });
      const queued = await listWorkoutMutations(value.id, databaseName);
      expect(queued.map((m) => m.operation)).toEqual(['create', 'edit']);
      expect(queued.map((m) => m.baseVersion)).toEqual([0, 1]);
      expect(
        (await getLocalWorkoutDraft(value.id, databaseName))?.draftStatus,
      ).toBe('completed');
      const local = await getLocalWorkoutDraft(value.id, databaseName);
      const merged = includeLocalRecordedPerformances(
        {
          exercises: [
            {
              exerciseId: 'squat',
              repTrend: [
                {
                  workoutId: value.id,
                  localDate: '2026-10-16',
                  loadGrams: 200000,
                  bestReps: 8,
                },
              ],
            },
          ],
          generatedAt: '2000-01-01T00:00:00Z',
        },
        [local!],
        queued,
      );
      expect(merged.exercises[0].repTrend).toHaveLength(1);
      expect(merged.exercises[0].repTrend[0]).toMatchObject({
        loadGrams: 160000,
        bestReps: 3,
      });
      await acknowledgeWorkoutMutation(
        queued[0],
        { ...value, version: 1 },
        databaseName,
      );
      await acknowledgeWorkoutMutation(
        queued[1],
        { ...filled, version: 2 },
        databaseName,
      );
      expect(
        (await getLocalWorkoutDraft(value.id, databaseName))?.draftStatus,
      ).toBe('completed');
      expect(
        (await getLocalWorkoutDraft(value.id, databaseName))?.editBaseline,
      ).toBeUndefined();
    } finally {
      await closeLocalDraftDatabase(databaseName);
    }
  });
});
