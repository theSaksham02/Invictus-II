# Cloudzy Deployment Guide — NRC Invictus II Ground Station

## What You're Deploying

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUDZY VPS (Ubuntu)                        │
│                                                                 │
│   ┌─────────────┐    ┌────────────┐    ┌──────────────────┐    │
│   │  Nginx      │◄──►│  Node.js   │◄──►│  SQLite DB       │    │
│   │  :80/:443   │    │  server.js │    │  flight.db       │    │
│   │  (reverse   │    │  :3000     │    └──────────────────┘    │
│   │   proxy)    │    │            │                             │
│   └──────┬──────┘    │  Socket.IO │    ┌──────────────────┐    │
│          │           │  WebSocket │◄──►│  Emulator        │    │
│          │           └────────────┘    │  (SIM_MODE=true) │    │
│          │                             └──────────────────┘    │
│          │                                                      │
└──────────┼──────────────────────────────────────────────────────┘
           │ HTTPS
           ▼
    🌍 Team members access from anywhere:
    https://invictus.yourdomain.com/nrc
```

---

## Step 1: Provision a Cloudzy VPS

1. Go to [cloudzy.com](https://cloudzy.com) → **Create VPS**
2. Choose:
   - **OS:** Ubuntu 22.04 LTS
   - **Plan:** Minimum 1 vCPU / 1 GB RAM / 20 GB SSD (cheapest plan works fine)
   - **Location:** Closest to your team (Dubai / UK)
3. After creation, you'll receive:
   - **IP Address** (e.g. `185.x.x.x`)
   - **Root Password** or SSH Key

---

## Step 2: SSH Into the Server

From your laptop:

```bash
ssh root@YOUR_SERVER_IP
```

If using a password:
```bash
ssh root@185.x.x.x
# Enter the password from Cloudzy dashboard
```

> [!TIP]
> **Set up SSH keys for the whole team** so nobody needs passwords:
> ```bash
> # On each team member's laptop:
> ssh-keygen -t ed25519 -C "yourname@invictus"
> ssh-copy-id root@YOUR_SERVER_IP
> ```

---

## Step 3: Initial Server Setup

Run these commands on the VPS:

```bash
# Update system
apt update && apt upgrade -y

# Install essential tools
apt install -y curl git build-essential nginx certbot python3-certbot-nginx ufw

# Create a non-root user for the app
adduser invictus --disabled-password --gecos ""
usermod -aG sudo invictus

# Allow invictus to run sudo without password (for pm2 startup)
echo "invictus ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/invictus
```

---

## Step 4: Install Node.js 20

```bash
# Install Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node -v   # Should show v20.x.x
npm -v    # Should show 10.x.x

# Install PM2 globally (process manager — keeps server alive)
npm install -g pm2
```

---

## Step 5: Clone the Repository

```bash
# Switch to the invictus user
su - invictus

# Clone the repo
git clone https://github.com/theSaksham02/Invictus-II.git ~/Invictus-II

# Navigate to the backend
cd ~/Invictus-II/backend

# Install dependencies
npm install
```

> [!NOTE]
> If the repo is private, you'll need to set up a GitHub deploy key or personal access token:
> ```bash
> # Generate a deploy key on the server
> ssh-keygen -t ed25519 -C "cloudzy-deploy"
> cat ~/.ssh/id_ed25519.pub
> # Add this key in GitHub → Repo Settings → Deploy Keys
> ```

---

## Step 6: Configure Environment

Create the production `.env` file:

```bash
cat > ~/Invictus-II/backend/.env << 'EOF'
# ─── Cloudzy Production Config ───────────────────────────
PORT=3000

# Serial ports (not used on cloud — we run in SIM_MODE)
SERIAL_PORT_CANSAT=/dev/ttyUSB0
SERIAL_PORT_CANSAT_CMD=
SERIAL_PORT_NRC=/dev/ttyUSB1
SERIAL_BAUD_CANSAT=115200
SERIAL_BAUD_CANSAT_CMD=115200
SERIAL_BAUD_NRC=115200

# Database
DB_FILE=./flight.db

# Simulation mode — TRUE for cloud deployment
SIM_MODE=true
ENABLE_SIM_FALLBACK=true

# Logging
LOG_PACKETS=false
LOG_LEVEL=info

# CORS — allow your domain + local dev
CORS_ORIGINS=*

# Signal & reconnect
SIGNAL_TIMEOUT_MS=5000
SERIAL_RECONNECT_MS=3000

# SD upload limits
SD_UPLOAD_MAX_FILE_BYTES=5242880
SD_UPLOAD_MAX_ROWS=50000

# Rover (optional)
ROVER_IP=192.168.4.1
ROVER_PORT=5000
ROVER_TIMEOUT_MS=800
ROVER_CONTROL_TOKEN=
EOF
```

> [!IMPORTANT]
> **`SIM_MODE=true`** is essential on the cloud since there's no physical Heltec connected. The emulator generates realistic NRC2 packets so the dashboard works live for the team.

---

## Step 7: Test the Server

```bash
cd ~/Invictus-II/backend

# Quick test — should start without errors
node server.js
```

You should see:
```
[INFO] MACH-26 Ground Station started { port: 3000, sim_mode: true }
```

Press `Ctrl+C` to stop. Now set it up properly with PM2.

---

## Step 8: PM2 Process Manager (Keep It Running Forever)

```bash
cd ~/Invictus-II/backend

# Start with PM2
pm2 start server.js --name "invictus-ground-station" --env production

# Save the process list (survives reboot)
pm2 save

# Generate startup script (auto-start on server reboot)
pm2 startup systemd -u invictus --hp /home/invictus
# Run the command PM2 gives you (starts with sudo env ...)

# Useful PM2 commands:
pm2 status                    # Check if running
pm2 logs invictus-ground-station   # Live logs
pm2 restart invictus-ground-station # Restart
pm2 monit                     # CPU/Memory monitor
```

---

## Step 9: Nginx Reverse Proxy

Switch back to root:
```bash
exit  # back to root
```

Create the Nginx config:

```bash
cat > /etc/nginx/sites-available/invictus << 'NGINX'
server {
    listen 80;
    server_name YOUR_SERVER_IP;
    # Replace YOUR_SERVER_IP with your actual IP
    # Or use a domain: server_name invictus.yourdomain.com;

    # Dashboard static files
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support (Socket.IO)
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 10M;
    }
}
NGINX
```

Enable the site:

```bash
# Enable the config
ln -sf /etc/nginx/sites-available/invictus /etc/nginx/sites-enabled/invictus

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test config
nginx -t

# Reload Nginx
systemctl reload nginx
```

---

## Step 10: Firewall Setup

```bash
# Allow SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 'Nginx Full'

# Enable firewall
ufw --force enable

# Verify
ufw status
```

Expected output:
```
Status: active

To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
Nginx Full                 ALLOW       Anywhere
```

---

## Step 11: Access the Dashboard! 🚀

The team can now access the dashboard from **anywhere**:

| Dashboard | URL |
|-----------|-----|
| **NRC Dashboard** | `http://YOUR_SERVER_IP/nrc` |
| **CANSAT Dashboard** | `http://YOUR_SERVER_IP/` |
| **Health Check** | `http://YOUR_SERVER_IP/api/health` |
| **Export Data** | `http://YOUR_SERVER_IP/api/export?source=NRC` |

Share the IP with your team — everyone sees the **same live telemetry** with real-time WebSocket updates.

---

## Step 12: (Optional) Custom Domain + HTTPS

If you have a domain (e.g. `invictus.uobd.space`):

### 12a. Point DNS
Add an **A record** in your domain registrar:
```
Type: A
Name: invictus (or @ for root)
Value: YOUR_SERVER_IP
TTL: 300
```

### 12b. Update Nginx
Edit `/etc/nginx/sites-available/invictus` and change:
```nginx
server_name invictus.yourdomain.com;
```

### 12c. Get Free SSL with Let's Encrypt
```bash
certbot --nginx -d invictus.yourdomain.com
# Follow the prompts — choose "redirect HTTP to HTTPS"
```

Now the team accesses via: **`https://invictus.yourdomain.com/nrc`** 🔒

---

## Step 13: (Optional) Forward Real Hardware from Laptop

If you want the **cloud dashboard to show real Heltec hardware data** (not simulation), you can forward the serial port from your laptop to the cloud:

### On your laptop (the one with Heltec plugged in):

```bash
# Install socat
brew install socat   # macOS

# Forward local USB serial to the cloud server via SSH tunnel
socat \
  FILE:/dev/cu.usbmodem14201,b115200,raw \
  TCP:YOUR_SERVER_IP:8888
```

### On the Cloudzy server:

```bash
# Install socat
apt install -y socat

# Create a virtual serial port from the TCP stream
socat \
  TCP-LISTEN:8888,reuseaddr,fork \
  PTY,link=/dev/ttyVUSB0,raw,unlink-close=0 &
```

Then update the `.env`:
```bash
SIM_MODE=false
SERIAL_PORT_NRC=/dev/ttyVUSB0
```

And restart:
```bash
su - invictus
pm2 restart invictus-ground-station
```

> [!WARNING]
> This requires a stable internet connection between the laptop and server. For competition day, use local mode instead.

---

## Updating the Server (After Git Pushes)

When you push new code to GitHub:

```bash
# SSH into server
ssh root@YOUR_SERVER_IP

# Switch to invictus user
su - invictus

# Pull latest code
cd ~/Invictus-II
git pull origin main

# Install any new dependencies
cd backend
npm install

# Restart the server
pm2 restart invictus-ground-station

# Check logs
pm2 logs invictus-ground-station --lines 20
```

---

## Quick Reference Card

| Task | Command |
|------|---------|
| SSH in | `ssh root@YOUR_SERVER_IP` |
| Check server status | `su - invictus && pm2 status` |
| View live logs | `pm2 logs invictus-ground-station` |
| Restart server | `pm2 restart invictus-ground-station` |
| Stop server | `pm2 stop invictus-ground-station` |
| Pull updates | `cd ~/Invictus-II && git pull && cd backend && npm install && pm2 restart invictus-ground-station` |
| Check Nginx | `nginx -t && systemctl status nginx` |
| Renew SSL | `certbot renew` |
| Server resources | `htop` |
| Disk space | `df -h` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Dashboard not loading | Check `pm2 status` — is it running? Check `pm2 logs` for errors |
| WebSocket disconnects | Verify Nginx has the `Upgrade` and `Connection` headers for `/socket.io/` |
| `better-sqlite3` build fails | Run `apt install -y build-essential python3` then `npm rebuild` |
| Port 3000 already in use | `lsof -ti:3000 \| xargs kill -9` then `pm2 restart invictus-ground-station` |
| Can't clone private repo | Add deploy key: `ssh-keygen -t ed25519` → add pub key to GitHub |
| Nginx 502 Bad Gateway | Node server crashed — `pm2 restart invictus-ground-station` |
| SSL cert expired | `sudo certbot renew && systemctl reload nginx` |
| No packets on dashboard | Confirm `SIM_MODE=true` in `.env`, restart PM2 |
