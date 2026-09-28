import { Router } from 'express';
import { db, audit } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { str, int } from '../util.js';

const r = Router();
r.get('/', requireAuth, (req, res) =>
  res.json(db.prepare('SELECT * FROM rooms ORDER BY name').all()));

// Shared validation for create/edit. Returns {error} or {name, building, capacity}.
function readRoom(body, partialOf = null) {
  const name = body.name === undefined && partialOf ? partialOf.name : str(body.name);
  const building = body.building === undefined && partialOf ? partialOf.building : str(body.building);
  const capacity = body.capacity === undefined && partialOf ? partialOf.capacity : (body.capacity === '' || body.capacity == null ? 0 : int(body.capacity));
  if (!name) return { error: 'Room name is required.' };
  if (name.length > 50) return { error: 'Room name is too long.' };
  if (Number.isNaN(capacity) || capacity < 0 || capacity > 100000) return { error: 'Capacity must be a whole number (0 or more).' };
  return { name, building: building || '', capacity };
}

r.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const v = readRoom(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  if (db.prepare('SELECT 1 FROM rooms WHERE name = ? COLLATE NOCASE').get(v.name)) return res.status(409).json({ error: 'A room with that name already exists.' });
  const info = db.prepare('INSERT INTO rooms (name,building,capacity) VALUES (?,?,?)').run(v.name, v.building, v.capacity);
  audit(req.user.id, 'create_room', v.name);
  res.status(201).json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(info.lastInsertRowid));
});

r.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(id);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const v = readRoom(req.body, room);
  if (v.error) return res.status(400).json({ error: v.error });
  if (db.prepare('SELECT 1 FROM rooms WHERE name = ? COLLATE NOCASE AND id != ?').get(v.name, id)) return res.status(409).json({ error: 'A room with that name already exists.' });
  db.prepare('UPDATE rooms SET name=?, building=?, capacity=? WHERE id=?').run(v.name, v.building, v.capacity, id);
  audit(req.user.id, 'update_room', v.name);
  res.json(db.prepare('SELECT * FROM rooms WHERE id = ?').get(id));
});

r.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const id = int(req.params.id);
  if (!db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(id)) return res.status(404).json({ error: 'Room not found.' });
  const used = db.prepare('SELECT COUNT(*) n FROM sessions WHERE room_id = ?').get(id).n;
  if (used) return res.status(409).json({ error: 'Room has scheduled sessions. Remove them first.' });
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
  audit(req.user.id, 'delete_room', `#${id}`);
  res.json({ ok: true });
});
export default r;
