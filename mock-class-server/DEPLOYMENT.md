# Backend Deployment - Oracle Ubuntu Server

## Quick Deploy

### 1. Server Prerequisites
```bash
# Check Node.js version (need 18+)
node --version

# If not installed:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2
```

### 2. Upload Code to Server
```bash
# From local machine, in mock-class-server directory
rsync -avz --exclude 'node_modules' --exclude 'dist' ./ ubuntu@YOUR_IP:~/mock-class-server/
```

Or use SCP:
```bash
scp -r mock-class-server ubuntu@YOUR_IP:~/
```

### 3. Setup on Server
```bash
ssh ubuntu@YOUR_IP

cd ~/mock-class-server
npm install
npm run build

# Create environment file
cp .env.example .env
nano .env
# Set: PORT=8080, NODE_ENV=production
```

### 4. Start Server with PM2
```bash
# Start
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the command it provides (usually requires sudo)

# Check status
pm2 status
pm2 logs mock-class-server
```

### 5. Configure Firewall (Ubuntu)
```bash
sudo ufw allow 22/tcp   # SSH (if not already allowed)
sudo ufw allow 8080/tcp # WebSocket server
sudo ufw enable
sudo ufw status
```

### 6. Configure Oracle Cloud Security List
1. Go to Oracle Cloud Console
2. Navigate to: **Networking** > **Virtual Cloud Networks**
3. Select your VCN > **Security Lists** > **Default Security List**
4. Click **Add Ingress Rules**
5. Add rule:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: TCP
   - **Destination Port Range**: `8080`
   - **Description**: WebSocket server
6. Click **Add Ingress Rules**

### 7. Test Connection
```bash
# Install wscat for testing
npm install -g wscat

# Test connection (from another machine or locally)
wscat -c ws://YOUR_SERVER_IP:8080
```

## Optional: SSL/TLS with Nginx (Recommended for Production)

### Setup Nginx Reverse Proxy
```bash
sudo apt install nginx certbot python3-certbot-nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/mock-class-server
```

Add configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/mock-class-server /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Allow HTTPS through firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Update frontend to use: `wss://your-domain.com`

## Management Commands

### View Logs
```bash
pm2 logs mock-class-server
pm2 logs mock-class-server --lines 100
```

### Restart Server
```bash
pm2 restart mock-class-server
```

### Stop Server
```bash
pm2 stop mock-class-server
```

### Update Code
```bash
cd ~/mock-class-server
# Upload new code or git pull
npm install
npm run build
pm2 restart mock-class-server
```

### Check Server Status
```bash
pm2 status
pm2 monit  # Interactive monitoring
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | WebSocket server port | `8080` |
| `NODE_ENV` | Environment mode | `production` |

## Troubleshooting

### Can't Connect to WebSocket
1. Check PM2 status: `pm2 status`
2. View logs: `pm2 logs mock-class-server`
3. Test locally: `wscat -c ws://localhost:8080`
4. Check firewall: `sudo ufw status`
5. Verify Oracle Security List has ingress rule for port 8080

### Server Not Starting
1. Check Node.js version: `node --version`
2. Reinstall dependencies: `rm -rf node_modules && npm install`
3. Rebuild: `npm run build`
4. Check PM2 logs: `pm2 logs mock-class-server --lines 200`

### High Memory Usage
- Check `pm2 monit`
- Restart server: `pm2 restart mock-class-server`
- The `ecosystem.config.js` has `max_memory_restart: '1G'` configured

## Performance Notes
- Server handles multiple concurrent WebSocket connections
- Each user connection is lightweight (no video/audio streaming)
- Broadcasts state updates only when users join/leave/update
- No authentication layer (as requested - no security features)
