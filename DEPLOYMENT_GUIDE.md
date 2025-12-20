# Deployment Guide

## Frontend Deployment (Vercel)

### Prerequisites
- Vercel account
- GitHub repository connected to Vercel

### Steps

1. **Install Vercel CLI** (optional for local deployment)
   ```bash
   npm i -g vercel
   ```

2. **Configure Environment Variable**
   In Vercel dashboard, add environment variable:
   - `VITE_WS_URL`: `wss://your-backend-ip-or-domain:8080`
   
   Or create `.env.production`:
   ```
   VITE_WS_URL=wss://your-backend-domain.com:8080
   ```

3. **Deploy via Vercel Dashboard**
   - Connect GitHub repository
   - Set root directory to `mock-class-frontend`
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Click Deploy

4. **Deploy via CLI** (alternative)
   ```bash
   cd mock-class-frontend
   vercel --prod
   ```

5. **Configure Cloudflare DNS**
   - Add CNAME record pointing to Vercel's deployment URL
   - Or add custom domain in Vercel settings

---

## Backend Deployment (Oracle Ubuntu)

### Prerequisites
- Ubuntu server with SSH access
- Node.js 18+ installed
- PM2 installed globally (recommended)

### Steps

1. **Connect to Server**
   ```bash
   ssh ubuntu@<your-oracle-ip>
   ```

2. **Install Node.js** (if not installed)
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install PM2** (process manager)
   ```bash
   sudo npm install -g pm2
   ```

4. **Upload Backend Code**
   ```bash
   # On local machine
   cd mock-class-server
   rsync -avz --exclude 'node_modules' --exclude 'dist' ./ ubuntu@<ip>:~/mock-class-server/
   ```

5. **Setup on Server**
   ```bash
   cd ~/mock-class-server
   npm install
   npm run build
   ```

6. **Configure Environment**
   ```bash
   cp .env.example .env
   nano .env
   # Set PORT=8080 and NODE_ENV=production
   ```

7. **Start with PM2**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

8. **Configure Firewall**
   ```bash
   sudo ufw allow 8080/tcp
   sudo ufw enable
   ```

9. **Configure Oracle Cloud Security List**
   - Go to Oracle Cloud Console
   - Navigate to VCN > Security Lists
   - Add Ingress Rule:
     - Source: 0.0.0.0/0
     - Protocol: TCP
     - Port: 8080

10. **Verify Server is Running**
    ```bash
    pm2 status
    pm2 logs mock-class-server
    ```

---

## SSL/TLS Configuration (Optional but Recommended)

### For WebSocket Server (Backend)

1. **Install Nginx**
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. **Install Certbot**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   ```

3. **Configure Nginx as Reverse Proxy**
   ```bash
   sudo nano /etc/nginx/sites-available/mock-class-server
   ```
   
   Add configuration:
   ```nginx
   server {
       listen 80;
       server_name your-backend-domain.com;
       
       location / {
           proxy_pass http://localhost:8080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. **Enable Site**
   ```bash
   sudo ln -s /etc/nginx/sites-available/mock-class-server /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Get SSL Certificate**
   ```bash
   sudo certbot --nginx -d your-backend-domain.com
   ```

6. **Update Frontend Environment Variable**
   - Change `VITE_WS_URL` to `wss://your-backend-domain.com`

---

## Cloudflare DNS Configuration

### For Frontend (Vercel)
1. Add CNAME record:
   - Name: `app` (or your subdomain)
   - Content: `cname.vercel-dns.com`
   - Proxy status: Proxied (orange cloud)

### For Backend (Oracle)
1. Add A record:
   - Name: `api` (or your subdomain)
   - Content: `<oracle-server-ip>`
   - Proxy status: DNS Only (grey cloud) for WebSocket
   - TTL: Auto

**Note**: Cloudflare proxy might interfere with WebSocket connections. Use "DNS Only" mode initially.

---

## Testing Deployment

### Test Backend
```bash
# Install wscat
npm install -g wscat

# Test connection
wscat -c ws://your-backend-domain.com:8080
# Or with SSL
wscat -c wss://your-backend-domain.com
```

### Test Frontend
1. Open browser to your Vercel URL or custom domain
2. Open DevTools Console
3. Login and join classroom
4. Check for WebSocket connection in Network tab

---

## Monitoring

### Backend Logs
```bash
pm2 logs mock-class-server
pm2 monit
```

### Restart Backend
```bash
pm2 restart mock-class-server
```

### Update Backend Code
```bash
cd ~/mock-class-server
git pull  # if using git
npm install
npm run build
pm2 restart mock-class-server
```

---

## Troubleshooting

### WebSocket Connection Failed
- Check firewall rules on Oracle Cloud
- Verify security list ingress rules
- Check PM2 logs: `pm2 logs`
- Test with `wscat` or browser DevTools

### Frontend Can't Connect
- Verify `VITE_WS_URL` environment variable
- Check CORS if using reverse proxy
- Ensure WebSocket port is open

### Backend Not Starting
- Check Node.js version: `node --version`
- Verify dependencies: `npm install`
- Check build output: `npm run build`
- Review PM2 logs: `pm2 logs mock-class-server --lines 100`
