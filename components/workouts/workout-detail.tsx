'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronLeft, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getWorkout } from '@/lib/workouts/api-client';
import type { Workout } from '@/lib/workouts/types';
import { APP_ROUTES } from '@/lib/routes';

export function WorkoutDetail({ id }: { id: string }) {
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getWorkout(id)
      .then(setWorkout)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : '記録を読み込めませんでした',
        ),
      );
  }, [id]);
  if (!workout)
    return (
      <div className="grid min-h-72 place-items-center">
        {error ? (
          <p className="text-sm font-bold text-destructive">{error}</p>
        ) : (
          <LoaderCircle className="animate-spin text-primary" />
        )}
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-7 lg:py-10">
      <a
        href={APP_ROUTES.history}
        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
      >
        <ChevronLeft /> 履歴へ
      </a>
      <div>
        <Badge variant="secondary">
          {workout.status === 'completed' ? '完了済み' : '入力途中'}
        </Badge>
        <h1 className="mt-3 text-3xl font-black">{workout.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {workout.localDate} · {workout.exercises.length}種目
        </p>
      </div>
      {workout.exercises.map((exercise, exerciseIndex) => (
        <Card key={exercise.id} className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <p className="text-xs font-bold text-primary">
              EXERCISE {exerciseIndex + 1}
            </p>
            <h2 className="mt-1 text-xl font-black">
              {exercise.exerciseNameSnapshot}
            </h2>
            <div className="mt-4 space-y-2">
              {exercise.sets.map((set, setIndex) => (
                <div key={set.id} className="rounded-xl bg-muted/65 p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid size-7 place-items-center rounded-full bg-card text-xs font-black">
                      {set.status === 'completed' ? (
                        <Check className="size-4 text-primary" />
                      ) : (
                        setIndex + 1
                      )}
                    </span>
                    <p className="font-black">
                      {set.actualLoadGrams === null
                        ? '—'
                        : `${set.actualLoadGrams / 1000} kg`}{' '}
                      × {set.actualReps ?? '—'} reps
                    </p>
                  </div>
                  {(set.targetLoadGrams !== null ||
                    set.targetRepMin !== null ||
                    set.targetRepMax !== null) && (
                    <p className="mt-2 pl-10 text-xs text-muted-foreground">
                      目標:{' '}
                      {set.targetLoadGrams === null
                        ? '—'
                        : `${set.targetLoadGrams / 1000} kg`}{' '}
                      × {set.targetRepMin ?? '—'}〜{set.targetRepMax ?? '—'}{' '}
                      reps
                    </p>
                  )}
                  {set.memo && (
                    <p className="mt-2 pl-10 text-sm text-muted-foreground">
                      {set.memo}
                    </p>
                  )}
                </div>
              ))}
            </div>
            {exercise.note && (
              <p className="mt-4 rounded-xl border p-3 text-sm text-muted-foreground">
                {exercise.note}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
      {workout.overallNote && (
        <Card className="rounded-3xl py-5 shadow-none">
          <CardContent className="px-5">
            <p className="text-sm font-black">全体メモ</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {workout.overallNote}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
