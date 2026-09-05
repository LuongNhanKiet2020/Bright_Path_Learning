import { pool, withTransaction } from '../lib/db';
import { ConflictError, NotFoundError, isExclusionViolation, reasonFromConstraint } from '../lib/errors';

export type LessonStatus = 'booked' | 'cancelled' | 'no_show';
export type LessonKind = 'single' | 'exam_pair';

export interface LessonRecord {
  id: string;
  tutorId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  kind: LessonKind;
  status: LessonStatus;
  cancelledAt: Date | null;
  note: string | null;
  studentIds: string[];
}

function mapRow(row: {
  id: string;
  tutor_id: string;
  room_id: string;
  starts_at: Date;
  ends_at: Date;
  kind: LessonKind;
  status: LessonStatus;
  cancelled_at: Date | null;
  note: string | null;
}, studentIds: string[]): LessonRecord {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    roomId: row.room_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    kind: row.kind,
    status: row.status,
    cancelledAt: row.cancelled_at,
    note: row.note,
    studentIds,
  };
}

export async function findById(id: string): Promise<LessonRecord | null> {
  const lessonRes = await pool.query('SELECT * FROM lesson WHERE id = $1', [id]);
  if (!lessonRes.rows[0]) return null;
  const studentsRes = await pool.query('SELECT student_id FROM lesson_student WHERE lesson_id = $1', [id]);
  return mapRow(lessonRes.rows[0], studentsRes.rows.map((r) => r.student_id));
}

async function findClashingLessonId(params: {
  reason: 'tutor' | 'room' | 'student' | 'unknown';
  tutorId: string;
  roomId: string;
  studentIds: string[];
  startsAt: Date;
  endsAt: Date;
  excludeLessonId?: string;
}): Promise<string | null> {
  const { reason, tutorId, roomId, studentIds, startsAt, endsAt, excludeLessonId } = params;
  if (reason === 'tutor') {
    const res = await pool.query(
      `SELECT id FROM lesson WHERE tutor_id = $1 AND status <> 'cancelled' AND ($2::uuid IS NULL OR id <> $2)
         AND tstzrange(starts_at, ends_at) && tstzrange($3, $4) LIMIT 1`,
      [tutorId, excludeLessonId ?? null, startsAt, endsAt],
    );
    return res.rows[0]?.id ?? null;
  }
  if (reason === 'room') {
    const res = await pool.query(
      `SELECT id FROM lesson WHERE room_id = $1 AND status <> 'cancelled' AND ($2::uuid IS NULL OR id <> $2)
         AND tstzrange(starts_at, ends_at) && tstzrange($3, $4) LIMIT 1`,
      [roomId, excludeLessonId ?? null, startsAt, endsAt],
    );
    return res.rows[0]?.id ?? null;
  }
  if (reason === 'student') {
    const res = await pool.query(
      `SELECT lesson_id AS id FROM lesson_student WHERE student_id = ANY($1::uuid[]) AND status <> 'cancelled'
         AND ($2::uuid IS NULL OR lesson_id <> $2) AND tstzrange(starts_at, ends_at) && tstzrange($3, $4) LIMIT 1`,
      [studentIds, excludeLessonId ?? null, startsAt, endsAt],
    );
    return res.rows[0]?.id ?? null;
  }
  return null;
}

export async function create(input: {
  id: string;
  tutorId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  kind: LessonKind;
  note: string | null;
  studentIds: string[];
}): Promise<void> {
  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO lesson (id, tutor_id, room_id, starts_at, ends_at, kind, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'booked', $7)`,
        [input.id, input.tutorId, input.roomId, input.startsAt, input.endsAt, input.kind, input.note],
      );
      for (const studentId of input.studentIds) {
        await client.query(
          `INSERT INTO lesson_student (lesson_id, student_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, 'booked')`,
          [input.id, studentId, input.startsAt, input.endsAt],
        );
      }
    });
  } catch (err) {
    if (!isExclusionViolation(err)) throw err;
    const reason = reasonFromConstraint(err.constraint);
    const clashingLessonId = await findClashingLessonId({
      reason,
      tutorId: input.tutorId,
      roomId: input.roomId,
      studentIds: input.studentIds,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    });
    throw new ConflictError(reason, clashingLessonId);
  }
}

export async function move(
  id: string,
  next: { tutorId: string; roomId: string; startsAt: Date; endsAt: Date },
): Promise<void> {
  try {
    await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE lesson SET tutor_id=$2, room_id=$3, starts_at=$4, ends_at=$5, updated_at=now()
         WHERE id=$1 RETURNING id`,
        [id, next.tutorId, next.roomId, next.startsAt, next.endsAt],
      );
      if (!res.rows[0]) throw new NotFoundError('lesson not found');
      await client.query('UPDATE lesson_student SET starts_at=$2, ends_at=$3 WHERE lesson_id=$1', [
        id,
        next.startsAt,
        next.endsAt,
      ]);
    });
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    if (!isExclusionViolation(err)) throw err;
    const reason = reasonFromConstraint(err.constraint);
    const studentsRes = await pool.query('SELECT student_id FROM lesson_student WHERE lesson_id = $1', [id]);
    const clashingLessonId = await findClashingLessonId({
      reason,
      tutorId: next.tutorId,
      roomId: next.roomId,
      studentIds: studentsRes.rows.map((r) => r.student_id),
      startsAt: next.startsAt,
      endsAt: next.endsAt,
      excludeLessonId: id,
    });
    throw new ConflictError(reason, clashingLessonId);
  }
}

export async function setStatus(id: string, status: 'cancelled' | 'no_show', cancelledAt: Date | null): Promise<void> {
  await withTransaction(async (client) => {
    const res = await client.query(
      'UPDATE lesson SET status=$2, cancelled_at=$3, updated_at=now() WHERE id=$1 RETURNING id',
      [id, status, cancelledAt],
    );
    if (!res.rows[0]) throw new NotFoundError('lesson not found');
    await client.query('UPDATE lesson_student SET status=$2 WHERE lesson_id=$1', [id, status]);
  });
}
