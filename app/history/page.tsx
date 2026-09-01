import { AppShell } from '@/components/layout/app-shell';
import { WorkoutSummaryList } from '@/components/workouts/workout-summary-list';

export default function HistoryPage() {
  return <AppShell><header className="border-b px-4 py-5 sm:px-7 lg:px-10"><p className="text-xs font-semibold text-primary">WORKOUT HISTORY</p><h1 className="mt-1 text-2xl font-black">ワークアウト履歴</h1></header><div className="mx-auto max-w-3xl space-y-7 p-4 sm:p-7 lg:pt-10"><section><h2 className="mb-3 text-sm font-black">入力途中</h2><WorkoutSummaryList status="active" emptyMessage="入力途中のワークアウトはありません" /></section><section><h2 className="mb-3 text-sm font-black">完了済み</h2><WorkoutSummaryList status="completed" emptyMessage="完了したワークアウトはまだありません" /></section></div></AppShell>;
}
