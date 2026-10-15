import { AppShell } from '@/components/layout/app-shell';
import { ActiveWorkout } from '@/components/workouts/active-workout';

export default async function ActiveWorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><ActiveWorkout id={id} /></AppShell>;
}
