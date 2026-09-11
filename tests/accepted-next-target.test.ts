import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptNextTarget } from '@/lib/progression/accepted-next-target-store';
import {
  getAcceptedTargetsForSummary,
  getApplicableAcceptedTargetsForCopy,
} from '@/lib/progression/accepted-next-target-queries';
import { getWorkoutCompletionProgressionSummary } from '@/lib/progression/server-store';
import {
  applyAcceptedTargetsToWorkoutCopy,
  copyWorkoutForToday,
} from '@/lib/workouts/draft';
import { applyWorkoutMutation, getWorkout } from '@/lib/workouts/server-store';
import type { WorkoutMutationInput } from '@/lib/workouts/types';

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

const timestamp = '2026-09-11T10:00:00.000Z';
const exerciseId = 'ex-bench-press';

function seedSource(
  sqlite: DatabaseSync,
  options: {
    id?: string;
    version?: number;
    reps?: number[];
    deletedAt?: string | null;
  } = {},
) {
  const id = options.id ?? 'source-workout';
  const exerciseRowId = `${id}-exercise`;
  sqlite
    .prepare(
      `INSERT INTO workout
        (id, owner_id, name, status, local_date, timezone, started_at, ended_at,
         overall_note, version, created_at, updated_at, deleted_at)
       VALUES (?, 'default', 'Source', 'completed', '2026-09-11', 'Asia/Tokyo',
               ?, ?, '', ?, ?, ?, ?)`,
    )
    .run(
      id,
      timestamp,
      timestamp,
      options.version ?? 1,
      timestamp,
      timestamp,
      options.deletedAt ?? null,
    );
  sqlite
    .prepare(
      `INSERT INTO workout_exercise
        (id, workout_id, exercise_id, position, status,
         exercise_name_snapshot, note, started_at, completed_at,
         created_at, updated_at)
       VALUES (?, ?, ?, 0, 'completed', 'ベンチプレス', '', ?, ?, ?, ?)`,
    )
    .run(
      exerciseRowId,
      id,
      exerciseId,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
    );
  (options.reps ?? [10, 10, 10]).forEach((reps, position) => {
    sqlite
      .prepare(
        `INSERT INTO workout_set
          (id, workout_exercise_id, position, status, set_type,
           target_load_grams, target_rep_min, target_rep_max,
           actual_load_grams, actual_reps, memo, completed_at,
           created_at, updated_at)
         VALUES (?, ?, ?, 'completed', 'working', 90000, 8, 10,
                 100000, ?, '', ?, ?, ?)`,
      )
      .run(
        `${exerciseRowId}-set-${position}`,
        exerciseRowId,
        position,
        reps,
        timestamp,
        timestamp,
        timestamp,
      );
  });
}

function acceptInput(
  mutationId = 'accept-mutation-1',
  sourceWorkoutId = 'source-workout',
  sourceWorkoutVersion = 1,
) {
  return { mutationId, exerciseId, sourceWorkoutId, sourceWorkoutVersion };
}

let sqlite: DatabaseSync;
let db: D1Database;

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
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
    );
  }
  db = new TestD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe('Phase 3C-3 accepted next target', () => {
  it('A/I: suggestionを明示採用し、同じmutationの再送でも1件だけ保存する', async () => {
    seedSource(sqlite);
    const first = await acceptNextTarget(db, acceptInput());
    const duplicate = await acceptNextTarget(db, acceptInput());

    expect(first).toMatchObject({
      duplicate: false,
      target: {
        targetLoadGrams: 102_500,
        targetRepMin: 8,
        targetRepMax: 10,
        targetWorkingSets: 3,
        status: 'accepted',
        validity: 'valid',
      },
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.target.id).toBe(first.target.id);
    expect(
      sqlite
        .prepare('SELECT COUNT(*) AS count FROM accepted_next_target')
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it('B/D/L: 検証済みaccepted targetをcopy targetより優先しactualは空にする', async () => {
    seedSource(sqlite);
    const accepted = (await acceptNextTarget(db, acceptInput())).target;
    const source = await getWorkout(db, 'source-workout');
    const copied = copyWorkoutForToday(source!, {
      timestamp,
      localDate: '2026-09-12',
      idFactory: (() => {
        let index = 0;
        return () => `copied-${index++}`;
      })(),
    });
    const applied = applyAcceptedTargetsToWorkoutCopy(copied, [accepted]);

    expect(applied.exercises[0].sets).toHaveLength(3);
    expect(applied.exercises[0].sets[0]).toMatchObject({
      targetLoadGrams: 102_500,
      targetRepMin: 8,
      targetRepMax: 10,
      actualLoadGrams: null,
      actualReps: null,
      status: 'planned',
    });
  });

  it('C/K: accepted targetが取得できなくても従来copy fallbackで開始できる', async () => {
    seedSource(sqlite);
    const source = await getWorkout(db, 'source-workout');
    const copied = copyWorkoutForToday(source!, { timestamp });
    expect(copied.exercises[0].sets[0]).toMatchObject({
      targetLoadGrams: 90_000,
      actualLoadGrams: null,
      actualReps: null,
    });
  });

  it('E: source version変更後はstaleとなり自動適用しない', async () => {
    seedSource(sqlite);
    await acceptNextTarget(db, acceptInput());
    sqlite
      .prepare(
        "UPDATE workout SET version = 2, updated_at = ? WHERE id = 'source-workout'",
      )
      .run('2026-09-11T11:00:00.000Z');

    const summaryTargets = await getAcceptedTargetsForSummary(
      db,
      'source-workout',
    );
    expect(summaryTargets.get(exerciseId)?.validity).toBe(
      'stale_source_version',
    );
    await expect(
      getApplicableAcceptedTargetsForCopy(db, 'source-workout'),
    ).resolves.toEqual([]);
  });

  it('F/G: soft delete中は不適用、restore後もversion不一致なら再確認を要求する', async () => {
    seedSource(sqlite);
    await acceptNextTarget(db, acceptInput());
    sqlite
      .prepare(
        "UPDATE workout SET deleted_at = ?, version = 2 WHERE id = 'source-workout'",
      )
      .run(timestamp);
    expect(
      (await getAcceptedTargetsForSummary(db, 'source-workout')).get(exerciseId)
        ?.validity,
    ).toBe('source_deleted');
    await expect(
      getApplicableAcceptedTargetsForCopy(db, 'source-workout'),
    ).resolves.toEqual([]);

    sqlite
      .prepare(
        "UPDATE workout SET deleted_at = NULL, version = 3 WHERE id = 'source-workout'",
      )
      .run();
    expect(
      (await getAcceptedTargetsForSummary(db, 'source-workout')).get(exerciseId)
        ?.validity,
    ).toBe('stale_source_version');
  });

  it('H: 新しい正式target採用時に古い未使用targetをsupersedeする', async () => {
    seedSource(sqlite, { id: 'source-old' });
    seedSource(sqlite, { id: 'source-new' });
    await acceptNextTarget(db, acceptInput('accept-old', 'source-old'));
    const newest = await acceptNextTarget(
      db,
      acceptInput('accept-new', 'source-new'),
    );

    expect(newest.target.status).toBe('accepted');
    expect(
      sqlite
        .prepare(
          "SELECT status FROM accepted_next_target WHERE mutation_id = 'accept-old'",
        )
        .get(),
    ).toMatchObject({ status: 'superseded' });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM accepted_next_target WHERE exercise_id = ? AND status = 'accepted'",
        )
        .get(exerciseId),
    ).toMatchObject({ count: 1 });
  });

  it('B/J: server copy成功時だけtargetを原子的にappliedへ進める', async () => {
    seedSource(sqlite);
    await acceptNextTarget(db, acceptInput());
    const source = await getWorkout(db, 'source-workout');
    const copied = copyWorkoutForToday(source!, {
      timestamp,
      localDate: '2026-09-12',
      idFactory: (() => {
        let index = 0;
        return () => `server-copy-${index++}`;
      })(),
    });
    const mutation: WorkoutMutationInput = {
      mutationId: 'copy-create-mutation',
      entityType: 'workout',
      entityId: copied.id,
      operation: 'create',
      baseVersion: 0,
      payload: { workout: copied },
      createdAt: timestamp,
    };
    const result = await applyWorkoutMutation(db, mutation);

    expect(result.workout.exercises[0].sets[0]).toMatchObject({
      targetLoadGrams: 102_500,
      actualLoadGrams: null,
      actualReps: null,
    });
    expect(
      sqlite
        .prepare(
          "SELECT status, applied_workout_id FROM accepted_next_target WHERE mutation_id = 'accept-mutation-1'",
        )
        .get(),
    ).toMatchObject({ status: 'applied', applied_workout_id: copied.id });
  });

  it('J: copy作成失敗時はaccepted targetを消費しない', async () => {
    seedSource(sqlite);
    await acceptNextTarget(db, acceptInput());
    const source = await getWorkout(db, 'source-workout');
    const copied = copyWorkoutForToday(source!, { timestamp });
    copied.exercises.push({
      ...structuredClone(copied.exercises[0]),
      id: 'invalid-exercise-row',
      exerciseId: 'missing-master',
      position: 1,
      sets: [],
    });
    await expect(
      applyWorkoutMutation(db, {
        mutationId: 'failing-copy',
        entityType: 'workout',
        entityId: copied.id,
        operation: 'create',
        baseVersion: 0,
        payload: { workout: copied },
        createdAt: timestamp,
      }),
    ).rejects.toThrow('選択された種目が見つかりません');
    expect(
      sqlite
        .prepare(
          "SELECT status, applied_workout_id FROM accepted_next_target WHERE mutation_id = 'accept-mutation-1'",
        )
        .get(),
    ).toMatchObject({ status: 'accepted', applied_workout_id: null });
  });

  it('source編集後のsummaryは新suggestionとstale状態を同時に返す', async () => {
    seedSource(sqlite);
    await acceptNextTarget(db, acceptInput());
    sqlite
      .prepare(
        "UPDATE workout_set SET actual_reps = 9 WHERE id = 'source-workout-exercise-set-1'",
      )
      .run();
    sqlite
      .prepare("UPDATE workout SET version = 2 WHERE id = 'source-workout'")
      .run();
    const summary = await getWorkoutCompletionProgressionSummary(
      db,
      'source-workout',
    );
    expect(summary.exercises[0].decision.nextTarget?.loadGrams).toBe(100_000);
    expect(summary.exercises[0].acceptedNextTarget?.validity).toBe(
      'stale_source_version',
    );
  });

  it('accepted target API失敗は既存copyデータを変更しない', async () => {
    seedSource(sqlite);
    const source = await getWorkout(db, 'source-workout');
    const copied = copyWorkoutForToday(source!, { timestamp });
    const before = structuredClone(copied);
    const failedRequest = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(failedRequest()).rejects.toThrow('offline');
    expect(copied).toEqual(before);
  });
});
