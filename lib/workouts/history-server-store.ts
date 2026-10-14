import type { ExerciseHistoryEntry, ExerciseHistoryPage } from './history';
import type { WorkoutSet } from './types';

interface HistoryRow {
  workout_id: string;
  workout_exercise_id: string;
  workout_name: string;
  local_date: string;
  exercise_name_snapshot: string;
  note: string;
  overall_note: string;
}

interface SetRow {
  id: string;
  workout_exercise_id: string;
  position: number;
  status: WorkoutSet['status'];
  set_type: WorkoutSet['setType'];
  target_load_grams: number | null;
  target_rep_min: number | null;
  target_rep_max: number | null;
  actual_load_grams: number | null;
  actual_reps: number | null;
  memo: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getExerciseHistory(
  db: D1Database,
  exerciseId: string,
  options: {
    beforeDate?: string;
    beforeStartedAt?: string;
    excludeWorkoutId?: string;
    offset?: number;
    limit?: number;
  } = {},
): Promise<ExerciseHistoryPage> {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 30);
  const clauses = [
    'w.owner_id = ?',
    'we.exercise_id = ?',
    "w.status = 'completed'",
    'w.deleted_at IS NULL',
    `(we.status <> 'skipped' OR LENGTH(TRIM(we.note)) > 0 OR EXISTS (
      SELECT 1 FROM workout_set note_set WHERE note_set.workout_exercise_id = we.id
        AND note_set.deleted_at IS NULL AND LENGTH(TRIM(note_set.memo)) > 0
    ))`,
  ];
  const values: (string | number)[] = ['default', exerciseId];
  if (options.beforeDate && options.beforeStartedAt) {
    clauses.push(
      '(w.local_date < ? OR (w.local_date = ? AND julianday(COALESCE(w.ended_at, w.started_at)) < julianday(?)))',
    );
    values.push(
      options.beforeDate,
      options.beforeDate,
      options.beforeStartedAt,
    );
  } else if (options.beforeDate) {
    clauses.push('w.local_date <= ?');
    values.push(options.beforeDate);
  }
  if (options.excludeWorkoutId) {
    clauses.push('w.id <> ?');
    values.push(options.excludeWorkoutId);
  }
  const result = await db
    .prepare(`
    SELECT w.id AS workout_id, we.id AS workout_exercise_id,
           w.name AS workout_name, w.local_date, w.overall_note,
           we.exercise_name_snapshot, we.note
    FROM workout_exercise we JOIN workout w ON w.id = we.workout_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY w.local_date DESC, julianday(w.ended_at) DESC, julianday(w.started_at) DESC, w.id DESC, we.position
    LIMIT ? OFFSET ?
  `)
    .bind(...values, limit + 1, options.offset ?? 0)
    .all<HistoryRow>();
  const rows = result.results.slice(0, limit);
  // Search all eligible history for each slot, independently of pagination.
  const referenceResult = (options.offset ?? 0) === 0 ? await db.prepare(`
    SELECT * FROM (
      SELECT w.id AS workout_id, we.id AS workout_exercise_id,
        w.name AS workout_name, w.local_date, w.overall_note,
        we.exercise_name_snapshot, we.note, w.ended_at AS sort_ended_at, w.started_at AS sort_started_at,
        ROW_NUMBER() OVER (PARTITION BY ws.position ORDER BY w.local_date DESC,
          julianday(w.ended_at) DESC, julianday(w.started_at) DESC, w.id DESC, we.position) AS slot_rank
      FROM workout_exercise we JOIN workout w ON w.id = we.workout_id
      JOIN workout_set ws ON ws.workout_exercise_id = we.id
      WHERE ${clauses.join(' AND ')} AND we.status <> 'skipped' AND ws.deleted_at IS NULL
        AND ws.status = 'completed' AND ws.set_type = 'working'
        AND ws.actual_load_grams >= 0 AND ws.actual_reps > 0
        AND ws.actual_load_grams = CAST(ws.actual_load_grams AS INTEGER)
        AND ws.actual_reps = CAST(ws.actual_reps AS INTEGER)
    ) WHERE slot_rank = 1
    ORDER BY local_date DESC, julianday(sort_ended_at) DESC, julianday(sort_started_at) DESC, workout_id DESC
  `).bind(...values).all<HistoryRow>() : null;
  const referenceRows = referenceResult?.results ?? [];
  const allRows = [...new Map([...rows, ...referenceRows].map(row => [row.workout_exercise_id, row])).values()];
  if (!allRows.length) return { items: [], hasMore: false };
  // D1 limits bound parameters per statement; reference sessions may exceed a page.
  const setPages = await Promise.all(Array.from({ length: Math.ceil(allRows.length / 80) }, (_, index) => {
    const chunk = allRows.slice(index * 80, (index + 1) * 80);
    return db.prepare(`
      SELECT * FROM workout_set
      WHERE workout_exercise_id IN (${chunk.map(() => '?').join(', ')}) AND deleted_at IS NULL
      ORDER BY position, created_at, id
    `).bind(...chunk.map(row => row.workout_exercise_id)).all<SetRow>();
  }));
  const sets = setPages.flatMap(page => page.results);
  const entries: ExerciseHistoryEntry[] = allRows.map((row) => ({
    workoutId: row.workout_id,
    workoutExerciseId: row.workout_exercise_id,
    workoutName: row.workout_name,
    localDate: row.local_date,
    exerciseName: row.exercise_name_snapshot,
    note: row.note,
    overallNote: row.overall_note,
    sets: sets
      .filter((set) => set.workout_exercise_id === row.workout_exercise_id)
      .map((set) => ({
        id: set.id,
        position: Number(set.position),
        status: set.status,
        setType: set.set_type,
        targetLoadGrams: set.target_load_grams,
        targetRepMin: set.target_rep_min,
        targetRepMax: set.target_rep_max,
        actualLoadGrams: set.actual_load_grams,
        actualReps: set.actual_reps,
        memo: set.memo,
        completedAt: set.completed_at,
        createdAt: set.created_at,
        updatedAt: set.updated_at,
      })),
  }));
  const byId = new Map(entries.map(entry => [entry.workoutExerciseId, entry]));
  return { items: rows.map(row => byId.get(row.workout_exercise_id)!),
    hasMore: result.results.length > limit,
    ...(referenceResult ? { references: [...new Set(referenceRows.map(row => row.workout_exercise_id))].map(id => byId.get(id)!) } : {}),
  };
}
