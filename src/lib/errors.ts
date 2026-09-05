export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(typeof body.message === 'string' ? body.message : JSON.stringify(body));
  }
}

export class ConflictError extends AppError {
  constructor(reason: string, clashingLessonId: string | null) {
    super(409, { error: 'CONFLICT', reason, clashingLessonId });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'lesson not found') {
    super(404, { error: 'NOT_FOUND', message });
  }
}

export class InvalidStateError extends AppError {
  constructor(message: string) {
    super(400, { error: 'INVALID_STATE', message });
  }
}

export function isExclusionViolation(err: unknown): err is { code: '23P01'; constraint?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23P01';
}

export function reasonFromConstraint(constraint: string | undefined): 'tutor' | 'room' | 'student' | 'unknown' {
  if (!constraint) return 'unknown';
  if (constraint.includes('tutor')) return 'tutor';
  if (constraint.includes('room')) return 'room';
  if (constraint.includes('student')) return 'student';
  return 'unknown';
}
