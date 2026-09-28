// End-to-end API tests. Runs against a throwaway database seeded with the DELSU data.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

const DB = join(tmpdir(), `dept-sched-test-${process.pid}.db`);
process.env.DB_PATH = DB;
const cleanup = () => { for (const f of [DB, DB + '-shm', DB + '-wal']) if (existsSync(f)) rmSync(f); };
cleanup();

await import('../server/seed.js');
const { app } = await import('../server/index.js');
const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const B = `http://localhost:${server.address().port}`;

let pass = 0, fail = 0;
const ok = (c, l) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${l}`); c ? pass++ : fail++; };
const call = async (tok, method, path, body) => {
  const res = await fetch(B + path, {
    method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, body: data, headers: res.headers };
};
const login = async (e, p) => (await call(null, 'POST', '/api/auth/login', { email: e, password: p })).body?.token;
const H = (h, m = 0) => h * 60 + m;
const [MON, TUE, WED, THU, FRI] = [0, 1, 2, 3, 4];

const admin = await login('admin@delsu.edu.ng', 'admin123');
const edafe = await login('edafe@delsu.edu.ng', 'lecturer123');
const omo = await login('omo@delsu.edu.ng', 'lecturer123');
const awana = await login('awana@delsu.edu.ng', 'lecturer123');
const akazue = await login('akazue@delsu.edu.ng', 'lecturer123');
const s300 = await login('student300@delsu.edu.ng', 'student123');
const s400a = await login('student400a@delsu.edu.ng', 'student123');

const courses = Object.fromEntries((await call(admin, 'GET', '/api/courses')).body.map(c => [c.code, c]));
const rooms = Object.fromEntries((await call(admin, 'GET', '/api/rooms')).body.map(r => [r.name, r]));
const users = (await call(admin, 'GET', '/api/users')).body;
const uid = (email) => users.find(u => u.email === email).id;
const lt1 = rooms['Lecture Theatre 1'].id, lab1 = rooms['Computer Lab 1'].id, r101 = rooms['Room 101'].id, r102 = rooms['Room 102'].id;
const check = (c, room, day, start, dur, extra = {}) =>
  call(admin, 'POST', '/api/sessions/check', { course_id: courses[c].id, room_id: room, day_of_week: day, start_min: start, duration_min: dur, ...extra });
const create = (c, room, day, start, dur) =>
  call(admin, 'POST', '/api/sessions', { course_id: courses[c].id, room_id: room, day_of_week: day, start_min: start, duration_min: dur });

console.log('[Auth & access control]');
ok(!!admin && !!edafe && !!s300, 'admin, lecturer and student all log in');
ok((await call(null, 'POST', '/api/auth/login', { email: 'admin@delsu.edu.ng', password: 'nope' })).status === 401, 'wrong password rejected (401)');
ok((await call(null, 'GET', '/api/users')).status === 401, 'no token rejected (401)');
ok((await call(s300, 'GET', '/api/users')).status === 403, 'student blocked from /api/users');
ok((await call(edafe, 'GET', '/api/users')).status === 403, 'lecturer blocked from /api/users');
ok((await call(s300, 'GET', '/api/sessions')).status === 403, 'student blocked from full session list');
ok((await call(admin, 'GET', '/api/users')).status === 200, 'admin allowed on /api/users');
ok((await call(s300, 'POST', '/api/sessions', { course_id: 1, room_id: 1, day_of_week: 2, start_min: 600, duration_min: 60 })).status === 403, 'student cannot create sessions');
{
  const raw = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  ok(raw.status === 400, 'malformed JSON returns 400 (not 500)');
  const nf = await call(null, 'GET', '/api/nope');
  ok(nf.status === 404 && !!nf.body?.error, 'unknown API path returns JSON 404');
  ok(nf.headers.get('x-content-type-options') === 'nosniff' && !!nf.headers.get('content-security-policy'), 'security headers present');
}

console.log('[Registration & login hardening]');
{
  const reg = await call(null, 'POST', '/api/auth/register', { name: 'New Person', email: 'New.Person@Example.com', password: 'secret1' });
  ok(reg.status === 201 && reg.body.user.role === 'student' && reg.body.user.email === 'new.person@example.com', 'register creates a lower-cased STUDENT');
  ok((await call(null, 'POST', '/api/auth/register', { name: 'Dup', email: 'NEW.person@example.com', password: 'secret1' })).status === 409, 'duplicate email in different case -> 409 (not 500)');
  ok((await call(null, 'POST', '/api/auth/register', { name: 'X', email: 'not-an-email', password: 'secret1' })).status === 400, 'invalid email rejected');
  ok((await call(null, 'POST', '/api/auth/register', { name: 'X', email: 'x@y.com', password: '123' })).status === 400, 'short password rejected');
  ok((await call(null, 'POST', '/api/auth/register', { name: 'X', email: 'x@y.com', password: { a: 1 } })).status === 400, 'non-string password rejected (no crash)');
  let last;
  for (let i = 0; i < 11; i++) last = await call(null, 'POST', '/api/auth/login', { email: 'ghost@delsu.edu.ng', password: 'bad' });
  ok(last.status === 429, 'login rate limit: 11th failed attempt -> 429');
}

console.log('[Seed data: DELSU 2025/26 second semester]');
ok(Object.keys(courses).length === 20, '20 courses seeded');
ok(courses['D-COS 311'].lecturers[0].name === 'Dr. Edafe' && courses['D-COS 311'].credit_units === 3, 'D-COS 311 — Dr. Edafe, 3 units');
ok(courses['COS 211'].title === 'Digital Logic' && courses['COS 211'].lecturers[0].name === 'Dr. Omo', 'COS 211 Digital Logic — Dr. Omo');
ok(courses['CSC 411'].lecturers[0].name === 'Prof. Jackson A.', 'CSC 411 Software Engineering — Prof. Jackson A.');
ok(courses['CSC 414'].lecturers[0].name === 'Dr. Edje E. Abel', 'CSC 414 — Dr. Edje E. Abel');
ok(courses['CSC 412'].lecturers.length === 2 && courses['CSC 412'].status === 'E', 'CSC 412 has a co-lecturer and is elective');
ok(courses['D-COS 312'].alias === 'CSC 302' && courses['D-COS 312'].level === 300, 'cross-listed code (D-COS 312 / CSC 302) and level kept');
{
  const all = (await call(admin, 'GET', '/api/sessions')).body;
  let bad = 0;
  for (const s of all) if ((await check(s.course_code, s.room_id, s.day_of_week, s.start_min, s.duration_min, { ignore_id: s.id })).body.hard.length) bad++;
  ok(all.length === 26 && bad === 0, `all ${all.length} seeded sessions are conflict-free`);
}

console.log('[Conflict engine — hard constraints]');
let r = await check('COS 211', lt1, MON, H(9), 60);
ok(r.body.hard.some(h => h.type === 'room'), 'room double-booking detected');
ok(!!r.body.suggestion, 'suggests next free slot: ' + (r.body.suggestion?.label || 'none'));
r = await check('CSC 415', lab1, MON, H(10), 60);
ok(r.body.hard.some(h => h.type === 'lecturer' && h.message.includes('Dr. Edafe')), 'lecturer double-booking detected (Dr. Edafe teaches D-COS 311 then)');
r = await check('COS 112', lab1, TUE, H(10), 60);
ok(r.body.hard.some(h => h.type === 'lecturer' && h.message.includes('Miss Awana')), 'CO-lecturer double-booking detected (Miss Awana also teaches CSC 412)');
{
  const blk = await call(edafe, 'POST', '/api/availability', { day_of_week: FRI, start_min: H(12), end_min: H(14) });
  ok(blk.status === 201, 'lecturer sets own unavailability');
  r = await check('CSC 415', lt1, FRI, H(12), 60);
  ok(r.body.hard.some(h => h.type === 'availability'), 'lecturer-unavailable violation detected');
  ok(!(await check('CSC 415', lt1, FRI, H(14), 60)).body.hard.length, 'adjacent slot (touching the block) is allowed');
  const b2 = await call(edafe, 'POST', '/api/availability', { day_of_week: MON, start_min: H(10, 30), end_min: H(11) });
  ok(b2.body.affected.some(a => a.course_code === 'D-COS 311'), 'blocking time reports the already-scheduled class it clashes with');
  await call(edafe, 'DELETE', '/api/availability/' + b2.body.id);
  const aw = await call(admin, 'POST', '/api/availability', { lecturer_id: uid('awana@delsu.edu.ng'), day_of_week: WED, start_min: H(10), end_min: H(12) });
  r = await check('CSC 412', r101, WED, H(10), 60);
  ok(r.body.hard.some(h => h.type === 'availability' && h.message.includes('Miss Awana')), 'co-lecturer availability is enforced too');
  await call(admin, 'DELETE', '/api/availability/' + aw.body.id);
}

console.log('[Conflict engine — soft warnings]');
{
  const tiny = (await call(admin, 'POST', '/api/rooms', { name: 'Closet', capacity: 1 })).body;
  r = await check('CSC 411', tiny.id, WED, H(16), 60);
  ok(!r.body.hard.length && r.body.soft.some(s => s.type === 'capacity'), 'capacity warning when over-capacity (soft, not blocking)');
  r = await check('CSC 411', lt1, WED, H(16), 60);
  ok(!r.body.soft.some(s => s.type === 'capacity'), 'no false capacity warning when the room fits');
  await call(admin, 'DELETE', '/api/rooms/' + tiny.id);
}
r = await check('CSC 413', r102, MON, H(9), 60);
ok(!r.body.hard.length && r.body.soft.some(s => s.type === 'student' && s.message.includes('2 enrolled')), 'STUDENT clash detected: 2 students also attend CSC 411 at that time');
r = await check('CSC 413', r102, MON, H(16), 60);
ok(!r.body.soft.some(s => s.type === 'student'), 'no false student-clash warning at a free time');
{
  const nl = await call(admin, 'POST', '/api/courses', { code: 'TST 100', title: 'No Lecturer Yet', credit_units: 2 });
  r = await call(admin, 'POST', '/api/sessions/check', { course_id: nl.body.id, room_id: lt1, day_of_week: THU, start_min: H(16), duration_min: 60 });
  ok(r.body.soft.some(s => s.type === 'lecturer-missing'), 'warns when a course has no lecturer');
  await call(admin, 'DELETE', '/api/courses/' + nl.body.id);
}

console.log('[Input validation]');
const bad = (o) => call(admin, 'POST', '/api/sessions', { course_id: courses['COS 211'].id, room_id: r102, day_of_week: THU, start_min: H(16), duration_min: 60, ...o });
ok((await bad({ day_of_week: 9 })).status === 400, 'day out of range -> 400');
ok((await bad({ duration_min: 0 })).status === 400, 'zero duration -> 400');
ok((await bad({ duration_min: -60 })).status === 400, 'negative duration -> 400');
ok((await bad({ duration_min: 45 })).status === 400, 'off-grid duration -> 400');
ok((await bad({ start_min: H(7) })).status === 400, 'start before 08:00 -> 400');
ok((await bad({ start_min: H(17), duration_min: 120 })).status === 400, 'ending after 18:00 -> 400');
ok((await bad({ course_id: 99999 })).status === 404, 'unknown course -> 404');
ok((await bad({ room_id: 99999 })).status === 404, 'unknown room -> 404');
ok((await call(admin, 'POST', '/api/sessions', {})).status === 400, 'empty body -> 400');

console.log('[Sessions: create / edit / delete]');
ok((await create('COS 211', lt1, MON, H(9), 60)).status === 409, 'conflicting create blocked (409)');
{
  const c = await create('COS 211', lt1, MON, H(9), 60);
  ok(!!c.body.suggestion && c.body.hard.length > 0, '409 carries the conflicts and a suggested slot');
}
let extra = await create('CSC 415', r101, FRI, H(14), 60);
ok(extra.status === 201 && Array.isArray(extra.body.warnings), 'clean create succeeds (201) with warnings array');
const eid = extra.body.session.id;
ok((await call(admin, 'PATCH', '/api/sessions/' + eid, { room_id: r101, day_of_week: FRI, start_min: H(10), duration_min: 60 })).status === 409, 'editing INTO a conflict is blocked (409)');
ok((await call(admin, 'PATCH', '/api/sessions/' + eid, { start_min: H(15) })).status === 200, 'session can be edited (partial update)');
ok((await call(s300, 'PATCH', '/api/sessions/' + eid, { start_min: H(15) })).status === 403, 'student cannot edit sessions');
ok((await call(admin, 'PATCH', '/api/sessions/99999', { start_min: H(15) })).status === 404, 'editing a missing session -> 404');
ok((await check('CSC 415', r101, FRI, H(15), 60, { ignore_id: eid })).body.hard.length === 0, 'a session does not conflict with itself when edited');

console.log('[Lecturer confirmation]');
const dcos311 = (await call(edafe, 'GET', '/api/timetable')).body.filter(s => s.course_code === 'D-COS 311');
ok(dcos311.length === 2 && dcos311.every(s => s.my_status === 'pending'), 'lecturer sees own sessions, all pending');
let cf = await call(edafe, 'POST', `/api/sessions/${dcos311[0].id}/confirm`, { status: 'confirmed' });
ok(cf.status === 200 && cf.body.my_status === 'confirmed' && cf.body.status === 'confirmed', 'lecturer confirms a class');
{
  const adm = (await call(admin, 'GET', '/api/timetable')).body.find(s => s.id === dcos311[0].id);
  ok(adm.status === 'confirmed' && adm.confirmations[0].lecturer_name === 'Dr. Edafe', 'admin sees the confirmation');
}
const c412 = (await call(admin, 'GET', '/api/sessions')).body.filter(s => s.course_code === 'CSC 412');
await call(akazue, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'confirmed' });
ok((await call(admin, 'GET', '/api/timetable')).body.find(s => s.id === c412[0].id).status === 'pending', 'two lecturers: still PENDING until both confirm');
await call(awana, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'declined', note: 'Clashes with a faculty meeting' });
{
  const s = (await call(admin, 'GET', '/api/timetable')).body.find(x => x.id === c412[0].id);
  ok(s.status === 'declined' && s.confirmations.some(c => c.note === 'Clashes with a faculty meeting'), 'a decline (with note) marks the session DECLINED for the admin');
}
ok((await call(omo, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'confirmed' })).status === 403, 'a lecturer of another course cannot confirm');
ok((await call(s300, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'confirmed' })).status === 403, 'student cannot confirm');
ok((await call(admin, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'confirmed' })).status === 403, 'admin cannot confirm on a lecturer\'s behalf');
ok((await call(awana, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'maybe' })).status === 400, 'invalid status -> 400');
ok((await call(awana, 'POST', '/api/sessions/99999/confirm', { status: 'confirmed' })).status === 404, 'confirming a missing session -> 404');
ok((await call(awana, 'POST', `/api/sessions/${c412[0].id}/confirm`, { status: 'pending' })).body.my_status === 'pending', 'lecturer can reset to pending');
{
  const st = (await call(s300, 'GET', '/api/timetable')).body;
  ok(st.length > 0 && st.every(s => !('status' in s) && !('confirmations' in s) && !('my_status' in s)), 'students never receive confirmation data');
  ok(st.every(s => s.lecturer_name), 'students see each class\'s lecturer(s)');
}
{
  const aw = (await call(awana, 'GET', '/api/timetable')).body;
  ok(aw.some(s => s.course_code === 'CSC 412') && aw.some(s => s.course_code === 'COS 112'), 'co-lecturer sees the courses they co-teach');
}
await call(edafe, 'POST', `/api/sessions/${eid}/confirm`, { status: 'confirmed' });
await call(admin, 'PATCH', '/api/sessions/' + eid, { start_min: H(16) });
ok((await call(edafe, 'GET', '/api/timetable')).body.find(s => s.id === eid).my_status === 'pending', 'moving a session resets its confirmations');
ok((await call(admin, 'DELETE', '/api/sessions/' + eid)).status === 200, 'session deleted');
ok((await call(admin, 'DELETE', '/api/sessions/' + eid)).status === 404, 'deleting again -> 404');

console.log('[Class roster]');
ok((await call(edafe, 'GET', `/api/sessions/${dcos311[0].id}/students`)).body.length === 1, 'lecturer sees the students enrolled in their class');
ok((await call(omo, 'GET', `/api/sessions/${dcos311[0].id}/students`)).status === 403, 'another course\'s lecturer cannot see the roster');
ok((await call(s300, 'GET', `/api/sessions/${dcos311[0].id}/students`)).status === 403, 'students cannot see rosters');
ok((await call(admin, 'GET', `/api/sessions/${dcos311[0].id}/students`)).status === 200, 'admin can see rosters');

console.log('[Student timetable & enrolment]');
{
  const tt = (await call(s300, 'GET', '/api/timetable')).body;
  ok(tt.length === 7 && tt.every(s => 'clash' in s), `student timetable returns ${tt.length} sessions, each with a clash flag`);
  ok(tt.every(s => s.clash === false), 'seeded student has no clashes');
}
{
  const e1 = await call(s300, 'POST', '/api/enrollments', { course_id: courses['CSC 413'].id });
  ok(e1.status === 201 && e1.body.warnings.some(w => w.message.includes('D-COS 313')), 'enrolling into an overlapping course succeeds WITH a clash warning');
  ok((await call(s300, 'GET', '/api/timetable')).body.filter(s => s.clash).length === 2, 'the two overlapping classes are flagged in the timetable');
  ok((await call(s300, 'POST', '/api/enrollments', { course_id: courses['CSC 413'].id })).status === 409, 'duplicate enrolment -> 409');
  ok((await call(s300, 'DELETE', '/api/enrollments/' + courses['CSC 413'].id)).status === 200, 'drop course');
  ok((await call(s300, 'DELETE', '/api/enrollments/' + courses['CSC 413'].id)).status === 404, 'dropping a course you are not in -> 404');
  const e2 = await call(s300, 'POST', '/api/enrollments', { course_id: courses['CSC 411'].id });
  ok(e2.status === 201 && e2.body.warnings.length === 0, 'enrolling into a non-overlapping course gives no warnings');
  await call(s300, 'DELETE', '/api/enrollments/' + courses['CSC 411'].id);
  ok((await call(s300, 'POST', '/api/enrollments', { course_id: 99999 })).status === 404, 'enrolling in a missing course -> 404');
  ok((await call(admin, 'POST', '/api/enrollments', { course_id: courses['CSC 411'].id, student_id: uid('edafe@delsu.edu.ng') })).status === 400, 'admin cannot enrol a non-student');
  ok((await call(edafe, 'POST', '/api/enrollments', { course_id: courses['CSC 411'].id })).status === 403, 'lecturer cannot enrol');
}

console.log('[Courses]');
{
  const mk = (o) => call(admin, 'POST', '/api/courses', { code: 'NEW 101', title: 'New Course', credit_units: 2, ...o });
  const c = await mk({ level: 100, status: 'E', alias: 'CSC 101', lecturer_id: uid('omo@delsu.edu.ng'), co_lecturer_ids: [uid('cleon@delsu.edu.ng')] });
  ok(c.status === 201 && c.body.level === 100 && c.body.status === 'E' && c.body.lecturers.length === 2, 'create course with level, status, alias and co-lecturer');
  ok((await mk({ code: 'new 101' })).status === 409, 'duplicate code (any case) -> 409');
  ok((await mk({ code: 'NEW 102', lecturer_id: uid('student300@delsu.edu.ng') })).status === 400, 'a student cannot be assigned as lecturer');
  ok((await mk({ code: 'NEW 103', status: 'X' })).status === 400, 'invalid status -> 400');
  ok((await mk({ code: 'NEW 104', credit_units: 0 })).status === 400, 'zero credit units -> 400');
  const un = await call(admin, 'PATCH', '/api/courses/' + c.body.id, { lecturer_id: null });
  ok(un.body.lecturers.length === 1 && un.body.lecturers[0].name === 'Mr. Cleon', 'lead lecturer can be UN-assigned (null)');
  ok((await call(admin, 'PATCH', '/api/courses/' + c.body.id, { title: 'Renamed' })).body.title === 'Renamed', 'course can be edited');
  ok((await call(s300, 'PATCH', '/api/courses/' + c.body.id, { title: 'Hax' })).status === 403, 'student cannot edit courses');
  ok((await call(admin, 'DELETE', '/api/courses/' + c.body.id)).status === 200, 'course deleted');
  ok((await call(admin, 'DELETE', '/api/courses/' + c.body.id)).status === 404, 'deleting again -> 404');
  // Re-assigning a lecturer who is already busy at the course's existing time is reported.
  const pc = await call(admin, 'PATCH', '/api/courses/' + courses['COS 211'].id, { lecturer_id: uid('edafe@delsu.edu.ng') });
  ok(pc.body.session_conflicts.some(x => x.message.includes('unavailable')), 'changing lecturer reports existing sessions that now clash');
  await call(admin, 'PATCH', '/api/courses/' + courses['COS 211'].id, { lecturer_id: uid('omo@delsu.edu.ng') });
}

console.log('[Rooms]');
{
  const rm = await call(admin, 'POST', '/api/rooms', { name: 'Seminar Room', building: 'Annex', capacity: 30 });
  ok(rm.status === 201, 'room created');
  ok((await call(admin, 'POST', '/api/rooms', { name: 'seminar room' })).status === 409, 'duplicate room name (any case) -> 409');
  ok((await call(admin, 'POST', '/api/rooms', { name: 'Bad', capacity: -5 })).status === 400, 'negative capacity -> 400');
  ok((await call(admin, 'PATCH', '/api/rooms/' + rm.body.id, { capacity: 45 })).body.capacity === 45, 'room can be edited');
  ok((await call(admin, 'DELETE', '/api/rooms/' + lt1)).status === 409, 'room with sessions cannot be deleted');
  ok((await call(admin, 'DELETE', '/api/rooms/' + rm.body.id)).status === 200, 'empty room deleted');
}

console.log('[Users]');
{
  const u = await call(admin, 'POST', '/api/users', { name: 'Temp Lecturer', email: 'Temp.Lect@delsu.edu.ng', password: 'temp123', role: 'lecturer' });
  ok(u.status === 201 && u.body.email === 'temp.lect@delsu.edu.ng', 'admin creates a lecturer (email lower-cased)');
  ok((await call(admin, 'POST', '/api/users', { name: 'D', email: 'TEMP.lect@delsu.edu.ng', password: 'temp123', role: 'lecturer' })).status === 409, 'duplicate email in another case -> 409');
  ok((await call(admin, 'PATCH', '/api/users/' + u.body.id, { password: 'newpass1' })).status === 200, 'admin resets a password');
  ok(!!(await login('temp.lect@delsu.edu.ng', 'newpass1')) && !(await login('temp.lect@delsu.edu.ng', 'temp123')), 'new password works, old one does not');
  const nc = (await call(admin, 'POST', '/api/courses', { code: 'TMP 100', title: 'Temp', lecturer_id: u.body.id })).body;
  await call(admin, 'PATCH', '/api/users/' + u.body.id, { role: 'student' });
  ok((await call(admin, 'GET', '/api/courses')).body.find(c => c.id === nc.id).lecturers.length === 0, 'demoting a lecturer frees their courses');
  await call(admin, 'DELETE', '/api/courses/' + nc.id);
  ok((await call(admin, 'PATCH', '/api/users/' + uid('admin@delsu.edu.ng'), { role: 'student' })).status === 400, 'admin cannot change their own role');
  ok((await call(admin, 'DELETE', '/api/users/' + uid('admin@delsu.edu.ng'))).status === 400, 'admin cannot delete themselves');
  ok((await call(admin, 'DELETE', '/api/users/' + u.body.id)).status === 200, 'user deleted');
  ok((await call(admin, 'DELETE', '/api/users/' + u.body.id)).status === 404, 'deleting again -> 404');
}

console.log('[Availability validation]');
ok((await call(edafe, 'POST', '/api/availability', { day_of_week: TUE, start_min: H(12), end_min: H(10) })).status === 400, 'end before start -> 400');
ok((await call(edafe, 'POST', '/api/availability', { day_of_week: 7, start_min: H(10), end_min: H(12) })).status === 400, 'bad day -> 400');
ok((await call(s300, 'POST', '/api/availability', { day_of_week: TUE, start_min: H(10), end_min: H(12) })).status === 403, 'student cannot set availability');
{
  const mine = (await call(edafe, 'GET', '/api/availability')).body[0];
  ok((await call(omo, 'DELETE', '/api/availability/' + mine.id)).status === 403, 'a lecturer cannot remove another lecturer\'s block');
}

console.log('[Dashboards]');
{
  const d = (await call(edafe, 'GET', '/api/dashboard')).body;
  ok(d.role === 'lecturer' && d.myCourses === 2 && d.mySessions === 3 && typeof d.awaiting === 'number', `lecturer dashboard: ${d.myCourses} courses / ${d.mySessions} sessions / ${d.awaiting} awaiting`);
  const a = (await call(admin, 'GET', '/api/dashboard')).body;
  ok(a.sessions === 26 && a.term === '2025/26-H2' && a.confirmed + a.pending + a.declined === a.sessions, 'admin dashboard: term + confirmed/pending/declined add up');
  ok(a.unscheduled === 1, 'admin dashboard flags the unscheduled course (Research Project)');
}

console.log('[Performance]');
{
  const times = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); await check('CSC 411', lt1, MON, H(9), 60); times.push(performance.now() - t); }
  times.sort((x, y) => x - y);
  ok(times[18] < 200, `conflict check p95 = ${times[18].toFixed(1)} ms (< 200 ms)`);
}

console.log(`==== ${pass} passed, ${fail} failed ====`);
server.close(); cleanup(); process.exit(fail ? 1 : 0);
