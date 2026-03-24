const crypto = require('crypto');

const TOKEN_SECRET = process.env.AUTH_SECRET || 'vmt-default-secret-change-me';
const TOKEN_EXPIRY_HOURS = 72; // 3 days

/**
 * Hash a PIN using HMAC-SHA256.
 */
function hashPin(pin) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(String(pin)).digest('hex');
}

/**
 * Verify a PIN against its hash.
 */
function verifyPin(pin, hash) {
  return hashPin(pin) === hash;
}

/**
 * Generate a stateless auth token.
 * Format: base64url(payload).signature
 */
function generateToken(user) {
  const payload = {
    userId: user.id,
    role: user.role,
    exp: Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

/**
 * Verify and decode a token. Returns the payload or null if invalid/expired.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadStr, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(payloadStr).digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPin, verifyPin, generateToken, verifyToken };
