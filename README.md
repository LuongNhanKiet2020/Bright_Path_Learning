# Bright Path — conflict-safe lesson booking

Internal scheduling tool for Bright Path Learning Centre. Feature built: **conflict-safe lesson booking** — create/move a lesson is rejected by the database if it clashes on tutor, room, or student; cancel/no-show behave correctly with the slot (cancel frees it, no-show doesn't). `TODAY` is pinned to `2026-03-05T12:00:00+07:00` (Thursday, inside the seeded week).

## Run

```bash
git clone <this repo> && cd tutoring_scheduling
cp .env.example .env
npm install
npm run db:up
npm run migrate
npm run seed
npm run dev
```

`npm test` runs whatever test suite exists at the time (see `package.json`).

## What the seed showed

```
--- seed report ---
tutors: 3, rooms: 6
export rows: 34, lesson groups after exam-pair merge: 33
loaded: 31, flagged (rejected by exclusion constraint): 2
  - L008: reason=student
  - L034: reason=tutor
rule breaks not enforced by the API (informational only):
  - T1 has 7 bookings on 2026-03-06 (cap is 6, not enforced)
  - L032 runs on Monday 2026-03-09 (centre is closed Monday, not enforced)
--- end seed report ---
```

## Try it

`studentIds` are real ids — the API never looks a student up by name (only the seed script does that, once, to load the export). List seeded ids with `SELECT id, name FROM student;` if you want to try your own.

```bash
# 201 — free slot, an existing seeded student ("Le Minh Chau")
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T2","roomId":"R4","startsAt":"2026-03-11T09:00:00+07:00","durationMin":60,"studentIds":["7c22f1ab-ead3-4e6f-83c5-45fcb0c944bf"]}'
# {"id":"f17409c4-be25-49c8-a636-ddbe708f22c8","tutorId":"T2","roomId":"R4","startsAt":"2026-03-11T02:00:00.000Z","endsAt":"2026-03-11T03:00:00.000Z","kind":"single","status":"booked","studentIds":["7c22f1ab-ead3-4e6f-83c5-45fcb0c944bf"]}
# HTTP 201

# 409 — same student already booked elsewhere at that time (L007)
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T2","roomId":"R2","startsAt":"2026-03-04T09:00:00+07:00","durationMin":60,"studentIds":["7c22f1ab-ead3-4e6f-83c5-45fcb0c944bf"]}'
# {"error":"CONFLICT","reason":"student","clashingLessonId":"6bddc27e-0af0-4ced-9a82-e9be87148c00"}
# HTTP 409
```
