import { describe, expect, it, vi } from 'vitest';
import { saveWorkout, WorkoutApiError } from '@/lib/workouts/api-client';
import { buildSnapshotReplacementPlan } from '@/lib/workouts/snapshot';
import type {
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/lib/workouts/types';
import { validateWorkoutSnapshot } from '@/lib/workouts/validation';

const timestamp = '2026-09-01T09:00:00.000Z';

function set(
  id: string,
  position: number,
  load: number,
  reps: number,
): WorkoutSet {
  return {
    id,
    position,
    status: 'completed',
    setType: 'working',
    targetLoadGrams: load + 2500,
    targetRepMin: reps,
    targetRepMax: reps + 2,
    actualLoadGrams: load,
    actualReps: reps,
    memo: `${id}のメモ`,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function exercise(
  id: string,
  position: number,
  setCount: number,
): WorkoutExercise {
  return {
    id,
    exerciseId: `master-${id}`,
    position,
    status: 'completed',
    exerciseNameSnapshot: `種目${position + 1}`,
    note: '',
    startedAt: timestamp,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    sets: Array.from({ length: setCount }, (_, index) =>
      set(
        `${id}-set-${index + 1}`,
        index,
        80_000 + position * 10_000,
        10 - index,
      ),
    ),
  };
}

function workout(): Workout {
  return {
    id: 'workout-1',
    name: '脚の日',
    status: 'active',
    localDate: '2026-09-01',
    timezone: 'Asia/Tokyo',
    startedAt: timestamp,
    endedAt: null,
    overallNote: '全体メモ',
    rating: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    exercises: [
      exercise('squat', 0, 3),
      exercise('rdl', 1, 2),
      exercise('leg-curl', 2, 3),
    ],
  };
}

describe('Phase 1A workout snapshot', () => {
  it('1ワークアウトに複数種目・複数セットを保持する', () => {
    const saved = validateWorkoutSnapshot(workout());
    expect(saved.exercises).toHaveLength(3);
    expect(saved.exercises.map((item) => item.sets.length)).toEqual([3, 2, 3]);
  });

  it('種目順とセット順をpositionで復元する', () => {
    const input = workout();
    input.exercises = [
      input.exercises[2],
      input.exercises[0],
      input.exercises[1],
    ];
    input.exercises[0].sets.reverse();
    const saved = validateWorkoutSnapshot(input);
    expect(saved.exercises.map((item) => item.exerciseNameSnapshot)).toEqual([
      '種目1',
      '種目2',
      '種目3',
    ]);
    expect(saved.exercises[2].sets.map((item) => item.position)).toEqual([
      0, 1, 2,
    ]);
  });

  it('targetとactualを別々の値として保持する', () => {
    const saved = validateWorkoutSnapshot(workout());
    const first = saved.exercises[0].sets[0];
    expect(first.targetLoadGrams).toBe(82_500);
    expect(first.actualLoadGrams).toBe(80_000);
    expect(first.targetRepMin).toBe(10);
    expect(first.targetRepMax).toBe(12);
    expect(first.actualReps).toBe(10);
  });

  it('削除したセットを置換後のスナップショットへ戻さない', () => {
    const existing = workout();
    const incoming = structuredClone(existing);
    const removed = incoming.exercises[0].sets.splice(1, 1)[0];
    incoming.exercises[0].sets = incoming.exercises[0].sets.map(
      (item, position) => ({ ...item, position }),
    );
    const plan = buildSnapshotReplacementPlan(existing, incoming);
    expect(plan.removedSetIds).toContain(removed.id);
    expect(plan.workout.exercises[0].sets.map((item) => item.id)).not.toContain(
      removed.id,
    );
  });
});

describe('API client', () => {
  it('APIエラーを成功データとして扱わない', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'DB保存に失敗しました' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(saveWorkout(workout(), fetcher)).rejects.toMatchObject({
      status: 500,
      message: 'DB保存に失敗しました',
    } satisfies Partial<WorkoutApiError>);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
