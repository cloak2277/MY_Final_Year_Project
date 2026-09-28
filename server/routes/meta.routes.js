import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { CURRENT_TERM } from '../config.js';
import { sessionSelect, hydrate, COURSES_OF_LECTURER } from '../queries.js';

const r = Router();

r.get('/lecturers', requireAuth, (req, res) =>
  res.json(db.prepare("SELECT id,name,email FROM users WHERE role='lecturer' ORDER BY name").all()));

// Role-specific dashboard summary.
r.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user, n = (sql, ...p) => db.prepare(sql).get(...p).n;
  if (u.role === 'admin') {
    const sessions = hydrate(sessionSelect('WHERE s.term = ?', CURRENT_TERM), u);
    return res.json({
      role: 'admin', term: CURRENT_TERM,
      users: n('SELECT COUNT(*) n FROM users'),
      courses: n('SELECT COUNT(*) n FROM courses'),
      rooms: n('SELECT COUNT(*) n FROM rooms'),
      sessions: sessions.length,
      students: n("SELECT COUNT(*) n FROM users WHERE role='student'"),
      lecturers: n("SELECT COUNT(*) n FROM users WHERE role='lecturer'"),
      confirmed: sessions.filter(s => s.status === 'confirmed').length,
      pending: sessions.filter(s => s.status === 'pending').length,
      declined: sessions.filter(s => s.status === 'declined').length,
      unscheduled: n('SELECT COUNT(*) n FROM courses c WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.course_id = c.id)'),
    });
  }
  if (u.role === 'lecturer') {
    const sessions = hydrate(sessionSelect(`WHERE s.term = ? AND s.course_id IN ${COURSES_OF_LECTURER}`, CURRENT_TERM, u.id, u.id), u);
    return res.json({
      role: 'lecturer', term: CURRENT_TERM,
      myCourses: n(`SELECT COUNT(*) n FROM courses WHERE id IN ${COURSES_OF_LECTURER}`, u.id, u.id),
      mySessions: sessions.length,
      awaiting: sessions.filter(s => s.my_status === 'pending').length,
      unavailable: n('SELECT COUNT(*) n FROM availability WHERE lecturer_id = ?', u.id),
    });
  }
  return res.json({
    role: 'student', term: CURRENT_TERM,
    enrolled: n('SELECT COUNT(*) n FROM enrollments WHERE student_id = ?', u.id),
    classes: n('SELECT COUNT(*) n FROM sessions WHERE term = ? AND course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)', CURRENT_TERM, u.id),
  });
});

r.get('/audit', requireAuth, requireRole('admin'), (req, res) =>
  res.json(db.prepare(`
    SELECT a.*, u.name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`).all()));

export default r;
