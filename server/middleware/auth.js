const { verifyToken } = require('../utils/auth');
const { getDb } = require('../db/database');

/**
 * Middleware: require a valid auth token.
 * Attaches req.user = { id, name, role }.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.substring(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const db = getDb();
    const user = await db.get('SELECT id, name, role, "isActive" FROM users WHERE id = ?', payload.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    req.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Middleware: require admin role (must be used after requireAuth).
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
