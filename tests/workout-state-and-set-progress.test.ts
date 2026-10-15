import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLocalWorkout,
  createSet,
  createWorkoutExercise,
  copyWorkoutForToday,
} from '@/lib/workouts/draft';
import {
  acknowledgeWorkoutMutation,
  cancelCompletedWorkoutEdit,
  closeLocalDraftDatabase,
  getLocalWorkoutDraft,
  listWorkoutMutations,
  LOCAL_DRAFT_DATABASE_NAME,
  markLocalWorkoutDraftCompleted,
  repairCompletedWorkoutDraft,
  saveCompletedWorkoutEditDraft,
  saveWorkoutDraftAndEnqueueMutation,
  selectWorkoutDetailForDisplay,
  workoutToSummary,
} from '@/lib/workouts/local-drafts';
import {
  prepareExerciseCompletion,
  prepareWorkoutCompletion,
} from '@/lib/workouts/completion';
import { referenceForSet } from '@/lib/workouts/history';
import {
  evaluateProgression,
  type ProgressionProfile,
} from '@/lib/progression/engine';
import {
  setAchievementLabel,
  compareWorkingSet,
} from '@/lib/progression/active-workout';
import { evaluatePersonalRecords } from '@/lib/progression/personal-records';
import { totalReps } from '@/lib/workouts/reps';
import { WorkoutExercise } from '@/components/workouts/workout-exercise';
import { SetProgressionProposals } from '@/components/workouts/set-progression-proposals';
import type { ExerciseMaster, Workout } from '@/lib/workouts/types';

const at = '2026-10-15T10:00:00Z';
const master: ExerciseMaster = {
  id: 'bench',
  name: 'テストベンチ',
  normalizedName: 'テストベンチ',
  bodyPart: '胸',
  measurementType: 'weight_reps',
  defaultRepMin: 8,
  defaultRepMax: 10,
  defaultWorkingSets: 3,
  defaultIncrementGrams: 2500,
  defaultRestSeconds: 90,
};
const profile: ProgressionProfile = {
  exerciseId: master.id,
  repMin: 8,
  repMax: 10,
  workingSets: 3,
  incrementGrams: 2500,
  progressionType: 'double_progression',
};
function fixture(): Workout {
  const workout = createLocalWorkout({
    name: '状態回帰テスト',
    localDate: '2026-10-15',
    timezone: 'Asia/Tokyo',
    startedAt: at,
  });
  const exercise = createWorkoutExercise(master, 0);
  exercise.sets = exercise.sets.map((set) => ({
    ...set,
    actualLoadGrams: 60000,
    actualReps: 10,
    status: 'completed',
    completedAt: at,
  }));
  return prepareWorkoutCompletion(
    {
      ...workout,
      rating: 5,
      overallNote: '編集前のメモ',
      exercises: [exercise],
    },
    at,
  );
}
function performance(workout = fixture()) {
  return {
    workoutId: workout.id,
    workoutVersion: workout.version,
    workoutLocalDate: workout.localDate,
    workoutUpdatedAt: workout.updatedAt,
    workoutStatus: workout.status,
    workoutDeletedAt: workout.deletedAt,
    workoutExerciseId: workout.exercises[0].id,
    exerciseId: master.id,
    exerciseStatus: workout.exercises[0].status,
    sets: workout.exercises[0].sets,
  };
}
beforeEach(async () => {
  await closeLocalDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LOCAL_DRAFT_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe('完了記録の編集キャンセル', () => {
  it('送信した編集のACK後は編集途中の判別値を残さない', async () => {
    const completed = fixture();
    await markLocalWorkoutDraftCompleted(completed);
    await saveCompletedWorkoutEditDraft(completed);
    const submitted = { ...completed, overallNote: '保存したメモ' };
    await saveWorkoutDraftAndEnqueueMutation(submitted, 'edit');
    await acknowledgeWorkoutMutation(
      (await listWorkoutMutations(completed.id))[0],
      { ...submitted, version: 2 },
    );
    expect(await getLocalWorkoutDraft(completed.id)).toMatchObject({
      draftStatus: 'completed',
      workout: { status: 'completed', overallNote: '保存したメモ', version: 2 },
    });
  });
  it('サーバーにまだactiveしかなくても、再起動後に編集前の完了状態へ戻し、完了の送信は保持する', async () => {
    const completed = fixture();
    const active = { ...completed, status: 'active' as const, endedAt: null };
    await saveWorkoutDraftAndEnqueueMutation(active, 'create');
    const create = (await listWorkoutMutations(active.id))[0];
    await acknowledgeWorkoutMutation(create, active);
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete');
    const queue = await listWorkoutMutations(completed.id);
    await saveCompletedWorkoutEditDraft(completed);
    await saveCompletedWorkoutEditDraft({
      ...completed,
      overallNote: '取り消す編集',
      rating: 1,
    });
    await closeLocalDraftDatabase();
    const restored = await cancelCompletedWorkoutEdit(completed.id, {
      serverWorkout: active,
    });
    expect(restored).toMatchObject({
      status: 'completed',
      endedAt: at,
      overallNote: '編集前のメモ',
      rating: 5,
    });
    expect((await getLocalWorkoutDraft(completed.id))?.draftStatus).toBe(
      'completed',
    );
    expect(await listWorkoutMutations(completed.id)).toEqual(queue);
    expect(
      selectWorkoutDetailForDisplay(
        active,
        await getLocalWorkoutDraft(completed.id),
        true,
      ).workout?.status,
    ).toBe('completed');
  });

  it('編集途中で完了ACKが届いても編集状態とキャンセル基準を保持する', async () => {
    const completed = fixture();
    await markLocalWorkoutDraftCompleted(completed);
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete');
    const mutation = (await listWorkoutMutations(completed.id))[0];
    await saveCompletedWorkoutEditDraft(completed);
    await saveCompletedWorkoutEditDraft({
      ...completed,
      overallNote: '保存前の編集',
    });
    await acknowledgeWorkoutMutation(mutation, { ...completed, version: 2 });
    const local = await getLocalWorkoutDraft(completed.id);
    expect(local).toMatchObject({
      draftStatus: 'completed_edit',
      workout: { overallNote: '保存前の編集' },
      editBaseline: { version: 2, status: 'completed' },
    });
    expect(await cancelCompletedWorkoutEdit(completed.id)).toMatchObject({
      status: 'completed',
      version: 2,
      overallNote: '編集前のメモ',
    });
  });

  it('送信キューに入れた編集はキャンセルで捨てず、完了状態を維持する', async () => {
    const completed = fixture();
    await markLocalWorkoutDraftCompleted(completed);
    await saveCompletedWorkoutEditDraft(completed);
    const submitted = { ...completed, overallNote: '送信済みの変更' };
    await saveWorkoutDraftAndEnqueueMutation(submitted, 'edit');
    const queue = await listWorkoutMutations(completed.id);
    expect(await cancelCompletedWorkoutEdit(completed.id)).toMatchObject({
      status: 'completed',
      overallNote: submitted.overallNote,
    });
    expect(await listWorkoutMutations(completed.id)).toEqual(queue);
  });

  it('過去の不整合キャッシュだけをサーバーの完了状態で修復する', async () => {
    const completed = fixture();
    // This reproduces the old cancellation path that persisted an active baseline.
    await markLocalWorkoutDraftCompleted({
      ...completed,
      status: 'active',
      endedAt: null,
    });
    expect(
      selectWorkoutDetailForDisplay(
        completed,
        await getLocalWorkoutDraft(completed.id),
      ).source,
    ).toBe('server');
    await repairCompletedWorkoutDraft(completed);
    expect(await getLocalWorkoutDraft(completed.id)).toMatchObject({
      draftStatus: 'completed',
      workout: { status: 'completed', endedAt: at },
    });
  });

  it('サーバーが未完了・完了送信待ちの不整合は、送信済みスナップショットから復元する', async () => {
    const completed = fixture();
    const active = { ...completed, status: 'active' as const, endedAt: null };
    await saveWorkoutDraftAndEnqueueMutation(completed, 'complete');
    const queue = await listWorkoutMutations(completed.id);
    await markLocalWorkoutDraftCompleted(active);
    expect(selectWorkoutDetailForDisplay(active, await getLocalWorkoutDraft(completed.id), true).workout).toBeNull();
    await repairCompletedWorkoutDraft(active);
    expect((await getLocalWorkoutDraft(completed.id))?.workout).toMatchObject({ status: 'completed', endedAt: at, overallNote: '編集前のメモ', rating: 5 });
    expect(await listWorkoutMutations(completed.id)).toEqual(queue);
  });

  it('修復時も未送信の変更や編集途中のデータは上書きしない', async () => {
    const completed = fixture();
    await markLocalWorkoutDraftCompleted({ ...completed, status: 'active' });
    await saveWorkoutDraftAndEnqueueMutation(
      { ...completed, overallNote: '未送信' },
      'edit',
    );
    await repairCompletedWorkoutDraft(completed);
    expect(
      (await getLocalWorkoutDraft(completed.id))?.workout.overallNote,
    ).toBe('未送信');
  });
});

describe('種目の完了と目標達成', () => {
  it('入力済みだけを完了し、目標だけのセットをスキップして次SET表示を消す', () => {
    const exercise = fixture().exercises[0];
    const blank = {
      ...createSet(2),
      targetLoadGrams: 60000,
      targetRepMin: 10,
      targetRepMax: 10,
      memo: '次回に回す',
    };
    const completed = prepareExerciseCompletion(
      {
        ...exercise,
        status: 'in_progress',
        sets: [...exercise.sets.slice(0, 2), blank],
      },
      at,
    );
    expect(completed.status).toBe('completed');
    expect(completed.sets[2]).toMatchObject({
      status: 'skipped',
      actualLoadGrams: null,
      actualReps: null,
      memo: '次回に回す',
    });
    const markup = renderToStaticMarkup(
      createElement(WorkoutExercise, {
        exercise: completed,
        workoutId: 'test',
        localDate: '2026-10-15',
        startedAt: at,
        isFirst: true,
        isLast: true,
        onChange: () => {},
        onDelete: () => {},
        onMove: () => {},
      }),
    );
    expect(markup).not.toContain('次に取り組む SET 3');
    expect(markup).toContain('未実施（スキップ）');
    expect(markup).toContain('この種目は完了しました');
  });
  it('部分入力のセットを黙ってスキップしない', () => {
    const exercise = fixture().exercises[0];
    expect(() =>
      prepareExerciseCompletion({
        ...exercise,
        sets: [{ ...createSet(0), actualLoadGrams: 62500 }],
      }),
    ).toThrow('重量と回数');
  });
  it('10〜10回に10回なら目標と上限を達成と表示する', () => {
    const set = {
      ...fixture().exercises[0].sets[0],
      targetLoadGrams: 60000,
      targetRepMin: 10,
      targetRepMax: 10,
    };
    expect(setAchievementLabel(set)).toBe('目標達成・上限10回を達成');
    expect(
      setAchievementLabel({ ...set, targetRepMin: 8, targetRepMax: 12 }),
    ).toBe('目標下限を達成・上限まであと2回');
    expect(setAchievementLabel({ ...set, actualLoadGrams: 57500 })).toBe(
      '目標下限まであと一歩',
    );
  });
});

describe('セットの役割と重量基準', () => {
  it('トップとバックオフを別々の目標範囲で判定し、一律重量へ丸めない', () => {
    const current = performance();
    current.sets = current.sets.map((set, index) => ({
      ...set,
      role: index === 0 ? 'top' : 'backoff',
      actualLoadGrams: index === 0 ? 62500 : 60000,
      actualReps: index === 0 ? 8 : index === 1 ? 10 : 12,
      targetRepMin: index === 0 ? 6 : 10,
      targetRepMax: index === 0 ? 8 : 12,
    }));
    const result = evaluateProgression(current, profile);
    expect(result.reasonCode).toBe('set_specific_progression');
    expect(
      result.setDecisions?.map((set) => [
        set.targetLoadGrams,
        set.targetRepMin,
        set.targetRepMax,
      ]),
    ).toEqual([
      [65000, 6, 8],
      [60000, 10, 12],
      [62500, 10, 12],
    ]);
    expect(result.nextTarget).toBeNull();
    const markup = renderToStaticMarkup(
      createElement(SetProgressionProposals, { items: result.setDecisions }),
    );
    expect(markup).toContain('トップ');
    expect(markup).toContain('バックオフ');
    expect(markup).toContain('フォーム');
    current.sets[2].status = 'skipped';
    const partial = evaluateProgression(current, profile);
    expect(partial.setDecisions).toHaveLength(2);
    expect(partial.evaluatedSetIds).toEqual(
      current.sets.slice(0, 2).map((set) => set.id),
    );
  });
  it('役割で参照するので、セット位置を変えても前回の別の役割を混ぜない', () => {
    const sets = fixture().exercises[0].sets;
    const top = { ...sets[0], role: 'top' as const, memo: '胸を張る' };
    const backoff = { ...sets[1], role: 'backoff' as const };
    const entry = {
      workoutId: 'past',
      workoutExerciseId: 'past-ex',
      workoutName: '過去',
      localDate: '2026-10-10',
      exerciseName: master.name,
      note: 'フォームのメモ',
      overallNote: '',
      sets: [top, backoff],
    };
    const currentTop = { ...top, id: 'current-top', position: 1 };
    expect(
      referenceForSet([entry], currentTop, [
        { ...backoff, position: 0 },
        currentTop,
      ])?.set.memo,
    ).toBe('胸を張る');
    expect(
      referenceForSet([entry], { ...currentTop, loadBasis: 'paired_total' }, [
        currentTop,
      ]),
    ).toBeNull();
  });
  it('左右合計40kgと片側20kgでボリューム・最大重量・e1RMを一致させる', () => {
    const set = {
      ...fixture().exercises[0].sets[0],
      actualLoadGrams: 40000,
      actualReps: 8,
      actualRepsLeft: 8,
      actualRepsRight: 10,
      loadBasis: 'paired_total' as const,
    };
    const perRep = {
      ...set,
      actualLoadGrams: 20000,
      loadBasis: 'per_rep' as const,
    };
    expect(set.actualLoadGrams * totalReps(set)).toBe(
      perRep.actualLoadGrams * totalReps(perRep),
    );
    const current = evaluatePersonalRecords(
      { workoutId: 'now', exerciseId: 'side', sets: [set] },
      [{ workoutId: 'past', exerciseId: 'side', sets: [perRep] }],
    );
    expect(current.achieved).toEqual({
      weight: false,
      reps: false,
      e1rm: false,
      volume: false,
    });
    expect(current.current.maxLoadGrams).toBe(20000);
    expect(current.current.totalVolumeGramReps).toBe(360000);
    expect(compareWorkingSet(set, perRep).status).toBe('unavailable');
  });
  it('新規セット・コピーでも重量基準と役割を保存し、実績はコピーしない', () => {
    const source = fixture();
    source.exercises[0].repMode = 'per_side';
    source.exercises[0].sets[0] = {
      ...source.exercises[0].sets[0],
      role: 'top',
      loadBasis: 'paired_total',
      actualRepsLeft: 9,
      actualRepsRight: 10,
    };
    expect(createSet(1, source.exercises[0].sets[0])).toMatchObject({
      role: 'top',
      loadBasis: 'paired_total',
      actualReps: null,
    });
    const copied = copyWorkoutForToday(source);
    expect(copied.exercises[0].sets[0]).toMatchObject({
      role: 'top',
      loadBasis: 'paired_total',
      actualLoadGrams: null,
      actualReps: null,
      actualRepsLeft: null,
      actualRepsRight: null,
    });
    expect(
      createWorkoutExercise(
        { ...master, repMode: 'per_side', loadBasis: 'paired_total' },
        0,
      ).sets[0].loadBasis,
    ).toBe('paired_total');
    expect(workoutToSummary(source).totalVolumeGrams).toBeGreaterThan(0);
  });
});
