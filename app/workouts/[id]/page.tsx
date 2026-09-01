import { AppShell } from '@/components/layout/app-shell';
import { WorkoutDetail } from '@/components/workouts/workout-detail';

export default async function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell><WorkoutDetail id={id} /></AppShell>;
}
