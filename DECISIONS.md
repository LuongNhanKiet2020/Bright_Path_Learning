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
- The "see today" board the owner explicitly asked for: not built. There's a `GET /lessons?date=` returning raw JSON — deliberately not called "schedule" so it doesn't slide into feature #5.

## 3. Design

*(pending — Phase 03)*

## 4. Reflection

*(pending — Phase 04)*
