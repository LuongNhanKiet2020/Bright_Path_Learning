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

All output below is a real run against the seeded database.

### Create — conflicts rejected by the database

```bash
# 201 — free slot
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T2","roomId":"R4","startsAt":"2026-03-11T09:00:00+07:00","durationMin":60,"studentIds":["87aec42d-4956-40c9-8b76-d3569b60fc96"]}'
# {"id":"ac968db8-...","tutorId":"T2","roomId":"R4","startsAt":"2026-03-11T02:00:00.000Z","endsAt":"2026-03-11T03:00:00.000Z","kind":"single","status":"booked","studentIds":["87aec42d-..."]}
# HTTP 201

# 409 reason "student" — this student is already booked elsewhere at that time (L007)
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T2","roomId":"R2","startsAt":"2026-03-04T09:00:00+07:00","durationMin":60,"studentIds":["87aec42d-4956-40c9-8b76-d3569b60fc96"]}'
# {"error":"CONFLICT","reason":"student","clashingLessonId":"eec0606f-0f0a-497e-a39d-f22fa260391f"}
# HTTP 409

# 409 reason "tutor" — same tutor, same time, different room (L033/L034)
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T1","roomId":"R2","startsAt":"2026-03-10T09:00:00+07:00","durationMin":60,"studentIds":["501415ca-f8f3-4f76-9600-27a29b89b371"]}'
# {"error":"CONFLICT","reason":"tutor","clashingLessonId":"3b6ccbb4-3653-4107-bf4e-38c13b6359b1"}
# HTTP 409

# 409 reason "room" — 30-minute overlap onto an existing 90-minute lesson (L003, 10:30-12:00);
# proves the constraint compares ranges, not just exact start times
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T2","roomId":"R1","startsAt":"2026-03-03T11:00:00+07:00","durationMin":60,"studentIds":["6f4728a2-7895-4a40-9cfb-7e35f6b19ed9"]}'
# {"error":"CONFLICT","reason":"room","clashingLessonId":"bf6e0c7e-9f0b-4b3c-846d-0cf4514188ea"}
# HTTP 409

# 201 — exam_pair, 2 students, same tutor/room/slot on purpose
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T3","roomId":"R5","startsAt":"2026-03-08T15:00:00+07:00","durationMin":60,"kind":"exam_pair","studentIds":["501415ca-f8f3-4f76-9600-27a29b89b371","6f4728a2-7895-4a40-9cfb-7e35f6b19ed9"]}'
# {"id":"12b54e71-...","kind":"exam_pair","status":"booked","studentIds":["501415ca-...","6f4728a2-..."]}
# HTTP 201
```

### Move

```bash
# 200 — move to a free slot
curl -s http://localhost:3000/lessons/ac968db8-7d78-4acf-b9cb-9f24cec8c220/move -X POST -H 'Content-Type: application/json' \
  -d '{"startsAt":"2026-03-11T10:30:00+07:00"}'
# {"id":"ac968db8-...","status":"booked","tutorId":"T2","roomId":"R4","startsAt":"2026-03-11T03:30:00.000Z",...}
# HTTP 200

# 409 reason "tutor" — moving into a slot that tutor already has (same conflict logic as create)
curl -s http://localhost:3000/lessons/ac968db8-7d78-4acf-b9cb-9f24cec8c220/move -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T1","startsAt":"2026-03-10T09:00:00+07:00"}'
# {"error":"CONFLICT","reason":"tutor","clashingLessonId":"3b6ccbb4-3653-4107-bf4e-38c13b6359b1"}
# HTTP 409
```

### Cut-off visibility — a post-cut-off change shows up as one, not a silent overwrite

```bash
# TODAY = 2026-03-05T12:00. Cancelling L016 (same day, 14:30) happens after its cut-off
# (2026-03-04 16:00) — the response says so directly:
curl -s http://localhost:3000/lessons/e93a2f30-ca44-45f3-a086-0a6d980295e6/cancel -X POST -d '{}'
# {"id":"e93a2f30-...","status":"cancelled","cancelledAt":"2026-03-05T05:00:00.000Z","afterCutoff":true}
# HTTP 200

curl -s http://localhost:3000/lessons/e93a2f30-ca44-45f3-a086-0a6d980295e6/history
# [{"type":"cancelled","occurredAt":"2026-03-05T05:00:00.000Z","afterCutoff":true,"actor":"mai",...}]
# HTTP 200

# Contrast: moving L033 (03-10, whose cut-off is 03-09 16:00 — still days away from TODAY)
# is not flagged, because it genuinely isn't past that lesson's cut-off yet:
curl -s http://localhost:3000/lessons/3b6ccbb4-3653-4107-bf4e-38c13b6359b1/move -X POST -d '{"startsAt":"2026-03-10T14:00:00+07:00"}'
curl -s http://localhost:3000/lessons/3b6ccbb4-3653-4107-bf4e-38c13b6359b1/history
# [{"type":"moved","afterCutoff":false,"actor":"mai",...}]
# HTTP 200
```

### Cancel frees the slot; no-show does not

```bash
# 201 — booking straight into the slot the cancel above just freed
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T1","roomId":"R1","startsAt":"2026-03-05T14:30:00+07:00","durationMin":90,"studentIds":["87aec42d-4956-40c9-8b76-d3569b60fc96"]}'
# HTTP 201

# 200 — mark a different lesson (L013) as no-show instead
curl -s http://localhost:3000/lessons/7cfdc756-91fd-4b86-83fc-1bd37fd63957/no-show -X POST -d '{}'
# {"id":"7cfdc756-...","status":"no_show"}
# HTTP 200

# 409 — its slot is still occupied: a no-show frees neither the room nor the tutor
curl -s http://localhost:3000/lessons -X POST -H 'Content-Type: application/json' \
  -d '{"tutorId":"T1","roomId":"R1","startsAt":"2026-03-05T09:00:00+07:00","durationMin":60,"studentIds":["6f4728a2-7895-4a40-9cfb-7e35f6b19ed9"]}'
# {"error":"CONFLICT","reason":"tutor","clashingLessonId":"7cfdc756-91fd-4b86-83fc-1bd37fd63957"}
# HTTP 409
```

### Errors

```bash
# 400 — cancelling a lesson that's already cancelled
curl -s http://localhost:3000/lessons/e93a2f30-ca44-45f3-a086-0a6d980295e6/cancel -X POST -d '{}'
# {"error":"INVALID_STATE","message":"cannot cancel a lesson with status \"cancelled\""}
# HTTP 400

# 404 — unknown lesson id
curl -s http://localhost:3000/lessons/00000000-0000-0000-0000-000000000000/cancel -X POST -d '{}'
# {"error":"NOT_FOUND","message":"lesson not found"}
# HTTP 404
```
