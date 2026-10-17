'use client';

import { useRef, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeRecordedWorkout } from '@/lib/workouts/instant-recording';
import {
  createLocalWorkout,
  createWorkoutExercise,
} from '@/lib/workouts/draft';
import { saveWorkoutDraftAndEnqueueMutation } from '@/lib/workouts/local-drafts';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import { APP_ROUTES, navigateTo } from '@/lib/routes';
import { defaultWorkoutName } from '@/lib/workouts/history';
import { useLocalToday } from '@/hooks/use-local-today';
import { ExercisePicker } from './exercise-picker';
import type { ExerciseMaster } from '@/lib/workouts/types';

export function StartWorkoutForm() {
  const today = useLocalToday();
  const [selectedDate, setLocalDate] = useState<string | null>(null);
  const localDate = selectedDate ?? today;
  const [customName, setCustomName] = useState<string | null>(null);
  const name = customName ?? defaultWorkoutName(localDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const creating = useRef(false);
  async function start(exercise: ExerciseMaster) {
    if (creating.current) return;
    creating.current = true;
    setLoading(true);
    setError(null);
    try {
      const workout = normalizeRecordedWorkout({
        ...createLocalWorkout({
          name: name.trim() || defaultWorkoutName(localDate),
          localDate,
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
        }),
        exercises: [createWorkoutExercise(exercise, 0)],
      });
      await saveWorkoutDraftAndEnqueueMutation(workout, 'create', {
        localUpdatedAt: workout.updatedAt,
        serverUpdatedAt: null,
      });
      void syncPendingWorkoutMutations(workout.id).catch(() => undefined);
      navigateTo(APP_ROUTES.activeWorkout(workout.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '開始できませんでした');
      setLoading(false);
      creating.current = false;
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading) setPickerOpen(true);
      }}
      className="space-y-5 rounded-[28px] border bg-card p-5 shadow-sm sm:p-7"
    >
      <ExercisePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludedIds={[]}
        onSelect={(exercise) => void start(exercise)}
      />
      <div>
        <label htmlFor="workout-name" className="block text-sm font-bold">
          トレーニング名（任意）
        </label>
        <Input
          id="workout-name"
          value={name}
          placeholder={defaultWorkoutName(localDate)}
          onChange={(event) => setCustomName(event.target.value)}
          maxLength={80}
          className="mt-2 h-11"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          名前を変えず、日付のまま記録することもできます。
        </p>
      </div>
      <div>
        <label htmlFor="workout-date" className="block text-sm font-bold">
          日付
        </label>
        <Input
          id="workout-date"
          type="date"
          value={localDate}
          onChange={(event) => setLocalDate(event.target.value)}
          className="mt-2 h-11"
          required
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={loading || !today || !localDate}
        className="h-12 w-full rounded-xl"
      >
        {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{' '}
        種目を選ぶ
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        重量と回数を入力すると、自動でその日の記録に反映されます。あとから編集・削除できます。
      </p>
    </form>
  );
}
