import { AppShell } from '@/components/layout/app-shell';
import { HistoryBrowser } from '@/components/workouts/history-browser';
import { isLocalDate } from '@/lib/workouts/history';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string; status?: string; exerciseName?: string; bodyPart?: string }>;
}) {
  const query = await searchParams;
  const date = query.date && isLocalDate(query.date) ? query.date : undefined;
  const month =
    query.month && isLocalDate(`${query.month}-01`) ? query.month : undefined;
  return (
    <AppShell>
      <header className="border-b px-4 py-5 sm:px-7 lg:px-10">
        <p className="text-xs font-semibold text-primary">WORKOUT HISTORY</p>
        <h1 className="mt-1 text-2xl font-black">トレーニング履歴</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          日付・種目・部位から、見たいセットとメモへ
        </p>
        {query.date && !date && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            日付の指定が正しくありません。日付を選び直してください。
          </p>
        )}
      </header>
      <HistoryBrowser
        initialExerciseName={query.exerciseName?.slice(0, 80)}
        initialBodyPart={query.bodyPart?.slice(0, 40)}
        initialDate={date}
        initialMonth={month}
        initialAll={(query.month === 'all' || (query.status === 'active' && !query.month)) && !date}
        initialStatus={query.status === 'active' ? 'active' : 'completed'}
      />
    </AppShell>
  );
}
