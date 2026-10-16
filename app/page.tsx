import { AppShell } from '@/components/layout/app-shell';
import { HomeV2 } from '@/components/home-v2';

export default function HomePage() {
  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-5 sm:px-7 lg:px-10">
        <div>
          <p className="text-xs font-semibold text-primary">
            REPWISE
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">
            今日のトレーニング
          </h1>
        </div>
      </header>
      <HomeV2 />
    </AppShell>
  );
}
