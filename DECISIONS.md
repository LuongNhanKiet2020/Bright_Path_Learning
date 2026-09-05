# DECISIONS

Time used: ~1h41m · Today pinned to 2026-03-05 · Stack: Node/TS + PostgreSQL

## 1. Reading the situation

### Questions for the owner

1. **Exam pair**: Mai pairs 2 students into 1 session for half price during exam season — treat this as one session with 2 students, or split it into two separate sessions to keep the "one-to-one" rule intact?
2. **Tutor-initiated cancellation**: when the tutor cancels (like the sick-day case), is the family charged, is the tutor paid?
3. **6-bookings/day cap**: Mai has broken this rule before when she had to (one tutor has 7 bookings in a day in the data) — hard block from now on, or allow going over it with a logged reason?
4. **Teaching on Monday**: does the centre ever teach on Monday (like the reschedule-for-a-family case), or is it an absolute no?
5. **Notifying the tutor after the 16:00 cut-off**: does the system only need to show the right thing when the tutor checks, or does it have to actively push a message to them?
6. **Who uses the system**: just Mai, or do tutors/the owner also need to log in and look?

### Where the brief argues with itself

- It says "one-to-one" but Mai deliberately pairs 2 students into 1 session during exam season → treat the pair as one valid session type, not a rare exception.
- It says "a room holds one lesson at a time" but the exam pair happens in exactly one room, one slot → since the pair counts as one session (with 2 students), it doesn't actually break the room rule.
- The owner wants the 6/day cap and the Monday closure enforced, but Mai has broken both, and the brief never mentions any bad outcome from that — so is either rule actually load-bearing, or just friction? → don't enforce either in this system yet; just surface that they're being broken in the seed report, and let the owner decide whether to make either one a hard rule.
- The cancellation rule only covers a family cancelling, not a tutor cancelling (the data has one tutor-initiated cancel for a sick day) → record who actually cancelled, but don't charge anything (billing was cut from scope entirely).
- The brief says the centre has 12 tutors / 6 rooms, but the real data only has 3 tutors / 3 rooms → never hard-code tutor/room counts in the code.

### What the data actually shows

- **L007+L008**: one student booked into two different places at the same time (two tutors, two rooms).
- **L009+L010**: two students sharing one tutor, one room, one slot — Mai's deliberate exam-pair booking.
- **L033+L034**: one tutor booked to teach in two different rooms at the same time.
- **L021–L027**: one tutor has 7 bookings in a single day (over the 6 cap).
- **L032**: a lesson runs on a Monday (the day the centre is closed).
- **L017**: the tutor cancels a lesson 1h20 before it starts, for being sick.
- **L005**: the family cancels within the rule (more than 4 hours' notice), but the cancellation itself happens after the previous day's 16:00 cut-off.

### Assumptions

- "Today" is pinned to 2026-03-05 (it's inside the sample week's CSV data).
- Time is fixed to Vietnam's timezone (+7), no daylight-saving changes.
- Students only have a name, no id of their own — two people can share a name. Handled by generating a random UUID per student and, by default, treating a name match as the same person.
- An exam pair counts as one session with 2 students, not two separate sessions.
- Only Mai uses the system — no login needed.
- The system never sends a message to anyone by itself — it's only a place to look things up.
- Any change made today, or after yesterday's cut-off, counts as a "post-cut-off change."
- All historical data is loaded, including sessions that break a rule — those are only flagged, never dropped or silently skipped; the rules only apply going forward, to newly-created sessions.
- The original data has no record of when a session was actually created, so there's no way to know which past sessions were added before or after their cut-off — going forward, the system records this fully for every new session.
- A "student didn't show up" (no-show) session doesn't count as cancelled, no matter whether there was any notice — the room and the slot are still considered in use.

## 2. What to build

### What this tool could do (pick exactly one)

1. **Block double-booked schedules** (tutor/room/student) when creating or moving a session — **this is the one I built**.
2. Show a tutor how their schedule differs from what they were told at the last cut-off — later; needs session history to exist first.
3. Handle cancellations fully, with real billing — later; there's no real billing data to work with.
4. Enforce the 6-bookings/day cap, allow going over with a logged reason — later; needs an owner decision first.
5. A "today" screen for the owner — later; it's just a faster look, it doesn't reduce the risk of double-booking at all.
6. Tell Mai which slot just opened up after a cancellation — later; there's no waitlist data to work from.
7. Load the old data from the original spreadsheet — mandatory groundwork, needed to test anything else at all.

### Why #1

This is exactly what the owner is most afraid of, and it has already happened for real (two students double-booked last term). The data proves it's happening right now, in the sample week itself (L007+L008, L033+L034). This is something a spreadsheet or a text message can never do, but software can. It fits inside 2h30. And building it right lays the groundwork (the session data itself) for everything else on this list.

### What I leave broken by choosing this

- Tutors still get their schedule through a hand-typed message — "which message is real" is still unsolved.
- The 6-bookings/day cap and the Monday closure: not blocked, not even warned about, live in the system.
- No late-cancellation billing.
- No waitlist for freed-up slots.
- No schedule screen — only one API to look back at a single session's history.

## 3. Design

### What gets stored

```
tutor          — id, name, subject, phone (taken directly from the original file, no new id made up)
room           — id, name (all six rooms R1-R6, even though the sample data only touches R1-R3)
student        — a generated id (the original file has none), name (name is not used as an identity key)
lesson         — id, tutor, room, start/end time, kind (single/exam pair),
                 status (booked/cancelled/no-show), when cancelled (if any), a note,
                 the old spreadsheet's row id (if loaded from there)
lesson_student — links a lesson to its student(s) — an exam pair links one lesson to 2 students;
                 also carries its own copy of the lesson's time range and status (technical reason below)
lesson_event   — history: every create/move/cancel logs one row (before — after,
                 whether it happened after the cut-off, who did it)
legacy_conflict — old sessions the database rejected while loading (a report, not a feature)
```

### How a cancel/move after the tutor was told is represented

A session always holds its latest state — nothing is deleted, and its time/room/tutor is never changed directly except through a dedicated "move." Every create/move/cancel/no-show adds one row to the history, marked with whether it happened **after the previous day's 16:00 cut-off**. That's how "what the tutor was actually told" can be reconstructed later — just read the history back.

### What's enforced by the database, what's handled in code

- A tutor can't teach two places at once → **enforced by the database** — this must never be wrong, even if two requests land at the exact same moment.
- A room can't hold two sessions at once → **enforced by the database**, same reasoning.
- A student can't be in two places at once → **enforced by the database** — this is what the owner cares about most, so it has to be exactly as solid as the two rules above, not weaker.
- End time must come after start time → **enforced by the database**, cheap and never changes.
- No deleting a session, no changing its time/room/tutor directly → **handled in code** (there simply is no route that allows it).
- Marking a change as "after cut-off" → **handled in code**, at the moment it's logged, since it depends on the current date/time and the policy could change later.
- The 6/day cap, the Monday closure, late-cancellation billing → **not handled anywhere** while the system is running — they only show up in the report from loading the old data.

### The API

- Create a new session — rejected if it clashes on tutor/room/student.
- Move a session to a new time/room/tutor — same rejection logic.
- Cancel a session — frees up that slot.
- Mark a student as a no-show — does not free up the slot.
- Look at a session's change history.

**Not built**: a generic "edit a session" endpoint (letting any field change in one call) — it wouldn't be able to tell "moved" apart from "just fixed a typo in the note," which destroys the whole point of keeping a change history.

## 4. Reflection

### Next week

- A screen for the tutor to see how their schedule differs from what they were last told.
- A real way to create/look up a student — creating a session currently needs an existing student id, but nothing except loading the old data can create one.
- Get the owner to actually decide on the 6/day cap and the Monday closure, then enforce it exactly the way they choose.
- Write a real test suite and run it automatically on every code change.

### What I know is weak

- For a technical Postgres reason, a session's time range is stored in two tables so that student double-booking can be blocked — if some future code change forgets to update both, the block can silently stop working and nobody would notice.
- Telling apart a tutor/room/student conflict relies on matching the database constraint's name — if that name ever changes, the code that reads it breaks too.
- The 6/day cap, the Monday closure, and late-cancellation billing: nothing blocks or even warns about them live — the current data already shows the first two being broken for real.
- No automated test suite ships with this submission — the six required scenarios were hand-checked and work, but nothing catches a future change that breaks them.
- Old sessions loaded from the spreadsheet have no "when was this created" history (the original file never recorded it) — only the ones with a real cancellation timestamp get one history row. Every session created from now on gets a full history.

### Where my AI assistant helped

- Wrote the database-level block on double-booking (including making sure a no-show doesn't count as freeing up the slot) and the hand-written database setup file.
- Worked through how to block student double-booking specifically (duplicating the time range so it could be blocked at all, instead of a weaker application-side check) and wrote that part.
- Wrote the loader for the old spreadsheet: how to tell that two rows are one exam-pair session, and how to report a row that breaks a rule.
- Wrote the API (create/move/cancel/no-show/history) and how to turn a database conflict into the right kind of error.
- Caught and fixed a real design mistake before submitting: the API originally took a student's name and tried to find-or-create them by that name — risky if two people share a name. Fixed to only take an existing student id instead.

### A suggestion I threw away

The stack originally picked Prisma (an ORM) for the whole database layer. I switched the double-booking block over to plain `pg` (hand-written SQL) instead, because of a race condition: blocking a double-booking for real means "check for a clash" and "write the row" have to be **one single action the database itself guarantees** (an EXCLUDE constraint, checked at the moment of the write). Checking through application code via an ORM — read the data, compare it yourself, then write — leaves a gap: two requests at the same time can each read "no clash yet" before the other one finishes writing. Prisma also can't declare an EXCLUDE constraint at all, so keeping it would still mean hand-writing SQL for the one part that matters most — none of the ORM's benefit would be left there anyway. I was right, because the promise "the system won't allow a double-booking" has to live in the database to actually hold, not in code that only checks before it writes.
