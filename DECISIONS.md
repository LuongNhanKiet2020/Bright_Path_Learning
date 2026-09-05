# DECISIONS

Time used: __h__m · Today pinned to 2026-03-05 · Stack: Node/TS + PostgreSQL

## 1. Reading the situation

### Questions for the owner (and what each answer changes)

| Question (with evidence) | If A → | If B → |
|---|---|---|
| **Exam pair** — is a session with 2 students/1 tutor/1 room one lesson or two? Evidence: Mai — *"In exam season I put two students with one tutor in the same room and the same slot, on purpose... I do that most weeks"*; data L009+L010, note *"exam pair - half price"*. | **A: one lesson, multiple students** → `lesson` has many `lesson_student` rows; room/tutor exclusion applies at the lesson level, so the pair never trips it. | **B: two separate lessons** → needs a `pair_group_id` + a conditional exclusion (more fragile). |
| **Tutor-initiated cancellation** — is the family charged, is the tutor paid? Evidence: L017, `cancelled_at 2026-03-05T14:40:00+07:00`, note *"tutor sick"*, 1h20 before the 16:00 start; the brief's rule only covers *"A family may cancel free of charge up to 4 hours before..."* | **A: no charge / pay rules differ** → need `cancelled_by` (family / tutor / centre) so tutor-initiated cancels skip the family late-fee logic. | **B: treat the same as a family cancel** → no `cancelled_by`, one shared logic. |
| **6-bookings/day cap** — hard block or override with a reason? Evidence: *"Mai breaks this rule when she is desperate, and the owner wants it enforced"*; data shows T1 with **7 bookings on 2026-03-06** (09:00, 11:30, 13:00, 16:00, 17:30, 19:00, 20:30) against the rule *"No tutor may be given more than 6 bookings in a single day."* | **A: hard cap** → DB trigger/constraint blocks the 7th booking. | **B: override with reason** → app-level check + `override_reason`, logged, not blocked. |
| **Monday exceptions** — does the centre ever teach on Monday, and who decides? Evidence: L032, `2026-03-09` (Monday) `10:00`, note *"moved from Sunday at the family's request"*, against *"The centre teaches Tuesday to Sunday. It is closed on Monday."* | **A: never** → CHECK constraint blocks any Monday insert. | **B: sometimes, by exception** → warning only, not blocked. |
| **Notification channel after cut-off** — does the tool only need to *show* a change, or does it have to *push* it? Evidence: tutor — *"I get my day in a message, then a correction, then sometimes a third message. I do not always know which one is real"* and *"I have driven in for a lesson that was called off the night before. Twice."* | **A: show only** → tool is the source of truth, tutor checks it themselves; no messaging integration. | **B: must push (WhatsApp/SMS)** → out of scope for 2h30, must be named as "left broken." |
| **Who is the actual user** — Mai only, or do tutors/owner log in too? Evidence: *"Mai... is the only person who fully understands the sheet, and she goes on leave in eight weeks"*; owner — *"I want to open the laptop and see today. Not scroll. See it."* | **A: Mai only** → no auth/roles needed. | **B: multiple roles** → auth/permissions, out of scope for 2h30. |

### Where the brief argues with itself

1. *"Lessons are one-to-one, sixty or ninety minutes long"* vs Mai — *"two students with one tutor in the same room and the same slot, on purpose... most weeks."* **Reading chosen:** exam pair is a first-class lesson kind (`kind='exam_pair'`) with ≥2 students, not a rare exception.
2. *"A room holds one lesson at a time, whoever is teaching in it"* vs the exam pair happening *"in the same room and the same slot"* with two students. **Reading chosen:** since exam pair = one lesson (per #1), the room rule still holds — one room, one lesson row, regardless of how many students are on it.
3. *"No tutor may be given more than 6 bookings"* + owner *"wants it enforced"* vs *"Mai breaks this rule when she is desperate"* and *"closed on Monday"* vs L032 actually running on Monday 2026-03-09. **Reading chosen:** both are aspirational rules, not hard invariants — enforce as a **warning in code**, not a DB block, since the real data already breaks them and we don't yet know if the owner wants a hard stop (see the questions above).
4. The late-cancellation rule only describes *"a family may cancel"*; it says nothing about a tutor cancelling — yet L017 is tutor-initiated (*"tutor sick"*). **Reading chosen:** add `cancelledBy` (family/tutor/centre) to record the truth, but only apply the family late-fee classification when `cancelledBy = 'family'`.
5. *"It has 12 tutors on the payroll... Six rooms"* vs the export only containing **3 tutors** (`tutors.csv`: T1–T3) and **3 rooms** (R1–R3 used in `lessons_export.csv`). **Reading chosen:** the export is a slice of a bigger reality — never hard-code tutor/room counts; seed all 6 rooms (R1–R6) per the rule even though the data only touches R1–R3.

### What the export actually shows

| # | Lesson(s) | Specific finding | Rule it breaks (quoted) |
|---|---|---|---|
| A | L007 + L008 | Student "Le Minh Chau" booked at the same 09:00 slot on 2026-03-04 in two places at once: T3/R3 and T2/R2 (L008 note: *"added by phone; family confirmed"*) | *"Twice last term we had a student booked into two places at once... if the system allows it, the system is broken"* |
| B | L009 + L010 | Same tutor T1, same room R1, same 11:00 slot (90'), two different students, note *"exam pair - half price"* | A deliberate, valid exception per Mai — directly clashes with "one-to-one" and "one lesson per room" if read literally |
| C | L033 + L034 | Tutor T1 teaching at 09:00 on 2026-03-10 in both R1 (Le Minh Chau) and R2 (Tran Bao Long) simultaneously — no exam-pair note, different rooms | *"a tutor can only be in one room at a time"* |
| D | L021–L027 | Tutor T1 has **7 bookings** on 2026-03-06 (09:00, 11:30, 13:00, 16:00, 17:30, 19:00, 20:30) | *"No tutor may be given more than 6 bookings in a single day"* |
| E | L032 | Lesson runs at 10:00 on Monday 2026-03-09, note *"moved from Sunday at the family's request"* | *"The centre teaches Tuesday to Sunday. It is closed on Monday"* |
| F | L017 | Cancelled at 14:40 on 2026-03-05 (note *"tutor sick"*), 1h20 before the 16:00 start — inside the 4h window, but the canceller is the tutor, not the family | *"A family may cancel free of charge up to 4 hours before... Inside that window the lesson is charged in full and the tutor is still paid"* — rule is silent on tutor-initiated cancels |
| G | L005 | Cancelled at 08:15 on 2026-03-03 for a 14:00 lesson (5h45 notice, so free by the 4h rule) — but the cut-off for that lesson was 16:00 the day before (2026-03-02) | *"Tomorrow's schedule is final at 16:00 today. Changes after the cut-off still happen, but they must be visible as changes"* — this is a free cancel that still lands after its own cut-off |

### Assumptions

- **Today pinned to 2026-03-05** (Thursday) — sits mid-week in the seed range, already has a same-day cancel (L017) and the overloaded tutor day (2026-03-06) needed to demo cut-off and late-cancel without inventing data.
- Timezone fixed to **Asia/Ho_Chi_Minh (+07:00)**; every timestamp column stored as `timestamptz` — every timestamp in the export already carries `+07:00` (e.g. `cancelled_at 2026-03-03T08:15:00+07:00`).
- Students are identified **by name only** — README.txt never mentions a student id; a `student` table dedupes by name at seed time. Flagged as a known weakness.
- Exam pair = **one lesson with ≥2 students**, not two lessons (see contradictions #1/#2) — keeps the room/tutor exclusion constraint intact with no special case.
- Tool is **single-user (Mai)** — *"Mai... is the only person who fully understands the sheet"* — no auth/roles built (pending confirmation from the owner).
- Tool **never sends messages** — it's a source of truth to look at; Mai still relays it manually. Named as "left broken" (pending confirmation from the owner).
- The 16:00 cut-off applies to lessons from the next day onward; a change made the same day as the lesson is always "past cut-off" (its cut-off was already yesterday).
- Seed loads **all 34 rows**, including rule-breaking ones, since this is real history. Any row rejected by the exclusion constraint (`23P01`) is flagged into a separate table and reported — never silently dropped, never crashes. The constraint only blocks *new* writes through the API, not historical seed rows.
- The export has **no `created_at`/`updated_at`**, and L008's *"added by phone"* note carries no timestamp — there's no way to know if it was added before or after that day's cut-off. This is exactly why future changes (post-launch) are tracked via `lesson_event.occurredAt` instead of trying to reconstruct it from the export — the reason `lesson_event` exists (carried forward to Phase 3 design).
- A **no-show** (`status=no_show`, no `cancelled_at`, e.g. L015) frees neither the room nor the slot — this matches the rule *"a student who simply does not arrive is a no-show, which frees neither"*; it is not a violation, just a status the code must classify correctly.

## 2. What to build

### Features this tool needs

| # | Feature | Who hurts | Why it can wait |
|---|---|---|---|
| 1 | **Conflict-safe lesson booking** (create/move blocked by the database on a tutor/room/student clash; cancel/no-show to prove slots free correctly) | Owner — *"if the system allows it, the system is broken"*; tutor double-booked on 2026-03-10 (finding C) | — (this is the one) |
| 2 | Change-aware daily schedule (diff against what was published at the 16:00 cut-off) | Tutor — *"I do not always know which one is real"* | Needs a correct lesson/event model first — built by #1 |
| 3 | Full cancellation flow with real billing (late fee charged, tutor paid) | Mai — *"Cancellations are the worst part"* | No real billing data exists; #1 already covers enough cancel behaviour to prove a slot frees |
| 4 | Tutor daily load cap (≤6), enforced or overridable | Owner wants it enforced, but T1 already has **7 bookings on 2026-03-06** | Needs an owner decision first (Q3, Phase 1) — hard-block vs override |
| 5 | "See today" board — one screen the owner can open | Owner — *"I want to open the laptop and see today. Not scroll. See it."* | Read-only view — doesn't make any rule harder to break, just faster than the spreadsheet |
| 6 | Freed-slot notification / waitlist on cancel | Mai — *"tries to remember to tell the tutor's next family that a slot has opened up"* | No waitlist data; out of scope for 2h30 |
| 7 | Spreadsheet import (seed loader + violation report) | Needed because Mai *"goes on leave in eight weeks"* and is the only one who understands the sheet | Not "the one feature" — it's the precondition for demonstrating any of the others |

### The one I build: Conflict-safe lesson booking

1. The owner sets the highest bar for it: *"That can never happen again — if the system allows it, the system is broken."* Every other feature is "nice"; this one is "must."
2. The data proves it's already happening: finding A (student booked in two places at once) and C (tutor teaching in two rooms at once) both occur within the one week of export — not a hypothetical.
3. This is something the spreadsheet + WhatsApp cannot do **by nature** — "see today" (#5) and a smoother cancellation UI (#3) the spreadsheet can still do, just slower; a database-level exclusion is a difference in kind, not speed.
4. It fits inside 2h30: one exclusion constraint set + the seed loader (required regardless) + 4 endpoints (create/move/cancel/no-show) + a handful of tests. Demonstrable directly against real data: re-POST L008 → `409`.
5. The data model behind it (`lesson`, `lesson_student`, `lesson_event`) is the foundation every other feature (#2, #3, #4) would need — choosing it means choosing the right schema before anything else gets built.

### What I leave broken

- Tutors still get their day via a message Mai types by hand — *"which message is real"* (tutor) is **not solved**; only the data model (`lesson_event`) is prepared so feature #2 could be built on top without a schema change.
- **Cap 6/tutor/day and closed-on-Monday: not enforced, not even warned in the API.** The seed report shows they are broken today (T1 has 7 bookings on 2026-03-06, L032 runs on Monday) — they need an owner decision first (Q3, Q4 in Phase 1) before choosing hard-block vs override.
- **Late-cancel classification and billing (`late`, `chargeFamily`, `payTutor`): cut entirely from the API.** Cancel only sets `status`, `cancelledAt`, and writes the event.
- Waitlist / freed-slot notification: untouched.
- The "see today" board the owner explicitly asked for: not built. There's a `GET /lessons/:id/history` for one lesson's own timeline, not a whole-day view — deliberately not a "schedule" endpoint so it doesn't slide into feature #5.

## 3. Design

### Data model

```
tutor          (id text PK,               -- natural key from tutors.csv ("T1", "T2", ...)
                name, subject, phone)

room           (id text PK,               -- "R1".."R6" — seeded even though the export only uses R1-R3
                name)

student        (id uuid PK,               -- no student id in the export
                name text)                -- not unique — a name isn't an identity; see below

lesson         (id uuid PK,
                tutor_id FK, room_id FK,
                starts_at timestamptz, ends_at timestamptz,
                kind      enum('single','exam_pair'),
                status    enum('booked','cancelled','no_show'),
                cancelled_at timestamptz NULL,
                note text NULL,
                legacy_ref text UNIQUE NULL,   -- "L001".. for seeded rows, NULL for API-created lessons
                created_at, updated_at)

lesson_student (lesson_id FK, student_id FK, PK(lesson_id, student_id),
                starts_at, ends_at, status)   -- denormalized copy of lesson's own columns — see below

lesson_event   (id PK, lesson_id FK, occurred_at timestamptz,
                type enum('created','moved','cancelled','no_show'),
                before jsonb NULL, after jsonb, after_cutoff boolean, actor text)

legacy_conflict (id PK, legacy_ref text, reason text, raw_row jsonb, created_at)
                -- export rows the exclusion constraints rejected at seed time; report-only, no API reads this
```

`lesson_student` carries its own copy of `starts_at/ends_at/status` because a Postgres `EXCLUDE` constraint needs the range column on the same table as the column it excludes on, and `student_id` only exists on `lesson_student` — `starts_at/ends_at` live on `lesson`. The app keeps the copy in sync on every `create`/`move`/`cancel`/`no-show`, inside the same transaction as the write to `lesson`. This is a real weakness (two sources of truth for one time range) — see Reflection.

`POST /lessons` takes `studentIds`, never names — the live API does not resolve a student by matching text. The only place a name is ever used to find/create a student is inside the seed script, as a one-time, self-contained step to reconstruct history from an export that has no student id (it's how findings A and C get caught at all). That heuristic never runs outside seeding.

The exclusion predicate on all three constraints is `WHERE (status <> 'cancelled')`, not `status = 'booked'`. The brief is explicit that a no-show "frees neither" the room nor the slot — only a cancellation does — so a no-show lesson must still count as occupying its tutor/room/student for conflict purposes.

### How a cancel/move after the tutor was told is represented

`lesson` always holds the *current* state — there is no `DELETE`, and `starts_at`/`room_id`/`tutor_id` are never updated directly except through `move`. Every `create`/`move`/`cancel`/`no-show` appends one `lesson_event` row (`before`/`after` snapshots, `occurred_at`, `actor`) computed via the pinned `now()` — never `new Date()`. `after_cutoff` is `occurred_at > cutoff(lesson.starts_at)`, where `cutoff(D) = (D − 1 day) 16:00 +07:00`.

The export itself has no `created_at`, so seeding does **not** fabricate a `created` event for the 31 historical rows — there is no honest timestamp to give it. The two rows that do carry a real historical timestamp (`cancelled_at` on L005 and L017) get one real `cancelled` event each at seed time, computed the same way a live cancel would be. From the first API call onward, every lesson has a full, real event trail — this is exactly the gap the brief's "how you represent a booking cancelled/moved after the tutor was told" question is pointing at, and `lesson_event` is built to close it going forward without a schema change (the basis for the change-aware schedule feature named in "next week").

### Rules: database vs code

| Rule | Where | Why |
|---|---|---|
| Tutor can't be in two places at once | **DB** — `EXCLUDE USING gist (tutor_id WITH =, tstzrange(starts_at,ends_at) WITH &&) WHERE (status <> 'cancelled')` | Race-safe between two concurrent requests; this is exactly what the spreadsheet can't do |
| Room holds one lesson at a time | **DB** — same shape, on `room_id` | Same reasoning |
| Student can't be in two places at once | **DB** — same shape, on `lesson_student.student_id`, against the denormalized range copy | The owner's #1 complaint; enforced with the same strength as tutor/room, not weaker |
| `ends_at > starts_at` | **DB CHECK** | Cheap, never changes |
| No `DELETE`; `starts_at`/`room_id`/`tutor_id` only change via `move` | **Code** — the routes simply don't exist | Keeps history honest; could change without touching the schema |
| `after_cutoff` on `lesson_event` | **Code**, computed from the pinned `now()` at write time | Depends on policy (`now()`, the 16:00 cut-off) rather than being a data invariant |
| Cap 6/tutor/day, closed-on-Monday, late-cancel billing | **Nowhere in the API** — visible only in the seed report | Cut from scope in Phase 02: the real data already breaks both, and enforcing either needs an owner decision (Q3/Q4, Phase 1) this exercise doesn't have |

### API

```
POST   /lessons                 { tutorId, roomId, startsAt, durationMin (60|90),
                                   kind ('single'|'exam_pair'), studentIds: string[], note? }
                                 → 201 { id, tutorId, roomId, startsAt, endsAt, kind, status, studentNames }
                                 → 409 { error: "CONFLICT", reason: "tutor"|"room"|"student", clashingLessonId }

POST   /lessons/:id/move        { tutorId?, roomId?, startsAt?, durationMin? }  (at least one field)
                                 → 200 updated lesson | 409 same shape as above
                                 → 400 { error: "INVALID_STATE" } if the lesson isn't currently 'booked'

POST   /lessons/:id/cancel      → 200 { id, status: 'cancelled', cancelledAt, afterCutoff }
                                 → 400 { error: "INVALID_STATE" } if not currently 'booked'

POST   /lessons/:id/no-show     → 200 { id, status: 'no_show' }
                                 → 400 { error: "INVALID_STATE" } if not currently 'booked'

GET    /lessons/:id/history     → 200 [{ id, type, occurredAt, before, after, afterCutoff, actor }, ...]
```

Exactly these 5 — nothing else. `POST /lessons/:id/no-show` and `GET /lessons/:id/history` earn their place because the test list (and the design question above) can't be demonstrated without them; nothing else made the cut once cap-6/closed-Monday/late-cancel were cut from scope in Phase 02.

### The endpoint I rejected: `PATCH /lessons/:id`

A generic patch — "change any field on a lesson" — was the obvious alternative to separate `move`/`cancel`/`no-show` routes. Rejected because it can't tell a `move` apart from a `cancel` or a typo fix in `note`: the whole point of `lesson_event.type` is to say *what kind of change* happened, and a generic patch collapses that distinction back into "something changed," which is the exact complaint the tutor made about the spreadsheet ("I do not always know which one is real"). Naming the mutation (`move`, `cancel`, `no-show`) is what keeps the event log honest.

## 4. Reflection

*(pending — Phase 04)*
