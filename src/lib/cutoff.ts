const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function cutoffFor(startsAt: Date): Date {
  const shifted = startsAt.getTime() + OFFSET_MS;
  const localMidnight = Math.floor(shifted / DAY_MS) * DAY_MS;
  const cutoffShifted = localMidnight - DAY_MS + 16 * 60 * 60 * 1000;
  return new Date(cutoffShifted - OFFSET_MS);
}

export function isAfterCutoff(startsAt: Date, occurredAt: Date): boolean {
  return occurredAt.getTime() > cutoffFor(startsAt).getTime();
}
