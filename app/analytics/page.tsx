import { BarChart3 } from 'lucide-react';
import { AnalyticsDashboard } from '@/components/analytics/analytics-dashboard';
import { AppShell } from '@/components/layout/app-shell';

export default function AnalyticsPage() {
  return (
    <AppShell>
      <header className="border-b border-border/60 px-4 py-5 sm:px-7 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <BarChart3 className="size-5" />
          </span>
          <div>
            <p className="text-xs font-semibold text-primary">ANALYTICS</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              詳細分析
            </h1>
          </div>
        </div>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          種目ごとの伸び、PR、部位別のトレーニング量を確認できます。
        </p>
      </header>
      <AnalyticsDashboard />
    </AppShell>
  );
}
