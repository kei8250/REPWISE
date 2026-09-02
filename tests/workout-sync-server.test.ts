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
): WorkoutMutationInput {
  return {
    mutationId,
    entityType: 'workout',
    entityId: snapshot.id,
    operation,
    payload: { workout: snapshot },
    createdAt: timestamp,
  };
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
