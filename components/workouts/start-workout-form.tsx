'use client';

import { useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLocalWorkout } from '@/lib/workouts/draft';
import { saveWorkoutDraftAndEnqueueMutation } from '@/lib/workouts/local-drafts';
import { syncPendingWorkoutMutations } from '@/lib/workouts/sync-queue';
import { APP_ROUTES, navigateTo } from '@/lib/routes';
import { defaultWorkoutName } from '@/lib/workouts/history';
import { useLocalToday } from '@/hooks/use-local-today';

export function StartWorkoutForm() {
  const today = useLocalToday();
  const [selectedDate, setLocalDate] = useState<string | null>(null);
  const localDate = selectedDate ?? today;
  const [customName, setCustomName] = useState<string | null>(null);
  const name = customName ?? defaultWorkoutName(localDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const workout = createLocalWorkout({
        name: name.trim() || defaultWorkoutName(localDate),
        localDate,
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
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
    }
  }
  return (
    <form
      onSubmit={(event) => void start(event)}
      className="space-y-5 rounded-[28px] border bg-card p-5 shadow-sm sm:p-7"
    >
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
          日付の名前のまま開始できます。
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
        disabled={loading}
        className="h-12 w-full rounded-xl"
      >
        {loading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{' '}
        記録を開始
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        開始後は入力内容が自動保存されます。種目は次の画面で追加します。
      </p>
    </form>
  );
}
