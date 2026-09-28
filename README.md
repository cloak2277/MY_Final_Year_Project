# Department Scheduler
### Intelligent Resource Allocation & Scheduling Platform for Academic Departments

A full-stack web application that lets an academic department schedule classes into rooms and time slots while a constraint-validation engine catches room clashes, lecturer clashes (including co-lecturers), lecturer-unavailability violations, room over-capacity, and student timetable clashes — and suggests the next free slot when a hard conflict is found. Seeded with the real DELSU Dept. of Computer and Software Technology 2025/26 second-semester course allocation; lecturer login emails, room names/capacities and class times are placeholders (see §6).

Three real user roles (**admin**, **lecturer**, **student**), token-based authentication, and access control enforced on the server.

---

## 1. Features by role

**Admin**
- Manage users (create lecturers/admins, change roles, reset passwords, remove accounts — with a guard that the last admin can't be removed).
- Manage rooms and courses (code, title, cross-listed alias, level, compulsory/elective status, credit units), including a lead lecturer plus any co-lecturers per course.
- Schedule classes with a live conflict check as the form is filled, plus a one-click "next free slot" suggestion.
- View the full department timetable, each session's per-lecturer confirmation status, and every class's enrolled-student roster.
- View an activity (audit) log.

**Lecturer**
- View a personal timetable of the classes they teach (as lead or co-lecturer).
- **Confirm or decline** each assigned class, with an optional note visible to the admin; a session with more than one lecturer shows as confirmed only once every lecturer has confirmed.
- See the roster of students enrolled in each of their classes.
- Mark unavailable time blocks — the scheduler will then refuse to book them (or a co-lecturer of theirs) at those times, and adding a block reports any already-scheduled class it now clashes with.

**Student**
- Browse the course catalogue and enrol / drop courses. Enrolling into a course that overlaps one you're already in is still allowed, but returns a clash warning naming the other course.
- View a personal weekly timetable with **clash detection** (two enrolled classes overlapping are outlined) and see each class's lecturer(s).

---

## 2. Technology

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (≥ 22.5) | Built-in `node:sqlite` — real SQL with zero native build step |
| Server | Express | Minimal, well-understood REST framework |
| Database | SQLite (via `node:sqlite`) | Real relational DB, foreign keys, single file, portable |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs` | Stateless sessions; salted password hashing |
| Frontend | Vanilla JS SPA + CSS | No build tooling; the API is the contract |

---

## 3. Architecture

```
Browser (SPA)  ──fetch + Bearer JWT──►  Express API  ──►  SQLite
public/                                 server/
  index.html                             index.js        app wiring + static
  styles.css                             auth.js         JWT + RBAC middleware
  app.js  (router, views, grid)          conflict.js     CONSTRAINT ENGINE
                                         db.js           schema + connection
                                         routes/*.js     REST endpoints
                                         seed.js         demo data
```

Requests flow through `requireAuth` (validates the JWT) and `requireRole(...)` (checks the role) before reaching a handler. Authorization is **server-side**: hiding a button in the UI is convenience only; a student calling an admin endpoint directly is rejected with `403`.

---

## 4. Data model

```mermaid
erDiagram
    users ||--o{ courses : "teaches (lecturer_id)"
    users ||--o{ enrollments : "enrols"
    users ||--o{ availability : "is unavailable"
    courses ||--o{ sessions : "is scheduled as"
    courses ||--o{ enrollments : "has"
    rooms ||--o{ sessions : "hosts"

    courses ||--o{ course_co_lecturers : "co-taught by"
    users ||--o{ course_co_lecturers : "co-teaches"
    sessions ||--o{ session_confirmations : "confirmed by"
    users ||--o{ session_confirmations : "confirms"

    users { int id PK; text name; text email UK; text password_hash; text role }
    rooms { int id PK; text name; text building; int capacity }
    courses { int id PK; text code UK; text alias; text title; int level; text status; int credit_units; int lecturer_id FK }
    course_co_lecturers { int course_id FK; int lecturer_id FK }
    sessions { int id PK; int course_id FK; int room_id FK; int day_of_week; int start_min; int duration_min; text term }
    session_confirmations { int session_id FK; int lecturer_id FK; text status; text note }
    enrollments { int id PK; int student_id FK; int course_id FK }
    availability { int id PK; int lecturer_id FK; int day_of_week; int start_min; int end_min }
    audit_log { int id PK; int user_id FK; text action; text detail; text created_at }
```

Times are stored as `day_of_week` (0=Mon … 4=Fri) plus minutes-from-midnight, so overlap maths is plain integer arithmetic. `role` is constrained at the database level to `admin | lecturer | student`. `courses.lecturer_id` is the **lead** lecturer; `course_co_lecturers` holds any additional teachers of the same course, so every constraint that checks "the lecturer" (double-booking, availability) checks **all** of them. `session_confirmations` has no row for a lecturer who hasn't responded yet — that's "pending" by omission, not a stored state.

---

## 5. The conflict / constraint engine

Lives in `server/conflict.js`. Given a candidate session it returns **hard** conflicts (block the save) and **soft** warnings (allowed but flagged):

| Constraint | Severity | Rule |
|---|---|---|
| Room double-booking | hard | Same room, same day, overlapping time |
| Lecturer double-booking | hard | The course's lecturer already teaches an overlapping session |
| Lecturer unavailable | hard | Session overlaps a window the lecturer marked unavailable |
| Room over capacity | soft | Enrolled students exceed the room's seats |
| Student clash | soft | A student enrolled in this course is also enrolled in another course with an overlapping session |
| No lecturer assigned | soft | The course has no lead or co-lecturer to check or to confirm the session |

Two blocks overlap when `aStart < bEnd && bStart < aEnd` (open intervals). `suggestSlot()` walks the week (the chosen day first) in 30-minute steps and returns the first slot with no hard conflicts.

The same engine powers a dry-run check for the live UI (`POST /api/sessions/check`), and the actual create/edit (`POST /api/sessions`, `PATCH /api/sessions/:id`), which re-evaluate and refuse to persist a hard conflict, returning a suggested slot in the `409` body.

**Enrolment clashes are checked separately**, by `enrolmentClashes()`, and are never blocking: `POST /api/enrollments` always succeeds if the course exists and the student isn't already enrolled, but the response carries a `warnings[]` array naming any of the student's existing courses that overlap the new one — satisfying the "detect & resolve conflicts" step of enrolment without preventing a student from taking two electives that happen to clash.

---

## 6. Running it

Requires **Node 22.5+** (for the built-in SQLite module). Runs entirely locally — no hosting or external services required.

```bash
npm install
npm run seed     # creates and populates data.db
npm start        # http://localhost:4000
```

Open `http://localhost:4000` and sign in:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@delsu.edu.ng` | `admin123` |
| Lecturer | `edafe@delsu.edu.ng` (Dr Edafe, teaches D-COS 311 / CSC 415) | `lecturer123` |
| Student | `student300@delsu.edu.ng` | `student123` |

All other seeded lecturers share `lecturer123` (see the `LECTURERS` map at the top of `server/seed.js` for every login email); demo students share `student123`. Self-registration creates a student account.

Re-run `npm run seed` at any time to reset to this demo data.

**Making this your own department's data.** `server/seed.js` is organised as data, not logic — three arrays (`LECTURERS`, `COURSES`, `SESSIONS`) plus a small block of demo students. The `COURSES` table already carries the real DELSU Computer Science 2025/26 second-semester allocation (course codes, titles, units, C/E status and lecturer assignments read from the department's course allocation sheet). What's still placeholder and worth editing before a real demo:
- **Lecturer login emails** in the `LECTURERS` map — the display names are real, the `@delsu.edu.ng` addresses are inferred and should be swapped for real ones (or left as-is for a local demo).
- **Room names and capacities** in `R`/`addRoom(...)` — there was no room-allocation sheet to seed from.
- **Class times** in `SESSIONS` — the allocation sheet gives lecturers and units, not a timetable, so times were placed to be conflict-free (the seed script verifies this itself and exits with an error if it isn't) but are not the department's actual timetable.
- **Students** — five placeholders, one per level, enrolled in that level's courses.

Any admin-side edits (add/rename a room, add a real student, correct a lecturer's email) can also be made from the running app itself under Users / Rooms / Courses, without touching `seed.js`.

---

## 7. API reference (summary)

All `/api/*` routes except `auth/login` and `auth/register` require `Authorization: Bearer <token>`.

```
POST   /api/auth/register            public → creates a student, returns {token,user}
POST   /api/auth/login               → {token,user}
GET    /api/auth/me                  current user

GET    /api/users                    admin
POST   /api/users                    admin (any role)
PATCH  /api/users/:id                admin (change role)
DELETE /api/users/:id                admin

GET    /api/rooms                    any   |  POST/DELETE  admin
GET    /api/courses                  any   |  POST/PATCH/DELETE  admin
GET    /api/lecturers                any

GET    /api/sessions                 admin — every session, with confirmation status
POST   /api/sessions/check           admin — dry-run conflict check
POST   /api/sessions                 admin — create (409 on hard conflict)
PATCH  /api/sessions/:id             admin — reschedule (409 on hard conflict; resets confirmations)
DELETE /api/sessions/:id             admin
POST   /api/sessions/:id/confirm     lecturer of that course — {status: confirmed|declined|pending, note?}
GET    /api/sessions/:id/students    admin / lecturer of that course — enrolled-student roster

GET    /api/enrollments              student (own) / admin
POST   /api/enrollments              student enrol / admin — never blocked; returns {warnings[]} on a clash
DELETE /api/enrollments/:courseId    student drop / admin

GET    /api/availability             lecturer (own) / admin
POST   /api/availability             lecturer / admin — returns {affected[]}: already-scheduled classes the new block now clashes with
DELETE /api/availability/:id         lecturer (own) / admin

GET    /api/timetable                role-scoped (admin=all w/ confirmations, lecturer=own w/ my_status, student=enrolled+clash flags)
GET    /api/dashboard                role-specific summary
GET    /api/audit                    admin
```

---

## 8. Testing

```bash
npm test
```

Runs `tests/api.test.mjs` — 122 in-process integration tests (each run seeds a throwaway database, listens on an ephemeral port, and cleans up after itself) covering authentication and rate limiting, server-side RBAC on every route, every hard and soft conflict type (including co-lecturer clashes), slot suggestion, conflict blocking on create *and* edit, lecturer confirmation (including the two-lecturers-must-both-confirm and decline-with-note cases), class rosters, the student timetable clash flags and non-blocking enrolment warnings, course/room/user CRUD and validation, and a basic latency check on the conflict engine.

---

## 9. Security notes & production hardening

This project demonstrates the real authentication and authorization model. For a production deployment you would additionally:

- `JWT_SECRET` and all config already come from environment variables (see `.env.example`); the server now refuses to start with the default development secret when `NODE_ENV=production`.
- Serve over HTTPS and store the JWT in an `HttpOnly`, `Secure` cookie rather than `localStorage` to reduce XSS exposure.
- Add rate limiting on `auth/login`, input validation (e.g. `zod`), and CSRF protection if moving to cookies.
- Add token refresh / revocation, and password-reset flows.
- For larger installations, swap SQLite for PostgreSQL — the schema and the conflict engine port directly (the overlap check becomes a SQL predicate or stays in the service layer).

**Known dependency advisory.** `npm audit` reports a moderate-severity denial-of-service advisory in `qs`, a transitive dependency pulled in by Express 4.x's bundled `body-parser`. It affects malformed query-string parsing, not authentication or data exposure, and is not otherwise triggered by this application's routes. Resolving it fully requires an Express 5 major-version upgrade, which was judged out of scope for this project; before any production use, re-run `npm audit` against the Express version current at that time.

---

## 10. Possible extensions

- Drag-and-drop rescheduling on the timetable grid with live re-validation.
- Automatic timetable generation (treat it as a constraint-satisfaction problem and let the engine fill an empty week).
- Multiple terms / academic sessions and recurring weekly patterns.
- Email notifications on schedule changes; iCal export of personal timetables.
- Soft-conflict policies an admin can configure (e.g. make student clashes blocking).


---

## 11. Known limitations

- **Placeholder data.** As noted in §6, only the course/lecturer allocation in the seed is drawn from a real source; room names/capacities, class times, and student records are illustrative.
- **Single term.** The schema has a `term` column and everything queries against `CURRENT_TERM` (`server/config.js`), but there is no UI to switch terms or archive a past one.
- **No email notifications.** A lecturer decline or a rescheduled class is visible next time the admin opens the timetable, not pushed to them.
- **Confirmation, not availability sync.** Confirming a class doesn't add it to any external calendar; it only records a status the admin can see.
