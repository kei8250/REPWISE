'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocalToday } from '@/hooks/use-local-today';
import { adjacentMonth, monthBounds } from '@/lib/workouts/history-navigation';
import { isLocalDate, localDateKey } from '@/lib/workouts/history';
import type { WorkoutHistoryFilter } from '@/lib/workouts/history';
import { APP_ROUTES } from '@/lib/routes';
import { WorkoutCalendar } from './workout-calendar';
import { WorkoutSummaryList } from './workout-summary-list';

export function HistoryBrowser({
  initialDate,
  initialMonth,
  initialStatus = 'completed',
  initialAll = false,
  initialExerciseName = '',
  initialBodyPart = '',
}: {
  initialDate?: string;
  initialMonth?: string;
  initialStatus?: 'active' | 'completed';
  initialAll?: boolean;
  initialExerciseName?: string;
  initialBodyPart?: string;
}) {
  const [exerciseName, setExerciseName] = useState(initialExerciseName);
  const [bodyPart, setBodyPart] = useState(initialBodyPart);
  const today = useLocalToday();
  const [selectedMonth, setMonth] = useState(
    initialMonth ?? initialDate?.slice(0, 7),
  );
  const [date, setDate] = useState(initialDate);
  const [status, setStatus] = useState(initialStatus);
  const [all, setAll] = useState(initialAll);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const month = selectedMonth ?? today.slice(0, 7);
  if (!month)
    return <p className="p-6 text-sm text-muted-foreground">履歴を準備中…</p>;
  const period: WorkoutHistoryFilter = date
    ? { from: date, to: date }
    : all
      ? {}
      : monthBounds(month);
  const update = (next: {
    month?: string;
    date?: string;
    status: 'active' | 'completed';
    all: boolean;
  }) => {
    setMonth(next.month);
    setDate(next.date);
    setStatus(next.status);
    setAll(next.all);
    const query = new URLSearchParams({
      month: next.all ? 'all' : (next.month ?? month),
      status: next.status,
    });
    if (next.date) query.set('date', next.date);
    if (exerciseName) query.set('exerciseName', exerciseName);
    if (bodyPart) query.set('bodyPart', bodyPart);
    window.history.replaceState(null, '', `${APP_ROUTES.history}?${query}`);
  };
  const chooseMonth = (value: string) => {
    if (isLocalDate(`${value}-01`))
      update({ month: value, status, all: false });
  };
  const chooseDate = (value: string) => {
    if (isLocalDate(value))
      update({ month: value.slice(0, 7), date: value, status, all: false });
  };
  const label = date
    ? `${date}の記録`
    : all
      ? 'すべての期間'
      : `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月の記録`;
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-7 lg:pt-10">
      <section className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
        <fieldset className="m-0 flex min-w-0 gap-2 border-0 p-0">
          <legend className="sr-only">表示する記録</legend>
          <Button
            type="button"
            variant={status === 'completed' ? 'default' : 'outline'}
            aria-pressed={status === 'completed'}
            className="flex-1"
            onClick={() => update({ month, date, status: 'completed', all })}
          >
            完了済み
          </Button>
          <Button
            type="button"
            variant={status === 'active' ? 'default' : 'outline'}
            aria-pressed={status === 'active'}
            className="flex-1"
            onClick={() => update({ month, status: 'active', all: true })}
          >
            入力途中
          </Button>
        </fieldset>
        <div>
          <label
            htmlFor="history-month"
            className="text-xs font-bold text-muted-foreground"
          >
            見たい月を選ぶ
          </label>
          <div className="mt-1 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="前の月"
              onClick={() => chooseMonth(adjacentMonth(month, -1))}
            >
              <ChevronLeft />
            </Button>
            <Input
              id="history-month"
              type="month"
              value={all ? '' : month}
              onChange={(event) => chooseMonth(event.target.value)}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="次の月"
              onClick={() => chooseMonth(adjacentMonth(month, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => chooseMonth(today.slice(0, 7))}
          >
            今月
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => chooseMonth(adjacentMonth(today.slice(0, 7), -1))}
          >
            先月
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => update({ month, status, all: true })}
          >
            すべての期間
          </Button>
        </div>
        <div>
          <label
            htmlFor="history-date"
            className="text-xs font-bold text-muted-foreground"
          >
            日付で絞り込む
          </label>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="history-date"
              type="date"
              value={date ?? ''}
              onChange={(event) =>
                event.target.value
                  ? chooseDate(event.target.value)
                  : chooseMonth(month)
              }
              className="min-w-0 flex-1"
            />
            {date && (
              <Button
                type="button"
                variant="outline"
                onClick={() => chooseMonth(month)}
              >
                解除
              </Button>
            )}
          </div>
        </div>
        <form key={`${exerciseName}:${bodyPart}`} className="space-y-3" onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const rawName = data.get('exerciseName');
          const rawPart = data.get('bodyPart');
          const name = typeof rawName === 'string' ? rawName.trim() : '';
          const part = typeof rawPart === 'string' ? rawPart : '';
          setExerciseName(name); setBodyPart(part);
          const url = new URL(window.location.href);
          if (name) url.searchParams.set('exerciseName', name); else url.searchParams.delete('exerciseName');
          if (part) url.searchParams.set('bodyPart', part); else url.searchParams.delete('bodyPart');
          window.history.replaceState(null, '', url);
        }}>
          <label className="block text-xs font-bold" htmlFor="history-exercise">種目名（過去の名前・現在の名前）</label>
          <Input id="history-exercise" name="exerciseName" defaultValue={exerciseName} maxLength={80} placeholder="例：ベンチプレス" className="h-11 text-base" />
          <label className="block text-xs font-bold" htmlFor="history-body-part">部位（現在の種目設定）</label>
          <select id="history-body-part" name="bodyPart" defaultValue={bodyPart} className="h-11 w-full rounded-xl border bg-background px-3 text-base">
            {['', '胸', '背中', '肩', '腕', '脚', '体幹', 'その他'].map(part => <option key={part} value={part}>{part || 'すべての部位'}</option>)}
          </select>
          <Button type="submit" className="min-h-11 w-full">種目・部位で絞り込む</Button>
          {(exerciseName || bodyPart) && <>
            <p className="text-xs">適用中：{exerciseName || 'すべての種目'} · {bodyPart || 'すべての部位'}</p>
            <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => {
              setExerciseName(''); setBodyPart('');
              const url = new URL(window.location.href);
              url.searchParams.delete('exerciseName'); url.searchParams.delete('bodyPart');
              window.history.replaceState(null, '', url);
            }}>条件をクリア</Button>
          </>}
        </form>
        <details
          onToggle={(event) => setCalendarOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-sm font-bold text-primary">
            カレンダーから日付を選ぶ
          </summary>
          {calendarOpen && (
            <div className="mt-3">
              <WorkoutCalendar
                month={new Date(`${month}-01T12:00:00`)}
                onMonthChange={(value) =>
                  chooseMonth(localDateKey(value).slice(0, 7))
                }
                onSelectDate={chooseDate}
              />
            </div>
          )}
        </details>
      </section>
      <section aria-labelledby="history-results-heading">
        <h2 id="history-results-heading" className="mb-3 text-sm font-black">
          {label} · {status === 'completed' ? '完了済み' : '入力途中'}
        </h2>
        <WorkoutSummaryList
          key={`${status}:${period.from ?? 'all'}:${period.to ?? 'all'}:${exerciseName}:${bodyPart}`}
          exerciseName={exerciseName}
          bodyPart={bodyPart}
          status={status}
          from={period.from}
          to={period.to}
          emptyMessage={
            exerciseName || bodyPart
              ? '指定した種目・部位に一致する記録がありません'
              : status === 'completed'
              ? 'この期間の完了した記録はありません'
              : 'この期間の入力途中の記録はありません'
          }
        />
      </section>
    </div>
  );
}
