import type { WorkoutStatus } from '@/lib/workouts/types';

export const APP_ROUTES = {
  home: '/',
  newWorkout: '/workouts/new',
  history: '/history',
  workoutDetail: (id: string) => `/workouts/${encodeURIComponent(id)}`,
  activeWorkout: (id: string) => `/workouts/active/${encodeURIComponent(id)}`,
} as const;

export const PRIMARY_NAVIGATION = [
  { key: 'home', href: APP_ROUTES.home, label: 'ホーム' },
  { key: 'newWorkout', href: APP_ROUTES.newWorkout, label: '記録する' },
  { key: 'history', href: APP_ROUTES.history, label: '履歴' },
] as const;

export function workoutRoute(id: string, status: WorkoutStatus) {
  return status === 'active'
    ? APP_ROUTES.activeWorkout(id)
    : APP_ROUTES.workoutDetail(id);
}

export function navigateTo(href: string) {
  window.location.assign(href);
}
