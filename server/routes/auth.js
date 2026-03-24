const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { verifyPin, hashPin, generateToken } = require('../utils/auth');
const { requireAuth } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Body: { name, pin }
 */
router.post('/login', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    const db = getDb();
    const user = await db.get(
      'SELECT id, name, role, "pinHash", "isActive" FROM users WHERE LOWER(name) = LOWER(?)',
      name.trim()
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    if (!verifyPin(pin, user.pinHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    // Update last login
    await db.run('UPDATE users SET "lastLoginAt" = ? WHERE id = ?', new Date().toISOString(), user.id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * GET /api/auth/me — get current user info
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.get(
      'SELECT id, name, role, "createdAt", "lastLoginAt" FROM users WHERE id = ?',
      req.user.id
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * PUT /api/auth/change-pin — change own PIN
 * Body: { currentPin, newPin }
 */
router.put('/change-pin', requireAuth, async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    if (!currentPin || !newPin) {
      return res.status(400).json({ error: 'Current PIN and new PIN are required' });
    }

    if (!/^\d{4,6}$/.test(newPin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }

    const db = getDb();
    const user = await db.get('SELECT "pinHash" FROM users WHERE id = ?', req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!verifyPin(currentPin, user.pinHash)) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }

    await db.run('UPDATE users SET "pinHash" = ? WHERE id = ?', hashPin(newPin), req.user.id);
    res.json({ message: 'PIN changed successfully' });
  } catch (err) {
    console.error('Change PIN error:', err.message);
    res.status(500).json({ error: 'Failed to change PIN' });
  }
});

module.exports = router;
