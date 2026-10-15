import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkoutMutation,
  getWorkout,
  listWorkouts,
} from '@/lib/workouts/server-store';
import { copyWorkoutForToday } from '@/lib/workouts/draft';
import type {
  Workout,
  WorkoutExercise,
  WorkoutMutationInput,
  WorkoutSet,
} from '@/lib/workouts/types';

type SqlValue = null | number | bigint | string | Uint8Array;

class TestStatement {
  private values: SqlValue[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.statement.get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return {
      success: true,
      results: this.statement.all(...this.values) as T[],
      meta: { changes: 0 },
    };
  }

  async run() {
    const result = this.statement.run(...this.values);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes) },
    };
  }

  async executeForBatch() {
    return this.statement.sourceSQL
      .trimStart()
      .toUpperCase()
      .startsWith('SELECT')
      ? this.all()
      : this.run();
  }
}

class TestD1 {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string) {
    return new TestStatement(this.sqlite.prepare(query));
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) {
        results.push(
          await (statement as unknown as TestStatement).executeForBatch(),
        );
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

const timestamp = '2026-09-02T11:00:00.000Z';

function set(id: string, position: number): WorkoutSet {
  return {
    id,
    position,
    status: 'completed',
    setType: 'working',
    targetLoadGrams: 62_500,
    targetRepMin: 8,
    targetRepMax: 10,
    actualLoadGrams: 60_000,
    actualReps: 9,
    memo: id,
    completedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function exercise(
  id: string,
  exerciseId: string,
  name: string,
  position: number,
): WorkoutExercise {
  return {
    id,
    exerciseId,
    position,
    status: 'in_progress',
    exerciseNameSnapshot: name,
    note: '',
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    sets: [set(`${id}-set-1`, 0), set(`${id}-set-2`, 1)],
  };
}

function workout(): Workout {
  return {
    id: 'idempotent-workout',
    name: '冪等性テスト',
    status: 'active',
    localDate: '2026-09-02',
    timezone: 'Asia/Tokyo',
    startedAt: timestamp,
    endedAt: null,
    overallNote: '',
    rating: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    sourceWorkoutId: null,
    exercises: [exercise('we-bench', 'ex-bench-press', 'ベンチプレス', 0)],
  };
}

function mutation(
  mutationId: string,
  operation: WorkoutMutationInput['operation'],
  snapshot: Workout,
  baseVersion = operation === 'create' ? 0 : snapshot.version,
): WorkoutMutationInput {
  return {
    mutationId,
    entityType: 'workout',
    entityId: snapshot.id,
    operation,
    baseVersion,
    payload: { workout: snapshot },
    createdAt: timestamp,
  };
}

async function createCompletedWorkout(prefix: string) {
  const created = await applyWorkoutMutation(
    d1,
    mutation(`${prefix}-create`, 'create', workout()),
  );
  const completing = structuredClone(created.workout);
  completing.status = 'completed';
  completing.endedAt = timestamp;
  return applyWorkoutMutation(
    d1,
    mutation(
      `${prefix}-complete`,
      'complete',
      completing,
      created.workout.version,
    ),
  );
}

async function legacyFingerprint(input: WorkoutMutationInput) {
  const workout = { ...input.payload.workout };
  delete (workout as { deletedAt?: string | null }).deletedAt;
  delete (workout as { sourceWorkoutId?: string | null }).sourceWorkoutId;
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payload: { workout },
    }),
  );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

let sqlite: DatabaseSync;
let d1: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    '0000_public_franklin_richards.sql',
    '0001_gray_magma.sql',
    '0002_chilly_wallop.sql',
    '0003_jazzy_karnak.sql',
    '0004_grey_kinsey_walden.sql',
    '0005_neat_molly_hayes.sql',
    '0006_side_repetitions.sql',
    '0007_set_roles_and_load_basis.sql',
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
    );
  }
  d1 = new TestD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe('Phase 1B-1b server idempotency', () => {
  it('同じcreate mutationを複数回受けてもworkout・種目・セットを重複作成しない', async () => {
    const input = mutation('mutation-create', 'create', workout());
    const first = await applyWorkoutMutation(d1, input);
    const duplicate = await applyWorkoutMutation(d1, input);

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout').get(),
    ).toMatchObject({ count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_exercise').get(),
    ).toMatchObject({ count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_set').get(),
    ).toMatchObject({ count: 2 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM processed_mutation').get(),
    ).toMatchObject({ count: 1 });
  });

  it('種目追加・セット追加のreplace再送でも二重登録しない', async () => {
    const initial = workout();
    await applyWorkoutMutation(
      d1,
      mutation('mutation-create', 'create', initial),
    );
    const changed = structuredClone(initial);
    changed.exercises[0].sets.push(set('we-bench-set-3', 2));
    changed.exercises.push(
      exercise('we-row', 'ex-seated-row', 'シーテッドロー', 1),
    );
    const replacement = mutation('mutation-replace', 'replace', changed);

    await applyWorkoutMutation(d1, replacement);
    const duplicate = await applyWorkoutMutation(d1, replacement);
    expect(duplicate.duplicate).toBe(true);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_exercise').get(),
    ).toMatchObject({ count: 2 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_set').get(),
    ).toMatchObject({ count: 5 });
  });

  it('バッチ途中で制約違反が起きても変更とmutation記録を部分適用しない', async () => {
    const initial = workout();
    await applyWorkoutMutation(
      d1,
      mutation('mutation-create', 'create', initial),
    );
    const broken = structuredClone(initial);
    const added = exercise('we-row', 'ex-seated-row', 'シーテッドロー', 1);
    added.sets[0].id = broken.exercises[0].sets[0].id;
    broken.exercises.push(added);

    await expect(
      applyWorkoutMutation(
        d1,
        mutation('mutation-partial-failure', 'replace', broken),
      ),
    ).rejects.toThrow();
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_exercise').get(),
    ).toMatchObject({ count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_set').get(),
    ).toMatchObject({ count: 2 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM processed_mutation WHERE mutation_id = 'mutation-partial-failure'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });
});

describe('Phase 1B-1c workout versions', () => {
  it('正しいbase versionだけを適用してserver versionを1ずつ進める', async () => {
    const created = await applyWorkoutMutation(
      d1,
      mutation('version-create', 'create', workout()),
    );
    const changed = structuredClone(created.workout);
    changed.overallNote = 'version 2の内容';
    const replaced = await applyWorkoutMutation(
      d1,
      mutation('version-replace', 'replace', changed, created.workout.version),
    );

    expect(created.workout.version).toBe(1);
    expect(replaced.workout.version).toBe(2);
    expect(
      sqlite
        .prepare(
          "SELECT base_version FROM processed_mutation WHERE mutation_id = 'version-replace'",
        )
        .get(),
    ).toMatchObject({ base_version: 1 });
  });

  it('処理済みmutationはserver versionが進んだ後もversion競合より先に冪等応答する', async () => {
    const created = await applyWorkoutMutation(
      d1,
      mutation('priority-create', 'create', workout()),
    );
    const second = structuredClone(created.workout);
    second.overallNote = 'version 2';
    const secondMutation = mutation(
      'priority-second',
      'replace',
      second,
      created.workout.version,
    );
    const secondResult = await applyWorkoutMutation(d1, secondMutation);
    const third = structuredClone(secondResult.workout);
    third.overallNote = 'version 3';
    await applyWorkoutMutation(
      d1,
      mutation(
        'priority-third',
        'replace',
        third,
        secondResult.workout.version,
      ),
    );

    const replay = await applyWorkoutMutation(d1, secondMutation);
    expect(replay).toMatchObject({ duplicate: true });
    expect(replay.workout.version).toBe(2);
    expect(
      sqlite
        .prepare(
          "SELECT version, overall_note FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({ version: 3, overall_note: 'version 3' });
  });

  it('Phase 1B-1bで処理済みの旧fingerprintもversion判定より先に冪等応答する', async () => {
    const created = await applyWorkoutMutation(
      d1,
      mutation('legacy-create', 'create', workout()),
    );
    const second = structuredClone(created.workout);
    second.overallNote = '旧クライアントで保存';
    const legacyMutation = mutation('legacy-replace', 'replace', second, 1);
    const secondResult = await applyWorkoutMutation(d1, legacyMutation);
    sqlite
      .prepare(
        `UPDATE processed_mutation
         SET base_version = 0, request_fingerprint = ?
         WHERE mutation_id = 'legacy-replace'`,
      )
      .run(await legacyFingerprint(legacyMutation));
    const third = structuredClone(secondResult.workout);
    third.overallNote = 'server version 3';
    await applyWorkoutMutation(
      d1,
      mutation('legacy-third', 'replace', third, 2),
    );

    const replay = await applyWorkoutMutation(d1, legacyMutation);
    expect(replay).toMatchObject({ duplicate: true });
    expect(replay.workout.version).toBe(2);
    expect(
      sqlite
        .prepare(
          "SELECT version, overall_note FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({ version: 3, overall_note: 'server version 3' });
  });

  it('古いbase versionを409相当の競合として拒否しserverを上書きしない', async () => {
    const initial = workout();
    const created = await applyWorkoutMutation(
      d1,
      mutation('conflict-create', 'create', initial),
    );
    const remote = structuredClone(created.workout);
    remote.overallNote = 'サーバー側の新しい変更';
    await applyWorkoutMutation(
      d1,
      mutation('conflict-remote', 'replace', remote, 1),
    );
    const stale = structuredClone(created.workout);
    stale.overallNote = '古い端末からの上書き';

    await expect(
      applyWorkoutMutation(d1, mutation('conflict-stale', 'replace', stale, 1)),
    ).rejects.toMatchObject({
      name: 'WorkoutVersionConflictError',
      code: 'WORKOUT_VERSION_CONFLICT',
      conflict: { type: 'stale', baseVersion: 1, serverVersion: 2 },
    });
    expect(
      sqlite
        .prepare(
          "SELECT version, overall_note FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({ version: 2, overall_note: 'サーバー側の新しい変更' });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM processed_mutation WHERE mutation_id = 'conflict-stale'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it('serverより進んだbase versionを通常競合と区別して拒否する', async () => {
    await applyWorkoutMutation(
      d1,
      mutation('ahead-create', 'create', workout()),
    );
    await expect(
      applyWorkoutMutation(
        d1,
        mutation('ahead-replace', 'replace', workout(), 2),
      ),
    ).rejects.toMatchObject({
      name: 'WorkoutVersionAheadError',
      code: 'WORKOUT_VERSION_AHEAD',
      conflict: { type: 'ahead', baseVersion: 2, serverVersion: 1 },
    });
  });

  it('古いbase versionからのcompleteでserverを完了・上書きしない', async () => {
    const created = await applyWorkoutMutation(
      d1,
      mutation('complete-conflict-create', 'create', workout()),
    );
    const remote = structuredClone(created.workout);
    remote.overallNote = '完了前のサーバー更新';
    await applyWorkoutMutation(
      d1,
      mutation('complete-conflict-remote', 'replace', remote, 1),
    );
    const staleComplete = structuredClone(created.workout);
    staleComplete.status = 'completed';
    staleComplete.endedAt = timestamp;
    staleComplete.overallNote = '古い完了内容';

    await expect(
      applyWorkoutMutation(
        d1,
        mutation('complete-conflict-stale', 'complete', staleComplete, 1),
      ),
    ).rejects.toMatchObject({
      code: 'WORKOUT_VERSION_CONFLICT',
      conflict: { type: 'stale', baseVersion: 1, serverVersion: 2 },
    });
    expect(
      sqlite
        .prepare(
          "SELECT status, version, overall_note FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({
      status: 'active',
      version: 2,
      overall_note: '完了前のサーバー更新',
    });
  });
});

describe('Phase 1B-2a completed workout changes', () => {
  it('完了済みワークアウトの項目・種目・セットを編集しversionを進める', async () => {
    const completed = await createCompletedWorkout('edit');
    const changed = structuredClone(completed.workout);
    changed.name = '編集後の脚トレ';
    changed.localDate = '2026-09-03';
    changed.overallNote = '編集後の全体メモ';
    changed.rating = 5;
    const editedSet = changed.exercises[0].sets[0];
    editedSet.position = 1;
    editedSet.actualLoadGrams = 70_000;
    editedSet.actualReps = 8;
    editedSet.memo = '編集したセットメモ';
    changed.exercises[0].sets = [set('we-bench-set-new', 0), editedSet];
    changed.exercises.push(
      exercise('we-row', 'ex-seated-row', 'シーテッドロー', 1),
    );

    const edited = await applyWorkoutMutation(
      d1,
      mutation('edit-completed', 'edit', changed, completed.workout.version),
    );

    expect(edited.workout).toMatchObject({
      name: '編集後の脚トレ',
      localDate: '2026-09-03',
      overallNote: '編集後の全体メモ',
      rating: 5,
      version: 3,
      deletedAt: null,
    });
    expect(edited.workout.exercises).toHaveLength(2);
    expect(edited.workout.exercises[0].sets.map((item) => item.id)).toEqual([
      'we-bench-set-new',
      'we-bench-set-1',
    ]);
    expect(edited.workout.exercises[0].sets[1]).toMatchObject({
      actualLoadGrams: 70_000,
      actualReps: 8,
      memo: '編集したセットメモ',
    });
  });

  it('同じ編集mutationの再送を二重適用しない', async () => {
    const completed = await createCompletedWorkout('edit-replay');
    const changed = structuredClone(completed.workout);
    changed.overallNote = '一度だけ適用';
    const input = mutation(
      'edit-replay-mutation',
      'edit',
      changed,
      completed.workout.version,
    );

    const first = await applyWorkoutMutation(d1, input);
    const replay = await applyWorkoutMutation(d1, input);

    expect(first).toMatchObject({ duplicate: false, workout: { version: 3 } });
    expect(replay).toMatchObject({ duplicate: true, workout: { version: 3 } });
    expect(
      sqlite
        .prepare("SELECT version FROM workout WHERE id = 'idempotent-workout'")
        .get(),
    ).toMatchObject({ version: 3 });
  });

  it('stale versionの完了済み編集を拒否してサーバー内容を保持する', async () => {
    const completed = await createCompletedWorkout('edit-stale');
    const remote = structuredClone(completed.workout);
    remote.overallNote = 'サーバー側の編集';
    await applyWorkoutMutation(
      d1,
      mutation('edit-stale-remote', 'edit', remote, 2),
    );
    const stale = structuredClone(completed.workout);
    stale.overallNote = '古いローカル編集';

    await expect(
      applyWorkoutMutation(d1, mutation('edit-stale-local', 'edit', stale, 2)),
    ).rejects.toMatchObject({
      code: 'WORKOUT_VERSION_CONFLICT',
      conflict: { type: 'stale', baseVersion: 2, serverVersion: 3 },
    });
    expect(
      sqlite
        .prepare(
          "SELECT version, overall_note FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({ version: 3, overall_note: 'サーバー側の編集' });
  });

  it('soft deleteで通常取得・履歴から除外し、再送で二重削除しない', async () => {
    const completed = await createCompletedWorkout('delete');
    const deleting = mutation(
      'delete-completed',
      'delete',
      completed.workout,
      completed.workout.version,
    );
    const first = await applyWorkoutMutation(d1, deleting);
    const replay = await applyWorkoutMutation(d1, deleting);

    expect(first.workout).toMatchObject({ version: 3 });
    expect(first.workout.deletedAt).not.toBeNull();
    expect(replay).toMatchObject({ duplicate: true, workout: { version: 3 } });
    expect(await getWorkout(d1, completed.workout.id)).toBeNull();
    expect(await listWorkouts(d1, 'completed')).toEqual([]);
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_exercise').get(),
    ).toMatchObject({ count: 1 });
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout_set').get(),
    ).toMatchObject({ count: 2 });
    expect(
      sqlite
        .prepare(
          "SELECT version, deleted_at FROM workout WHERE id = 'idempotent-workout'",
        )
        .get(),
    ).toMatchObject({ version: 3 });
  });

  it('restoreもmutation/version管理し、履歴へ戻す', async () => {
    const completed = await createCompletedWorkout('restore');
    const deleted = await applyWorkoutMutation(
      d1,
      mutation('restore-delete', 'delete', completed.workout, 2),
    );
    const restored = await applyWorkoutMutation(
      d1,
      mutation('restore-workout', 'restore', deleted.workout, 3),
    );

    expect(restored.workout).toMatchObject({ version: 4, deletedAt: null });
    expect(await getWorkout(d1, completed.workout.id)).not.toBeNull();
    expect(await listWorkouts(d1, 'completed')).toHaveLength(1);
  });

  it('stale versionの削除を競合として拒否し、勝手に削除しない', async () => {
    const completed = await createCompletedWorkout('delete-stale');
    const remote = structuredClone(completed.workout);
    remote.overallNote = '削除前のサーバー変更';
    await applyWorkoutMutation(
      d1,
      mutation('delete-stale-remote', 'edit', remote, 2),
    );

    await expect(
      applyWorkoutMutation(
        d1,
        mutation('delete-stale-local', 'delete', completed.workout, 2),
      ),
    ).rejects.toMatchObject({
      code: 'WORKOUT_VERSION_CONFLICT',
      conflict: { type: 'stale', baseVersion: 2, serverVersion: 3 },
    });
    expect(await getWorkout(d1, completed.workout.id)).toMatchObject({
      version: 3,
      deletedAt: null,
      overallNote: '削除前のサーバー変更',
    });
  });
});

describe('Phase 1B-2b copied workout persistence', () => {
  it('完了済みworkoutから別IDの新規workoutを冪等に作成し、元を変更しない', async () => {
    const source = await createCompletedWorkout('copy-source');
    const copied = copyWorkoutForToday(source.workout, {
      timestamp: '2026-09-04T08:30:00.000Z',
      localDate: '2026-09-04',
      timezone: 'Asia/Tokyo',
      idFactory: (() => {
        let value = 0;
        return () => `copied-id-${value++}`;
      })(),
    });
    const input = mutation('copy-create-mutation', 'create', copied, 0);

    const first = await applyWorkoutMutation(d1, input);
    const replay = await applyWorkoutMutation(d1, input);

    expect(first).toMatchObject({
      duplicate: false,
      workout: {
        id: 'copied-id-0',
        sourceWorkoutId: source.workout.id,
        status: 'active',
      },
    });
    expect(replay).toMatchObject({
      duplicate: true,
      workout: { id: 'copied-id-0', version: 1 },
    });
    const changedCopy = structuredClone(first.workout);
    changedCopy.name = 'コピー後に変更';
    changedCopy.exercises[0].sets[0].actualLoadGrams = 85_000;
    changedCopy.exercises[0].sets[0].actualReps = 8;
    await applyWorkoutMutation(
      d1,
      mutation('copy-change-mutation', 'replace', changedCopy, 1),
    );
    expect(
      sqlite.prepare('SELECT COUNT(*) AS count FROM workout').get(),
    ).toMatchObject({ count: 2 });
    expect(
      sqlite
        .prepare('SELECT version, deleted_at FROM workout WHERE id = ?')
        .get(source.workout.id),
    ).toMatchObject({ version: 2, deleted_at: null });
    expect(await getWorkout(d1, source.workout.id)).toMatchObject({
      name: '冪等性テスト',
      version: 2,
    });
    expect(
      sqlite
        .prepare('SELECT source_workout_id FROM workout WHERE id = ?')
        .get(copied.id),
    ).toMatchObject({ source_workout_id: source.workout.id });
  });

  it('soft deleted workoutをコピー元にしたcreateを拒否する', async () => {
    const source = await createCompletedWorkout('copy-deleted-source');
    await applyWorkoutMutation(
      d1,
      mutation('copy-source-delete', 'delete', source.workout, 2),
    );
    const copied = workout();
    copied.id = 'copy-from-deleted';
    copied.sourceWorkoutId = source.workout.id;

    await expect(
      applyWorkoutMutation(
        d1,
        mutation('copy-from-deleted-create', 'create', copied, 0),
      ),
    ).rejects.toThrow('コピー元');
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS count FROM workout WHERE id = ?')
        .get(copied.id),
    ).toMatchObject({ count: 0 });
  });
});

describe('active draft deletion and per-side persistence', () => {
  it('activeを完了扱いにせず削除・再送・復元でき、終了時刻と子の記録を維持する', async () => {
    const created = await applyWorkoutMutation(d1, mutation('draft-create', 'create', workout()));
    const request = mutation('draft-delete', 'delete', { ...created.workout, deletedAt: timestamp });
    const deleted = await applyWorkoutMutation(d1, request);
    expect(deleted.workout).toMatchObject({ status: 'active', endedAt: null, version: 2, deletedAt: expect.any(String) });
    expect(await getWorkout(d1, workout().id)).toBeNull();
    expect(await listWorkouts(d1, 'active')).toEqual([]);
    expect((await applyWorkoutMutation(d1, request)).duplicate).toBe(true);
    const restored = await applyWorkoutMutation(d1, mutation('draft-restore', 'restore', { ...deleted.workout, deletedAt: null }));
    expect(restored.workout).toMatchObject({ status: 'active', endedAt: null, version: 3, deletedAt: null });
    expect(restored.workout.exercises[0].sets).toHaveLength(2);
    expect((await listWorkouts(d1, 'active'))[0].id).toBe(workout().id);
    await expect(applyWorkoutMutation(d1, mutation('stale-delete', 'delete', created.workout))).rejects.toThrow();
  });

  it('左右別の種目作成とsnapshot保存・再読込・履歴・volume・コピーを通す', async () => {
    const { createExerciseMaster } = await import('@/lib/workouts/server-store');
    const { validateWorkoutSnapshot } = await import('@/lib/workouts/validation');
    const { getExerciseHistory } = await import('@/lib/workouts/history-server-store');
    const { getWorkoutCompletionProgressionSummary } = await import('@/lib/progression/server-store');
    const master = await createExerciseMaster(d1, { id: 'side-master', name: 'ブルガリアンテスト', bodyPart: '脚', repMode: 'per_side' });
    expect(master.repMode).toBe('per_side');
    const snapshot = workout();
    snapshot.exercises[0].repMode = 'per_side';
    snapshot.exercises[0].exerciseId = master.id;
    snapshot.exercises[0].sets = [0,1,2].map(position => ({ ...set(`side-${position}`, position), actualReps: 99, actualRepsRight: 12, actualRepsLeft: 9 }));
    const canonical = validateWorkoutSnapshot(snapshot);
    expect(canonical.exercises[0].sets[0].actualReps).toBe(9);
    const created = await applyWorkoutMutation(d1, mutation('side-create', 'create', canonical));
    const completed = await applyWorkoutMutation(d1, mutation('side-complete', 'complete', { ...created.workout, status: 'completed', endedAt: timestamp, exercises: created.workout.exercises.map(exercise => ({ ...exercise, status: 'completed' })) }));
    expect((await getWorkout(d1, snapshot.id))?.exercises[0]).toMatchObject({ repMode: 'per_side', sets: [expect.objectContaining({ actualReps: 9, actualRepsLeft: 9, actualRepsRight: 12 }), expect.anything(), expect.anything()] });
    const history = await getExerciseHistory(d1, master.id);
    expect(history.references?.[0].sets[0]).toMatchObject({ actualRepsLeft: 9, actualRepsRight: 12 });
    const summary = await getWorkoutCompletionProgressionSummary(d1, snapshot.id);
    expect(summary.exercises[0].decision.status).toBe('keep_load');
    expect(summary.exercises[0].personalRecords.current.totalVolumeGramReps).toBe(60000 * (12 + 9) * 3);
    expect((await listWorkouts(d1, 'completed'))[0].totalVolumeGrams).toBe(60000 * (12 + 9) * 3);
    const { getAnalyticsSnapshot } = await import('@/lib/analytics/server-store');
    const analytics = await getAnalyticsSnapshot(d1, 'all', new Date('2026-10-15T00:00:00Z'));
    expect(analytics.workouts.totalVolumeGramReps).toBe(60000 * (12 + 9) * 3);
    const { updateExerciseMaster } = await import('@/lib/workouts/exercise-settings-store');
    await updateExerciseMaster(d1, master.id, { ...master, repMode: 'standard' });
    expect((await getWorkout(d1, snapshot.id))?.exercises[0].repMode).toBe('per_side');

    const copied = copyWorkoutForToday(completed.workout);
    expect(copied.exercises[0].repMode).toBe('per_side');
    expect(copied.exercises[0].sets.every(set => set.actualReps === null && set.actualRepsLeft === null && set.actualRepsRight === null)).toBe(true);
  });

  it('旧キューの逆転した目標は実績を変更せず同期でき、同一mutationの再送も変えない', async () => {
    const { validateWorkoutSnapshot } = await import('@/lib/workouts/validation');
    const original = workout();
    original.exercises[0].sets[0].targetRepMin = 12;
    original.exercises[0].sets[0].targetRepMax = 8;
    const normalized = validateWorkoutSnapshot(original);
    expect(normalized.exercises[0].sets[0]).toMatchObject({ targetRepMin: 12, targetRepMax: 8, actualReps: 9 });
    const request = mutation('legacy-reversed', 'create', normalized);
    const created = await applyWorkoutMutation(d1, request);
    expect(created.workout.exercises[0].sets[0].actualReps).toBe(9);
    expect((await applyWorkoutMutation(d1, request)).duplicate).toBe(true);
  });
});


it('個別セットAPIと置換APIも左右回数とsnapshotの方式を保持する', async () => {
  const { addWorkoutSet, updateWorkoutSet, replaceWorkout } = await import('@/lib/workouts/server-store');
  const snapshot = workout();
  snapshot.exercises[0].repMode = 'per_side';
  snapshot.exercises[0].sets = [];
  await applyWorkoutMutation(d1, mutation('side-legacy-create', 'create', snapshot));
  const actual = { ...set('individual-side',0), actualReps: 11, actualRepsRight: 12, actualRepsLeft: 8 };
  const added = (await addWorkoutSet(d1, snapshot.id, snapshot.exercises[0].id, actual))!;
  expect(added.exercises[0].sets[0]).toMatchObject({ actualReps: 8, actualRepsLeft: 8, actualRepsRight: 12 });
  const updated = (await updateWorkoutSet(d1, snapshot.id, snapshot.exercises[0].id, actual.id, { ...actual, actualRepsLeft: 10 }))!;
  expect(updated.exercises[0].sets[0]).toMatchObject({ actualReps: 10, actualRepsLeft: 10, actualRepsRight: 12 });
  const replacement = await replaceWorkout(d1, updated);
  expect(replacement.exercises[0].repMode).toBe('per_side');
  expect(replacement.exercises[0].sets[0]).toMatchObject({ actualRepsLeft: 10, actualRepsRight: 12 });
});


it('HTTP入口からactiveの削除・復元・再削除と同一要求の再送を通し、完了状態へ変えない', async () => {
  vi.doMock('@/db', () => ({ getD1: () => d1 }));
  try {
    const { POST } = await import('@/app/api/v2/sync/route');
    async function post(input: WorkoutMutationInput) {
      const response = await POST(new Request('http://fixture.test/api/v2/sync', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } }));
      expect(response.status).toBe(200);
      return await response.json() as { workout: Workout; duplicate: boolean };
    }
    const created = await post(mutation('http-create', 'create', workout()));
    const deleted = await post(mutation('http-delete', 'delete', { ...created.workout, deletedAt: timestamp }));
    const restored = await post(mutation('http-restore', 'restore', { ...deleted.workout, deletedAt: null }));
    const request = mutation('http-delete-again', 'delete', { ...restored.workout, deletedAt: timestamp });
    const deletedAgain = await post(request);
    expect(deletedAgain.workout).toMatchObject({ status: 'active', endedAt: null, version: 4 });
    expect((await post(request)).duplicate).toBe(true);
    expect(await listWorkouts(d1, 'active')).toEqual([]);
  } finally { vi.doUnmock('@/db'); }
});

it('役割・回数目標・重量基準をSQLと履歴・判定・分析・コピーまで保持する', async () => {
  const { createExerciseMaster } = await import('@/lib/workouts/server-store');
  const { validateWorkoutSnapshot } = await import('@/lib/workouts/validation');
  const { getExerciseHistory } = await import('@/lib/workouts/history-server-store');
  const { getWorkoutCompletionProgressionSummary } = await import('@/lib/progression/server-store');
  const { getAnalyticsSnapshot } = await import('@/lib/analytics/server-store');
  const master = await createExerciseMaster(d1, { id: 'basis-master', name: '重量基準テスト', bodyPart: '背中', repMode: 'per_side', loadBasis: 'paired_total' });
  expect(master.loadBasis).toBe('paired_total');
  const snapshot = workout();
  snapshot.exercises[0].exerciseId = master.id;
  snapshot.exercises[0].repMode = 'per_side';
  snapshot.exercises[0].sets = [0, 1, 2].map(position => ({ ...set(`basis-${position}`, position), role: position === 0 ? 'top' : 'backoff', loadBasis: 'paired_total', actualLoadGrams: position === 0 ? 40000 : 30000, actualReps: 8, actualRepsLeft: 8, actualRepsRight: 10, targetRepMin: 6, targetRepMax: position === 0 ? 8 : 12 }));
  const created = await applyWorkoutMutation(d1, mutation('basis-create', 'create', validateWorkoutSnapshot(snapshot)));
  const completed = await applyWorkoutMutation(d1, mutation('basis-complete', 'complete', { ...created.workout, status: 'completed', endedAt: timestamp, exercises: created.workout.exercises.map(exercise => ({ ...exercise, status: 'completed' })) }));
  expect((await getWorkout(d1, snapshot.id))?.exercises[0].sets[0]).toMatchObject({ role: 'top', loadBasis: 'paired_total', targetRepMax: 8 });
  expect((await getExerciseHistory(d1, master.id)).references?.[0].sets[1]).toMatchObject({ role: 'backoff', loadBasis: 'paired_total', targetRepMax: 12 });
  const summary = await getWorkoutCompletionProgressionSummary(d1, snapshot.id);
  expect(summary.exercises[0].decision.reasonCode).toBe('set_specific_progression');
  expect(summary.exercises[0].decision.setDecisions?.map(set => set.targetLoadGrams)).toEqual([42500, 30000, 30000]);
  const expectedVolume = (40000 + 30000 + 30000) * 18 / 2;
  expect(summary.exercises[0].personalRecords.current.totalVolumeGramReps).toBe(expectedVolume);
  expect(summary.exercises[0].personalRecords.current.maxLoadGrams).toBe(20000);
  expect((await listWorkouts(d1, 'completed'))[0].totalVolumeGrams).toBe(expectedVolume);
  expect((await getAnalyticsSnapshot(d1, 'all', new Date('2026-10-15T00:00:00Z'))).workouts.totalVolumeGramReps).toBe(expectedVolume);
  expect(copyWorkoutForToday(completed.workout).exercises[0].sets[0]).toMatchObject({ role: 'top', loadBasis: 'paired_total', actualLoadGrams: null });
  const { updateExerciseMaster } = await import('@/lib/workouts/exercise-settings-store');
  await updateExerciseMaster(d1, master.id, { ...master, loadBasis: 'per_rep' });
  expect((await getWorkout(d1, snapshot.id))?.exercises[0].sets[0].loadBasis).toBe('paired_total');
});
