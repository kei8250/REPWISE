import { AppShell } from '@/components/layout/app-shell';
import { HomeV2 } from '@/components/home-v2';
import { Settings } from 'lucide-react';
import { APP_ROUTES } from '@/lib/routes';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-5 sm:px-7 lg:px-10">
        <div>
          <p className="text-xs font-semibold text-primary">
            REPWISE v2 · Phase 1A
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight">
            今日のトレーニング
          </h1>
        </div>
        <a
          href={APP_ROUTES.settings}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <Settings /> 設定
        </a>
      </header>
      <HomeV2 />
    </AppShell>
  );
}
