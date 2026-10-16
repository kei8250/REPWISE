'use client';

import { useEffect, useRef, useState } from 'react';
import { useSavedGoals } from '@/hooks/use-goal-progress';
import type { TrainingGoal } from '@/lib/goals/model';
import { formatKilograms } from '@/lib/analytics/detail-view';
import { ja } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { listWorkouts } from '@/lib/workouts/api-client';
import { localDateKey } from '@/lib/workouts/history';
import type { WorkoutSummary } from '@/lib/workouts/types';
import { APP_ROUTES, navigateTo, workoutRoute } from '@/lib/routes';
import { useLocalToday } from '@/hooks/use-local-today';
import { readLocalWorkoutSources } from '@/lib/workouts/local-drafts';
import { mergeVisibleWorkouts } from '@/lib/workouts/visible-workouts';

export function workoutsOnDate(items: WorkoutSummary[], date: string) {
  return items
    .filter((item) => item.localDate === date)
    .sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id),
    );
}

export function goalsOnDate(goals: TrainingGoal[], date: string) {
  return goals.filter(
    (goal) => goal.status !== 'archived' && goal.deadline === date,
  );
}

export function WorkoutCalendar({
  month: controlledMonth,
  onMonthChange,
  onSelectDate,
}: {
  month?: Date;
  onMonthChange?: (month: Date) => void;
  onSelectDate?: (date: string) => void;
} = {}) {
  const today = useLocalToday();
  const savedGoals = useSavedGoals();
  const goals = savedGoals.goals.filter((goal) => goal.status !== 'archived');
  const [selectedMonth, setMonth] = useState<Date | null>(null);
  const month =
    controlledMonth ??
    selectedMonth ??
    new Date(`${today || '2000-01-01'}T12:00:00`);
  const [attempt, setAttempt] = useState(0);
  const [selectedDay, setSelectedDay] = useState<{
    from: string;
    date: string;
  } | null>(null);
  const calendarRoot = useRef<HTMLDivElement>(null);
  const selectedDayLabel = useRef<string | null>(null);
  const from = localDateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const to = localDateKey(
    new Date(month.getFullYear(), month.getMonth() + 1, 0),
  );
  const [state, setState] = useState<{
    from: string;
    items: WorkoutSummary[];
    status: 'success' | 'error';
  }>({ from: '', items: [], status: 'success' });
  useEffect(() => {
    if (!today) return;
    let alive = true;
    void (async () => {
      const items: WorkoutSummary[] = [];
      while (alive) {
        const page = await listWorkouts('completed', 100, undefined, {
          from,
          to,
          offset: items.length,
        });
        items.push(...page);
        if (page.length < 100) break;
      }
      const local = await readLocalWorkoutSources();
      if (alive)
        setState({
          from,
          items: mergeVisibleWorkouts(
            items,
            local.drafts,
            local.mutations,
            'completed',
            { from, to },
          ),
          status: 'success',
        });
    })().catch(async () => {
      if (alive) {
        const local = await readLocalWorkoutSources().catch(() => ({
          drafts: [],
          mutations: [],
        }));
        if (alive)
          setState({
            from,
            items: mergeVisibleWorkouts(
              [],
              local.drafts,
              local.mutations,
              'completed',
              { from, to },
              false,
            ),
            status: 'error',
          });
      }
    });
    return () => {
      alive = false;
    };
  }, [from, to, attempt, today]);
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1);
    window.addEventListener('repwise-sync-queue-change', refresh);
    return () =>
      window.removeEventListener('repwise-sync-queue-change', refresh);
  }, []);
  const loading = state.from !== from;
  const selectedWorkouts =
    selectedDay?.from === from && !loading
      ? workoutsOnDate(state.items, selectedDay.date)
      : [];
  const selectedGoals =
    selectedDay?.from === from ? goalsOnDate(goals, selectedDay.date) : [];
  const monthGoals = goals
    .filter((goal) => goal.deadline >= from && goal.deadline <= to)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const upcoming = [...goals]
    .filter((goal) => goal.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  const goalDates = new Set(goals.map((goal) => goal.deadline));
  const counts = new Map<string, number>();
  if (!loading)
    for (const item of state.items)
      counts.set(item.localDate, (counts.get(item.localDate) ?? 0) + 1);
  if (!today)
    return (
      <section className="rounded-3xl border bg-card p-5">
        <h2 className="text-lg font-black">トレーニングカレンダー</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          カレンダーを準備中…
        </p>
      </section>
    );
  return (
    <section
      aria-labelledby="workout-calendar-heading"
      className="rounded-3xl border bg-card p-5"
    >
      <div className="mb-4">
        <h2 id="workout-calendar-heading" className="text-lg font-black">
          トレーニングカレンダー
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          日付を押して、その日のセットとメモを振り返る
        </p>
      </div>
      {upcoming && (
        <button
          type="button"
          className="mb-3 min-h-11 rounded-xl border px-3 text-sm font-bold text-primary"
          onClick={() => {
            const next = new Date(`${upcoming.deadline}T12:00:00`);
            setMonth(next);
            onMonthChange?.(next);
          }}
        >
          次の目標日へ（{upcoming.deadline}）
        </button>
      )}
      {savedGoals.error && (
        <p role="alert" className="mb-3 text-xs text-muted-foreground">
          目標日を読み込めません。目標設定で保存状態を確認してください。
        </p>
      )}
      <div ref={calendarRoot} className="mx-auto max-w-md">
        <Calendar
          locale={ja}
          month={month}
          onMonthChange={(value) => {
            setMonth(value);
            onMonthChange?.(value);
          }}
          showOutsideDays={false}
          classNames={{ today: 'rounded-lg ring-1 ring-primary/40' }}
          className="w-full [--cell-size:--spacing(10)]"
          modifiers={{
            trained: (date) => counts.has(localDateKey(date)),
            goal_deadline: (date) => goalDates.has(localDateKey(date)),
          }}
          modifiersClassNames={{
            goal_deadline:
              'relative after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:z-20 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-amber-500',
            trained:
              'bg-primary/10 [&_button]:font-black [&_button]:text-primary',
          }}
          labels={{
            labelNext: () => '次の月へ',
            labelPrevious: () => '前の月へ',
            labelDayButton: (date) =>
              `${date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}、${counts.get(localDateKey(date)) ?? 0}件の完了したトレーニング、${goalsOnDate(
                goals,
                localDateKey(date),
              )
                .map((goal) => `${goal.exerciseName}の目標日`)
                .join(
                  '・',
                )}、${onSelectDate ? '履歴を絞り込む' : '記録を開く'}`,
          }}
          disabled={
            onSelectDate
              ? undefined
              : (date) =>
                  !counts.has(localDateKey(date)) &&
                  !goalDates.has(localDateKey(date))
          }
          onDayClick={(date, _modifiers, event) => {
            const key = localDateKey(date);
            if (onSelectDate) {
              onSelectDate(key);
              return;
            }
            const matches = workoutsOnDate(state.items, key);
            if (goalsOnDate(goals, key).length > 0) {
              selectedDayLabel.current =
                event.currentTarget.getAttribute('data-day');
              setSelectedDay({ from, date: key });
              return;
            }
            if (matches.length === 1)
              navigateTo(workoutRoute(matches[0].id, matches[0].status));
            else if (matches.length > 1) {
              selectedDayLabel.current =
                event.currentTarget.getAttribute('data-day');
              setSelectedDay({ from, date: key });
            }
          }}
        />
      </div>
      <Dialog
        open={selectedWorkouts.length > 1 || selectedGoals.length > 0}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() =>
            Array.from(
              calendarRoot.current?.querySelectorAll<HTMLButtonElement>(
                'button[data-day]',
              ) ?? [],
            ).find(
              (button) => button.dataset.day === selectedDayLabel.current,
            ) ?? false
          }
          className="max-h-[80dvh] overflow-y-auto"
        >
          <DialogTitle className="text-lg font-black">
            {selectedDay?.date}
            {selectedGoals.length ? 'の目標と記録' : 'の記録'}
          </DialogTitle>
          <DialogDescription>
            この日の目標や、開きたいトレーニングの記録を確認してください。
          </DialogDescription>
          {selectedGoals.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-bold">この日が目標日</h3>
              {selectedGoals.map((goal) => (
                <a
                  key={goal.id}
                  href={`${APP_ROUTES.goals}#goal-${encodeURIComponent(goal.id)}`}
                  className="block min-h-11 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <span className="block break-words font-bold">
                    {goal.exerciseName}
                    {goal.status === 'paused' ? '（一時停止中）' : ''}
                  </span>
                  <span className="text-sm">
                    {formatKilograms(goal.targetLoadGrams)} × {goal.targetReps}
                    回
                  </span>
                </a>
              ))}
            </div>
          )}
          <ul className="space-y-2">
            {selectedWorkouts.map((item) => (
              <li key={item.id}>
                <a
                  href={workoutRoute(item.id, item.status)}
                  className="block min-h-11 rounded-xl border p-3 hover:bg-muted"
                >
                  <span className="block break-words font-bold">
                    {item.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {new Date(item.startedAt).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {item.exerciseCount}種目 · {item.completedSetCount}
                    セット完了
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <DialogClose
            render={<Button variant="outline" className="min-h-11" />}
          >
            カレンダーへ戻る
          </DialogClose>
        </DialogContent>
      </Dialog>
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="mr-2 inline-block size-2 rounded-full bg-amber-500" />
        黄色い点は目標日（記録と同じ日でも両方表示）
      </p>
      {monthGoals.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-500/5 p-3">
          <h3 className="text-sm font-bold">表示月の目標日</h3>
          {monthGoals.map((goal) => (
            <button
              type="button"
              key={goal.id}
              className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
              onClick={() => setSelectedDay({ from, date: goal.deadline })}
            >
              <time>{goal.deadline}</time>
              <span className="break-words font-bold">{goal.exerciseName}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {loading ? (
          '記録のある日を確認中…'
        ) : state.status === 'error' ? (
          <div>
            <p>
              サーバーの記録を取得できませんでした。この端末で確認できる記録を表示しています。
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setState((previous) => ({ ...previous, from: '' }));
                setAttempt((value) => value + 1);
              }}
            >
              再試行
            </Button>
          </div>
        ) : (
          <p>
            <span className="mr-2 inline-block size-3 rounded bg-primary/20" />
            色の付いた日は記録あり · 今月 {counts.size}日 / {state.items.length}
            回
          </p>
        )}
      </div>
    </section>
  );
}
