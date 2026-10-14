import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
// Use a dedicated Chromium profile. Every app API is intercepted with synthetic data.
// This script never navigates to the public site or uses a real database.
const baseline = process.argv.includes('--baseline');
const fixtureOrigin = baseline
  ? 'http://localhost:3001'
  : 'http://localhost:3000';
const target = (
  await (await fetch('http://localhost:9222/json/list')).json()
).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const exceptions = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
let online = false;
let posts = 0;
const server = new Map();
const processed = new Map();
const fixturesDir = fileURLToPath(
  new URL('../docs/reviews/mobile-progressive-overload/', import.meta.url),
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
const recentHistory = {
  ...validHistory,
  workoutId: 'recent-history',
  workoutExerciseId: 'recent-exercise',
  localDate: '2026-10-13',
  note: '未完了の種目メモも残す',
  sets: oldSets.map((set) => ({
    ...set,
    id: 'recent-' + set.id,
    status: 'planned',
    actualLoadGrams: null,
    actualReps: null,
    memo: '未完了：左肩を確認',
  })),
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
  if (m.method === 'Page.javascriptDialogOpening') {
    await send('Page.handleJavaScriptDialog', { accept: true });
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
    if (!online) {
      code = 500;
      data = { error: 'テスト用の通信失敗' };
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
  } else if (u.pathname === '/api/v2/exercises') data = [master, master2];
  else if (
    u.pathname === '/api/v2/exercises/ex-bench-press' &&
    request.method === 'PATCH'
  ) {
    master = { ...master, ...JSON.parse(request.postData) };
    data = master;
  } else if (u.pathname.endsWith('/progression'))
    data = { exerciseId: master.id, profile, performance, decision };
  else if (u.pathname.endsWith('/history'))
    data = {
      items: [recentHistory, validHistory],
      references: [validHistory],
      hasMore: false,
    };
  else if (u.pathname === '/api/v2/analytics') data = analytics;
  else if (u.pathname === '/api/v2/workouts')
    data = [...server.values()]
      .filter(
        (w) =>
          (!u.searchParams.get('status') ||
            w.status === u.searchParams.get('status')) &&
          (!u.searchParams.get('from') ||
            w.localDate >= u.searchParams.get('from')) &&
          (!u.searchParams.get('to') ||
            w.localDate <= u.searchParams.get('to')) &&
          w.exercises.some(
            (e) =>
              (!u.searchParams.get('exerciseName') ||
                e.exerciseNameSnapshot.includes(
                  u.searchParams.get('exerciseName'),
                )) &&
              (!u.searchParams.get('bodyPart') ||
                [master, master2].find((m) => m.id === e.exerciseId)
                  ?.bodyPart === u.searchParams.get('bodyPart')),
          ),
      )
      .sort(
        (a, b) =>
          b.localDate.localeCompare(a.localDate) || b.id.localeCompare(a.id),
      )
      .slice(
        Number(u.searchParams.get('offset') ?? 0),
        Number(u.searchParams.get('offset') ?? 0) +
          Number(u.searchParams.get('limit') ?? 30),
      )
      .map(summary);
  else if (
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
  });
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
async function typeAppend(selector, text) {
  await evalJs(`document.querySelector(${JSON.stringify(selector)}).focus()`);
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

online = true;
await go(
  '/workouts/new',
  "Boolean(document.querySelector('#workout-date')?.value)",
);
await clickText('記録を開始');
await until(
  "location.pathname.includes('/workouts/active/') && document.body.innerText.includes('最初の種目')",
);
const activePath = await evalJs('location.pathname');
await clickText('種目を追加');
await until(
  "document.querySelector('[role=dialog]')?.textContent.includes('ベンチプレス')",
);
await evalJs(
  "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.includes('ベンチプレス'))?.click()",
);
await until(
  'document.querySelector(\'input[aria-label="セット1の実績重量"]\')',
);

if (baseline) {
  for (const width of [375, 390]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await until("document.body.innerText.includes('SET 1：肩を下げる')");
    await evalJs(
      "(()=>{const e=document.querySelector('input[aria-label=\"セット1の実績重量\"]').closest('.rounded-2xl.border.bg-card');window.scrollTo(0,e.getBoundingClientRect().top+scrollY-160)})()",
    );
    await pause(300);
    await shot(`${fixturesDir}/before-${width}.png`);
  }
  ws.close();
} else {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    console.log(JSON.stringify({ check: message, passed: true }));
  };
  const overflow = () =>
    evalJs('document.documentElement.scrollWidth <= innerWidth');
  const setViewport = (width) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const width of [375, 390]) {
    await setViewport(width);
    await until("document.body.innerText.includes('直近の有効実績')");
    await evalJs(
      "document.querySelector('input[aria-label=\"セット1の目標重量\"]').closest('[id^=workout-set-]').scrollIntoView({block:'start'})",
    );
    await pause(200);
    await shot(`${fixturesDir}/ready-${width}.png`);
    check(await overflow(), `no_horizontal_overflow_${width}`);
    check(
      await evalJs(
        "document.querySelector('input[aria-label=\"セット1の実績重量\"]').value==='' && document.body.innerText.includes('未完了の種目メモも残す')",
      ),
      `valid_reference_and_incomplete_notes_${width}`,
    );
  }
  await setViewport(375);
  await evalJs(
    "Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='前回の実績を目標にコピー').click()",
  );
  check(
    await evalJs(
      "document.querySelector('input[aria-label=\"セット1の目標重量\"]').value==='80.5' && document.querySelector('input[aria-label=\"セット1の実績重量\"]').value===''",
    ),
    'copy_previous_sets_target_only',
  );
  await type('input[aria-label="セット1の目標重量"]', '82.75');
  await type('input[aria-label="セット1の目標rep上限"]', '12');
  await shot(`${fixturesDir}/goal-375.png`);

  check(
    await evalJs(
      "document.querySelector('input[aria-label=\"セット1の実績重量\"]').value===''",
    ),
    'target_edit_leaves_actual_empty',
  );
  for (const digit of '82.75') {
    await typeAppend('input[aria-label="セット1の実績重量"]', digit);
  }
  check(
    await evalJs(
      "document.querySelector('input[aria-label=\"セット1の実績重量\"]').value==='82.75'",
    ),
    'decimal_input_character_by_character',
  );
  await type('input[aria-label="セット1の実績rep"]', '10');
  await type(
    'textarea[aria-label="セット1のメモ"]',
    'テスト記録：前回より重量アップ',
  );
  await tap('button[aria-label="セット1を完了"]');
  await until(
    '!document.querySelector(\'input[aria-label="セット1の実績重量"]\')',
  );
  await pause(400);
  check(
    await evalJs(
      "document.body.innerText.includes('次に取り組む · SET 2') && document.body.innerText.includes('82.75 kg × 10 回')",
    ),
    'completed_compact_next_set',
  );
  await shot(`${fixturesDir}/completed-next-375.png`);
  await setViewport(390);
  await evalJs(
    "(()=>{const e=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='確認・編集').closest('.rounded-2xl');window.scrollTo(0,e.getBoundingClientRect().top+scrollY-document.querySelector('header').getBoundingClientRect().bottom-12)})()",
  );
  await pause(200);
  await shot(`${fixturesDir}/completed-summary-390.png`);
  // Reduced viewport approximates keyboard occlusion; it is not a physical iOS keyboard.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 480,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await evalJs(
    "document.querySelector('input[aria-label=\"セット2の実績重量\"]').focus();document.activeElement.scrollIntoView({block:'center'})",
  );
  await pause(200);
  check(
    await evalJs(
      "(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>document.querySelector('header').getBoundingClientRect().bottom&&r.bottom<innerHeight})()",
    ),
    'input_visible_in_keyboard_sized_viewport',
  );
  await type('input[aria-label="セット2の実績重量"]', '80.5');
  await type('input[aria-label="セット2の実績rep"]', '9');
  await shot(`${fixturesDir}/keyboard-390.png`);
  await setViewport(390);
  // Persist inputs and selection across a full history visit/back navigation.
  await evalJs('window.scrollTo(0,600)');
  await pause(200);
  const scrollBefore = await evalJs('scrollY');
  await go(
    '/history?month=2026-10',
    "document.querySelector('#history-exercise')",
  );
  await evalJs('window.history.back()');
  await until(
    "location.pathname.includes('/active/') && document.querySelector('input[aria-label=\"セット2の実績重量\"]')?.value==='80.5'",
  );
  await pause(400);
  check(
    await evalJs(
      "document.querySelector('input[aria-label=\"セット2の実績rep\"]').value==='9'",
    ),
    'inputs_survive_history_return',
  );
  check(
    Math.abs((await evalJs('scrollY')) - scrollBefore) < 80,
    'scroll_survives_history_return',
  );
  await tap('button[aria-label="セット2を完了"]');
  await until(
    "!document.querySelector('input[aria-label=\"セット2の実績重量\"]') && document.body.innerText.includes('次に取り組む · SET 3')",
  );
  check(true, 'touch_complete_second_set_390');
  await clickText('別の種目を追加');
  await until(
    "document.querySelector('[role=dialog]')?.textContent.includes('シーテッドロウ')",
  );
  await evalJs(
    "Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.includes('シーテッドロウ'))?.click()",
  );
  await until(
    "document.querySelector('h2')?.textContent.includes('シーテッドロウ')",
  );
  await go(
    '/history?month=2026-10',
    "document.querySelector('#history-exercise')",
  );
  await evalJs('window.history.back()');
  await until(
    "location.pathname.includes('/active/') && document.querySelector('h2')?.textContent.includes('シーテッドロウ')",
  );
  check(true, 'selected_exercise_survives_history_return');
  await go(
    '/history?month=2026-10',
    "document.querySelector('#history-exercise') && document.body.innerText.includes('10月10日ベンチ履歴')",
  );
  await type('#history-exercise', 'ベンチ');
  await evalJs(
    "document.querySelector('#history-body-part').value='胸';document.querySelector('#history-exercise').form.requestSubmit()",
  );
  await until(
    "location.search.includes('exerciseName=') && document.body.innerText.includes('10月10日ベンチ履歴') && !document.body.innerText.includes('10月10日ロウ履歴')",
  );
  await reload(
    "document.querySelector('#history-exercise')?.value==='ベンチ' && document.querySelector('#history-body-part')?.value==='胸' && document.body.innerText.includes('10月10日ベンチ履歴')",
  );
  check(await overflow(), 'history_filter_and_reload_390');
  await shot(`${fixturesDir}/history-390.png`);
  await go(
    '/analytics?exerciseId=ex-seated-row',
    "document.querySelector('select[aria-label=\"分析する種目\"]')?.value==='ex-seated-row'",
  );
  await clickText('胸');
  await until(
    "document.querySelector('select[aria-label=\"分析する種目\"]')?.value==='ex-bench-press'",
  );
  check(
    await evalJs(
      "document.querySelector('#exercise-overview-title').closest('section').innerText.includes('ベンチプレス')",
    ),
    'body_part_filter_updates_top_analysis',
  );
  await shot(`${fixturesDir}/analytics-390.png`);
  check(await overflow(), 'analytics_no_horizontal_overflow_390');
  check(exceptions.length === 0, 'no_browser_exceptions');
  console.log(
    JSON.stringify({
      browserExceptions: exceptions,
      fixtureSyncRequests: posts,
      activePath,
    }),
  );
  ws.close();
}
