import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('v2 SQLite schema persistence', () => {
  it('複数種目・複数セット・順序・target/actualを保存して再読込できる', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(readFileSync(new URL('../drizzle/0000_public_franklin_richards.sql', import.meta.url), 'utf8'));
    db.prepare("INSERT INTO exercises (name, body_part, created_at) VALUES ('旧種目', '腕', ?)").run('2026-08-31T00:00:00.000Z');
    db.exec(readFileSync(new URL('../drizzle/0001_gray_magma.sql', import.meta.url), 'utf8'));
    const timestamp = '2026-09-01T09:00:00.000Z';
    db.prepare("INSERT INTO workout (id, owner_id, name, status, local_date, timezone, started_at, overall_note, version, created_at, updated_at) VALUES (?, 'default', ?, 'active', ?, 'Asia/Tokyo', ?, '', 1, ?, ?)").run('workout-integration', '脚の日', '2026-09-01', timestamp, timestamp, timestamp);
    const masters = [
      ['master-squat', 'テストスクワット', 'テストスクワット'],
      ['master-rdl', 'テストRDL', 'テストrdl'],
      ['master-leg-curl', 'テストレッグカール', 'テストレッグカール'],
    ];
    const insertMaster = db.prepare("INSERT INTO exercise_master (id, owner_id, name, normalized_name, body_part, measurement_type, created_at, updated_at) VALUES (?, 'default', ?, ?, '脚', 'weight_reps', ?, ?)");
    const insertExercise = db.prepare("INSERT INTO workout_exercise (id, workout_id, exercise_id, position, status, exercise_name_snapshot, note, created_at, updated_at) VALUES (?, 'workout-integration', ?, ?, 'in_progress', ?, '', ?, ?)");
    const insertSet = db.prepare("INSERT INTO workout_set (id, workout_exercise_id, position, status, set_type, target_load_grams, target_rep_min, target_rep_max, actual_load_grams, actual_reps, memo, completed_at, created_at, updated_at) VALUES (?, ?, ?, 'completed', 'working', ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    masters.forEach(([id, name, normalized], position) => {
      insertMaster.run(id, name, normalized, timestamp, timestamp);
      insertExercise.run(`we-${position}`, id, position, name, timestamp, timestamp);
      for (let setPosition = 0; setPosition < 3; setPosition += 1) {
        insertSet.run(`set-${position}-${setPosition}`, `we-${position}`, setPosition, 82_500, 8, 10, 80_000, 10 - setPosition, `memo-${position}-${setPosition}`, timestamp, timestamp, timestamp);
      }
    });

    const exerciseRows = db.prepare('SELECT id, position, exercise_name_snapshot FROM workout_exercise WHERE workout_id = ? ORDER BY position').all('workout-integration');
    expect(exerciseRows.map((row) => row.exercise_name_snapshot)).toEqual(['テストスクワット', 'テストRDL', 'テストレッグカール']);
    const setRows = db.prepare('SELECT id, position, target_load_grams, target_rep_min, target_rep_max, actual_load_grams, actual_reps, memo FROM workout_set WHERE workout_exercise_id = ? AND deleted_at IS NULL ORDER BY position').all('we-0');
    expect(setRows).toHaveLength(3);
    expect(setRows.map((row) => row.position)).toEqual([0, 1, 2]);
    expect(setRows[0]).toMatchObject({ target_load_grams: 82_500, target_rep_min: 8, target_rep_max: 10, actual_load_grams: 80_000, actual_reps: 10, memo: 'memo-0-0' });

    db.prepare('DELETE FROM workout_set WHERE id = ?').run('set-0-1');
    const afterDelete = db.prepare('SELECT id FROM workout_set WHERE workout_exercise_id = ? ORDER BY position').all('we-0');
    expect(afterDelete.map((row) => row.id)).toEqual(['set-0-0', 'set-0-2']);
    expect(db.prepare('SELECT name FROM exercises').get()).toMatchObject({ name: '旧種目' });
    db.close();
  });
});
