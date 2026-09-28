import { Router } from 'express';
import { db, audit, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { evaluate, suggestSlot, DAY_START, DAY_END, STEP } from '../conflict.js';
import { CURRENT_TERM } from '../config.js';
import { sessionSelect, hydrate, teachesCourse } from '../queries.js';
import { int, str } from '../util.js';

const r = Router();

// Validate + normalise a candidate. `base` supplies defaults when editing (PATCH).
// Returns { error, status } or { cand }.
function readCandidate(body, base = null) {
  const pick = (k) => (body[k] !== undefined ? body[k] : base?.[k]);
  const cand = {
    course_id: int(pick('course_id')), room_id: int(pick('room_id')),
    day_of_week: int(pick('day_of_week')), start_min: int(pick('start_min')),
    duration_min: int(pick('duration_min')), term: CURRENT_TERM,
  };
  for (const k of ['course_id', 'room_id', 'day_of_week', 'start_min', 'duration_min'])
    if (Number.isNaN(cand[k])) return { error: 'Course, room, day, start time and duration are required whole numbers.', status: 400 };
  if (cand.day_of_week < 0 || cand.day_of_week > 4) return { error: 'Day must be Monday (0) to Friday (4).', status: 400 };
  if (cand.duration_min <= 0 || cand.duration_min % STEP !== 0) return { error: `Duration must be a positive multiple of ${STEP} minutes.`, status: 400 };
  if (cand.start_min % STEP !== 0) return { error: `Start time must fall on a ${STEP}-minute boundary.`, status: 400 };
  if (cand.start_min < DAY_START || cand.start_min + cand.duration_min > DAY_END)
    return { error: 'Sessions must sit between 08:00 and 18:00.', status: 400 };
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(cand.course_id)) return { error: 'Course not found.', status: 404 };
  if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(cand.room_id)) return { error: 'Room not found.', status: 404 };
  return { cand };
}

// Admin: every scheduled session with lecturers + confirmation status.
r.get('/', requireAuth, requireRole('admin'), (req, res) => {
  res.json(hydrate(sessionSelect('WHERE s.term = ?', CURRENT_TERM), req.user));
});

// Live conflict check while the admin fills the form (no write).
r.post('/check', requireAuth, requireRole('admin'), (req, res) => {
  const ignore = int(req.body.ignore_id);
  const v = readCandidate(req.body);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const result = evaluate(v.cand, Number.isNaN(ignore) ? null : ignore);
  res.json({ ...result, suggestion: result.hard.length ? suggestSlot(v.cand, Number.isNaN(ignore) ? null : ignore) : null });
});

// Create a session. Hard conflicts block it (409); soft warnings ride along on success.
r.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const v = readCandidate(req.body);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const result = evaluate(v.cand);
  if (result.hard.length) {
    return res.status(409).json({ error: 'Scheduling conflict.', ...result, suggestion: suggestSlot(v.cand) });
  }
  const c = v.cand;
  const info = db.prepare('INSERT INTO sessions (course_id,room_id,day_of_week,start_min,duration_min,term) VALUES (?,?,?,?,?,?)')
    .run(c.course_id, c.room_id, c.day_of_week, c.start_min, c.duration_min, c.term);
  audit(req.user.id, 'create_session', `#${info.lastInsertRowid}`);
  const row = hydrate(sessionSelect('WHERE s.id = ?', info.lastInsertRowid), req.user)[0];
  res.status(201).json({ session: row, warnings: result.soft });
});

// Reschedule / move a session. Re-validated against everything except itself.
// Any change resets lecturer confirmations, because they confirmed the OLD slot.
r.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  const cur = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Session not found.' });
  const v = readCandidate(req.body, cur);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const result = evaluate(v.cand, id);
  if (result.hard.length) return res.status(409).json({ error: 'Scheduling conflict.', ...result, suggestion: suggestSlot(v.cand, id) });
  const c = v.cand;
  const changed = ['course_id', 'room_id', 'day_of_week', 'start_min', 'duration_min'].some(k => c[k] !== cur[k]);
  tx(() => {
    db.prepare('UPDATE sessions SET course_id=?, room_id=?, day_of_week=?, start_min=?, duration_min=? WHERE id=?')
      .run(c.course_id, c.room_id, c.day_of_week, c.start_min, c.duration_min, id);
    if (changed) db.prepare('DELETE FROM session_confirmations WHERE session_id = ?').run(id);
  });
  audit(req.user.id, 'update_session', `#${id}`);
  res.json({ session: hydrate(sessionSelect('WHERE s.id = ?', id), req.user)[0], warnings: result.soft });
});

r.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) return res.status(404).json({ error: 'Session not found.' });
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  audit(req.user.id, 'delete_session', `#${id}`);
  res.json({ ok: true });
});

// Lecturer: confirm / decline / reset ('pending') a session of a course they teach.
r.post('/:id/confirm', requireAuth, requireRole('lecturer'), (req, res) => {
  const id = int(req.params.id);
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  if (!teachesCourse(req.user.id, s.course_id)) return res.status(403).json({ error: 'You are not a lecturer of this course.' });
  const status = req.body.status, note = str(req.body.note).slice(0, 200) || null;
  if (!['confirmed', 'declined', 'pending'].includes(status)) return res.status(400).json({ error: 'Status must be confirmed, declined or pending.' });
  if (status === 'pending') {
    db.prepare('DELETE FROM session_confirmations WHERE session_id = ? AND lecturer_id = ?').run(id, req.user.id);
  } else {
    db.prepare(`INSERT INTO session_confirmations (session_id, lecturer_id, status, note) VALUES (?,?,?,?)
                ON CONFLICT(session_id, lecturer_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = datetime('now')`)
      .run(id, req.user.id, status, note);
  }
  audit(req.user.id, 'confirm_session', `#${id} ${status}`);
  res.json(hydrate(sessionSelect('WHERE s.id = ?', id), req.user)[0]);
});

// Class roster: admin, or a lecturer of that course.
r.get('/:id/students', requireAuth, requireRole('admin', 'lecturer'), (req, res) => {
  const id = int(req.params.id);
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  if (req.user.role === 'lecturer' && !teachesCourse(req.user.id, s.course_id))
    return res.status(403).json({ error: 'You are not a lecturer of this course.' });
  res.json(db.prepare(`SELECT u.id, u.name, u.email FROM enrollments e JOIN users u ON u.id = e.student_id
                       WHERE e.course_id = ? ORDER BY u.name`).all(s.course_id));
});

export default r;
