'use client';

import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Dumbbell, History, Home, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  APP_ROUTES,
  DESKTOP_NAVIGATION,
} from '@/lib/routes';

const navigationIcons = {
  home: Home,
  newWorkout: Dumbbell,
  history: History,
  analytics: BarChart3,
  settings: Settings,
} as const;

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href) || (href === APP_ROUTES.analytics && pathname.startsWith(APP_ROUTES.goals));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1500px]">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border/70 bg-card px-5 py-6 lg:flex">
          <a href={APP_ROUTES.home} className="flex items-center gap-3 px-2">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Activity className="size-5" />
            </span>
            <span>
              <span className="block text-lg font-black tracking-tight">
                REPWISE
              </span>
              <span className="block text-[10px] font-bold tracking-[0.18em] text-muted-foreground">
                TRAIN SMARTER
              </span>
            </span>
          </a>
          <nav className="mt-10 space-y-1" aria-label="メインナビゲーション">
            {DESKTOP_NAVIGATION.map(({ key, href, label }) => {
              const Icon = navigationIcons[key];
              return (
                <a
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition',
                    isActive(href)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="size-[18px]" />
                  {label}
                </a>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl bg-[#effcf4] p-4 text-[#133c25] ring-1 ring-[#bdebcf]">
            <p className="text-sm font-bold">REPWISE v2</p>
            <p className="mt-1 text-xs leading-relaxed text-[#4d725d]">
              複数種目を、1回のワークアウトとして記録します。
            </p>
          </div>
        </aside>
        <section className="min-w-0 flex-1 pb-24 lg:pb-8">{children}</section>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 px-4 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
        aria-label="モバイルナビゲーション"
      >
        {DESKTOP_NAVIGATION.map(({ key, href, label }) => {
          const Icon = navigationIcons[key];
          return (
            <a
              key={href}
              href={href}
              className={cn(
                'flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] font-semibold',
                isActive(href) ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {label}
            </a>
          );
        })}
      </nav>
    </main>
  );
}
