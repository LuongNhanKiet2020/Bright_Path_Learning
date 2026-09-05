import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import * as lessonService from '../services/lesson-service';

const createLessonSchema = z
  .object({
    tutorId: z.string().min(1),
    roomId: z.string().min(1),
    startsAt: z.string().datetime({ offset: true }),
    durationMin: z.union([z.literal(60), z.literal(90)]),
    kind: z.enum(['single', 'exam_pair']).default('single'),
    studentIds: z.array(z.string().uuid()).min(1),
    note: z.string().min(1).optional(),
  })
  .refine((data) => (data.kind === 'single' ? data.studentIds.length === 1 : data.studentIds.length >= 2), {
    message: 'single needs exactly 1 student; exam_pair needs at least 2',
    path: ['studentIds'],
  });

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = createLessonSchema.parse(req.body);
    const result = await lessonService.createLesson({
      tutorId: body.tutorId,
      roomId: body.roomId,
      startsAt: new Date(body.startsAt),
      durationMin: body.durationMin,
      kind: body.kind,
      studentIds: body.studentIds,
      note: body.note ?? null,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

const moveLessonSchema = z
  .object({
    tutorId: z.string().min(1).optional(),
    roomId: z.string().min(1).optional(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    durationMin: z.union([z.literal(60), z.literal(90)]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'at least one field is required' });

export async function move(req: Request, res: Response, next: NextFunction) {
  try {
    const body = moveLessonSchema.parse(req.body ?? {});
    const result = await lessonService.moveLesson(req.params.id!, {
      tutorId: body.tutorId,
      roomId: body.roomId,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      durationMin: body.durationMin,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await lessonService.cancelLesson(req.params.id!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function noShow(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await lessonService.noShowLesson(req.params.id!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function history(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await lessonService.getLessonHistory(req.params.id!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
