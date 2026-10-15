import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Use a dedicated Chromium profile. Every app API is intercepted with synthetic data.
// This script never navigates to the public site or uses a real database.
const reviewUx = process.argv.includes('--review-ux');
const legacySyncReview = process.argv.includes('--legacy-sync');
const stateProgressReview = process.argv.includes('--state-progress');
const navigationReview = process.argv.includes('--navigation');
const fixtureOrigin = 'http://localhost:3000';
const target = (
  await (await fetch('http://localhost:9223/json/list')).json()
).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const extraTargets = new Map();
const closingSessions = new Set();
const exceptions = [];
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
let online = false;
let failureCode = 500;
let customRecommendation = null;
const dialogs = [];
let posts = 0;
const server = new Map();
const processed = new Map();
const fixturesDir = process.env.REPWISE_REVIEW_OUTPUT_DIR ?? fileURLToPath(
  new URL(reviewUx ? '../docs/reviews/reference-review-ux/' : legacySyncReview ? '../docs/reviews/legacy-sync-recovery/' : stateProgressReview ? '../docs/reviews/workout-state-progress/' : navigationReview ? '../docs/reviews/workout-navigation/' : '../docs/reviews/draft-cleanup-side-reps/', import.meta.url),
);
let master = {
  id: 'ex-bench-press',
  name: 'ベンチプレス',
  normalizedName: 'ベンチプレス',
  bodyPart: '胸',
  measurementType: 'weight_reps',
  defaultRepMin: 8,
  defaultRepMax: 12,
  defaultWorkingSets: 3,
  defaultIncrementGrams: 2500,
  defaultRestSeconds: 90,
};
const master2 = {
  ...master,
  id: 'ex-seated-row',
  name: 'シーテッドロウ',
  bodyPart: '背中',
};
const oldSets = [10, 9, 8].map((actualReps, position) => ({
  id: `past-${position}`,
  position,
  status: 'completed',
  setType: 'working',
  targetLoadGrams: 80000,
  targetRepMin: 8,
  targetRepMax: 12,
  actualLoadGrams: 80500,
  actualReps,
  memo: `SET ${position + 1}：肩を下げる`,
  completedAt: '2026-10-10T08:00:00Z',
  createdAt: '2026-10-10T08:00:00Z',
  updatedAt: '2026-10-10T08:00:00Z',
}));
const validHistory = {
  workoutId: 'valid-history',
  workoutExerciseId: 'valid-exercise',
  workoutName: '10月10日のトレーニング',
  localDate: '2026-10-10',
  exerciseName: master.name,
  note: '胸を張り、反動を使わない',
  overallNote: '睡眠7時間',
  sets: oldSets,
};
const profile = {
  exerciseId: master.id,
  repMin: 8,
  repMax: 12,
  workingSets: 3,
  incrementGrams: 2500,
  progressionType: 'double_progression',
};
const performance = {
  workoutId: validHistory.workoutId,
  workoutVersion: 1,
  workoutLocalDate: validHistory.localDate,
  workoutUpdatedAt: '2026-10-10T08:00:00Z',
  workoutStatus: 'completed',
  workoutDeletedAt: null,
  workoutExerciseId: validHistory.workoutExerciseId,
  exerciseId: master.id,
  exerciseStatus: 'completed',
  sets: oldSets,
};
const decision = {
  status: 'keep_load',
  reasonCode: 'within_rep_range',
  currentLoadGrams: 80500,
  nextTarget: {
    loadGrams: 80500,
    repMin: 8,
    repMax: 12,
    workingSets: 3,
    sets: oldSets.map((set) => ({
      position: set.position,
      targetLoadGrams: 80500,
      targetRepMin: 8,
      targetRepMax: 12,
    })),
  },
  evaluatedSetIds: oldSets.map((set) => set.id),
  sourceWorkoutId: 'valid-history',
  sourceWorkoutVersion: 1,
};
const stagnation = {
  status: 'insufficient_data',
  reasonCode: 'not_enough_history',
  validHistoryCount: 1,
  requiredHistoryCount: 3,
  recentHistoryCount: 1,
  consecutiveAcceptedTargetMisses: 0,
};
const analytics = {
  generatedAt: '2026-10-14T08:00:00Z',
  period: {
    range: '30d',
    startDate: '2026-09-15',
    endDate: '2026-10-14',
    dayCount: 30,
  },
  workouts: {
    completedWorkoutCount: 2,
    trainingDayCount: 2,
    weeklyAverageWorkoutCount: 0.47,
    workingSetCount: 6,
    totalVolumeGramReps: 5000000,
    volumeByWorkout: [],
  },
  exercises: [master2, master].map((m) => ({
    exerciseId: m.id,
    exerciseName: m.name,
    bodyPart: m.bodyPart,
    workoutCount: 2,
    trainingDayCount: 2,
    workingSetCount: 3,
    totalVolumeGramReps: 2500000,
    profile: { ...profile, exerciseId: m.id },
    progression: decision,
    stagnation,
    e1rmTrend: [],
    maxWeightTrend: [],
    volumeTrend: [],
    repTrend: [],
    personalRecordHistory: [],
    acceptedTargetHistory: [],
    currentAcceptedTarget: null,
  })),
  bodyParts: [
    {
      bodyPart: '胸',
      exerciseCount: 1,
      trainingDayCount: 1,
      workingSetCount: 3,
      totalVolumeGramReps: 2500000,
    },
    {
      bodyPart: '背中',
      exerciseCount: 1,
      trainingDayCount: 1,
      workingSetCount: 3,
      totalVolumeGramReps: 2500000,
    },
  ],
};
const fixtureWorkout = {
  id: 'valid-history',
  name: '10月10日ベンチ履歴',
  status: 'completed',
  localDate: '2026-10-10',
  timezone: 'Asia/Tokyo',
  startedAt: '2026-10-10T08:00:00Z',
  endedAt: '2026-10-10T09:00:00Z',
  overallNote: 'テスト用',
  rating: null,
  version: 1,
  createdAt: '2026-10-10T08:00:00Z',
  updatedAt: '2026-10-10T09:00:00Z',
  deletedAt: null,
  sourceWorkoutId: null,
  exercises: [
    {
      id: 'valid-exercise',
      exerciseId: master.id,
      position: 0,
      status: 'completed',
      exerciseNameSnapshot: master.name,
      note: validHistory.note,
      startedAt: '2026-10-10T08:00:00Z',
      completedAt: '2026-10-10T09:00:00Z',
      createdAt: '2026-10-10T08:00:00Z',
      updatedAt: '2026-10-10T09:00:00Z',
      sets: oldSets,
    },
  ],
};
server.set(fixtureWorkout.id, fixtureWorkout);
server.set('row-history', {
  ...fixtureWorkout,
  id: 'row-history',
  name: '10月10日ロウ履歴',
  exercises: [
    {
      ...fixtureWorkout.exercises[0],
      id: 'row-exercise',
      exerciseId: master2.id,
      exerciseNameSnapshot: master2.name,
    },
  ],
});
let customMaster = null;
server.set('draft-old', {
  ...fixtureWorkout,
  id: 'draft-old',
  name: '削除対象の古い入力途中',
  status: 'active',
  localDate: '2025-01-01',
  endedAt: null,
  exercises: [],
});
server.set('draft-other', {
  ...fixtureWorkout,
  id: 'draft-other',
  name: '別の入力途中',
  status: 'active',
  localDate: '2026-10-15',
  endedAt: null,
  exercises: [],
});
const summary = (w) => {
  const sets = w.exercises.flatMap((e) => e.sets);
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    localDate: w.localDate,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    exerciseCount: w.exercises.length,
    setCount: sets.length,
    completedSetCount: sets.filter((s) => s.status === 'completed').length,
    totalVolumeGrams: 0,
  };
};
ws.addEventListener('message', async (event) => {
  const m = JSON.parse(event.data);
  if (m.id) {
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error) p.reject(m.error);
      else p.resolve(m.result);
    }
    return;
  }
  if (m.sessionId && closingSessions.has(m.sessionId)) return;
  if (m.method === 'Page.javascriptDialogOpening') {
    dialogs.push(m.params.message);
    await send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    exceptions.push(
      m.params.exceptionDetails.exception?.description ??
        m.params.exceptionDetails.text,
    );
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const u = new URL(request.url);
  let code = 200,
    data;
  if (u.pathname === '/api/v2/sync') {
    posts++;
    const mutation = JSON.parse(request.postData);
    for (const exercise of mutation.payload.workout.exercises)
      for (const set of exercise.sets) {
        if (
          set.targetRepMin != null &&
          set.targetRepMax != null &&
          set.targetRepMin > set.targetRepMax
        )
          throw new Error('Client queued reversed target bounds');
        if (
          exercise.repMode === 'per_side' &&
          set.status === 'completed' &&
          (set.actualRepsLeft == null ||
            set.actualRepsRight == null ||
            set.actualReps !==
              Math.min(set.actualRepsLeft, set.actualRepsRight))
        )
          throw new Error('Client queued incomplete per-side set');
        if (set.actualReps != null && !Number.isInteger(set.actualReps))
          throw new Error('Client queued fractional actual reps');
      }
    if (!online) {
      code = failureCode;
      data = { error: failureCode === 400 ? '完了状態が必要です（旧サーバーのテスト応答）' : 'テスト用の通信失敗' };
    } else if (processed.has(mutation.mutationId))
      data = { ...processed.get(mutation.mutationId), duplicate: true };
    else {
      const current = server.get(mutation.entityId);
      const version = current?.version ?? 0;
      if (mutation.baseVersion !== version)
        throw new Error(
          `Unexpected baseVersion ${mutation.baseVersion}, expected ${version}`,
        );
      const workout = {
        ...mutation.payload.workout,
        version: version + 1,
        updatedAt: new Date().toISOString(),
      };
      server.set(workout.id, workout);
      data = { mutationId: mutation.mutationId, duplicate: false, workout };
      processed.set(mutation.mutationId, data);
    }
  } else if (u.pathname === '/api/v2/exercises') {
    if (request.method === 'POST') {
      customMaster = {
        ...master,
        ...JSON.parse(request.postData),
        id: 'side-created',
      };
      data = customMaster;
    } else data = [master, master2, ...(customMaster ? [customMaster] : [])];
  } else if (
    u.pathname === '/api/v2/exercises/ex-bench-press' &&
    request.method === 'PATCH'
  ) {
    master = { ...master, ...JSON.parse(request.postData) };
    data = master;
  } else if (u.pathname.endsWith('/progression')) {
    const side = u.pathname.includes('side-created');
    const sets = side
      ? oldSets.map((set) => ({
          ...set,
          actualLoadGrams: 20500,
          actualReps: 8,
          actualRepsLeft: 8,
          actualRepsRight: 10,
        }))
      : oldSets;
    const exerciseId = side ? 'side-created' : master.id;
    data = {
      exerciseId,
      profile: { ...profile, exerciseId },
      performance: { ...performance, exerciseId, sets },
      decision: !side && customRecommendation ? customRecommendation : side
        ? {
            ...decision,
            currentLoadGrams: 20500,
            nextTarget: {
              ...decision.nextTarget,
              loadGrams: 20500,
              sets: decision.nextTarget.sets.map((set) => ({
                ...set,
                targetLoadGrams: 20500,
              })),
            },
          }
        : decision,
    };
  } else if (u.pathname.endsWith('/history')) {
    const reference = u.pathname.includes('side-created')
      ? {
          ...validHistory,
          exerciseName: 'ブルガリアンテスト',
          sets: oldSets.map((set) => ({
            ...set,
            actualLoadGrams: 20500,
            actualReps: 8,
            actualRepsLeft: 8,
            actualRepsRight: 10,
          })),
        }
      : validHistory;
    data = { items: [reference], references: [reference], hasMore: false };
  } else if (u.pathname === '/api/v2/analytics') data = analytics;
  else if (u.pathname.endsWith('/progression-summary')) {
    const workout = server.get(u.pathname.split('/')[4]);
    data = {
      workoutId: workout.id,
      workoutVersion: workout.version,
      totalExercises: workout.exercises.length,
      counts: {
        increaseLoad: 0,
        keepLoad: 0,
        insufficientData: workout.exercises.length,
      },
      exercises: workout.exercises.map((exercise) => ({
        workoutExerciseId: exercise.id,
        exerciseId: exercise.exerciseId,
        exerciseName: exercise.exerciseNameSnapshot,
        position: exercise.position,
        profile: { ...profile, exerciseId: exercise.exerciseId },
        performance: {
          ...performance,
          workoutId: workout.id,
          workoutVersion: workout.version,
          workoutLocalDate: workout.localDate,
          workoutExerciseId: exercise.id,
          exerciseId: exercise.exerciseId,
          exerciseStatus: exercise.status,
          sets: exercise.sets,
        },
        decision: {
          ...decision,
          status: 'insufficient_data',
          reasonCode: 'incomplete_working_set',
          nextTarget: null,
        },
        personalRecords: {
          status: 'first_record',
          achieved: { weight: false, reps: false, e1rm: false, volume: false },
          current: {
            maxLoadGrams: 20500,
            maxE1rmGrams: 26650,
            totalVolumeGramReps: 430500,
          },
          previous: {
            maxLoadGrams: null,
            maxE1rmGrams: null,
            maxVolumeGramReps: null,
          },
          repRecords: [],
          e1rmExcludedHighRepSetCount: 0,
        },
        acceptedNextTarget: null,
        stagnation,
      })),
    };
  } else if (u.pathname === '/api/v2/workouts') {
    const matches = [...server.values()].filter(
      (w) =>
        !w.deletedAt &&
        (!u.searchParams.get('exerciseName') || w.exercises.some(e => e.exerciseNameSnapshot.includes(u.searchParams.get('exerciseName')))) &&
        (!u.searchParams.get('status') ||
          w.status === u.searchParams.get('status')) &&
        (!u.searchParams.get('from') ||
          w.localDate >= u.searchParams.get('from')) &&
        (!u.searchParams.get('to') || w.localDate <= u.searchParams.get('to')),
    );
    const offset = Number(u.searchParams.get('offset') ?? 0),
      limit = Number(u.searchParams.get('limit') ?? 30);
    data = matches
      .sort(
        (a, b) =>
          b.localDate.localeCompare(a.localDate) || b.id.localeCompare(a.id),
      )
      .slice(offset, offset + limit)
      .map(summary);
  } else if (u.pathname.endsWith('/sync-state')) {
    const id = decodeURIComponent(u.pathname.split('/')[4]);
    data = { workout: server.get(id) ?? null };
  } else if (
    u.pathname.startsWith('/api/v2/workouts/') &&
    !u.pathname.endsWith('/progression-summary')
  ) {
    data = server.get(
      decodeURIComponent(u.pathname.slice('/api/v2/workouts/'.length)),
    );
    if (!data) {
      code = 404;
      data = { error: 'まだ同期されていません' };
    }
  } else {
    code = 503;
    data = { error: 'テスト対象外のAPI' };
  }
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: code,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify(data)).toString('base64'),
  }, m.sessionId).catch(error => { if (!closingSessions.has(m.sessionId)) exceptions.push(JSON.stringify(error)); });
});
await send('Page.enable');
await send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
await send('Page.navigate', { url: 'about:blank' });
await send('Runtime.enable');
await send('Storage.clearDataForOrigin', {
  origin: fixtureOrigin,
  storageTypes: 'all',
});
await send('Fetch.enable', {
  patterns: [{ urlPattern: fixtureOrigin + '/api/*', requestStage: 'Request' }],
});
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});
const evalJs = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  return result.result.value;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression) {
  for (let i = 0; i < 250; i++) {
    if (await evalJs(`Boolean(document.body) && Boolean(${expression})`))
      return;
    await pause(100);
  }
  throw new Error('Wait timed out: ' + expression);
}
async function go(path, ready) {
  await send('Page.navigate', { url: fixtureOrigin + path });
  await until(
    `location.href===${JSON.stringify(fixtureOrigin + path)} && (${ready})`,
  );
}
async function reload(ready) {
  const stamp = await evalJs('performance.timeOrigin');
  await send('Page.reload');
  await until(`performance.timeOrigin!==${stamp} && (${ready})`);
}
async function clickText(text) {
  await evalJs(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`,
  );
}
async function type(selector, text) {
  await evalJs(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select();})()`,
  );
  await send('Input.insertText', { text });
}
async function tap(selector) {
  await evalJs(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
  );
  await pause(100);
  const point = await evalJs(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:e.contains(document.elementFromPoint(x,y)),width:r.width,height:r.height}})()`,
  );
  if (!point.hit || point.width < 44 || point.height < 44)
    throw new Error('Unreachable or small touch target: ' + selector);
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4 }],
  });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function shot(path) {
  const r = await send('Page.captureScreenshot', {
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
}

const check = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(JSON.stringify({ check: message, passed: true }));
};
const setViewport = (width) =>
  send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
const overflow = () =>
  evalJs('document.documentElement.scrollWidth<=innerWidth');
async function select(selector, value) {
  await evalJs(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
}
try {
await send('Emulation.setTouchEmulationEnabled', { enabled: true });
if (reviewUx) {
  const { reviewReferenceUx } = await import('./review-reference-ux.mjs');
  await reviewReferenceUx({ evalJs, go, reload, until, tap, clickText, shot, setViewport, overflow, check, fixturesDir, setOnline: value => { online = value; } });
} else if (legacySyncReview) {
  const { reviewLegacySync } = await import('./review-legacy-sync.mjs');
  await reviewLegacySync({ send, registerTarget: (id, sessionId) => extraTargets.set(id, sessionId), markClosing: sessionId => closingSessions.add(sessionId), evalJs, go, reload, until, tap, type, clickText, pause, shot, setViewport, overflow, check, server, fixtureWorkout, fixturesDir, setOnline: value => { online = value; } });
} else if (stateProgressReview) {
  const { reviewWorkoutStateProgress } = await import('./review-workout-state-progress.mjs');
  await reviewWorkoutStateProgress({ send, evalJs, go, reload, until, tap, clickText, type, select, pause, shot, setViewport, overflow, check, server, fixtureWorkout, oldSets, dialogs, registerTarget: (id, sessionId) => extraTargets.set(id, sessionId), markClosing: sessionId => closingSessions.add(sessionId), setOnline: value => { online = value; }, setFailureCode: value => { failureCode = value; }, setRecommendation: value => { customRecommendation = value; }, fixturesDir });
} else if (navigationReview) {
  const { reviewWorkoutNavigation } = await import('./review-workout-navigation.mjs');
  await reviewWorkoutNavigation({ send, evalJs, go, until, tap, clickText, pause, shot, setViewport, overflow, check, server, fixtureWorkout, setOnline: (value) => { online = value; }, fixturesDir });
} else {
await setViewport(375);
online = true;
await go(
  '/history?status=active&month=all',
  'document.querySelector(\'a[href="/workouts/active/draft-old"]\')',
);
check(true, 'all_periods_include_old_drafts');
async function swipeOld() {
  const point = await evalJs(
    "(()=>{const e=document.querySelector('a[href=\"/workouts/active/draft-old\"]').closest('[data-swipe-open]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.right-35,y:r.y+r.height/2}})()",
  );
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  for (let distance = 20; distance <= 150; distance += 20) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x - distance, y: point.y }],
    });
    await pause(30);
  }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(
    "document.querySelector('a[href=\"/workouts/active/draft-old\"]').closest('[data-swipe-open]').dataset.swipeOpen==='true'",
  );
  await pause(400);
}
await swipeOld();
await shot(`${fixturesDir}/swipe-375.png`);
check(await overflow(), 'swipe_no_horizontal_overflow_375');
online = false;
await tap('button[aria-label="削除対象の古い入力途中を削除"]');
await pause(500);
await until(
  "!document.querySelector('a[href=\"/workouts/active/draft-old\"]') && document.body.innerText.includes('削除を取り消す')",
);
check(
  server.get('draft-old').deletedAt === null,
  'offline_delete_hides_row_without_server_write',
);
await setViewport(390);
await shot(`${fixturesDir}/deleted-390.png`);
online = true;
await until(
  "Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='削除を取り消す'&&!button.disabled)",
);
await clickText('削除を取り消す');
await until('document.querySelector(\'a[href="/workouts/active/draft-old"]\')');
check(true, 'undo_restores_active_draft');
await swipeOld();
await tap('button[aria-label="削除対象の古い入力途中を削除"]');
await until(
  '!document.querySelector(\'a[href="/workouts/active/draft-old"]\')',
);
await reload(
  "document.body.innerText.includes('別の入力途中') && !document.querySelector('a[href=\"/workouts/active/draft-old\"]')",
);
check(true, 'deleted_draft_stays_hidden_after_reload');
await send('Page.bringToFront');
await evalJs(
  `document.querySelector('button[aria-label="別の入力途中の削除操作を表示"]').focus()`,
);
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Enter',
  code: 'Enter',
  text: String.fromCharCode(13),
  windowsVirtualKeyCode: 13,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Enter',
  code: 'Enter',
  text: String.fromCharCode(13),
  windowsVirtualKeyCode: 13,
});
await until(
  `document.activeElement?.getAttribute('aria-label')==='別の入力途中を削除'`,
);
await send('Input.dispatchKeyEvent', {
  type: 'keyDown',
  key: 'Enter',
  code: 'Enter',
  text: String.fromCharCode(13),
  windowsVirtualKeyCode: 13,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp',
  key: 'Enter',
  code: 'Enter',
  text: String.fromCharCode(13),
  windowsVirtualKeyCode: 13,
});
await until(
  `!document.querySelector('a[href="/workouts/active/draft-other"]') && Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='削除を取り消す'&&!button.disabled)`,
);
check(true, 'keyboard_delete_and_empty_list_undo');
await clickText('削除を取り消す');
await until(`document.querySelector('a[href="/workouts/active/draft-other"]')`);
for (let index = 1; index <= 16; index++)
  server.set(`page-${String(index).padStart(2, '0')}`, {
    ...fixtureWorkout,
    id: `page-${String(index).padStart(2, '0')}`,
    name: `ページの入力途中${index}`,
    status: 'active',
    localDate: '2024-01-01',
    endedAt: null,
    exercises: [],
  });
await go(
  '/history?status=active&month=all',
  `document.body.innerText.includes('1ページ')`,
);
await clickText('次の8件');
await until(`document.body.innerText.includes('2ページ')`);
await clickText('次の8件');
await until(`document.body.innerText.includes('3ページ')`);
await evalJs(
  `document.querySelector('a[href="/workouts/active/page-01"]').closest('[data-swipe-open]').querySelector('button[aria-expanded]').click()`,
);
await tap('button[aria-label="ページの入力途中1を削除"]');
await until(
  `document.body.innerText.includes('2ページ') && !document.querySelector('a[href="/workouts/active/page-01"]')`,
);
check(true, 'delete_last_page_preserves_nearest_page');
await go('/workouts/new', "document.querySelector('#workout-date')?.value");
await clickText('記録を開始');
await until(
  "location.pathname.includes('/active/') && document.body.innerText.includes('最初の種目')",
);
const activeId = await evalJs("location.pathname.split('/').at(-1)");
await clickText('種目を追加');
await until("document.querySelector('#new-exercise-rep-mode')");
await type('input[placeholder="種目名"]', 'ブルガリアンテスト');
await select('#new-exercise-rep-mode', 'per_side');
await shot(`${fixturesDir}/create-side-390.png`);
await clickText('作成して追加');
await until('document.querySelector(\'input[aria-label="セット1の右回数"]\')');
check(
  customMaster?.repMode === 'per_side',
  'create_exercise_persists_rep_mode',
);
await type('input[aria-label="セット1の目標rep下限"]', '20');
check(
  await evalJs(
    "document.querySelector('input[aria-label=\"セット1の目標rep上限\"]').value==='20'",
  ),
  'lower_bound_adjusts_upper_before_queueing',
);
await type('input[aria-label="セット1の目標rep上限"]', '12');
check(
  await evalJs(
    "document.querySelector('input[aria-label=\"セット1の目標rep下限\"]').value==='12'",
  ),
  'upper_bound_adjusts_lower_before_queueing',
);
await type('input[aria-label="セット1の目標rep下限"]', '8');
await type('input[aria-label="セット1の目標重量"]', '20.5');
await type('input[aria-label="セット1の実績重量"]', '20.5');
await type('input[aria-label="セット1の右回数"]', '12');
await type('input[aria-label="セット1の左回数"]', '9.5');
check(
  await evalJs(
    "document.querySelector('input[aria-label=\"セット1の左回数\"]').getAttribute('aria-invalid')==='true' && document.body.innerText.includes('整数で入力してください')",
  ),
  'fractional_reps_show_field_error',
);
await clickText('終了');
await pause(150);
check(
  await evalJs(
    "location.pathname.includes('/active/') && !document.body.innerText.includes('同期に失敗')",
  ),
  'invalid_field_blocks_finish_without_sync_error',
);
await shot(`${fixturesDir}/input-error-390.png`);
await type('input[aria-label="セット1の左回数"]', '9');
await evalJs(
  "document.querySelector('input[aria-label=\"セット1の実績重量\"]').closest('[id^=workout-set-]').scrollIntoView({block:'start'})",
);
await pause(200);
await shot(`${fixturesDir}/side-set-390.png`);
await setViewport(375);
await pause(150);
await shot(`${fixturesDir}/side-set-375.png`);
check(await overflow(), 'side_input_no_horizontal_overflow_375');
await setViewport(390);
check(await overflow(), 'side_input_no_horizontal_overflow_390');
await tap('button[aria-label="セット1を完了"]');
await until(
  "!document.querySelector('input[aria-label=\"セット1の右回数\"]') && document.body.innerText.includes('右 12 / 左 9 回')",
);
await reload(
  "document.body.innerText.includes('右 12 / 左 9 回') && document.querySelector('input[aria-label=\"セット2の右回数\"]')",
);
check(
  await evalJs(
    "document.querySelector('input[aria-label=\"セット2の右回数\"]').value==='' && document.querySelector('input[aria-label=\"セット2の左回数\"]').value===''",
  ),
  'next_set_actuals_remain_empty',
);
await clickText('確認・編集');
await until(`document.querySelector('input[aria-label="セット1の左回数"]')`);
await type('input[aria-label="セット1の左回数"]', '');
check(
  await evalJs(
    `document.querySelector('input[aria-label="セット1の左回数"]').getAttribute('aria-invalid')==='true' && document.querySelector('button[aria-label="セット1を完了"]')?.disabled`,
  ),
  'clearing_completed_side_requires_correction',
);
await type('input[aria-label="セット1の左回数"]', '9');
await tap('button[aria-label="セット1を完了"]');
await until(`!document.querySelector('input[aria-label="セット1の左回数"]')`);
await clickText('終了');
await until(
  "!location.pathname.includes('/active/') && document.body.innerText.includes('右 12 / 左 9 回')",
);
await until("document.body.innerText.includes('有効な完了実績')");
await shot(`${fixturesDir}/side-result-390.png`);
await evalJs(
  "Array.from(document.querySelectorAll('h2')).find(e=>e.textContent.includes('ブルガリアン')).closest('[data-slot=card]').scrollIntoView({block:'start'})",
);
await pause(200);
await shot(`${fixturesDir}/side-history-390.png`);
check(true, 'side_reps_survive_completion_and_history');
for (
  let i = 0;
  i < 60 && !server.get(activeId)?.exercises[0]?.sets[0]?.actualRepsLeft;
  i++
)
  await pause(100);
check(
  server.get(activeId)?.exercises[0]?.sets[0]?.actualRepsLeft === 9 &&
    server.get(activeId)?.exercises[0]?.sets[0]?.actualRepsRight === 12 &&
    server.get(activeId)?.exercises[0]?.sets[0]?.actualReps === 9,
  'sync_snapshot_preserves_both_sides',
);
}
check(exceptions.length === 0, 'no_browser_exceptions');
console.log(
  JSON.stringify({ browserExceptions: exceptions, fixtureSyncRequests: posts }),
);
} finally {
  for (const [targetId, sessionId] of extraTargets) {
    if (sessionId) closingSessions.add(sessionId);
    await send('Target.closeTarget', { targetId }).catch(() => undefined);
  }
  await send('Page.navigate', { url: 'about:blank' });
  ws.close();
}
