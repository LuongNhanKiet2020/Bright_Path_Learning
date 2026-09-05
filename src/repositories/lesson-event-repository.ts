import { randomUUID } from 'node:crypto';
import { pool } from '../lib/db';

export type LessonEventType = 'created' | 'moved' | 'cancelled' | 'no_show';

export interface LessonEventRecord {
  id: string;
  lessonId: string;
  occurredAt: Date;
  type: LessonEventType;
  before: unknown;
  after: unknown;
  afterCutoff: boolean;
  actor: string;
}

export async function append(event: {
  lessonId: string;
  occurredAt: Date;
  type: LessonEventType;
  before: unknown;
  after: unknown;
  afterCutoff: boolean;
  actor: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO lesson_event (id, lesson_id, occurred_at, type, before, after, after_cutoff, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      event.lessonId,
      event.occurredAt,
      event.type,
      event.before === null ? null : JSON.stringify(event.before),
      JSON.stringify(event.after),
      event.afterCutoff,
      event.actor,
    ],
  );
}

export async function listByLesson(lessonId: string): Promise<LessonEventRecord[]> {
  const res = await pool.query(
    `SELECT id, lesson_id, occurred_at, type, before, after, after_cutoff, actor
     FROM lesson_event WHERE lesson_id = $1 ORDER BY occurred_at ASC`,
    [lessonId],
  );
  return res.rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    occurredAt: r.occurred_at,
    type: r.type,
    before: r.before,
    after: r.after,
    afterCutoff: r.after_cutoff,
    actor: r.actor,
  }));
}
