// ============================================================================
//  CONFLICT / CONSTRAINT ENGINE
//  The core of the platform. Given a candidate session it evaluates every
//  scheduling constraint and returns hard conflicts (block the booking) and
//  soft warnings (allowed, but flagged). Also suggests the next free slot and
//  checks a student's enrolment against the sessions they already attend.
// ============================================================================
import { db } from './db.js';
import { CURRENT_TERM } from './config.js';

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DAY_START = 8 * 60;   // 08:00
export const DAY_END   = 18 * 60;  // 18:00
export const STEP      = 30;       // scheduling granularity (minutes)

// Two time blocks on the same day overlap (open interval).
export function overlaps(aStart, aDur, bStart, bDur) {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

export function fmtTime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? 'am' : 'pm';
  let hh = h % 12; if (hh === 0) hh = 12;
  return m === 0 ? `${hh}${ap}` : `${hh}:${String(m).padStart(2, '0')}${ap}`;
}

// Everyone who teaches a course: the lead lecturer first, then co-lecturers.
export function lecturersOfCourse(courseId) {
  const lead = db.prepare(`SELECT u.id, u.name FROM courses c JOIN users u ON u.id = c.lecturer_id WHERE c.id = ?`).get(courseId);
  const co = db.prepare(`SELECT u.id, u.name FROM course_co_lecturers cl JOIN users u ON u.id = cl.lecturer_id
                         WHERE cl.course_id = ? ORDER BY u.name`).all(courseId);
  const out = lead ? [lead] : [];
  for (const c of co) if (!out.some(o => o.id === c.id)) out.push(c);
  return out;
}

// course_id -> Set(lecturer ids), for every course at once.
function lecturerMap() {
  const map = new Map();
  const add = (cid, lid) => { if (!map.has(cid)) map.set(cid, new Set()); map.get(cid).add(lid); };
  for (const r of db.prepare('SELECT id, lecturer_id FROM courses WHERE lecturer_id IS NOT NULL').all()) add(r.id, r.lecturer_id);
  for (const r of db.prepare('SELECT course_id, lecturer_id FROM course_co_lecturers').all()) add(r.course_id, r.lecturer_id);
  return map;
}

// All sessions in the same term, joined to the info the engine needs.
function siblingSessions(term, ignoreId) {
  return db.prepare(`
    SELECT s.*, c.code AS course_code, c.title AS course_title, r.name AS room_name, r.capacity
    FROM sessions s
    JOIN courses c ON c.id = s.course_id
    JOIN rooms   r ON r.id = s.room_id
    WHERE s.term = ? AND s.id != ?
  `).all(term, ignoreId ?? -1);
}

/**
 * Evaluate a candidate session against every constraint.
 * candidate = { course_id, room_id, day_of_week, start_min, duration_min, term }
 * Returns { hard: [...], soft: [...] }  each item { type, message, withSessionId? }
 */
export function evaluate(candidate, ignoreId = null) {
  const hard = [], soft = [];
  const term = candidate.term || CURRENT_TERM;
  const lecturers = lecturersOfCourse(candidate.course_id);
  const lecturerIds = new Set(lecturers.map(l => l.id));
  const lecMap = lecturerMap();
  const others = siblingSessions(term, ignoreId);

  for (const o of others) {
    if (o.day_of_week !== candidate.day_of_week) continue;
    if (!overlaps(candidate.start_min, candidate.duration_min, o.start_min, o.duration_min)) continue;

    // 1) Room double-booking — hard.
    if (o.room_id === candidate.room_id) {
      hard.push({ type: 'room', withSessionId: o.id,
        message: `${o.room_name} is already booked by ${o.course_code} (${DAYS[o.day_of_week]} ${fmtTime(o.start_min)}–${fmtTime(o.start_min + o.duration_min)}).` });
    }
    // 2) Lecturer double-booking — hard (any lecturer of either course).
    const theirs = lecMap.get(o.course_id) || new Set();
    for (const l of lecturers) {
      if (theirs.has(l.id)) {
        hard.push({ type: 'lecturer', withSessionId: o.id,
          message: `${l.name} already teaches ${o.course_code} at that time.` });
      }
    }
  }

  // 3) Any lecturer of the course marked unavailable — hard.
  const availStmt = db.prepare('SELECT * FROM availability WHERE lecturer_id = ? AND day_of_week = ?');
  for (const l of lecturers) {
    for (const b of availStmt.all(l.id, candidate.day_of_week)) {
      if (overlaps(candidate.start_min, candidate.duration_min, b.start_min, b.end_min - b.start_min)) {
        hard.push({ type: 'availability',
          message: `${l.name} is unavailable ${DAYS[b.day_of_week]} ${fmtTime(b.start_min)}–${fmtTime(b.end_min)}.` });
      }
    }
  }

  // 4) Room capacity vs enrolment — soft.
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(candidate.room_id);
  const enrolled = db.prepare('SELECT COUNT(*) n FROM enrollments WHERE course_id = ?').get(candidate.course_id).n;
  if (room && room.capacity && enrolled > room.capacity) {
    soft.push({ type: 'capacity',
      message: `${enrolled} students enrolled but ${room.name} seats only ${room.capacity}.` });
  }

  // 5) Student timetable clashes — soft. Cross-reference: any student enrolled in
  //    THIS course who is also enrolled in another course whose session overlaps.
  const clashCount = db.prepare(`
    SELECT COUNT(DISTINCT e1.student_id) AS n
    FROM enrollments e1
    JOIN enrollments e2 ON e2.student_id = e1.student_id AND e2.course_id != e1.course_id
    JOIN sessions   s2 ON s2.course_id = e2.course_id AND s2.term = ? AND s2.id != ?
    WHERE e1.course_id = ?
      AND s2.day_of_week = ?
      AND s2.start_min < ? AND ? < s2.start_min + s2.duration_min
  `).get(term, ignoreId ?? -1, candidate.course_id, candidate.day_of_week,
         candidate.start_min + candidate.duration_min, candidate.start_min).n;
  if (clashCount > 0) {
    soft.push({ type: 'student',
      message: `${clashCount} enrolled student(s) have another class at this time.` });
  }

  // 6) No lecturer assigned — soft (nobody to confirm or be checked).
  if (lecturerIds.size === 0) {
    soft.push({ type: 'lecturer-missing', message: 'This course has no lecturer assigned yet.' });
  }

  // De-duplicate identical messages.
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(x => (seen.has(x.message) ? false : (seen.add(x.message), true)));
  };
  return { hard: dedupe(hard), soft: dedupe(soft) };
}

// Walk the week (chosen day first) for the first slot with NO hard conflicts.
export function suggestSlot(candidate, ignoreId = null) {
  const order = [candidate.day_of_week, ...[0, 1, 2, 3, 4].filter(d => d !== candidate.day_of_week)];
  for (const day of order) {
    for (let t = DAY_START; t + candidate.duration_min <= DAY_END; t += STEP) {
      const probe = { ...candidate, day_of_week: day, start_min: t };
      if (evaluate(probe, ignoreId).hard.length === 0) {
        return { day_of_week: day, start_min: t, label: `${DAYS[day]} ${fmtTime(t)}` };
      }
    }
  }
  return null;
}

// When a student enrols: which of the course's sessions overlap sessions of courses
// they are ALREADY enrolled in? Returned as soft warnings (enrolment is still allowed).
export function enrolmentClashes(studentId, courseId, term = CURRENT_TERM) {
  const rows = db.prepare(`
    SELECT ca.code AS new_code, cb.code AS other_code, cb.title AS other_title,
           a.day_of_week, a.start_min, a.duration_min,
           b.start_min AS b_start, b.duration_min AS b_dur
    FROM sessions a
    JOIN sessions b ON b.day_of_week = a.day_of_week AND b.course_id != a.course_id
                   AND a.start_min < b.start_min + b.duration_min
                   AND b.start_min < a.start_min + a.duration_min
    JOIN enrollments e ON e.student_id = ? AND e.course_id = b.course_id
    JOIN courses ca ON ca.id = a.course_id
    JOIN courses cb ON cb.id = b.course_id
    WHERE a.course_id = ? AND a.term = ? AND b.term = ?
    ORDER BY a.day_of_week, a.start_min
  `).all(studentId, courseId, term, term);
  return rows.map(r => ({
    type: 'student',
    message: `${r.new_code} (${DAYS[r.day_of_week]} ${fmtTime(r.start_min)}–${fmtTime(r.start_min + r.duration_min)}) overlaps your enrolled course ${r.other_code} (${fmtTime(r.b_start)}–${fmtTime(r.b_start + r.b_dur)}).`,
  }));
}
