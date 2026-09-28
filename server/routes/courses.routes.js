import { Router } from 'express';
import { db, audit, tx } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { evaluate, lecturersOfCourse, DAYS, fmtTime } from '../conflict.js';
import { str, int } from '../util.js';

const r = Router();

// Attach lecturers[] (lead first) and a joined lecturer_name to course rows.
function withLecturers(rows) {
  for (const c of rows) {
    c.lecturers = lecturersOfCourse(c.id);
    c.lecturer_name = c.lecturers.map(l => l.name).join(' / ') || null;
  }
  return rows;
}
const courseRow = (id) => withLecturers([db.prepare(`
  SELECT c.*,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled,
    (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id)    AS session_count
  FROM courses c WHERE c.id = ?`).get(id)])[0];

// Everyone can browse the catalogue; it carries lecturer names + enrolment count.
r.get('/', requireAuth, (req, res) => {
  res.json(withLecturers(db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS enrolled,
      (SELECT COUNT(*) FROM sessions s WHERE s.course_id = c.id)    AS session_count
    FROM courses c ORDER BY COALESCE(c.level, 0) DESC, c.code
  `).all()));
});

const isLecturer = (id) => !!db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'lecturer'").get(id);

// Validate the lecturer fields; returns { error } or { lead, co }.
function readLecturers(body, current = null) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  let lead = current ? current.lead : null, co = current ? current.co : [];
  if (has('lecturer_id')) {
    lead = body.lecturer_id === null || body.lecturer_id === '' ? null : int(body.lecturer_id);
    if (lead !== null && (Number.isNaN(lead) || !isLecturer(lead))) return { error: 'Lead lecturer must be an existing lecturer account.' };
  }
  if (has('co_lecturer_ids')) {
    const raw = Array.isArray(body.co_lecturer_ids) ? body.co_lecturer_ids : [];
    co = [...new Set(raw.map(int))];
    if (co.some(x => Number.isNaN(x) || !isLecturer(x))) return { error: 'Co-lecturers must be existing lecturer accounts.' };
  }
  co = co.filter(x => x !== lead);
  return { lead, co };
}

function readCourse(body, existing = null) {
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const code = has('code') ? str(body.code) : existing?.code;
  const title = has('title') ? str(body.title) : existing?.title;
  const alias = has('alias') ? (str(body.alias) || null) : (existing?.alias ?? null);
  const department = has('department') ? str(body.department) : (existing?.department ?? '');
  const status = has('status') ? String(body.status).toUpperCase() : (existing?.status ?? 'C');
  const units = has('credit_units') ? int(body.credit_units) : (existing?.credit_units ?? 3);
  let level = existing?.level ?? null;
  if (has('level')) level = body.level === '' || body.level === null ? null : int(body.level);
  if (!code || !title) return { error: 'Course code and title are required.' };
  if (code.length > 20 || title.length > 150) return { error: 'Course code or title is too long.' };
  if (!['C', 'E'].includes(status)) return { error: 'Status must be C (compulsory) or E (elective).' };
  if (Number.isNaN(units) || units < 1 || units > 12) return { error: 'Credit units must be a whole number from 1 to 12.' };
  if (level !== null && (Number.isNaN(level) || level < 100 || level > 800)) return { error: 'Level must be like 100, 200, 300 or 400.' };
  return { code, title, alias, department, status, units, level };
}

function saveCoLecturers(courseId, co) {
  db.prepare('DELETE FROM course_co_lecturers WHERE course_id = ?').run(courseId);
  for (const id of co) db.prepare('INSERT INTO course_co_lecturers (course_id, lecturer_id) VALUES (?,?)').run(courseId, id);
}

r.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const v = readCourse(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const l = readLecturers(req.body);
  if (l.error) return res.status(400).json({ error: l.error });
  if (db.prepare('SELECT 1 FROM courses WHERE code = ? COLLATE NOCASE').get(v.code)) return res.status(409).json({ error: 'Course code already exists.' });
  const id = tx(() => {
    const info = db.prepare('INSERT INTO courses (code,alias,title,department,level,status,credit_units,lecturer_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(v.code, v.alias, v.title, v.department, v.level, v.status, v.units, l.lead);
    saveCoLecturers(info.lastInsertRowid, l.co);
    return info.lastInsertRowid;
  });
  audit(req.user.id, 'create_course', v.code);
  res.status(201).json(courseRow(id));
});

r.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Course not found.' });
  const current = { lead: c.lecturer_id, co: db.prepare('SELECT lecturer_id FROM course_co_lecturers WHERE course_id = ?').all(id).map(x => x.lecturer_id) };
  const v = readCourse(req.body, c);
  if (v.error) return res.status(400).json({ error: v.error });
  const l = readLecturers(req.body, current);
  if (l.error) return res.status(400).json({ error: l.error });
  if (v.code.toLowerCase() !== c.code.toLowerCase() && db.prepare('SELECT 1 FROM courses WHERE code = ? COLLATE NOCASE AND id != ?').get(v.code, id))
    return res.status(409).json({ error: 'Course code already exists.' });
  tx(() => {
    db.prepare('UPDATE courses SET code=?,alias=?,title=?,department=?,level=?,status=?,credit_units=?,lecturer_id=? WHERE id=?')
      .run(v.code, v.alias, v.title, v.department, v.level, v.status, v.units, l.lead, id);
    saveCoLecturers(id, l.co);
    // A lecturer who no longer teaches the course can no longer have confirmed its sessions.
    const keep = [l.lead, ...l.co].filter(x => x !== null);
    db.prepare(`DELETE FROM session_confirmations WHERE session_id IN (SELECT id FROM sessions WHERE course_id = ?)
                AND lecturer_id NOT IN (${keep.map(() => '?').join(',') || 'NULL'})`).run(id, ...keep);
  });
  audit(req.user.id, 'update_course', v.code);
  // New lecturers may already be busy at this course's existing times: report, don't block.
  const session_conflicts = [];
  for (const s of db.prepare('SELECT * FROM sessions WHERE course_id = ?').all(id)) {
    for (const h of evaluate(s, s.id).hard)
      session_conflicts.push({ session_id: s.id, when: `${DAYS[s.day_of_week]} ${fmtTime(s.start_min)}`, message: h.message });
  }
  res.json({ ...courseRow(id), session_conflicts });
});

r.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM courses WHERE id = ?').get(id)) return res.status(404).json({ error: 'Course not found.' });
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  audit(req.user.id, 'delete_course', `#${id}`);
  res.json({ ok: true });
});
export default r;
