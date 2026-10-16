import { AppShell } from '@/components/layout/app-shell';
import { GoalsDashboard } from '@/components/goals/goals-dashboard';
import { APP_ROUTES } from '@/lib/routes';

export default function GoalsPage() {
  return (
    <AppShell>
      <header className="border-b px-4 py-5 sm:px-7 lg:px-10">
        <a
          className="inline-flex min-h-11 items-center text-sm font-bold text-primary"
          href={APP_ROUTES.analytics}
        >
          ← 詳細分析へ
        </a>
        <p className="mt-2 text-xs font-bold tracking-widest text-primary">
          GOALS
        </p>
        <h1 className="mt-1 text-2xl font-black">目標設定</h1>
      </header>
      <GoalsDashboard />
    </AppShell>
  );
}
