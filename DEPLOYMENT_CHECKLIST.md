# Deployment Checklist

## ✅ Pre-Deployment Verification Complete

### Frontend (mock-class-frontend) - Ready for Vercel ✅
- [x] Build configuration correct (Vite)
- [x] Environment variable support added (`VITE_WS_URL`)
- [x] Vercel configuration file created (`vercel.json`)
- [x] React Router properly configured for SPA
- [x] `.env.example` created
- [x] Dependencies properly configured
- [x] Deployment guide created

**Build Command**: `npm run build`  
**Output Directory**: `dist`

### Backend (mock-class-server) - Ready for Oracle Ubuntu ✅
- [x] Production dependencies fixed (`ws` moved to dependencies)
- [x] Build script added (`npm run build`)
- [x] Production start script configured (`npm start`)
- [x] Port configurable via environment variable
- [x] PM2 ecosystem file created
- [x] TypeScript compilation configured
- [x] `.env.example` created
- [x] Deployment guide created
- [x] No security features (as requested)

**Start Command**: `npm start` or `pm2 start ecosystem.config.js`

---

## 🚀 Quick Deployment Steps

### Frontend to Vercel (5 minutes)
1. Push code to GitHub
2. Import repo in Vercel dashboard
3. Set root: `mock-class-frontend`, framework: Vite
4. Add env var: `VITE_WS_URL=ws://YOUR_ORACLE_IP:8080`
5. Deploy
6. Configure custom domain in Cloudflare (optional)

### Backend to Oracle Ubuntu (10 minutes)
1. SSH to server: `ssh ubuntu@YOUR_IP`
2. Install Node.js 20+ and PM2
3. Upload code: `rsync -avz mock-class-server/ ubuntu@IP:~/mock-class-server/`
4. On server: `cd ~/mock-class-server && npm install && npm run build`
5. Create `.env` with `PORT=8080`
6. Start: `pm2 start ecosystem.config.js && pm2 save && pm2 startup`
7. Open firewall: `sudo ufw allow 8080/tcp`
8. Add Oracle Security List ingress rule for port 8080

### DNS Configuration (Cloudflare)
- **Frontend**: CNAME `app` → `cname.vercel-dns.com` (Proxied)
- **Backend**: A record `api` → `ORACLE_IP` (DNS Only - for WebSocket)

---

## 🔍 Testing Deployment

### Test Backend
```bash
npm install -g wscat
wscat -c ws://YOUR_ORACLE_IP:8080
# Should connect successfully
```

### Test Frontend
1. Visit your Vercel URL
2. Login: `alicesmith` / `password123`
3. Join classroom
4. Open DevTools > Network > WS tab
5. Should see WebSocket connection established

### Test Full Integration
1. Open frontend in 2+ browser tabs
2. Login with different usernames
3. All tabs should see each other in the classroom grid

---

## 📝 Configuration Files Created

### Frontend
- `mock-class-frontend/.env.example` - Environment variable template
- `mock-class-frontend/vercel.json` - Vercel SPA routing config
- `mock-class-frontend/DEPLOYMENT.md` - Frontend deployment guide

### Backend  
- `mock-class-server/.env.example` - Environment variable template
- `mock-class-server/ecosystem.config.js` - PM2 process manager config
- `mock-class-server/DEPLOYMENT.md` - Backend deployment guide

### Root
- `DEPLOYMENT_GUIDE.md` - Complete deployment documentation

---

## 🔧 Code Changes Made

### Backend (`mock-class-server/index.ts`)
- Added environment variable support for PORT
- Added NODE_ENV logging

### Backend (`mock-class-server/package.json`)
- Moved `ws` from devDependencies to dependencies
- Added `build` script: `tsc`
- Changed `start` script to run compiled code: `node dist/index.js`
- Added `dev` script: `ts-node index.ts`
- Added `@types/node` to devDependencies

### Frontend (`mock-class-frontend/src/pages/Classroom.tsx`)
- Changed hardcoded WebSocket URL to use environment variable
- Uses `import.meta.env.VITE_WS_URL` with fallback to `localhost:8080`

---

## ⚠️ Important Notes

### Security
- **No authentication/authorization on backend** (as requested)
- Anyone can connect to WebSocket server
- Suitable for demo/testing only

### WebSocket & Cloudflare
- If using Cloudflare proxy, WebSocket connections may fail
- Use "DNS Only" (grey cloud) for backend domain
- Or use direct IP address

### SSL/TLS
- For production, recommend adding Nginx + Let's Encrypt SSL
- Frontend must use `wss://` if backend has SSL
- See `DEPLOYMENT_GUIDE.md` for SSL setup instructions

### CORS
- No CORS configured on backend (WebSocket doesn't require it)
- If adding HTTP endpoints, configure CORS appropriately

---

## 📊 Deployment Architecture

```
┌─────────────────┐
│   Cloudflare    │ (DNS)
│      DNS        │
└────────┬────────┘
         │
    ┌────┴─────────────────┐
    │                      │
┌───▼──────┐         ┌─────▼──────────┐
│  Vercel  │         │ Oracle Cloud   │
│          │         │ Ubuntu Server  │
│ Frontend │◄───WS───┤                │
│ (React)  │         │ Backend (Node) │
└──────────┘         │ Port 8080      │
                     │ PM2 + ws       │
                     └────────────────┘
```

### Traffic Flow
1. User visits frontend (Cloudflare → Vercel)
2. Frontend establishes WebSocket connection to backend
3. Real-time updates flow via WebSocket
4. Multiple users can join and see each other in real-time

---

## 🎯 Success Criteria
- [ ] Frontend accessible via custom domain or Vercel URL
- [ ] Backend WebSocket server running on Oracle Cloud
- [ ] WebSocket connection established between frontend and backend
- [ ] Multiple users can join classroom simultaneously
- [ ] Users appear in real-time grid (3x3)
- [ ] PM2 keeps backend running after server restart

---

## 📞 Need Help?
- Frontend issues: Check [mock-class-frontend/DEPLOYMENT.md](mock-class-frontend/DEPLOYMENT.md)
- Backend issues: Check [mock-class-server/DEPLOYMENT.md](mock-class-server/DEPLOYMENT.md)  
- Full guide: Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
