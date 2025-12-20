# Frontend Deployment - Vercel

## Quick Deploy

### 1. Environment Setup
Create `.env.production` file:
```env
VITE_WS_URL=wss://your-backend-domain.com:8080
```

Or if using direct IP without SSL:
```env
VITE_WS_URL=ws://YOUR_ORACLE_IP:8080
```

### 2. Deploy to Vercel

#### Option A: Via Vercel Dashboard (Recommended)
1. Push code to GitHub
2. Go to [vercel.com](https://vercel.com) and import repository
3. Settings:
   - **Root Directory**: `mock-class-frontend`
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add Environment Variable:
   - Key: `VITE_WS_URL`
   - Value: `wss://your-backend-domain.com:8080` (or `ws://IP:8080`)
5. Click Deploy

#### Option B: Via Vercel CLI
```bash
cd mock-class-frontend
npm install -g vercel
vercel --prod
```

### 3. Configure Custom Domain (Cloudflare DNS)

In Cloudflare:
1. Add CNAME record:
   - Name: `app` (or desired subdomain)
   - Target: `cname.vercel-dns.com`
   - Proxy: ON (orange cloud)

In Vercel Dashboard:
1. Go to Project Settings > Domains
2. Add your custom domain
3. Vercel will provide DNS records if needed

### 4. Verify Deployment
- Visit your Vercel URL or custom domain
- Login (use: `alicesmith` / `password123`)
- Join classroom
- Check browser DevTools Console for WebSocket connection

## Build Locally
```bash
npm install
npm run build
# Output in dist/ folder
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_WS_URL` | WebSocket server URL | `wss://api.example.com:8080` |

## Important Notes
- WebSocket URL must start with `ws://` (no SSL) or `wss://` (with SSL)
- If backend uses SSL/TLS, frontend MUST use `wss://`
- If using Cloudflare proxy for backend, WebSocket might not work (use DNS only)
