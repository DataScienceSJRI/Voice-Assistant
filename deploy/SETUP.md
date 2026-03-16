# Server Setup 
## 1. Install system packages

```bash
apt update && apt install -y python3 python3-venv nginx certbot python3-certbot-nginx
```

## 2. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/YOUR_REPO.git /var/www/VAT
cd /var/www/VAT
```

## 3. Create the virtual environment and install dependencies

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

## 4. Configure environment variables

```bash
cp .env.example .env
nano .env   # fill in all values
chmod 600 .env
```

## 5. Set file ownership

```bash
chown -R www-data:www-data /opt/elevenlabs-tester
```

## 6. Install the systemd service

```bash
cp deploy/elevenlabs-tester.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable elevenlabs-tester
systemctl start elevenlabs-tester
systemctl status elevenlabs-tester
```

## 7. Configure nginx

Add the `/VAT/` location block to your existing nginx server block:

```bash
sudo nano /etc/nginx/sites-available/default
```

Paste the contents of `deploy/nginx.conf` (the `location /VAT/ { ... }` block) inside
the existing `server { }` block, then:

```bash
nginx -t && systemctl reload nginx
```

## 8. Update ALLOWED_ORIGINS in .env

```
ALLOWED_ORIGINS=https://datatools.sjri.res.in
```

Then restart the service:

```bash
systemctl restart elevenlabs-tester
```

## Deploying updates

```bash
bash /opt/elevenlabs-tester/deploy/deploy.sh
```

## Useful commands

```bash
# View live logs
journalctl -u elevenlabs-tester -f

# Check service status
systemctl status elevenlabs-tester

# Health check
curl https://datatools.sjri.res.in/VAT/health
```
