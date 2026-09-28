import { Router } from 'express';
import { db, audit } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from '../auth.js';
import { wrap, str, isEmail, loginBlocked, loginFailed, loginOk } from '../util.js';

const r = Router();

// Public self-registration always creates a STUDENT. Staff/lecturer accounts
// are created by an admin via /api/users.
r.post('/register', wrap(async (req, res) => {
  const name = str(req.body.name), email = str(req.body.email).toLowerCase(), password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (name.length > 100) return res.status(400).json({ error: 'Name is too long.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'That email is already registered.' });
  const hash = await hashPassword(password);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, hash, 'student');
  const user = db.prepare('SELECT id,name,email,role FROM users WHERE id = ?').get(info.lastInsertRowid);
  audit(user.id, 'register', `student ${email}`);
  res.status(201).json({ token: signToken(user), user });
}));

r.post('/login', wrap(async (req, res) => {
  const email = str(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (loginBlocked(req, email)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    loginFailed(req, email);
    return res.status(401).json({ error: 'Email and password do not match.' });
  }
  loginOk(req, email);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ token: signToken(user), user });
}));

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default r;
