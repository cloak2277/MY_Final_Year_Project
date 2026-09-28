import { Router } from 'express';
import { db, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { enrolmentClashes } from '../conflict.js';
import { int } from '../util.js';

const r = Router();

// A student sees their own enrolments; admin can look up any student (?student_id=).
r.get('/', requireAuth, requireRole('student', 'admin'), (req, res) => {
  const sid = req.user.role === 'admin' && req.query.student_id ? int(req.query.student_id) : req.user.id;
  res.json(db.prepare(`
    SELECT e.id, e.course_id, c.code, c.title, c.level FROM enrollments e
    JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? ORDER BY c.code`).all(sid));
});

// Enrol. Students enrol themselves; an admin may enrol a student by student_id.
// Enrolment is never blocked by a clash — the response carries soft warnings instead.
r.post('/', requireAuth, requireRole('student', 'admin'), (req, res) => {
  const courseId = int(req.body.course_id);
  const sid = req.user.role === 'admin' ? int(req.body.student_id) : req.user.id;
  if (Number.isNaN(courseId)) return res.status(400).json({ error: 'course_id is required.' });
  if (Number.isNaN(sid)) return res.status(400).json({ error: 'student_id is required.' });
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) return res.status(404).json({ error: 'Course not found.' });
  if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'student'").get(sid)) return res.status(400).json({ error: 'That user is not a student.' });
  if (db.prepare('SELECT 1 FROM enrollments WHERE student_id = ? AND course_id = ?').get(sid, courseId))
    return res.status(409).json({ error: 'Already enrolled in this course.' });
  db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)').run(sid, courseId);
  audit(req.user.id, 'enroll', `student #${sid} course #${courseId}`);
  res.status(201).json({ ok: true, warnings: enrolmentClashes(sid, courseId) });
});

r.delete('/:courseId', requireAuth, requireRole('student', 'admin'), (req, res) => {
  const sid = req.user.role === 'admin' && req.query.student_id ? int(req.query.student_id) : req.user.id;
  const info = db.prepare('DELETE FROM enrollments WHERE student_id = ? AND course_id = ?').run(sid, int(req.params.courseId));
  if (!info.changes) return res.status(404).json({ error: 'Not enrolled in that course.' });
  audit(req.user.id, 'drop', `student #${sid} course #${req.params.courseId}`);
  res.json({ ok: true });
});
export default r;
