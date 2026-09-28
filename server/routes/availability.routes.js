import { Router } from 'express';
import { db, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { overlaps, DAYS, fmtTime } from '../conflict.js';
import { COURSES_OF_LECTURER } from '../queries.js';
import { int } from '../util.js';

const r = Router();

// A lecturer manages their own unavailable windows; an admin can manage anyone's.
r.get('/', requireAuth, requireRole('lecturer', 'admin'), (req, res) => {
  const lid = req.user.role === 'admin' && req.query.lecturer_id ? int(req.query.lecturer_id) : req.user.id;
  res.json(db.prepare('SELECT * FROM availability WHERE lecturer_id = ? ORDER BY day_of_week, start_min').all(lid));
});

r.post('/', requireAuth, requireRole('lecturer', 'admin'), (req, res) => {
  const lid = req.user.role === 'admin' ? int(req.body.lecturer_id) : req.user.id;
  const day = int(req.body.day_of_week), start = int(req.body.start_min), end = int(req.body.end_min);
  if ([lid, day, start, end].some(Number.isNaN)) return res.status(400).json({ error: 'Day, start and end are required.' });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'lecturer'").get(lid)) return res.status(400).json({ error: 'That user is not a lecturer.' });
  if (day < 0 || day > 4) return res.status(400).json({ error: 'Day must be Monday to Friday.' });
  if (start < 0 || end > 24 * 60 || end <= start) return res.status(400).json({ error: 'End time must be after start time.' });
  const info = db.prepare('INSERT INTO availability (lecturer_id, day_of_week, start_min, end_min) VALUES (?,?,?,?)').run(lid, day, start, end);
  audit(req.user.id, 'add_unavailable', `lecturer #${lid} ${DAYS[day]} ${fmtTime(start)}-${fmtTime(end)}`);
  // Already-scheduled classes that now fall inside the blocked window (reported, not blocked).
  const affected = db.prepare(`
    SELECT s.id, s.day_of_week, s.start_min, s.duration_min, c.code
    FROM sessions s JOIN courses c ON c.id = s.course_id
    WHERE s.course_id IN ${COURSES_OF_LECTURER} AND s.day_of_week = ?`).all(lid, lid, day)
    .filter(s => overlaps(s.start_min, s.duration_min, start, end - start))
    .map(s => ({ session_id: s.id, course_code: s.code, when: `${DAYS[s.day_of_week]} ${fmtTime(s.start_min)}–${fmtTime(s.start_min + s.duration_min)}` }));
  res.status(201).json({ id: info.lastInsertRowid, affected });
});

r.delete('/:id', requireAuth, requireRole('lecturer', 'admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM availability WHERE id = ?').get(int(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found.' });
  if (req.user.role !== 'admin' && row.lecturer_id !== req.user.id) return res.status(403).json({ error: 'Not yours to remove.' });
  db.prepare('DELETE FROM availability WHERE id = ?').run(row.id);
  res.json({ ok: true });
});
export default r;
