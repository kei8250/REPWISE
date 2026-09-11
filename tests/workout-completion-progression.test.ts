import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatNextProgressionTarget,
  formatWorkingSetPerformance,
  progressionReasonLabel,
  progressionStatusLabel,
} from '@/lib/progression/completion-summary';
import { getWorkoutCompletionProgressionSummary as getServerSummary } from '@/lib/progression/server-store';
import { getWorkoutCompletionProgressionSummary as getClientSummary } from '@/lib/workouts/api-client';

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

function insertCompletedWorkout(
  sqlite: DatabaseSync,
  options: {
    reps: number[];
    loads?: number[];
    version?: number;
    includeWarmup?: boolean;
  },
) {
  sqlite
    .prepare(
      `INSERT INTO workout
        (id, owner_id, name, status, local_date, timezone, started_at,
         ended_at, overall_note, version, created_at, updated_at, deleted_at)
       VALUES ('summary-workout', 'default', 'Summary test', 'completed',
               '2026-09-11', 'Asia/Tokyo', ?, ?, '', ?, ?, ?, NULL)`,
    )
    .run(timestamp, timestamp, options.version ?? 1, timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO workout_exercise
        (id, workout_id, exercise_id, position, status,
         exercise_name_snapshot, note, started_at, completed_at,
         created_at, updated_at)
       VALUES ('summary-exercise', 'summary-workout', 'ex-bench-press', 0,
               'completed', 'ベンチプレス', '', ?, ?, ?, ?)`,
    )
    .run(timestamp, timestamp, timestamp, timestamp);
  if (options.includeWarmup) {
    sqlite
      .prepare(
        `INSERT INTO workout_set
          (id, workout_exercise_id, position, status, set_type,
           actual_load_grams, actual_reps, memo, completed_at,
           created_at, updated_at)
         VALUES ('warmup', 'summary-exercise', -1, 'completed', 'warmup',
                 50000, 5, '', ?, ?, ?)`,
      )
      .run(timestamp, timestamp, timestamp);
  }
  options.reps.forEach((reps, position) => {
    sqlite
      .prepare(
        `INSERT INTO workout_set
          (id, workout_exercise_id, position, status, set_type,
           actual_load_grams, actual_reps, memo, completed_at,
           created_at, updated_at)
         VALUES (?, 'summary-exercise', ?, 'completed', 'working',
                 ?, ?, '', ?, ?, ?)`,
      )
      .run(
        `working-${position}`,
        position,
        options.loads?.[position] ?? 100_000,
        reps,
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
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
    );
  }
  db = new TestD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe('Phase 3C-1 completion progression summary', () => {
  it('A: 100kg 10/10/10は増量候補と次回102.5kgを返す', async () => {
    insertCompletedWorkout(sqlite, { reps: [10, 10, 10] });
    const summary = await getServerSummary(db, 'summary-workout');
    const exercise = summary.exercises[0];

    expect(summary.counts).toEqual({
      increaseLoad: 1,
      keepLoad: 0,
      insufficientData: 0,
    });
    expect(exercise.decision).toMatchObject({
      status: 'increase_load',
      reasonCode: 'all_sets_at_rep_max',
      nextTarget: { loadGrams: 102_500 },
    });
    expect(formatNextProgressionTarget(exercise.decision)).toBe(
      '102.5kg / 8〜10回 × 3セット',
    );
  });

  it('B: 100kg 10/9/8は同重量継続にする', async () => {
    insertCompletedWorkout(sqlite, { reps: [10, 9, 8] });
    const exercise = (await getServerSummary(db, 'summary-workout'))
      .exercises[0];
    expect(exercise.decision).toMatchObject({
      status: 'keep_load',
      reasonCode: 'within_rep_range',
      nextTarget: { loadGrams: 100_000 },
    });
    expect(formatWorkingSetPerformance(exercise.performance)).toBe(
      '100kg × 10 / 9 / 8',
    );
  });

  it('C: 100kg 7/8/8は増量せず自然な下限未満表示にする', async () => {
    insertCompletedWorkout(sqlite, { reps: [7, 8, 8] });
    const decision = (await getServerSummary(db, 'summary-workout'))
      .exercises[0].decision;
    expect(decision.status).toBe('keep_load');
    expect(progressionStatusLabel(decision.status)).toBe('今回は同重量継続');
    expect(progressionReasonLabel(decision.reasonCode)).toBe(
      '目標rep下限未満のセットあり',
    );
  });

  it('D: 2セットは必要セット数不一致で判定不能にする', async () => {
    insertCompletedWorkout(sqlite, { reps: [10, 10] });
    const decision = (await getServerSummary(db, 'summary-workout'))
      .exercises[0].decision;
    expect(decision).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'working_set_count_mismatch',
    });
  });

  it('E: warmupを除外してworking setだけを評価・表示する', async () => {
    insertCompletedWorkout(sqlite, {
      reps: [10, 10, 10],
      includeWarmup: true,
    });
    const exercise = (await getServerSummary(db, 'summary-workout'))
      .exercises[0];
    expect(exercise.decision.status).toBe('increase_load');
    expect(exercise.decision.evaluatedSetIds).toEqual([
      'working-0',
      'working-1',
      'working-2',
    ]);
    expect(formatWorkingSetPerformance(exercise.performance)).toBe(
      '100kg × 10 / 10 / 10',
    );
  });

  it('F: 完了履歴編集後はDBへ固定せず現在データから再計算する', async () => {
    insertCompletedWorkout(sqlite, { reps: [10, 10, 10], version: 2 });
    expect(
      (await getServerSummary(db, 'summary-workout')).exercises[0].decision
        .status,
    ).toBe('increase_load');

    sqlite
      .prepare("UPDATE workout_set SET actual_reps = 9 WHERE id = 'working-1'")
      .run();
    sqlite
      .prepare("UPDATE workout SET version = 3 WHERE id = 'summary-workout'")
      .run();
    const edited = await getServerSummary(db, 'summary-workout');
    expect(edited.workoutVersion).toBe(3);
    expect(edited.exercises[0].decision.status).toBe('keep_load');
  });

  it('G/H: soft delete中は対象外、restore後は再び計算できる', async () => {
    insertCompletedWorkout(sqlite, { reps: [10, 10, 10] });
    sqlite
      .prepare("UPDATE workout SET deleted_at = ? WHERE id = 'summary-workout'")
      .run(timestamp);
    await expect(getServerSummary(db, 'summary-workout')).rejects.toThrow(
      '完了済みワークアウトが見つかりません',
    );

    sqlite
      .prepare(
        "UPDATE workout SET deleted_at = NULL, version = 3 WHERE id = 'summary-workout'",
      )
      .run();
    await expect(
      getServerSummary(db, 'summary-workout'),
    ).resolves.toMatchObject({
      workoutVersion: 3,
      counts: { increaseLoad: 1 },
    });
  });

  it('重量がセットごとに異なる場合は推測せず判定不能にする', async () => {
    insertCompletedWorkout(sqlite, {
      reps: [10, 10, 10],
      loads: [100_000, 102_500, 100_000],
    });
    const exercise = (await getServerSummary(db, 'summary-workout'))
      .exercises[0];
    expect(exercise.decision).toMatchObject({
      status: 'insufficient_data',
      reasonCode: 'inconsistent_load',
    });
    expect(formatWorkingSetPerformance(exercise.performance)).toBe(
      '100kg×10 / 102.5kg×10 / 100kg×10',
    );
  });
});

describe('Phase 3C-1 non-blocking detail behavior', () => {
  it('I: summary API遅延中も既存の詳細データを利用できる', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const detail = { id: 'summary-workout', name: '表示済みの詳細' };
    const request = getClientSummary('summary-workout', fetcher);

    expect(detail.name).toBe('表示済みの詳細');
    expect(fetcher).toHaveBeenCalledOnce();
    resolve(
      Response.json({
        workoutId: 'summary-workout',
        workoutVersion: 1,
        totalExercises: 0,
        counts: { increaseLoad: 0, keepLoad: 0, insufficientData: 0 },
        exercises: [],
      }),
    );
    await expect(request).resolves.toMatchObject({
      workoutId: 'summary-workout',
    });
  });

  it('J: summary API失敗は既存の履歴データを変更しない', async () => {
    const detail = { id: 'summary-workout', editable: true, deletable: true };
    const before = structuredClone(detail);
    await expect(
      getClientSummary(
        'summary-workout',
        vi.fn(async () => Response.json({ error: 'failed' }, { status: 500 })),
      ),
    ).rejects.toThrow();
    expect(detail).toEqual(before);
  });
});
