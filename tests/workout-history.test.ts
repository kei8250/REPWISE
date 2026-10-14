import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getExerciseHistory } from '@/lib/workouts/history-server-store';
import { listWorkouts } from '@/lib/workouts/server-store';
import {
  defaultWorkoutName,
  isLocalDate,
  localDateKey,
  previousSetAt,
} from '@/lib/workouts/history';
import { createLocalWorkout, copyWorkoutForToday } from '@/lib/workouts/draft';
import { compareWorkingSet } from '@/lib/progression/active-workout';

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
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'),
    );
  }
  db = new TestD1(sqlite) as unknown as D1Database;
});

afterEach(() => sqlite.close());

describe('workout calendar and exercise history', () => {
  it('前回・前々回を日付順に返し、2/3セット目と各階層のメモを保持する', async () => {
    insertWorkout(sqlite, {
      id: 'older',
      localDate: '2026-09-01',
      reps: [10, 9, 7],
    });
    insertWorkout(sqlite, {
      id: 'latest',
      localDate: '2026-09-08',
      reps: [12, 10, 8],
    });
    sqlite
      .prepare(
        "UPDATE workout_set SET memo = '3セット目は肩に注意', actual_load_grams = 82500 WHERE id = ?",
      )
      .run('latest-exercise-set-2');
    sqlite
      .prepare(
        "UPDATE workout_exercise SET note = 'フォーム\nゆっくり下ろす' WHERE id = ?",
      )
      .run('latest-exercise');
    sqlite
      .prepare("UPDATE workout SET overall_note = '睡眠6時間' WHERE id = ?")
      .run('latest');
    const history = await getExerciseHistory(db, 'ex-bench-press');
    expect(history.items.map((entry) => entry.workoutId)).toEqual([
      'latest',
      'older',
    ]);
    expect(history.items[0]).toMatchObject({
      note: 'フォーム\nゆっくり下ろす',
      overallNote: '睡眠6時間',
    });
    expect(previousSetAt(history.items[0], 2)).toMatchObject({
      actualLoadGrams: 82500,
      actualReps: 8,
      memo: '3セット目は肩に注意',
    });
    expect(previousSetAt(history.items[1], 1)?.actualReps).toBe(9);
  });

  it('削除済み・入力中・別種目・別owner・スキップ種目・未来・現在を除外する', async () => {
    insertWorkout(sqlite, { id: 'valid', localDate: '2026-09-01' });
    insertWorkout(sqlite, {
      id: 'active',
      localDate: '2026-09-03',
      status: 'active',
    });
    insertWorkout(sqlite, {
      id: 'deleted',
      localDate: '2026-09-04',
      deletedAt: timestamp,
    });
    insertWorkout(sqlite, {
      id: 'other-exercise',
      localDate: '2026-09-05',
      exerciseId: 'ex-seated-row',
    });
    insertWorkout(sqlite, { id: 'other-owner', localDate: '2026-09-06' });
    sqlite
      .prepare("UPDATE workout SET owner_id = 'other' WHERE id = ?")
      .run('other-owner');
    insertWorkout(sqlite, {
      id: 'skipped',
      localDate: '2026-09-07',
      exerciseStatus: 'skipped',
    });
    insertWorkout(sqlite, { id: 'future', localDate: '2026-09-12' });
    insertWorkout(sqlite, { id: 'current', localDate: '2026-09-08' });
    const history = await getExerciseHistory(db, 'ex-bench-press', {
      beforeDate: '2026-09-08',
      excludeWorkoutId: 'current',
    });
    expect(history.items.map((entry) => entry.workoutId)).toEqual(['valid']);
  });

  it('同じ日に後から終了したトレーニングは前回として表示しない', async () => {
    insertWorkout(sqlite, { id: 'morning', localDate: '2026-09-11' });
    insertWorkout(sqlite, { id: 'evening', localDate: '2026-09-11' });
    sqlite
      .prepare('UPDATE workout SET ended_at = ? WHERE id = ?')
      .run('2026-09-11T20:00:00.000Z', 'evening');
    const history = await getExerciseHistory(db, 'ex-bench-press', {
      beforeDate: '2026-09-11',
      beforeStartedAt: '2026-09-11T12:00:00.000Z',
    });
    expect(history.items.map((entry) => entry.workoutId)).toEqual(['morning']);
  });

  it('未完了セットを詰めず、削除されたセットも後ろの番号をずらさない', async () => {
    insertWorkout(sqlite, { id: 'slots', localDate: '2026-09-01' });
    sqlite
      .prepare("UPDATE workout_set SET status = 'skipped' WHERE id = ?")
      .run('slots-exercise-set-0');
    sqlite
      .prepare('UPDATE workout_set SET deleted_at = ? WHERE id = ?')
      .run(timestamp, 'slots-exercise-set-1');
    const history = await getExerciseHistory(db, 'ex-bench-press');
    expect(previousSetAt(history.items[0], 0)?.status).toBe('skipped');
    expect(previousSetAt(history.items[0], 1)).toBeNull();
    const third = previousSetAt(history.items[0], 2)!;
    expect(third.position).toBe(2);
    expect(
      compareWorkingSet(
        { ...third, actualReps: 11 },
        { ...third, deletedAt: null },
      ),
    ).toMatchObject({ status: 'above' });
  });

  it('10件より前の履歴もページ送りで取得できる', async () => {
    for (let i = 1; i <= 12; i++)
      insertWorkout(sqlite, {
        id: `past-${i}`,
        localDate: `2026-09-${String(i).padStart(2, '0')}`,
      });
    const first = await getExerciseHistory(db, 'ex-bench-press');
    const second = await getExerciseHistory(db, 'ex-bench-press', {
      offset: first.items.length,
    });
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((entry) => entry.localDate)).toEqual([
      '2026-09-02',
      '2026-09-01',
    ]);
    expect(second.hasMore).toBe(false);
  });

  it('カレンダーの月・日付を絞り込み、同日の複数記録と古いページを返す', async () => {
    insertWorkout(sqlite, { id: 'august', localDate: '2026-08-31' });
    insertWorkout(sqlite, { id: 'day-a', localDate: '2026-09-01' });
    insertWorkout(sqlite, { id: 'day-b', localDate: '2026-09-01' });
    insertWorkout(sqlite, { id: 'september', localDate: '2026-09-30' });
    insertWorkout(sqlite, { id: 'october', localDate: '2026-10-01' });
    const month = await listWorkouts(db, 'completed', 100, {
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(month.map((entry) => entry.id)).toEqual([
      'september',
      'day-b',
      'day-a',
    ]);
    const day = await listWorkouts(db, 'completed', 1, {
      from: '2026-09-01',
      to: '2026-09-01',
      offset: 1,
    });
    expect(day.map((entry) => entry.id)).toEqual(['day-a']);
  });

  it('日付の実在性と月末・閏日を確認し、自動名だけをコピー先の日付に更新する', () => {
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(localDateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(defaultWorkoutName('2026-10-14')).toBe('10月14日のトレーニング');
    const source = {
      ...createLocalWorkout({
        name: '10月14日のトレーニング',
        localDate: '2026-10-14',
        timezone: 'Asia/Tokyo',
      }),
      status: 'completed' as const,
    };
    expect(copyWorkoutForToday(source, { localDate: '2026-10-16' }).name).toBe(
      '10月16日のトレーニング',
    );
    expect(
      copyWorkoutForToday(
        { ...source, name: '脚の日' },
        { localDate: '2026-10-16' },
      ).name,
    ).toBe('脚の日');
  });
});
