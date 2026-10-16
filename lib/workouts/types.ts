import type { RepMode, LoadBasis, SetRole } from './reps';
export type WorkoutStatus = 'draft' | 'active' | 'completed' | 'abandoned';
export type WorkoutExerciseStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'skipped';
export type WorkoutSetStatus = 'planned' | 'completed' | 'skipped';

export interface ExerciseMaster {
  loadBasis?: LoadBasis;
  id: string;
  name: string;
  normalizedName: string;
  bodyPart: string;
  measurementType: 'weight_reps';
  repMode?: RepMode;
  defaultRepMin: number | null;
  defaultRepMax: number | null;
  defaultWorkingSets: number | null;
  defaultIncrementGrams: number | null;
  defaultRestSeconds: number | null;
}

export interface WorkoutSet {
  loadBasis?: LoadBasis;
  role?: SetRole;
  id: string;
  position: number;
  status: WorkoutSetStatus;
  setType: 'working';
  targetLoadGrams: number | null;
  targetRepMin: number | null;
  targetRepMax: number | null;
  actualLoadGrams: number | null;
  actualReps: number | null;
  actualRepsLeft?: number | null;
  actualRepsRight?: number | null;
  memo: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  position: number;
  status: WorkoutExerciseStatus;
  exerciseNameSnapshot: string;
  repMode?: RepMode;
  note: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string;
  status: WorkoutStatus;
  localDate: string;
  timezone: string;
  startedAt: string;
  endedAt: string | null;
  overallNote: string;
  rating: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  sourceWorkoutId: string | null;
  exercises: WorkoutExercise[];
}

export interface WorkoutSummary {
  localOnly?: boolean;
  pendingSync?: boolean;
  id: string;
  name: string;
  status: WorkoutStatus;
  localDate: string;
  startedAt: string;
  endedAt: string | null;
  exerciseCount: number;
  setCount: number;
  completedSetCount: number;
  totalVolumeGrams: number;
}

export interface CreateWorkoutInput {
  id?: string;
  name: string;
  localDate: string;
  timezone: string;
  startedAt?: string;
}

export interface CreateExerciseMasterInput {
  loadBasis?: LoadBasis;
  repMode?: RepMode;
  id?: string;
  name: string;
  bodyPart: string;
}

export type UpdateExerciseMasterInput = Pick<ExerciseMaster, 'name' | 'bodyPart' | 'defaultRepMin' | 'defaultRepMax' | 'defaultWorkingSets' | 'defaultIncrementGrams' | 'defaultRestSeconds' | 'repMode' | 'loadBasis'>;

export type WorkoutMutationOperation =
  | 'create'
  | 'replace'
  | 'complete'
  | 'edit'
  | 'delete'
  | 'restore';
export type WorkoutMutationSyncStatus =
  | 'pending'
  | 'syncing'
  | 'failed'
  | 'blocked'
  | 'conflict';

export interface WorkoutMutationPayload {
  permanentDelete?: true;
  workout: Workout;
}

export interface WorkoutMutationInput {
  mutationId: string;
  entityType: 'workout';
  entityId: string;
  operation: WorkoutMutationOperation;
  baseVersion: number;
  payload: WorkoutMutationPayload;
  createdAt: string;
}

export interface WorkoutMutation extends WorkoutMutationInput {
  sequence: number;
  workoutId: string;
  retryCount: number;
  syncStatus: WorkoutMutationSyncStatus;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface WorkoutMutationResult {
  permanentlyDeleted?: true;
  mutationId: string;
  duplicate: boolean;
  workout: Workout;
}

export interface WorkoutVersionConflictDetails {
  type: 'stale' | 'ahead';
  baseVersion: number;
  serverVersion: number;
  serverUpdatedAt: string;
}

export type SaveState =
  | 'loading'
  | 'saved'
  | 'saving'
  | 'pending'
  | 'error'
  | 'conflict';
