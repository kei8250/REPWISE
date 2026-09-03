import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyWorkoutMutation } from '@/lib/workouts/server-store';
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

async function legacyFingerprint(input: WorkoutMutationInput) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload,
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
