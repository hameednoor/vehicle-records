const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { hashPin } = require('../utils/auth');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All routes require admin
router.use(requireAuth, requireAdmin);

/**
 * GET /api/users — list all users
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const users = await db.all(
      'SELECT id, name, role, "isActive", "createdAt", "lastLoginAt" FROM users ORDER BY "createdAt" ASC'
    );
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /api/users — create a new user
 * Body: { name, pin, role }
 */
router.post('/', async (req, res) => {
  try {
    const { name, pin, role } = req.body;
    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }
    const userRole = role === 'admin' ? 'admin' : 'driver';

    const db = getDb();

    // Check for duplicate name
    const existing = await db.get('SELECT id FROM users WHERE LOWER(name) = LOWER(?)', name.trim());
    if (existing) {
      return res.status(400).json({ error: 'A user with that name already exists' });
    }

    const id = uuidv4();
    await db.run(
      'INSERT INTO users (id, name, "pinHash", role, "isActive") VALUES (?, ?, ?, ?, 1)',
      id,
      name.trim(),
      hashPin(pin),
      userRole
    );

    res.status(201).json({
      user: { id, name: name.trim(), role: userRole, isActive: 1 },
    });
  } catch (err) {
    console.error('Create user error:', err.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /api/users/:id — update a user (name, role, isActive)
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, isActive } = req.body;
    const db = getDb();

    const user = await db.get('SELECT * FROM users WHERE id = ?', id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      // Check duplicate
      const dup = await db.get('SELECT id FROM users WHERE LOWER(name) = LOWER(?) AND id != ?', name.trim(), id);
      if (dup) {
        return res.status(400).json({ error: 'A user with that name already exists' });
      }
      updates.push('name = ?');
      params.push(name.trim());
    }
    if (role !== undefined) {
      updates.push('role = ?');
      params.push(role === 'admin' ? 'admin' : 'driver');
    }
    if (isActive !== undefined) {
      updates.push('"isActive" = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    await db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);

    const updated = await db.get(
      'SELECT id, name, role, "isActive", "createdAt", "lastLoginAt" FROM users WHERE id = ?',
      id
    );
    res.json({ user: updated });
  } catch (err) {
    console.error('Update user error:', err.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * PUT /api/users/:id/reset-pin — admin reset a user's PIN
 * Body: { pin }
 */
router.put('/:id/reset-pin', async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }

    const db = getDb();
    const user = await db.get('SELECT id FROM users WHERE id = ?', id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await db.run('UPDATE users SET "pinHash" = ? WHERE id = ?', hashPin(pin), id);
    res.json({ message: 'PIN reset successfully' });
  } catch (err) {
    console.error('Reset PIN error:', err.message);
    res.status(500).json({ error: 'Failed to reset PIN' });
  }
});

/**
 * DELETE /api/users/:id — delete a user
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = await db.run('DELETE FROM users WHERE id = ?', id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
