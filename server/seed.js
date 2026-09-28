// Seeds the database with the DELSU Dept. of Computer and Software Technology
// 2025/26 Second Semester course allocation (Computer Science courses).
//   Real:        course codes, titles, credit units, C/E status, lecturer assignments.
//   Placeholder: lecturer login emails, room names/capacities, class times, and demo students.
//                Edit them from the admin UI (or here) to match your department.
import { db, initSchema, audit } from './db.js';
import { hashPassword } from './auth.js';
import { evaluate } from './conflict.js';
import { CURRENT_TERM } from './config.js';

initSchema();
db.exec(`
  DELETE FROM session_confirmations; DELETE FROM sessions; DELETE FROM enrollments; DELETE FROM availability;
  DELETE FROM course_co_lecturers; DELETE FROM courses; DELETE FROM rooms; DELETE FROM users; DELETE FROM audit_log;
  DELETE FROM sqlite_sequence;
`);

const DEPT = 'Computer and Software Technology';
const ADMIN_PW = 'admin123', LECT_PW = 'lecturer123', STUDENT_PW = 'student123';
const H = (h, m = 0) => h * 60 + m;
const [MON, TUE, WED, THU, FRI] = [0, 1, 2, 3, 4];

// ---- users -----------------------------------------------------------------
const addUser = async (name, email, role, pw) =>
  db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run(name, email, await hashPassword(pw), role).lastInsertRowid;

await addUser('Department Admin', 'admin@delsu.edu.ng', 'admin', ADMIN_PW);

// key -> [display name (as on the allocation sheet), login email]
const LECTURERS = {
  jackson:   ['Prof. Jackson A.',            'jackson@delsu.edu.ng'],
  akazue:    ['Dr. Mrs. Akazue M. I.',       'akazue@delsu.edu.ng'],
  awana:     ['Miss Awana',                  'awana@delsu.edu.ng'],
  edith:     ['Dr. Mrs Omede Edith',         'edith.omede@delsu.edu.ng'],
  edje:      ['Dr. Edje E. Abel',            'edje@delsu.edu.ng'],
  edafe:     ['Dr. Edafe',                   'edafe@delsu.edu.ng'],
  ogeh:      ['Mr. Ogeh Clement',            'ogeh@delsu.edu.ng'],
  cyril:     ['Cyril T.',                    'cyril@delsu.edu.ng'],
  royalty:   ['Miss Royalty',                'royalty@delsu.edu.ng'],
  onyagu:    ['Dr. Onyagu Lilian',           'onyagu@delsu.edu.ng'],
  gcomede:   ['Dr. G. C. Omede',             'gc.omede@delsu.edu.ng'],
  okorodudu: ['Dr. Okorodudu Franklyn',      'okorodudu@delsu.edu.ng'],
  blessing:  ['Mrs. Blessing',               'blessing@delsu.edu.ng'],
  atonuje:   ['Mr. Ephraim Atonuje',         'atonuje@delsu.edu.ng'],
  victor:    ['Mr. Victor O.',               'victor@delsu.edu.ng'],
  joy:       ['Miss Joy Agboi',              'joy.agboi@delsu.edu.ng'],
  grace:     ['Mrs. Grace Ohis',             'grace.ohis@delsu.edu.ng'],
  gift:      ['Mrs. Gift Umukoro',           'gift.umukoro@delsu.edu.ng'],
  omo:       ['Dr. Omo',                     'omo@delsu.edu.ng'],
  cleon:     ['Mr. Cleon',                   'cleon@delsu.edu.ng'],
};
const L = {};
for (const [k, [name, email]] of Object.entries(LECTURERS)) L[k] = await addUser(name, email, 'lecturer', LECT_PW);

// ---- rooms (placeholders) --------------------------------------------------
const addRoom = (name, building, capacity) =>
  db.prepare('INSERT INTO rooms (name,building,capacity) VALUES (?,?,?)').run(name, building, capacity).lastInsertRowid;
const R = {
  lt1:  addRoom('Lecture Theatre 1', 'Main Block', 150),
  lt2:  addRoom('Lecture Theatre 2', 'Main Block', 120),
  r101: addRoom('Room 101', 'Main Block', 60),
  r102: addRoom('Room 102', 'Main Block', 60),
  lab1: addRoom('Computer Lab 1', 'ICT Block', 40),
  lab2: addRoom('Computer Lab 2', 'ICT Block', 40),
};

// ---- courses: 2025/26 second semester allocation ---------------------------
// [code, alias, title, level, status, units, lead, [co-lecturers]]
const COURSES = [
  // 400 level
  ['CSC 411',   null,        'Software Engineering',                        400, 'C', 3, 'jackson',   []],
  ['CSC 412',   null,        'Network and Information System Security',     400, 'E', 3, 'akazue',    ['awana']],
  ['CSC 413',   null,        'Mobile Computing',                            400, 'C', 2, 'edith',     []],
  ['CSC 414',   null,        'Organization of Programming Languages',       400, 'C', 2, 'edje',      []],
  ['CSC 415',   null,        'Special Topics in Software Engineering',      400, 'E', 2, 'edafe',     []],
  ['CSC 410',   null,        'Research Project',                            400, 'C', 6, 'ogeh',      ['cyril']],
  // 300 level
  ['D-COS 311', null,        'Special Topics in Software Engineering',      300, 'C', 3, 'edafe',     []],
  ['D-COS 312', 'CSC 302',   'Distributed Computing System',                300, 'C', 2, 'edje',      ['royalty']],
  ['D-COS 313', 'CSC 301',   'Systems and Analysis Design',                 300, 'C', 2, 'onyagu',    []],
  ['D-COS 314', 'CSC 303',   'Survey of Programming Languages',             300, 'C', 2, 'gcomede',   []],
  ['D-COS 315', 'CSC 307',   'Software Development Dynamics',               300, 'C', 3, 'okorodudu', []],
  // 200 level
  ['CSC 211',   null,        'Structured Programming',                      200, 'C', 2, 'blessing',  []],
  ['CSC 214',   null,        'Introduction to Simulation Methods',          200, 'C', 2, 'atonuje',   []],
  ['COS 215',   'CSC 215',   'Computer Hardware',                           200, 'C', 3, 'victor',    ['joy']],
  ['COS 214',   'CSC 213',   'Computer Programming II (Python)',            200, 'C', 3, 'ogeh',      ['grace']],
  ['COS 213',   null,        'Introduction to Software Engineering',        200, 'C', 2, 'okorodudu', []],
  ['COS 212',   null,        'Computer Architecture and Organization',      200, 'C', 2, 'gift',      []],
  ['COS 211',   null,        'Digital Logic',                               200, 'C', 2, 'omo',       []],
  // 100 level
  ['COS 112',   'CSC 112',   'Computer Laboratory',                         100, 'C', 2, 'gcomede',   ['awana']],
  ['COS 113',   null,        'Introduction to Object Oriented Programming', 100, 'C', 3, 'omo',       ['cleon']],
];
const C = {};
for (const [code, alias, title, level, status, units, lead, co] of COURSES) {
  const id = db.prepare('INSERT INTO courses (code,alias,title,department,level,status,credit_units,lecturer_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(code, alias, title, DEPT, level, status, units, L[lead]).lastInsertRowid;
  for (const c of co) db.prepare('INSERT INTO course_co_lecturers (course_id, lecturer_id) VALUES (?,?)').run(id, L[c]);
  C[code] = id;
}

// ---- sessions (placeholder times; 3-unit courses meet twice, 2-unit once; the research project has no lectures)
// [course, room, day, start, minutes]
const SESSIONS = [
  ['CSC 411', 'lt1', MON, H(8), 120], ['CSC 411', 'lt1', THU, H(8), 60],
  ['CSC 412', 'r101', TUE, H(10), 120], ['CSC 412', 'r101', FRI, H(10), 60],
  ['CSC 413', 'r102', WED, H(10), 120],
  ['CSC 414', 'r102', TUE, H(8), 120],
  ['CSC 415', 'r101', THU, H(10), 120],
  ['D-COS 311', 'lt2', MON, H(10), 120], ['D-COS 311', 'lt2', WED, H(8), 60],
  ['D-COS 312', 'lt2', TUE, H(12), 120],
  ['D-COS 313', 'lt2', WED, H(10), 120],
  ['D-COS 314', 'lt2', THU, H(12), 120],
  ['D-COS 315', 'lt2', MON, H(14), 120], ['D-COS 315', 'lt2', FRI, H(8), 60],
  ['CSC 211', 'lab1', MON, H(8), 120],
  ['CSC 214', 'r101', TUE, H(8), 120],
  ['COS 215', 'lab2', MON, H(12), 120], ['COS 215', 'lab2', WED, H(12), 60],
  ['COS 214', 'lab1', TUE, H(14), 120], ['COS 214', 'lab1', THU, H(14), 60],
  ['COS 213', 'r101', WED, H(14), 120],
  ['COS 212', 'r102', THU, H(10), 120],
  ['COS 211', 'r102', FRI, H(12), 120],
  ['COS 112', 'lab2', WED, H(10), 120],
  ['COS 113', 'lab2', TUE, H(10), 120], ['COS 113', 'lab2', THU, H(8), 60],
];
for (const [code, room, day, start, dur] of SESSIONS) {
  db.prepare('INSERT INTO sessions (course_id,room_id,day_of_week,start_min,duration_min,term) VALUES (?,?,?,?,?,?)')
    .run(C[code], R[room], day, start, dur, CURRENT_TERM);
}

// ---- demo students (placeholders) ------------------------------------------
const STUDENTS = [
  ['Demo Student 100L',   'student100@delsu.edu.ng',  ['COS 112', 'COS 113']],
  ['Demo Student 200L',   'student200@delsu.edu.ng',  ['CSC 211', 'CSC 214', 'COS 215', 'COS 214', 'COS 213', 'COS 212', 'COS 211']],
  ['Demo Student 300L',   'student300@delsu.edu.ng',  ['D-COS 311', 'D-COS 312', 'D-COS 313', 'D-COS 314', 'D-COS 315']],
  ['Demo Student 400L-A', 'student400a@delsu.edu.ng', ['CSC 411', 'CSC 412', 'CSC 413', 'CSC 414']],
  ['Demo Student 400L-B', 'student400b@delsu.edu.ng', ['CSC 411', 'CSC 413', 'CSC 414', 'CSC 415']],
];
for (const [name, email, codes] of STUDENTS) {
  const sid = await addUser(name, email, 'student', STUDENT_PW);
  for (const code of codes) db.prepare('INSERT INTO enrollments (student_id, course_id) VALUES (?,?)').run(sid, C[code]);
}

audit(null, 'seed', `DELSU ${CURRENT_TERM}: ${COURSES.length} courses, ${SESSIONS.length} sessions`);

// ---- self-check: the seeded timetable must contain zero hard conflicts -----
let bad = 0;
for (const s of db.prepare('SELECT * FROM sessions').all()) {
  const { hard } = evaluate(s, s.id);
  if (hard.length) { bad++; console.error('CONFLICT in seed:', s.id, hard.map(h => h.message)); }
}
if (bad) { console.error(`Seed has ${bad} conflicting session(s).`); process.exit(1); }

console.log(`Seeded ${Object.keys(LECTURERS).length} lecturers, ${COURSES.length} courses, ${SESSIONS.length} sessions, ${STUDENTS.length} demo students. No hard conflicts.`);
console.log('Logins: admin@delsu.edu.ng / admin123 · <lecturer>@delsu.edu.ng / lecturer123 (e.g. edafe@delsu.edu.ng) · student300@delsu.edu.ng / student123');
