import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../lib/db';
import { isAfterCutoff } from '../lib/cutoff';
import { isExclusionViolation, reasonFromConstraint } from '../lib/errors';
import { readTutors, readLessons, type RawLessonRow } from './csv';

const ROOM_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

interface LessonGroup {
  legacyRef: string;
  rows: RawLessonRow[];
  tutorId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'booked' | 'cancelled' | 'no_show';
  cancelledAt: Date | null;
  note: string | null;
  kind: 'single' | 'exam_pair';
  studentNames: string[];
}

function toStartsAt(date: string, startTime: string): Date {
  return new Date(`${date}T${startTime}:00+07:00`);
}

function groupExamPairs(rows: RawLessonRow[]): RawLessonRow[][] {
  const byKey = new Map<string, RawLessonRow[]>();
  for (const row of rows) {
    const key = `${row.tutor_id}|${row.room}|${row.date}|${row.start_time}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(row);
    else byKey.set(key, [row]);
  }

  const groups: RawLessonRow[][] = [];
  const grouped = new Set<string>();
  for (const bucket of byKey.values()) {
    if (bucket.length > 1 && bucket.every((r) => r.note.toLowerCase().includes('exam pair'))) {
      groups.push(bucket);
      for (const r of bucket) grouped.add(r.lesson_id);
    }
  }
  for (const row of rows) {
    if (!grouped.has(row.lesson_id)) groups.push([row]);
  }
  return groups;
}

function toLessonGroup(rows: RawLessonRow[]): LessonGroup {
  const first = rows[0]!;
  const startsAt = toStartsAt(first.date, first.start_time);
  const durationMin = Number(first.duration_min);
  return {
    legacyRef: rows.map((r) => r.lesson_id).join('+'),
    rows,
    tutorId: first.tutor_id,
    roomId: first.room,
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMin * 60_000),
    status: first.status as LessonGroup['status'],
    cancelledAt: first.cancelled_at ? new Date(first.cancelled_at) : null,
    note: first.note || null,
    kind: rows.length > 1 ? 'exam_pair' : 'single',
    studentNames: rows.map((r) => r.student),
  };
}

async function getOrCreateStudent(client: PoolClient, name: string): Promise<string> {
  const existing = await client.query<{ id: string }>('SELECT id FROM student WHERE name = $1', [name]);
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  await client.query('INSERT INTO student (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

interface SeedOutcome {
  legacyRef: string;
  ok: boolean;
  reason?: string;
}

async function insertGroup(group: LessonGroup): Promise<SeedOutcome> {
  try {
    await withTransaction(async (client) => {
      const lessonId = randomUUID();
      await client.query(
        `INSERT INTO lesson (id, tutor_id, room_id, starts_at, ends_at, kind, status, cancelled_at, note, legacy_ref)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          lessonId,
          group.tutorId,
          group.roomId,
          group.startsAt,
          group.endsAt,
          group.kind,
          group.status,
          group.cancelledAt,
          group.note,
          group.legacyRef,
        ],
      );

      for (const name of group.studentNames) {
        const studentId = await getOrCreateStudent(client, name);
        await client.query(
          `INSERT INTO lesson_student (lesson_id, student_id, starts_at, ends_at, status)
           VALUES ($1, $2, $3, $4, $5)`,
          [lessonId, studentId, group.startsAt, group.endsAt, group.status],
        );
      }

      if (group.status === 'cancelled' && group.cancelledAt) {
        const afterCutoff = isAfterCutoff(group.startsAt, group.cancelledAt);
        const before = { tutorId: group.tutorId, roomId: group.roomId, status: 'booked' };
        const after = { tutorId: group.tutorId, roomId: group.roomId, status: 'cancelled', cancelledAt: group.cancelledAt };
        await client.query(
          `INSERT INTO lesson_event (id, lesson_id, occurred_at, type, before, after, after_cutoff, actor)
           VALUES ($1, $2, $3, 'cancelled', $4, $5, $6, 'seed')`,
          [randomUUID(), lessonId, group.cancelledAt, JSON.stringify(before), JSON.stringify(after), afterCutoff],
        );
      }
    });
    return { legacyRef: group.legacyRef, ok: true };
  } catch (err) {
    if (!isExclusionViolation(err)) throw err;
    const reason = reasonFromConstraint(err.constraint);
    await pool.query(
      `INSERT INTO legacy_conflict (id, legacy_ref, reason, raw_row) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), group.legacyRef, reason, JSON.stringify(group.rows)],
    );
    return { legacyRef: group.legacyRef, ok: false, reason };
  }
}

function reportUnenforcedRuleBreaks(rows: RawLessonRow[]): string[] {
  const lines: string[] = [];
  const byTutorDate = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== 'booked') continue;
    const key = `${row.tutor_id}|${row.date}`;
    byTutorDate.set(key, (byTutorDate.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byTutorDate) {
    if (count > 6) {
      const [tutorId, date] = key.split('|');
      lines.push(`  - ${tutorId} has ${count} bookings on ${date} (cap is 6, not enforced)`);
    }
  }
  for (const row of rows) {
    const dow = new Date(`${row.date}T00:00:00+07:00`).toLocaleDateString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'long',
    });
    if (dow === 'Monday') {
      lines.push(`  - ${row.lesson_id} runs on Monday ${row.date} (centre is closed Monday, not enforced)`);
    }
  }
  return lines;
}

async function main() {
  const tutors = readTutors(path.join(DATA_DIR, 'tutors.csv'));
  const lessons = readLessons(path.join(DATA_DIR, 'lessons_export.csv'));

  for (const tutor of tutors) {
    await pool.query('INSERT INTO tutor (id, name, subject, phone) VALUES ($1, $2, $3, $4)', [
      tutor.tutor_id,
      tutor.tutor_name,
      tutor.subject,
      tutor.phone,
    ]);
  }
  for (const roomId of ROOM_IDS) {
    await pool.query('INSERT INTO room (id, name) VALUES ($1, $2)', [roomId, `Room ${roomId.slice(1)}`]);
  }

  const groups = groupExamPairs(lessons).map(toLessonGroup);
  const outcomes: SeedOutcome[] = [];
  for (const group of groups) {
    outcomes.push(await insertGroup(group));
  }

  const ok = outcomes.filter((o) => o.ok);
  const flagged = outcomes.filter((o) => !o.ok);

  console.log('--- seed report ---');
  console.log(`tutors: ${tutors.length}, rooms: ${ROOM_IDS.length}`);
  console.log(`export rows: ${lessons.length}, lesson groups after exam-pair merge: ${groups.length}`);
  console.log(`loaded: ${ok.length}, flagged (rejected by exclusion constraint): ${flagged.length}`);
  for (const f of flagged) {
    console.log(`  - ${f.legacyRef}: reason=${f.reason}`);
  }
  console.log('rule breaks not enforced by the API (informational only):');
  const infoLines = reportUnenforcedRuleBreaks(lessons);
  if (infoLines.length === 0) console.log('  (none)');
  else infoLines.forEach((line) => console.log(line));
  console.log('--- end seed report ---');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
