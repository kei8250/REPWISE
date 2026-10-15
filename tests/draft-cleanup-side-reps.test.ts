import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalWorkout,
  createSet,
  createWorkoutExercise,
} from '@/lib/workouts/draft';
import {
  closeLocalDraftDatabase,
  LOCAL_DRAFT_DATABASE_NAME,
  saveWorkoutDraftAndEnqueueMutation,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  acknowledgeWorkoutMutation,
  selectWorkoutForRestore,
  workoutToSummary,
} from '@/lib/workouts/local-drafts';
import {
  deleteActiveWorkout,
  restoreActiveWorkout,
} from '@/lib/workouts/draft-deletion';
import { mergeVisibleWorkouts } from '@/lib/workouts/visible-workouts';
import {
  effectiveReps,
  editTargetRange,
  repsLabel,
  totalReps,
} from '@/lib/workouts/reps';
import { validateWorkoutExercise } from '@/lib/workouts/validation';
import { prepareWorkoutCompletion } from '@/lib/workouts/completion';
import {
  evaluateProgression,
  type ProgressionExercisePerformance,
} from '@/lib/progression/engine';
import { WorkoutSetRow } from '@/components/workouts/workout-set-row';
import { ValidatedNumberInput } from '@/components/workouts/validated-number-input';
import type { ExerciseMaster } from '@/lib/workouts/types';

const master: ExerciseMaster = {
  id: 'side',
  name: 'ワンハンドロウ',
  normalizedName: 'ワンハンドロウ',
  bodyPart: '背中',
  measurementType: 'weight_reps',
  repMode: 'per_side',
  defaultRepMin: 8,
  defaultRepMax: 12,
  defaultWorkingSets: 1,
  defaultIncrementGrams: 1250,
  defaultRestSeconds: 90,
};
function fixture() {
  const workout = createLocalWorkout({
    name: '左右のテスト',
    localDate: '2026-10-15',
    timezone: 'Asia/Tokyo',
  });
  workout.exercises = [createWorkoutExercise(master, 0)];
  return workout;
}

beforeEach(async () => {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('draft cleanup', () => {
  it('未同期createの後へdeleteとrestoreをFIFOで追加し、先行ACKで復元状態を壊さない', async () => {
    const original = fixture();
    await saveWorkoutDraftAndEnqueueMutation(original, 'create');
    const deleted = await deleteActiveWorkout(original.id);
    expect(deleted).toMatchObject({
      status: 'active',
      endedAt: null,
      deletedAt: expect.any(String),
    });
    const restored = await restoreActiveWorkout(original.id);
    expect(restored.deletedAt).toBeNull();
    const queue = await listWorkoutMutations(original.id);
    expect(queue.map((item) => [item.operation, item.baseVersion])).toEqual([
      ['create', 0],
      ['delete', 1],
      ['restore', 2],
    ]);
    await acknowledgeWorkoutMutation(queue[0], { ...original, version: 1 });
    await acknowledgeWorkoutMutation(queue[1], { ...deleted, version: 2 });
    expect((await getLocalWorkoutDraft(original.id))?.draftStatus).toBe(
      'active',
    );
    await acknowledgeWorkoutMutation(queue[2], { ...restored, version: 3 });
    expect((await getLocalWorkoutDraft(original.id))?.draftStatus).toBe(
      'active',
    );
    expect(
      (await getLocalWorkoutDraft(original.id))?.workout.endedAt,
    ).toBeNull();
    expect(await listWorkoutMutations(original.id)).toEqual([]);
  });

  it('削除はサーバーの古いactive一覧と復元経路からも隠し、物理的に消さない', async () => {
    const original = fixture();
    await saveWorkoutDraftAndEnqueueMutation(original, 'create');
    await deleteActiveWorkout(original.id);
    const draft = (await getLocalWorkoutDraft(original.id))!;
    expect(
      mergeVisibleWorkouts(
        [workoutToSummary(original)],
        [{ ...draft, serverUpdatedAt: '2026-10-15T00:00:00Z' }],
        [],
        'active',
      ),
    ).toEqual([]);
    expect(selectWorkoutForRestore(original, draft, false).workout).toBeNull();
    expect(draft.workout.exercises[0].exerciseId).toBe(master.id);
    await expect(
      saveWorkoutDraftAndEnqueueMutation(original, 'replace'),
    ).rejects.toThrow();
  });

  it('完了済み記録を入力途中の削除操作で削除しない', async () => {
    const original = { ...fixture(), status: 'completed' as const };
    await saveWorkoutDraftAndEnqueueMutation(original, 'complete');
    await expect(deleteActiveWorkout(original.id)).rejects.toThrow('入力途中');
  });
});

describe('per-side reps and input validation', () => {
  it('入力方式をsnapshotに残し、片側だけでは完了せず、左右入力後は少ない側で判定する', () => {
    const workout = fixture();
    expect(workout.exercises[0].repMode).toBe('per_side');
    const set = workout.exercises[0].sets[0];
    set.actualLoadGrams = 20500;
    set.actualRepsRight = 12;
    expect(() => prepareWorkoutCompletion(workout)).toThrow('右と左');
    set.actualRepsLeft = 9;
    const completed = prepareWorkoutCompletion(workout);
    expect(completed.exercises[0].sets[0]).toMatchObject({
      actualReps: 9,
      actualRepsLeft: 9,
      actualRepsRight: 12,
    });
    const performance: ProgressionExercisePerformance = {
      workoutId: workout.id,
      workoutVersion: 1,
      workoutLocalDate: workout.localDate,
      workoutUpdatedAt: workout.updatedAt,
      workoutStatus: 'completed',
      workoutDeletedAt: null,
      workoutExerciseId: workout.exercises[0].id,
      exerciseId: master.id,
      exerciseStatus: 'completed',
      sets: [{ ...completed.exercises[0].sets[0], actualReps: 99 }],
    };
    expect(
      evaluateProgression(performance, {
        exerciseId: master.id,
        repMin: 8,
        repMax: 12,
        workingSets: 1,
        incrementGrams: 1250,
        progressionType: 'double_progression',
      }).status,
    ).toBe('keep_load');
    expect(totalReps(completed.exercises[0].sets[0])).toBe(21);
    expect(effectiveReps(completed.exercises[0].sets[0])).toBe(9);
    expect(repsLabel(completed.exercises[0].sets[0])).toBe('右 12 / 左 9 回');
  });

  it('左右別の不正値と片側欠けを保存前に検証し、通常種目のデータは従来通り読む', () => {
    const exercise = fixture().exercises[0];
    exercise.sets[0] = {
      ...exercise.sets[0],
      status: 'completed',
      actualLoadGrams: 20000,
      actualReps: 12,
      actualRepsRight: 12,
      actualRepsLeft: null,
    };
    expect(() => validateWorkoutExercise(exercise)).toThrow();
    exercise.sets[0].actualRepsLeft = 1.5;
    expect(() => validateWorkoutExercise(exercise)).toThrow();
    const standard = {
      ...exercise,
      repMode: undefined,
      sets: [{ ...createSet(0), actualLoadGrams: 20000, actualReps: 10 }],
    };
    expect(
      validateWorkoutExercise(standard).sets[0].actualRepsLeft,
    ).toBeUndefined();
  });

  it('セットを追加しても前セットの実績をコピーせず、目標だけを引き継ぐ', () => {
    const previous = {
      ...createSet(0),
      actualLoadGrams: 20000,
      actualReps: 9,
      actualRepsLeft: 9,
      actualRepsRight: 12,
      targetLoadGrams: 21000,
      targetRepMin: 8,
      targetRepMax: 12,
    };
    expect(createSet(1, previous)).toMatchObject({
      actualLoadGrams: null,
      actualReps: null,
      targetLoadGrams: 21000,
      targetRepMin: 8,
      targetRepMax: 12,
    });
    expect(createSet(1, previous).actualRepsLeft).toBeUndefined();
  });

  it('変更したrep境界を優先して相方を合わせ、実績に触れない', () => {
    const set = {
      ...createSet(0),
      targetRepMin: 8,
      targetRepMax: 12,
      actualReps: 10,
    };
    expect(editTargetRange(set, 'targetRepMin', 15)).toMatchObject({
      targetRepMin: 15,
      targetRepMax: 15,
      actualReps: 10,
    });
    expect(editTargetRange(set, 'targetRepMax', 6)).toMatchObject({
      targetRepMin: 6,
      targetRepMax: 6,
      actualReps: 10,
    });
  });

  it('左右の入力欄と不正な整数の案内を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(WorkoutSetRow, {
        set: createSet(0),
        number: 1,
        repMode: 'per_side',
        onChange: () => {},
        onDelete: () => {},
        canDelete: false,
        isFirst: true,
        isLast: true,
        onMove: () => {},
        comparison: { status: 'unavailable', label: null },
      }),
    );
    expect(html).toContain('セット1の右回数');
    expect(html).toContain('セット1の左回数');
    expect(html).toContain('左右共通');
    const invalid = renderToStaticMarkup(
      createElement(ValidatedNumberInput, {
        value: 1.5,
        min: 1,
        max: 999,
        onValueChange: () => {},
      }),
    );
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('整数で入力してください');
  });
});

it('同じ入力途中の削除を同時に要求してもdeleteを二重にキューへ入れない', async () => {
  const original = fixture();
  await saveWorkoutDraftAndEnqueueMutation(original, 'create');
  await Promise.allSettled([
    deleteActiveWorkout(original.id),
    deleteActiveWorkout(original.id),
  ]);
  expect(
    (await listWorkoutMutations(original.id)).filter(
      (item) => item.operation === 'delete',
    ),
  ).toHaveLength(1);
});
