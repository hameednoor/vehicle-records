/**
 * One-time script to get a Google OAuth2 refresh token.
 *
 * Usage:
 *   node get-refresh-token.js YOUR_CLIENT_ID YOUR_CLIENT_SECRET
 *
 * Steps:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Click "Create Credentials" -> "OAuth client ID"
 *   3. Application type: "Desktop app"
 *   4. Copy the Client ID and Client Secret
 *   5. Run this script with those values
 *   6. Open the URL it prints in your browser
 *   7. Authorize with your Google account
 *   8. Copy the refresh token it outputs
 */

const http = require('http');
const { URL } = require('url');

const CLIENT_ID = process.argv[2];
const CLIENT_SECRET = process.argv[3];
const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log('Usage: node get-refresh-token.js <CLIENT_ID> <CLIENT_SECRET>');
  console.log('');
  console.log('Get these from: https://console.cloud.google.com/apis/credentials');
  console.log('Create an OAuth client ID of type "Desktop app"');
  process.exit(1);
}

// drive.file = only files created by this app (not full Drive access)
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&access_type=offline` +
  `&prompt=consent`;

console.log('');
console.log('Open this URL in your browser:');
console.log('');
console.log(authUrl);
console.log('');
console.log('Waiting for authorization...');

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  if (parsed.pathname === '/callback') {
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
      console.error('Authorization failed:', error);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>No authorization code received</h1>');
      return;
    }

    // Exchange code for tokens
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });

      const tokens = await tokenRes.json();

      if (tokens.error) {
        throw new Error(`${tokens.error}: ${tokens.error_description}`);
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success!</h1><p>You can close this tab. Check your terminal for the refresh token.</p>');

      console.log('');
      console.log('========================================');
      console.log('  SUCCESS! Add these to Vercel env vars:');
      console.log('========================================');
      console.log('');
      console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
      console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('');

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Token exchange failed</h1><p>${err.message}</p>`);
      console.error('Token exchange failed:', err.message);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/callback`);
});
