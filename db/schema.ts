import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const exercises = sqliteTable(
  'exercises',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    bodyPart: text('body_part').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_exercises_body_part').on(table.bodyPart)],
);

export const workoutSessions = sqliteTable(
  'workout_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workoutDate: text('workout_date').notNull(),
    title: text('title').notNull(),
    bodyPart: text('body_part').notNull(),
    durationMinutes: integer('duration_minutes'),
    rating: integer('rating'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_workout_sessions_date').on(table.workoutDate)],
);

export const workoutSets = sqliteTable(
  'workout_sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'cascade' }),
    exerciseName: text('exercise_name').notNull(),
    setNumber: integer('set_number').notNull(),
    weight: integer('weight').notNull(),
    reps: integer('reps').notNull(),
    memo: text('memo').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_workout_sets_session').on(table.sessionId),
    index('idx_workout_sets_exercise').on(table.exerciseName),
  ],
);

export const coachMessages = sqliteTable('coach_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

// REPWISE v2 core. Legacy tables above are intentionally preserved so that
// Phase 1A can ship without rewriting or deleting existing workout records.
export const exerciseMaster = sqliteTable(
  'exercise_master',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('default'),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    bodyPart: text('body_part').notNull(),
    measurementType: text('measurement_type').notNull().default('weight_reps'),
    defaultRepMin: integer('default_rep_min'),
    defaultRepMax: integer('default_rep_max'),
    defaultWorkingSets: integer('default_working_sets'),
    defaultIncrementGrams: integer('default_increment_grams'),
    defaultRestSeconds: integer('default_rest_seconds'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_exercise_master_owner_body_part').on(
      table.ownerId,
      table.bodyPart,
    ),
    uniqueIndex('uq_exercise_master_owner_name').on(
      table.ownerId,
      table.normalizedName,
    ),
  ],
);

export const workouts = sqliteTable(
  'workout',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().default('default'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    localDate: text('local_date').notNull(),
    timezone: text('timezone').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    overallNote: text('overall_note').notNull().default(''),
    rating: integer('rating'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('idx_workout_owner_date').on(table.ownerId, table.localDate),
    index('idx_workout_owner_status').on(table.ownerId, table.status),
  ],
);

export const workoutExercises = sqliteTable(
  'workout_exercise',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exerciseMaster.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    status: text('status').notNull().default('planned'),
    exerciseNameSnapshot: text('exercise_name_snapshot').notNull(),
    note: text('note').notNull().default(''),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_workout_exercise_workout_position').on(
      table.workoutId,
      table.position,
    ),
    index('idx_workout_exercise_exercise').on(table.exerciseId),
  ],
);

export const workoutSetsV2 = sqliteTable(
  'workout_set',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    status: text('status').notNull().default('planned'),
    setType: text('set_type').notNull().default('working'),
    targetLoadGrams: integer('target_load_grams'),
    targetRepMin: integer('target_rep_min'),
    targetRepMax: integer('target_rep_max'),
    actualLoadGrams: integer('actual_load_grams'),
    actualReps: integer('actual_reps'),
    memo: text('memo').notNull().default(''),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('idx_workout_set_exercise_position').on(
      table.workoutExerciseId,
      table.position,
    ),
  ],
);

export const processedMutations = sqliteTable(
  'processed_mutation',
  {
    mutationId: text('mutation_id').primaryKey(),
    ownerId: text('owner_id').notNull().default('default'),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation').notNull(),
    baseVersion: integer('base_version').notNull().default(0),
    requestFingerprint: text('request_fingerprint').notNull(),
    resultJson: text('result_json').notNull(),
    processedAt: text('processed_at').notNull(),
  },
  (table) => [
    index('idx_processed_mutation_owner_entity').on(
      table.ownerId,
      table.entityType,
      table.entityId,
    ),
  ],
);
