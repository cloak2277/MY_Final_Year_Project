import { Router } from 'express';
import { db, audit, tx } from '../db.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import { wrap, str, int, isEmail } from '../util.js';

const r = Router();
r.use(requireAuth, requireRole('admin'));
const ROLES = ['admin', 'lecturer', 'student'];

r.get('/', (req, res) => {
  res.json(db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY role, name').all());
});

r.post('/', wrap(async (req, res) => {
  const name = str(req.body.name), email = str(req.body.email).toLowerCase(), role = req.body.role;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields are required.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email already in use.' });
  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash, role);
  audit(req.user.id, 'create_user', `${role} ${email}`);
  res.status(201).json(db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
}));

// Change name, role and/or reset the password.
r.patch('/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const { role } = req.body;
  const name = req.body.name === undefined ? null : str(req.body.name);
  const password = req.body.password === undefined ? null : req.body.password;
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (name !== null && (!name || name.length > 100)) return res.status(400).json({ error: 'Enter a valid name.' });
  if (password !== null && (typeof password !== 'string' || password.length < 6)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (role !== undefined && role !== target.role) {
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
    // Never allow removing the last admin.
    if (target.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n <= 1)
      return res.status(400).json({ error: 'At least one admin must remain.' });
  }
  const hash = password !== null ? await hashPassword(password) : null;
  tx(() => {
    db.prepare('UPDATE users SET role = COALESCE(?, role), name = COALESCE(?, name), password_hash = COALESCE(?, password_hash) WHERE id = ?')
      .run(role ?? null, name, hash, id);
    if (role !== undefined && role !== target.role) {
      // Leaving a role removes what only that role can hold.
      if (target.role === 'lecturer') {
        db.prepare('UPDATE courses SET lecturer_id = NULL WHERE lecturer_id = ?').run(id);
        db.prepare('DELETE FROM course_co_lecturers WHERE lecturer_id = ?').run(id);
        db.prepare('DELETE FROM session_confirmations WHERE lecturer_id = ?').run(id);
        db.prepare('DELETE FROM availability WHERE lecturer_id = ?').run(id);
      }
      if (target.role === 'student') db.prepare('DELETE FROM enrollments WHERE student_id = ?').run(id);
    }
  });
  audit(req.user.id, 'update_user', `#${id}${role ? ' -> ' + role : ''}${password !== null ? ' (password reset)' : ''}`);
  res.json(db.prepare('SELECT id,name,email,role FROM users WHERE id = ?').get(id));
}));

r.delete('/:id', (req, res) => {
  const id = int(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (target.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin'").get().n <= 1)
    return res.status(400).json({ error: 'At least one admin must remain.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  audit(req.user.id, 'delete_user', `#${id}`);
  res.json({ ok: true });
});

export default r;
