import { randomUUID } from 'node:crypto';
import { pool } from '../lib/db';

export async function getOrCreateByName(name: string): Promise<string> {
  const trimmed = name.trim();
  const existing = await pool.query<{ id: string }>('SELECT id FROM student WHERE name = $1', [trimmed]);
  if (existing.rows[0]) return existing.rows[0].id;
  await pool.query('INSERT INTO student (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [
    randomUUID(),
    trimmed,
  ]);
  const row = await pool.query<{ id: string }>('SELECT id FROM student WHERE name = $1', [trimmed]);
  return row.rows[0]!.id;
}
