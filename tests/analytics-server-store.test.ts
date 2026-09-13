import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAnalyticsSnapshot } from '@/lib/analytics/server-store';

type SqlValue = null | number | bigint | string | Uint8Array;

class TestStatement {
  private values: SqlValue[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
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

const timestamp = '2026-09-10T09:00:00.000Z';

function insertWorkout(
  sqlite: DatabaseSync,
  id: string,
  localDate: string,
  loadGrams: number,
  reps: number,
  deletedAt: string | null = null,
) {
  sqlite
    .prepare(
      `INSERT INTO workout
        (id, owner_id, name, status, local_date, timezone, started_at,
         ended_at, overall_note, version, created_at, updated_at, deleted_at)
       VALUES (?, 'default', ?, 'completed', ?, 'Asia/Tokyo', ?, ?, '', 1, ?, ?, ?)`,
    )
    .run(
      id,
      id,
      localDate,
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      deletedAt,
    );
  sqlite
    .prepare(
      `INSERT INTO workout_exercise
        (id, workout_id, exercise_id, position, status,
         exercise_name_snapshot, note, started_at, completed_at,
         created_at, updated_at)
       VALUES (?, ?, 'ex-bench-press', 0, 'completed', 'ベンチプレス', '', ?, ?, ?, ?)`,
    )
    .run(`${id}-exercise`, id, timestamp, timestamp, timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO workout_set
        (id, workout_exercise_id, position, status, set_type,
         actual_load_grams, actual_reps, memo, completed_at,
         created_at, updated_at)
       VALUES (?, ?, 0, 'completed', 'working', ?, ?, '', ?, ?, ?)`,
    )
    .run(
      `${id}-set`,
      `${id}-exercise`,
      loadGrams,
      reps,
      timestamp,
      timestamp,
      timestamp,
    );
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

describe('Phase 4A analytics D1 service', () => {
  it('completedな有効履歴とaccepted targetを3本の並列readで集約する', async () => {
    insertWorkout(sqlite, 'source', '2026-09-08', 100_000, 9);
    insertWorkout(sqlite, 'applied', '2026-09-09', 100_000, 10);
    insertWorkout(
      sqlite,
      'deleted',
      '2026-09-10',
      120_000,
      10,
      '2026-09-11T00:00:00.000Z',
    );
    sqlite
      .prepare(
        `INSERT INTO accepted_next_target
          (id, owner_id, mutation_id, exercise_id, source_workout_id,
           source_workout_version, target_load_grams, target_rep_min,
           target_rep_max, target_working_sets, status, applied_workout_id,
           created_at, updated_at)
         VALUES ('target', 'default', 'mutation', 'ex-bench-press', 'source',
                 1, 100000, 8, 10, 1, 'applied', 'applied', ?, ?)`,
      )
      .run(timestamp, timestamp);

    const result = await getAnalyticsSnapshot(
      db,
      'all',
      new Date('2026-09-30T00:00:00.000Z'),
    );

    expect(result.workouts).toMatchObject({
      completedWorkoutCount: 2,
      trainingDayCount: 2,
      workingSetCount: 2,
      totalVolumeGramReps: 1_900_000,
    });
    expect(result.exercises[0]).toMatchObject({
      exerciseId: 'ex-bench-press',
      bodyPart: '胸',
      workoutCount: 2,
    });
    expect(result.exercises[0].acceptedTargetHistory).toContainEqual(
      expect.objectContaining({ id: 'target', outcome: 'achieved' }),
    );
    expect(result.exercises[0].maxWeightTrend).not.toContainEqual(
      expect.objectContaining({ value: 120_000 }),
    );
  });

  it('soft delete後は再計算から除外しrestore後に再反映する', async () => {
    insertWorkout(sqlite, 'first', '2026-09-08', 100_000, 8);
    insertWorkout(sqlite, 'best', '2026-09-09', 110_000, 8);
    sqlite
      .prepare("UPDATE workout SET deleted_at = ? WHERE id = 'best'")
      .run(timestamp);

    let result = await getAnalyticsSnapshot(
      db,
      'all',
      new Date('2026-09-30T00:00:00.000Z'),
    );
    expect(result.workouts.completedWorkoutCount).toBe(1);
    expect(result.exercises[0].maxWeightTrend.at(-1)?.value).toBe(100_000);

    sqlite
      .prepare("UPDATE workout SET deleted_at = NULL WHERE id = 'best'")
      .run();
    result = await getAnalyticsSnapshot(
      db,
      'all',
      new Date('2026-09-30T00:00:00.000Z'),
    );
    expect(result.workouts.completedWorkoutCount).toBe(2);
    expect(result.exercises[0].maxWeightTrend.at(-1)?.value).toBe(110_000);
  });
});
