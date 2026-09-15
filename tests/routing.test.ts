import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/app-shell';
import { HomeV2 } from '@/components/home-v2';
import {
  APP_ROUTES,
  navigateTo,
  PRIMARY_NAVIGATION,
  workoutRoute,
} from '@/lib/routes';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Phase 1A routing', () => {
  it('defines every public Phase 1A page route in one place', () => {
    expect(APP_ROUTES.home).toBe('/');
    expect(APP_ROUTES.newWorkout).toBe('/workouts/new');
    expect(APP_ROUTES.history).toBe('/history');
    expect(APP_ROUTES.analytics).toBe('/analytics');
    expect(APP_ROUTES.workoutDetail('workout-123')).toBe(
      '/workouts/workout-123',
    );
    expect(APP_ROUTES.activeWorkout('workout-123')).toBe(
      '/workouts/active/workout-123',
    );
  });

  it('selects the active and completed workout destinations', () => {
    expect(workoutRoute('active-123', 'active')).toBe(
      '/workouts/active/active-123',
    );
    expect(workoutRoute('completed-123', 'completed')).toBe(
      '/workouts/completed-123',
    );
  });

  it('renders the home start and history actions as native links', () => {
    const markup = renderToStaticMarkup(createElement(HomeV2));

    expect(markup).toContain(`href="${APP_ROUTES.newWorkout}"`);
    expect(markup).toContain(`href="${APP_ROUTES.history}"`);
  });

  it('uses the same primary route definitions in desktop and mobile navigation', () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, null, createElement('span', null, 'content')),
    );
    const navigations = markup.match(/<nav[\s\S]*?<\/nav>/g);

    expect(navigations).toHaveLength(2);
    for (const navigation of navigations ?? []) {
      for (const item of PRIMARY_NAVIGATION) {
        expect(navigation).toContain(`href="${item.href}"`);
        expect(navigation).toContain(item.label);
      }
    }
  });

  it('performs a full-page navigation to the supplied destination', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });

    navigateTo(APP_ROUTES.activeWorkout('workout-123'));

    expect(assign).toHaveBeenCalledWith('/workouts/active/workout-123');
  });
});
