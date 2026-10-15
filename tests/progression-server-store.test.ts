import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getExerciseProgressionRecommendation,
  getLatestCompletedExercisePerformance,
} from '@/lib/progression/server-store';

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
}

class TestD1 {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string) {
    return new TestStatement(this.sqlite.prepare(query));
  }
}

const timestamp = '2026-09-11T09:00:00.000Z';

function insertWorkout(
  sqlite: DatabaseSync,
  input: {
    id: string;
    exerciseId?: string;
    localDate: string;
    status?: string;
    exerciseStatus?: string;
    deletedAt?: string | null;
    reps?: number[];
    version?: number;
  },
) {
  const exerciseId = input.exerciseId ?? 'ex-bench-press';
  const workoutExerciseId = `${input.id}-exercise`;
  const status = input.status ?? 'completed';
  const exerciseStatus = input.exerciseStatus ?? 'completed';
  const reps = input.reps ?? [10, 10, 10];
  sqlite
    .prepare(
      `INSERT INTO workout
        (id, owner_id, name, status, local_date, timezone, started_at,
         ended_at, overall_note, version, created_at, updated_at, deleted_at)
       VALUES (?, 'default', ?, ?, ?, 'Asia/Tokyo', ?, ?, '', ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.id,
      status,
      input.localDate,
      timestamp,
      status === 'completed' ? timestamp : null,
      input.version ?? 1,
      timestamp,
      timestamp,
      input.deletedAt ?? null,
    );
  sqlite
    .prepare(
      `INSERT INTO workout_exercise
        (id, workout_id, exercise_id, position, status,
         exercise_name_snapshot, note, started_at, completed_at,
         created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, '', ?, ?, ?, ?)`,
    )
    .run(
      workoutExerciseId,
      input.id,
      exerciseId,
      exerciseStatus,
      exerciseId,
      timestamp,
      exerciseStatus === 'completed' ? timestamp : null,
      timestamp,
      timestamp,
    );
  reps.forEach((rep, position) => {
    sqlite
      .prepare(
        `INSERT INTO workout_set
          (id, workout_exercise_id, position, status, set_type,
           actual_load_grams, actual_reps, memo, completed_at,
           created_at, updated_at)
         VALUES (?, ?, ?, 'completed', 'working', 100000, ?, '', ?, ?, ?)`,
      )
      .run(
        `${workoutExerciseId}-set-${position}`,
        workoutExerciseId,
        position,
        rep,
        timestamp,
        timestamp,
        timestamp,
      );
  });
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
    '0006_side_repetitions.sql',
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
    );
  }
  db = new TestD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe('Phase 3A progression history', () => {
  it('exercise ID基準で直近の有効な完了実績だけを取得する', async () => {
    insertWorkout(sqlite, {
      id: 'valid-old',
      localDate: '2026-09-01',
      reps: [8, 8, 8],
    });
    insertWorkout(sqlite, {
      id: 'active-newer',
      localDate: '2026-09-10',
      status: 'active',
      exerciseStatus: 'in_progress',
    });
    insertWorkout(sqlite, {
      id: 'deleted-newer',
      localDate: '2026-09-09',
      deletedAt: timestamp,
    });
    insertWorkout(sqlite, {
      id: 'same-name-different-id',
      exerciseId: 'ex-incline-dumbbell-press',
      localDate: '2026-09-11',
    });
    insertWorkout(sqlite, {
      id: 'valid-latest',
      localDate: '2026-09-08',
      reps: [10, 10, 10],
      version: 4,
    });

    const performance = await getLatestCompletedExercisePerformance(
      db,
      'ex-bench-press',
    );
    const recommendation = await getExerciseProgressionRecommendation(
      db,
      'ex-bench-press',
    );

    expect(performance).toMatchObject({
      workoutId: 'valid-latest',
      workoutVersion: 4,
      workoutLocalDate: '2026-09-08',
      exerciseId: 'ex-bench-press',
    });
    expect(recommendation).toMatchObject({
      exerciseId: 'ex-bench-press',
      profile: {
        repMin: 8,
        repMax: 10,
        workingSets: 3,
        incrementGrams: 2_500,
      },
      decision: {
        status: 'increase_load',
        sourceWorkoutId: 'valid-latest',
        nextTarget: { loadGrams: 102_500 },
      },
    });
  });

  it('履歴編集・soft delete後は永続キャッシュなしで再計算する', async () => {
    insertWorkout(sqlite, {
      id: 'previous',
      localDate: '2026-09-01',
      reps: [8, 8, 8],
    });
    insertWorkout(sqlite, {
      id: 'latest',
      localDate: '2026-09-10',
      reps: [10, 10, 10],
      version: 2,
    });

    expect(
      (await getExerciseProgressionRecommendation(db, 'ex-bench-press'))
        .decision.status,
    ).toBe('increase_load');

    sqlite
      .prepare(
        `UPDATE workout_set
         SET actual_reps = 9
         WHERE id = 'latest-exercise-set-1'`,
      )
      .run();
    sqlite.prepare("UPDATE workout SET version = 3 WHERE id = 'latest'").run();
    expect(
      (await getExerciseProgressionRecommendation(db, 'ex-bench-press'))
        .decision,
    ).toMatchObject({
      status: 'keep_load',
      sourceWorkoutVersion: 3,
    });

    sqlite
      .prepare("UPDATE workout SET deleted_at = ? WHERE id = 'latest'")
      .run(timestamp);
    expect(
      (await getExerciseProgressionRecommendation(db, 'ex-bench-press'))
        .decision,
    ).toMatchObject({
      status: 'keep_load',
      sourceWorkoutId: 'previous',
    });
  });

  it('実績がなければ推測せずinsufficient_dataを返す', async () => {
    expect(
      await getExerciseProgressionRecommendation(db, 'ex-bench-press'),
    ).toMatchObject({
      performance: null,
      decision: {
        status: 'insufficient_data',
        reasonCode: 'no_completed_history',
      },
    });
  });
});
