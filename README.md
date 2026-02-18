# Covered Call Dashboard

A personal covered call tracking dashboard built with React + Vite. Tracks positions, premium income, assignment risk, tax treatment, and performance vs buy & hold.

## Quick Deploy to Vercel

### 1. Push to GitHub

Create a new repo on GitHub, then:

```bash
cd cc-dashboard
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cc-dashboard.git
git push -u origin main
```

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"** → Import your `cc-dashboard` repo
3. Vercel auto-detects Vite — just click **Deploy**

### 3. Add Your API Key

The dashboard uses Claude to fetch live stock prices, IV data, and suggested strikes.

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In Vercel: **Settings → Environment Variables**
3. Add: `ANTHROPIC_API_KEY` = `sk-ant-...`
4. Redeploy (Deployments → ••• → Redeploy)

### 4. Share

Your dashboard is live at `https://cc-dashboard-xxxxx.vercel.app`. Share this URL with anyone — each person gets their own data stored in their browser.

## Pushing Updates

```bash
# Make changes to src/Dashboard.jsx
git add .
git commit -m "description of change"
git push
# Vercel auto-deploys in ~30 seconds
```

## Local Development

```bash
npm install
npm run dev
```

Create a `.env` file with your API key for local dev (the Vite dev server proxies `/api` routes to Vercel's serverless functions only in production — for local dev, the API features won't work unless you run `vercel dev` instead of `npm run dev`).

## Stack

- **React 18** + **Vite**
- **Tailwind CSS** for styling
- **Recharts** for charts
- **Lucide React** for icons
- **Vercel Serverless Functions** for Anthropic API proxy
- **localStorage** for per-user data persistence
