# Deployment Guide

## Architecture
- **Frontend**: React app deployed to Vercel
- **Backend**: Express API deployed to Render
- **Database**: PostgreSQL on Supabase
- **File Storage**: Supabase Storage

## Step 1: Set Up Supabase

1. Go to https://supabase.com and create a new project
2. Note your project URL and keys from Settings > API:
   - Project URL (e.g., https://xxxxx.supabase.co)
   - anon/public key
   - service_role key (keep secret!)
3. The database tables are created automatically by the app on first start
4. Create Storage buckets:
   - Go to Storage in Supabase dashboard
   - Create bucket: `invoices` (public)
   - Create bucket: `vehicle-photos` (public)

## Step 2: Deploy Backend to Render

1. Push your code to GitHub
2. Go to https://render.com and create a new Web Service
3. Connect your GitHub repo
4. Configure:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Plan**: Free (or Starter for better performance)
5. Add environment variables:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = your Supabase PostgreSQL connection string
     (Find in Supabase: Settings > Database > Connection string > URI)
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_KEY` = your service_role key
   - `CORS_ORIGIN` = your Vercel frontend URL (e.g., https://vehicle-tracker.vercel.app)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (for email reminders)
6. Deploy and note your Render URL (e.g., https://vehicle-tracker-api.onrender.com)

## Step 3: Deploy Frontend to Vercel

1. Go to https://vercel.com and import your GitHub repo
2. Configure:
   - **Root Directory**: `client`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Add environment variable:
   - `VITE_API_URL` = your Render backend URL + /api (e.g., https://vehicle-tracker-api.onrender.com/api)
4. Update `client/vercel.json`: replace `YOUR-BACKEND-URL` with your actual Render URL
5. Deploy!

## Step 4: Verify

1. Open your Vercel URL
2. Check that vehicles load on the dashboard
3. Try adding a service record with an invoice upload
4. Check Settings page loads correctly

## Local Development

No cloud setup needed for local dev:
```bash
cd vehicle-records
npm run dev
```
This uses SQLite and local file storage automatically.

## Environment Variables Reference

### Backend (server/.env)
| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | For cloud | Supabase PostgreSQL connection string |
| SUPABASE_URL | For cloud | Supabase project URL |
| SUPABASE_SERVICE_KEY | For cloud | Supabase service role key |
| CORS_ORIGIN | For cloud | Frontend URL for CORS |
| PORT | No | Server port (default: 3001) |
| SMTP_HOST | For email | SMTP server hostname |
| SMTP_PORT | For email | SMTP port (usually 587) |
| SMTP_USER | For email | SMTP username |
| SMTP_PASS | For email | SMTP password/app password |
| EMAIL_FROM | For email | Sender name and email |

### Frontend (client/.env)
| Variable | Required | Description |
|----------|----------|-------------|
| VITE_API_URL | For cloud | Backend API URL |

## Important Note

In `client/vercel.json`, you must replace `YOUR-BACKEND-URL` with your actual Render deployment URL before deploying. For example, if your Render URL is `https://vehicle-tracker-api.onrender.com`, the rewrite destination should be `https://vehicle-tracker-api.onrender.com/api/$1`.
