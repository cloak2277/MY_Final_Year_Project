import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { CURRENT_TERM } from '../config.js';
import { sessionSelect, hydrate, COURSES_OF_LECTURER } from '../queries.js';

const r = Router();

// Role-aware timetable.
//   admin    -> every session, with each lecturer's confirmation status
//   lecturer -> sessions of courses they teach (lead or co-lecturer) + their own confirmation
//   student  -> sessions of courses they're enrolled in, with clash flags (no confirmation data)
r.get('/', requireAuth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = sessionSelect('WHERE s.term = ?', CURRENT_TERM);
  } else if (req.user.role === 'lecturer') {
    rows = sessionSelect(`WHERE s.term = ? AND s.course_id IN ${COURSES_OF_LECTURER}`, CURRENT_TERM, req.user.id, req.user.id);
  } else {
    rows = sessionSelect('WHERE s.term = ? AND s.course_id IN (SELECT course_id FROM enrollments WHERE student_id = ?)', CURRENT_TERM, req.user.id);
    // Flag the student's own clashes (two enrolled classes overlapping).
    for (const a of rows) {
      a.clash = rows.some(b => b.id !== a.id && b.day_of_week === a.day_of_week &&
        a.start_min < b.start_min + b.duration_min && b.start_min < a.start_min + a.duration_min);
    }
  }
  res.json(hydrate(rows, req.user));
});
export default r;
