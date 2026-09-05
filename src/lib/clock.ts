export function now(): Date {
  const raw = process.env.TODAY;
  if (!raw) {
    throw new Error('TODAY is not set — see .env.example');
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`TODAY is not a valid ISO datetime: "${raw}"`);
  }
  return parsed;
}
