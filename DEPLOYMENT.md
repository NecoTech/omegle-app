# Deploying to a Hostinger VPS

This assumes an Ubuntu-based Hostinger VPS with root/sudo SSH access and a domain
pointed at the VPS's IP address (an A record for `yourdomain.com` and `www`).

## 1. Point your domain at the VPS

In Hostinger's DNS zone editor (or wherever the domain is managed), create:
- `A` record: `@` → your VPS IP
- `A` record: `www` → your VPS IP

Wait for propagation (`dig yourdomain.com` should return the VPS IP) before requesting
a certificate in step 6.

## 2. SSH in and prep the server

```bash
ssh root@your-vps-ip

apt update && apt upgrade -y

# Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx

node -v   # confirm v20.x
```

Create a non-root user to run the app under, if you don't already have one:

```bash
adduser deploy
usermod -aG sudo deploy
su - deploy
```

## 3. Firewall

Only SSH, HTTP, and HTTPS should be reachable from the internet — the app's own
ports (3000/3001) are bound to `127.0.0.1` and only Nginx talks to them locally.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 4. Get the code onto the server

From your local machine, either push this repo to GitHub/GitLab and clone it on the
VPS, or copy it directly:

```bash
# from your local machine
scp -r "C:\Users\NJ\Downloads\omegle-app" deploy@your-vps-ip:/home/deploy/omegle-app
```

(Skip `node_modules` and `.next` if copying manually — `npm ci` and `npm run build`
regenerate them.)

## 5. Install, configure, and build

```bash
cd /home/deploy/omegle-app
npm ci

cp .env.production.example .env.production
nano .env.production   # set NEXT_PUBLIC_SIGNALING_URL=https://yourdomain.com

nano ecosystem.config.js   # set CORS_ORIGIN to https://yourdomain.com

npm run build
```

## 6. Nginx + SSL

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/omegle-app
sudo nano /etc/nginx/sites-available/omegle-app   # replace yourdomain.com

sudo ln -s /etc/nginx/sites-available/omegle-app /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot edits the Nginx config in place to add the HTTPS server block and redirect
HTTP → HTTPS, and sets up auto-renewal. HTTPS is not optional here: browsers only
allow camera/microphone access (`getUserMedia`) on secure origins (or `localhost`).

## 7. Run the app under PM2

```bash
sudo npm install -g pm2

pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd   # run the printed command as root to enable boot-start
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs omegle-web
pm2 logs omegle-signaling
pm2 restart omegle-web omegle-signaling
```

## 8. Verify

- Visit `https://yourdomain.com` — padlock should show valid HTTPS
- Open two sessions (e.g. normal + incognito), click Start Chat on both, allow
  camera/mic, confirm they match and video/chat work
- `curl https://yourdomain.com/socket.io/socket.io.js` should return JS, confirming
  Nginx is correctly routing to the signaling server

## 9. TURN server (strongly recommended before real users)

STUN alone (what's configured by default) fails to connect a meaningful fraction of
real-world users — anyone behind a symmetric NAT, many corporate/mobile networks,
etc. You need a TURN server as a relay fallback. Two options:

**A. Hosted TURN (simplest)** — services like Metered, Twilio Network Traversal, or
Xirsys give you a TURN URL + credentials with no server to maintain. Put them in
`.env.production`:

```
NEXT_PUBLIC_TURN_URL=turn:relay.example.com:80
NEXT_PUBLIC_TURN_USERNAME=...
NEXT_PUBLIC_TURN_CREDENTIAL=...
```

Rebuild (`npm run build`) and `pm2 restart omegle-web` after changing env vars —
`NEXT_PUBLIC_*` values are baked in at build time.

**B. Self-hosted (coturn)** — more setup, uses your VPS's bandwidth for relayed
calls:

```bash
sudo apt install -y coturn
# edit /etc/turnserver.conf: set listening-port, realm, a static-auth-secret or
# user/pass, and external-ip to your VPS's public IP
sudo systemctl enable --now coturn
```

Open the TURN ports in the firewall (default 3478 TCP/UDP, plus a relay port range
you configure, e.g. 49152-65535 UDP):

```bash
sudo ufw allow 3478
sudo ufw allow 49152:65535/udp
```

## Updating after code changes

```bash
cd /home/deploy/omegle-app
git pull            # or re-copy changed files
npm ci
npm run build
pm2 restart omegle-web omegle-signaling
```

## Troubleshooting

- **Camera/mic prompt never appears**: confirm the site is actually HTTPS, not HTTP.
- **"Searching for a stranger..." forever**: check `pm2 logs omegle-signaling` and
  confirm `curl https://yourdomain.com/socket.io/socket.io.js` works — if it 404s,
  the Nginx `/socket.io/` location isn't matching (check for typos/order of blocks).
- **Video never connects even though matched**: almost always a missing TURN server
  — see step 9.
- **CORS errors in the browser console**: `CORS_ORIGIN` in `ecosystem.config.js`
  must exactly match the scheme + domain used to load the page (including `https://`
  and no trailing slash).
