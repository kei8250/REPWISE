import { AppShell } from '@/components/layout/app-shell';
import { WorkoutSummaryList } from '@/components/workouts/workout-summary-list';
import { isLocalDate } from '@/lib/workouts/history';
import { APP_ROUTES } from '@/lib/routes';

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: requestedDate } = await searchParams;
  const date =
    requestedDate && isLocalDate(requestedDate) ? requestedDate : undefined;
  return (
    <AppShell>
      <header className="border-b px-4 py-5 sm:px-7 lg:px-10">
        <p className="text-xs font-semibold text-primary">WORKOUT HISTORY</p>
        <h1 className="mt-1 text-2xl font-black">
          {date ? `${date}のトレーニング` : 'ワークアウト履歴'}
        </h1>
        {requestedDate && !date && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            日付の指定が正しくありません。すべての履歴を表示しています。
          </p>
        )}
      </header>
      <div className="mx-auto max-w-3xl space-y-7 p-4 sm:p-7 lg:pt-10">
        {date && (
          <div className="flex gap-4 text-sm font-bold text-primary">
            <a href={APP_ROUTES.home}>カレンダーへ戻る</a>
            <a href={APP_ROUTES.history}>すべての履歴</a>
          </div>
        )}
        <section>
          <h2 className="mb-3 text-sm font-black">入力途中</h2>
          <WorkoutSummaryList
            key={`active-${date ?? 'all'}`}
            status="active"
            localDate={date}
            emptyMessage={
              date
                ? 'この日の入力途中の記録はありません'
                : '入力途中のワークアウトはありません'
            }
          />
        </section>
        <section>
          <h2 className="mb-3 text-sm font-black">完了済み</h2>
          <WorkoutSummaryList
            key={`completed-${date ?? 'all'}`}
            status="completed"
            localDate={date}
            emptyMessage={
              date
                ? 'この日の完了したトレーニングはありません'
                : '完了したワークアウトはまだありません'
            }
          />
        </section>
      </div>
    </AppShell>
  );
}
