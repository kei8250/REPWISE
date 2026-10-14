'use client';

import { useEffect, useState } from 'react';
import { ja } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { listWorkouts } from '@/lib/workouts/api-client';
import { localDateKey } from '@/lib/workouts/history';
import type { WorkoutSummary } from '@/lib/workouts/types';
import { APP_ROUTES, navigateTo } from '@/lib/routes';
import { useLocalToday } from '@/hooks/use-local-today';
import { readLocalWorkoutSources } from '@/lib/workouts/local-drafts';
import { mergeVisibleWorkouts } from '@/lib/workouts/visible-workouts';

export function WorkoutCalendar({ month: controlledMonth, onMonthChange, onSelectDate }: {
  month?: Date;
  onMonthChange?: (month: Date) => void;
  onSelectDate?: (date: string) => void;
} = {}) {
  const today = useLocalToday();
  const [selectedMonth, setMonth] = useState<Date | null>(null);
  const month = controlledMonth ?? selectedMonth ?? new Date(`${today || '2000-01-01'}T12:00:00`);
  const [attempt, setAttempt] = useState(0);
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
      const local = await readLocalWorkoutSources().catch(() => ({ drafts: [], mutations: [] }));
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
      if (alive) setState({ from, items: mergeVisibleWorkouts(items, local.drafts, local.mutations, 'completed', { from, to }), status: 'success' });
    })().catch(async () => {
      if (alive) {
        const local = await readLocalWorkoutSources().catch(() => ({ drafts: [], mutations: [] }));
        if (alive) setState({ from, items: mergeVisibleWorkouts([], local.drafts, local.mutations, 'completed', { from, to }, false), status: 'error' });
      }
    });
    return () => {
      alive = false;
    };
  }, [from, to, attempt, today]);
  const loading = state.from !== from;
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
      <div className="mx-auto max-w-md">
        <Calendar
          locale={ja}
          month={month}
          onMonthChange={(value) => { setMonth(value); onMonthChange?.(value); }}
          showOutsideDays={false}
          classNames={{ today: 'rounded-lg ring-1 ring-primary/40' }}
          className="w-full [--cell-size:--spacing(10)]"
          modifiers={{ trained: (date) => counts.has(localDateKey(date)) }}
          modifiersClassNames={{
            trained:
              'bg-primary/10 [&_button]:font-black [&_button]:text-primary',
          }}
          labels={{
            labelDayButton: (date) =>
              `${date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}、${counts.get(localDateKey(date)) ?? 0}件の完了したトレーニング、履歴を開く`,
          }}
          onDayClick={(date) => onSelectDate ? onSelectDate(localDateKey(date)) : navigateTo(`${APP_ROUTES.history}?date=${localDateKey(date)}`)}
        />
      </div>
      <div className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {loading ? (
          '記録のある日を確認中…'
        ) : state.status === 'error' ? (
          <div>
            <p>記録のある日を取得できませんでした。日付から履歴は開けます。</p>
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
