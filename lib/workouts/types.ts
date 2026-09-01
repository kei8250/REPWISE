export type WorkoutStatus = 'draft' | 'active' | 'completed' | 'abandoned';
export type WorkoutExerciseStatus = 'planned' | 'in_progress' | 'completed' | 'skipped';
export type WorkoutSetStatus = 'planned' | 'completed' | 'skipped';

export interface ExerciseMaster {
  id: string;
  name: string;
  normalizedName: string;
  bodyPart: string;
  measurementType: 'weight_reps';
  defaultRepMin: number | null;
  defaultRepMax: number | null;
  defaultWorkingSets: number | null;
  defaultIncrementGrams: number | null;
  defaultRestSeconds: number | null;
}

export interface WorkoutSet {
  id: string;
  position: number;
  status: WorkoutSetStatus;
  setType: 'working';
  targetLoadGrams: number | null;
  targetRepMin: number | null;
  targetRepMax: number | null;
  actualLoadGrams: number | null;
  actualReps: number | null;
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
  exercises: WorkoutExercise[];
}

export interface WorkoutSummary {
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
  id?: string;
  name: string;
  bodyPart: string;
}

export type SaveState = 'loading' | 'saved' | 'saving' | 'error';
