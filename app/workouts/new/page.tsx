import { AppShell } from '@/components/layout/app-shell';
import { StartWorkoutForm } from '@/components/workouts/start-workout-form';

export default function NewWorkoutPage() {
  return <AppShell><header className="border-b px-4 py-5 sm:px-7 lg:px-10"><p className="text-xs font-semibold text-primary">NEW WORKOUT</p><h1 className="mt-1 text-2xl font-black">トレーニングを記録</h1></header><div className="mx-auto max-w-xl p-4 sm:p-7 lg:pt-10"><StartWorkoutForm /></div></AppShell>;
}
