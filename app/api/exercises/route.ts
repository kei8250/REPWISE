import { env } from 'cloudflare:workers';

export async function GET() {
  try {
    const result = await env.DB.prepare('SELECT id, name, body_part AS bodyPart FROM exercises ORDER BY body_part, name').all();
    return Response.json(result.results);
  } catch {
    return Response.json([]);
  }
}

export async function POST(request: Request) {
  const body = await request.json() as { name?: string; group?: string };
  if (!body.name?.trim() || !body.group?.trim()) return Response.json({ error: '種目名と部位は必須です' }, { status: 400 });
  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare('INSERT INTO exercises (name, body_part, created_at) VALUES (?, ?, ?)').bind(body.name.trim(), body.group.trim(), createdAt).run();
  return Response.json({ id: result.meta.last_row_id, name: body.name.trim(), group: body.group.trim() }, { status: 201 });
}
