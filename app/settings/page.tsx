import { AppShell } from '@/components/layout/app-shell';
import { SettingsDashboard } from '@/components/settings/settings-dashboard';

export default function SettingsPage() {
  return (
    <AppShell>
      <header className="border-b px-4 py-5 sm:px-7 lg:px-10">
        <p className="text-xs font-semibold text-primary">SETTINGS</p>
        <h1 className="mt-1 text-2xl font-black">設定</h1>
      </header>
      <SettingsDashboard />
    </AppShell>
  );
}
