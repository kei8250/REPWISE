import { formatWorkingSetPerformance } from '@/lib/progression/completion-summary';
import { prepareWorkoutCompletion } from '@/lib/workouts/completion';
import { createLocalWorkout } from '@/lib/workouts/draft';
import type { WorkoutSet } from '@/lib/workouts/types';
import { applySuggestionToEmptyTargets } from '@/lib/progression/active-workout';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSet } from '@/lib/workouts/draft';
import {
  referenceAt,
  targetFromReference,
  validReferenceSet,
  type ExerciseHistoryEntry,
} from '@/lib/workouts/history';
import { progressionProgress } from '@/lib/progression/explanation';
import {
  evaluateProgression,
  type ProgressionExercisePerformance,
  type ProgressionProfile,
} from '@/lib/progression/engine';
import { WorkoutSetRow } from '@/components/workouts/workout-set-row';
import { ExerciseProgression } from '@/components/workouts/exercise-progression';

const previous = {
  ...createSet(1),
  status: 'completed' as const,
  actualLoadGrams: 82500,
  actualReps: 10,
  memo: '肩を下げる',
};
const entry = (
  id: string,
  sets: WorkoutSet[] = [previous],
): ExerciseHistoryEntry => ({
  workoutId: id,
  workoutExerciseId: id,
  workoutName: id,
  exerciseName: 'ベンチ',
  localDate: '2026-10-10',
  note: 'フォーム優先',
  overallNote: '',
  sets,
});
const profile: ProgressionProfile = {
  exerciseId: 'bench',
  repMin: 8,
  repMax: 12,
  workingSets: 3,
  incrementGrams: 1250,
  progressionType: 'double_progression',
};
const performance: ProgressionExercisePerformance = {
  workoutId: 'past',
  workoutVersion: 1,
  workoutLocalDate: '2026-10-10',
  workoutUpdatedAt: '',
  workoutStatus: 'completed',
  workoutDeletedAt: null,
  workoutExerciseId: 'e',
  exerciseId: 'bench',
  exerciseStatus: 'completed',
  sets: [
    { ...previous, position: 0 },
    { ...previous, id: '2', position: 1, actualReps: 12 },
    {
      ...previous,
      id: '3',
      position: 2,
      status: 'skipped',
      actualLoadGrams: null,
      actualReps: null,
    },
  ],
};

describe('mobile progressive overload workflow', () => {
  it('does not shift missing slots and ignores incomplete, skipped and invalid actuals', () => {
    const records = [
      entry('incomplete', [
        { ...previous, status: 'planned', memo: '痛みのメモ' },
      ]),
      entry('skipped', [{ ...previous, status: 'skipped' }]),
      entry('valid'),
    ];
    expect(referenceAt(records, 1)?.entry.workoutId).toBe('valid');
    expect(referenceAt(records, 0)).toBeNull();
    expect(records[0].sets[0].memo).toBe('痛みのメモ');
    expect(validReferenceSet({ ...previous, actualLoadGrams: 0 })).toBe(true);
    for (const actualReps of [0, -1, 1.5, null])
      expect(validReferenceSet({ ...previous, actualReps })).toBe(false);
  });

  it('reference copy changes only targets; finishing a target-only workout cannot manufacture actuals', () => {
    const set = createSet(1);
    const copied = targetFromReference(set, previous);
    expect(copied).toEqual({
      ...set,
      targetLoadGrams: 82500,
      targetRepMin: 10,
      targetRepMax: 10,
    });
    expect(copied.actualLoadGrams).toBeNull();
    expect(copied.actualReps).toBeNull();
    expect(copied.status).toBe('planned');
    const workout = createLocalWorkout({
      name: 'テスト',
      localDate: '2026-10-14',
      timezone: 'Asia/Tokyo',
    });
    workout.exercises = [
      {
        id: 'e',
        exerciseId: 'bench',
        position: 0,
        status: 'in_progress',
        exerciseNameSnapshot: 'ベンチ',
        note: '',
        startedAt: '',
        completedAt: null,
        createdAt: '',
        updatedAt: '',
        sets: [copied],
      },
    ];
    expect(() => prepareWorkoutCompletion(workout)).toThrow('1つ以上');
    expect(workout.exercises[0].sets[0].actualLoadGrams).toBeNull();
    const target = evaluateProgression(
      {
        ...performance,
        sets: performance.sets.map((set) => ({
          ...set,
          status: 'completed',
          actualLoadGrams: 82500,
          actualReps: 12,
        })),
      },
      profile,
    ).nextTarget!;
    const exercise = {
      ...workout.exercises[0],
      sets: [createSet(0), copied, { ...createSet(2), targetLoadGrams: 90000 }],
    };
    const applied = applySuggestionToEmptyTargets(exercise, target);
    expect(applied.sets[0]).toMatchObject({
      targetLoadGrams: 83750,
      actualLoadGrams: null,
      actualReps: null,
    });
    expect(applied.sets[1]).toEqual(copied);
    expect(applied.sets[2]).toEqual(exercise.sets[2]);
    const skipped = {
      ...exercise,
      sets: [{ ...createSet(0), status: 'skipped' as const }],
    };
    expect(applySuggestionToEmptyTargets(skipped, target).sets).toEqual(
      skipped.sets,
    );

    const existing = {
      ...set,
      actualLoadGrams: 80000,
      actualReps: 9,
      memo: '今のメモ',
    };
    expect(targetFromReference(existing, previous)).toMatchObject({
      actualLoadGrams: 80000,
      actualReps: 9,
      memo: '今のメモ',
    });
  });

  it('shows partial achievements while the unchanged engine withholds incomplete recommendations', () => {
    expect(progressionProgress(performance, profile)).toEqual({
      required: 3,
      recorded: 3,
      completed: 2,
      atMinimum: 2,
      atMaximum: 1,
    });
    expect(evaluateProgression(performance, profile).status).toBe(
      'insufficient_data',
    );
    const skippedWithInputs = { ...performance, sets: performance.sets.map((set, index) => ({ ...set, actualLoadGrams: 82500, actualReps: 10, status: index === 2 ? 'skipped' : 'completed' })) };
    expect(formatWorkingSetPerformance(skippedWithInputs)).toContain('未完了・スキップ');

    const mixed = {
      ...performance,
      sets: performance.sets.map((set, index) => ({
        ...set,
        status: 'completed',
        actualReps: 12,
        actualLoadGrams: index === 1 ? 80000 : 82500,
      })),
    };
    expect(evaluateProgression(mixed, profile).reasonCode).toBe(
      'inconsistent_load',
    );
    const uniform = {
      ...mixed,
      sets: mixed.sets.map((set) => ({ ...set, actualLoadGrams: 82500 })),
    };
    expect(evaluateProgression(uniform, profile).nextTarget?.loadGrams).toBe(
      83750,
    );
  });

  it('always renders targets, notes and separate actual fields on unfinished sets; compacts completed sets', () => {
    const props = {
      set: {
        ...createSet(1),
        targetLoadGrams: 85000,
        targetRepMin: 8,
        targetRepMax: 12,
      },
      number: 2,
      onChange: () => {},
      onDelete: () => {},
      canDelete: true,
      isFirst: false,
      isLast: false,
      onMove: () => {},
      comparison: { status: 'unavailable' as const, label: null },
      previousRecords: [
        {
          localDate: '2026-10-10',
          label: '直近の有効実績',
          set: previous,
          exerciseNote: 'フォーム優先',
        },
      ],
      isNext: true,
    };
    const html = renderToStaticMarkup(createElement(WorkoutSetRow, props));
    expect(html).toContain('今回の目標');
    expect(html).toContain('セット後の実績');
    expect(html).toContain('肩を下げる');
    expect(html).toContain('フォーム優先');
    expect(html).toContain('inputMode="decimal"');
    expect(html).not.toContain('<details');
    const compact = renderToStaticMarkup(
      createElement(WorkoutSetRow, { ...props, set: previous }),
    );
    expect(compact).toContain('確認・編集');
    expect(compact).not.toContain('<input');
  });

  it('shows different per-set targets even when the recommendation cannot load', () => {
    const exercise = {
      id: 'e',
      exerciseId: 'bench',
      position: 0,
      status: 'in_progress' as const,
      exerciseNameSnapshot: 'ベンチ',
      note: '',
      startedAt: '',
      completedAt: null,
      createdAt: '',
      updatedAt: '',
      sets: [
        {
          ...createSet(0),
          targetLoadGrams: 85000,
          targetRepMin: 8,
          targetRepMax: 10,
        },
        {
          ...createSet(1),
          targetLoadGrams: 80000,
          targetRepMin: 10,
          targetRepMax: 12,
        },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(ExerciseProgression, {
        exercise,
        state: { status: 'error', recommendation: null, error: 'offline' },
        onRetry: () => {},
      }),
    );
    expect(html).toContain('85 kg');
    expect(html).toContain('80 kg');
    expect(html).toContain('8〜10回');
    expect(html).toContain('10〜12回');
    expect(html).toContain('取得できません');
  });
});
