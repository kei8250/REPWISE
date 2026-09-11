export type AcceptedNextTargetStatus = 'accepted' | 'applied' | 'superseded';

export type AcceptedNextTargetValidity =
  | 'valid'
  | 'stale_source_version'
  | 'source_deleted';

export interface AcceptedNextTarget {
  id: string;
  mutationId: string;
  exerciseId: string;
  sourceWorkoutId: string;
  sourceWorkoutVersion: number;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  targetWorkingSets: number;
  status: AcceptedNextTargetStatus;
  appliedWorkoutId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptedNextTargetSummary extends AcceptedNextTarget {
  validity: AcceptedNextTargetValidity;
}

export interface AcceptNextTargetInput {
  mutationId: string;
  exerciseId: string;
  sourceWorkoutId: string;
  sourceWorkoutVersion: number;
}

export interface AcceptNextTargetResult {
  duplicate: boolean;
  target: AcceptedNextTargetSummary;
}

export interface ApplicableAcceptedTarget {
  id: string;
  exerciseId: string;
  sourceWorkoutId: string;
  sourceWorkoutVersion: number;
  targetLoadGrams: number;
  targetRepMin: number;
  targetRepMax: number;
  targetWorkingSets: number;
}
