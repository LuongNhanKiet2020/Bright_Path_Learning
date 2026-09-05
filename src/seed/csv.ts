import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

export interface RawTutorRow {
  tutor_id: string;
  tutor_name: string;
  subject: string;
  phone: string;
}

export interface RawLessonRow {
  lesson_id: string;
  date: string;
  start_time: string;
  duration_min: string;
  student: string;
  tutor_id: string;
  room: string;
  status: string;
  cancelled_at: string;
  note: string;
}

export function readTutors(filePath: string): RawTutorRow[] {
  return parse(readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true });
}

export function readLessons(filePath: string): RawLessonRow[] {
  return parse(readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true });
}
