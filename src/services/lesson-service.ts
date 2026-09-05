import { randomUUID } from 'node:crypto';
import { now } from '../lib/clock';
import { isAfterCutoff } from '../lib/cutoff';
import { InvalidStateError, NotFoundError } from '../lib/errors';
import * as lessonRepo from '../repositories/lesson-repository';
import * as eventRepo from '../repositories/lesson-event-repository';

const ACTOR = 'mai';

export interface CreateLessonInput {
  tutorId: string;
  roomId: string;
  startsAt: Date;
  durationMin: number;
  kind: 'single' | 'exam_pair';
  studentIds: string[];
  note: string | null;
}

export async function createLesson(input: CreateLessonInput) {
  const endsAt = new Date(input.startsAt.getTime() + input.durationMin * 60_000);

  const id = randomUUID();
  await lessonRepo.create({
    id,
    tutorId: input.tutorId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt,
    kind: input.kind,
    note: input.note,
    studentIds: input.studentIds,
  });

  const occurredAt = now();
  await eventRepo.append({
    lessonId: id,
    occurredAt,
    type: 'created',
    before: null,
    after: { tutorId: input.tutorId, roomId: input.roomId, startsAt: input.startsAt, endsAt, status: 'booked' },
    afterCutoff: isAfterCutoff(input.startsAt, occurredAt),
    actor: ACTOR,
  });

  return {
    id,
    tutorId: input.tutorId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt,
    kind: input.kind,
    status: 'booked' as const,
    studentIds: input.studentIds,
  };
}

export interface MoveLessonInput {
  tutorId?: string;
  roomId?: string;
  startsAt?: Date;
  durationMin?: number;
}

export async function moveLesson(lessonId: string, patch: MoveLessonInput) {
  const current = await lessonRepo.findById(lessonId);
  if (!current) throw new NotFoundError('lesson not found');
  if (current.status !== 'booked') {
    throw new InvalidStateError(`cannot move a lesson with status "${current.status}"`);
  }

  const nextStartsAt = patch.startsAt ?? current.startsAt;
  const currentDurationMin = (current.endsAt.getTime() - current.startsAt.getTime()) / 60_000;
  const nextDurationMin = patch.durationMin ?? currentDurationMin;
  const nextEndsAt = new Date(nextStartsAt.getTime() + nextDurationMin * 60_000);
  const next = {
    tutorId: patch.tutorId ?? current.tutorId,
    roomId: patch.roomId ?? current.roomId,
    startsAt: nextStartsAt,
    endsAt: nextEndsAt,
  };

  await lessonRepo.move(lessonId, next);

  const occurredAt = now();
  await eventRepo.append({
    lessonId,
    occurredAt,
    type: 'moved',
    before: { tutorId: current.tutorId, roomId: current.roomId, startsAt: current.startsAt, endsAt: current.endsAt },
    after: { tutorId: next.tutorId, roomId: next.roomId, startsAt: next.startsAt, endsAt: next.endsAt },
    afterCutoff: isAfterCutoff(next.startsAt, occurredAt),
    actor: ACTOR,
  });

  return { id: lessonId, kind: current.kind, status: current.status, ...next };
}

export async function cancelLesson(lessonId: string) {
  const current = await lessonRepo.findById(lessonId);
  if (!current) throw new NotFoundError('lesson not found');
  if (current.status !== 'booked') {
    throw new InvalidStateError(`cannot cancel a lesson with status "${current.status}"`);
  }

  const occurredAt = now();
  await lessonRepo.setStatus(lessonId, 'cancelled', occurredAt);

  const afterCutoff = isAfterCutoff(current.startsAt, occurredAt);
  await eventRepo.append({
    lessonId,
    occurredAt,
    type: 'cancelled',
    before: { status: 'booked' },
    after: { status: 'cancelled', cancelledAt: occurredAt },
    afterCutoff,
    actor: ACTOR,
  });

  return { id: lessonId, status: 'cancelled' as const, cancelledAt: occurredAt, afterCutoff };
}

export async function noShowLesson(lessonId: string) {
  const current = await lessonRepo.findById(lessonId);
  if (!current) throw new NotFoundError('lesson not found');
  if (current.status !== 'booked') {
    throw new InvalidStateError(`cannot mark no-show on a lesson with status "${current.status}"`);
  }

  await lessonRepo.setStatus(lessonId, 'no_show', null);

  const occurredAt = now();
  await eventRepo.append({
    lessonId,
    occurredAt,
    type: 'no_show',
    before: { status: 'booked' },
    after: { status: 'no_show' },
    afterCutoff: isAfterCutoff(current.startsAt, occurredAt),
    actor: ACTOR,
  });

  return { id: lessonId, status: 'no_show' as const };
}

export async function getLessonHistory(lessonId: string) {
  const current = await lessonRepo.findById(lessonId);
  if (!current) throw new NotFoundError('lesson not found');
  return eventRepo.listByLesson(lessonId);
}
