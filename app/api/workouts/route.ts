import { env } from 'cloudflare:workers';

type WorkoutPayload = { date?: string; title?: string; bodyPart?: string; exercise?: string; sets?: Array<{ weight?: number; reps?: number; memo?: string }> };

export async function GET() {
  try {
    const result = await env.DB.prepare(`
      SELECT s.id, s.workout_date AS workoutDate, s.title, s.body_part AS bodyPart,
             COUNT(ws.id) AS setCount, COALESCE(SUM(ws.weight * ws.reps), 0) AS volume
      FROM workout_sessions s
      LEFT JOIN workout_sets ws ON ws.session_id = s.id
      GROUP BY s.id
      ORDER BY s.workout_date DESC, s.id DESC
      LIMIT 50
    `).all();
    return Response.json(result.results);
  } catch {
    return Response.json([]);
  }
}

export async function POST(request: Request) {
  const body = await request.json() as WorkoutPayload;
  if (!body.date || !body.title || !body.bodyPart || !body.exercise || !body.sets?.length) return Response.json({ error: 'トレーニング情報が不足しています' }, { status: 400 });
  const createdAt = new Date().toISOString();
  const session = await env.DB.prepare('INSERT INTO workout_sessions (workout_date, title, body_part, created_at) VALUES (?, ?, ?, ?)').bind(body.date, body.title, body.bodyPart, createdAt).run();
  const sessionId = Number(session.meta.last_row_id);
  const statements = body.sets.map((set, index) => env.DB.prepare('INSERT INTO workout_sets (session_id, exercise_name, set_number, weight, reps, memo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(sessionId, body.exercise, index + 1, Number(set.weight ?? 0), Number(set.reps ?? 0), set.memo ?? '', createdAt));
  await env.DB.batch(statements);
  return Response.json({ id: sessionId, savedSets: statements.length }, { status: 201 });
}
