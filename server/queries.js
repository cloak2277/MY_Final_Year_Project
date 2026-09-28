// Shared read helpers: sessions joined with their course, room, lecturers and confirmation status.
import { db } from './db.js';

const BASE = `
  SELECT s.*, c.code AS course_code, c.alias AS course_alias, c.title AS course_title, c.level AS course_level,
         c.lecturer_id, r.name AS room_name, r.capacity,
         (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id) AS enrolled
  FROM sessions s
  JOIN courses c ON c.id = s.course_id
  JOIN rooms   r ON r.id = s.room_id `;

export const sessionSelect = (where = '', ...params) =>
  db.prepare(BASE + where + ' ORDER BY s.day_of_week, s.start_min').all(...params);

/**
 * Attach lecturers[], lecturer_name (joined) and a confirmation summary to each session row.
 *   viewer.role admin    -> full confirmations[] (with notes)
 *   viewer.role lecturer -> my_status / my_note only
 *   viewer.role student  -> lecturers only (no confirmation data)
 * status: 'declined' if any lecturer declined, 'confirmed' if all confirmed, else 'pending'.
 */
export function hydrate(rows, viewer) {
  if (!rows.length) return rows;
  const lecs = new Map();      // course_id -> [{id,name}]
  const push = (cid, l) => { if (!lecs.has(cid)) lecs.set(cid, []); if (!lecs.get(cid).some(x => x.id === l.id)) lecs.get(cid).push(l); };
  for (const r of db.prepare(`SELECT c.id AS course_id, u.id, u.name FROM courses c JOIN users u ON u.id = c.lecturer_id`).all())
    push(r.course_id, { id: r.id, name: r.name });
  for (const r of db.prepare(`SELECT cl.course_id, u.id, u.name FROM course_co_lecturers cl JOIN users u ON u.id = cl.lecturer_id ORDER BY u.name`).all())
    push(r.course_id, { id: r.id, name: r.name });

  const confs = new Map();     // session_id -> [{lecturer_id,status,note}]
  for (const r of db.prepare('SELECT * FROM session_confirmations').all()) {
    if (!confs.has(r.session_id)) confs.set(r.session_id, []);
    confs.get(r.session_id).push(r);
  }

  for (const s of rows) {
    const ls = lecs.get(s.course_id) || [];
    s.lecturers = ls;
    s.lecturer_name = ls.map(l => l.name).join(' / ') || null;
    const cs = (confs.get(s.id) || []).filter(c => ls.some(l => l.id === c.lecturer_id));
    let status = 'pending';
    if (cs.some(c => c.status === 'declined')) status = 'declined';
    else if (ls.length && ls.every(l => cs.some(c => c.lecturer_id === l.id && c.status === 'confirmed'))) status = 'confirmed';
    if (viewer?.role === 'student') continue;
    s.status = status;
    if (viewer?.role === 'admin') {
      s.confirmations = ls.map(l => {
        const c = cs.find(x => x.lecturer_id === l.id);
        return { lecturer_id: l.id, lecturer_name: l.name, status: c ? c.status : 'pending', note: c?.note || null };
      });
    } else if (viewer?.role === 'lecturer') {
      const mine = cs.find(c => c.lecturer_id === viewer.id);
      s.my_status = mine ? mine.status : 'pending';
      s.my_note = mine?.note || null;
    }
  }
  return rows;
}

// Is this user one of the lecturers of this course?
export function teachesCourse(userId, courseId) {
  return !!db.prepare(`
    SELECT 1 FROM courses WHERE id = ? AND lecturer_id = ?
    UNION SELECT 1 FROM course_co_lecturers WHERE course_id = ? AND lecturer_id = ?`).get(courseId, userId, courseId, userId);
}

// SQL fragment: course ids taught by a given lecturer (lead or co).
export const COURSES_OF_LECTURER = `(SELECT id FROM courses WHERE lecturer_id = ? UNION SELECT course_id FROM course_co_lecturers WHERE lecturer_id = ?)`;
