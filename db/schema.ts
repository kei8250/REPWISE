import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const exercises = sqliteTable('exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  bodyPart: text('body_part').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_exercises_body_part').on(table.bodyPart)]);

export const workoutSessions = sqliteTable('workout_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  workoutDate: text('workout_date').notNull(),
  title: text('title').notNull(),
  bodyPart: text('body_part').notNull(),
  durationMinutes: integer('duration_minutes'),
  rating: integer('rating'),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_workout_sessions_date').on(table.workoutDate)]);

export const workoutSets = sqliteTable('workout_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id').notNull().references(() => workoutSessions.id, { onDelete: 'cascade' }),
  exerciseName: text('exercise_name').notNull(),
  setNumber: integer('set_number').notNull(),
  weight: integer('weight').notNull(),
  reps: integer('reps').notNull(),
  memo: text('memo').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_workout_sets_session').on(table.sessionId), index('idx_workout_sets_exercise').on(table.exerciseName)]);

export const coachMessages = sqliteTable('coach_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});
