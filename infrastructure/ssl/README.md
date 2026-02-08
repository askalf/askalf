# SSL Certificates

This directory is for SSL certificates when deploying WITHOUT cloudflared.

**Note:** If using cloudflared, you don't need SSL certificates here - Cloudflare handles SSL termination at their edge.

## Required Files

Place these files here:
- `fullchain.pem` - Full certificate chain
- `privkey.pem` - Private key

## Option 1: Let's Encrypt (Certbot)

```bash
# Install certbot
sudo apt install certbot

# Get certificates (DNS challenge for wildcard)
sudo certbot certonly --manual --preferred-challenges dns \
  -d askalf.org -d *.askalf.org

# Copy to this directory
sudo cp /etc/letsencrypt/live/askalf.org/fullchain.pem ./
sudo cp /etc/letsencrypt/live/askalf.org/privkey.pem ./
sudo chown $(whoami):$(whoami) *.pem
```

## Option 2: Cloudflare Origin Certificate

1. Go to Cloudflare Dashboard → SSL/TLS → Origin Server
2. Create Certificate
3. Download and save as `fullchain.pem` and `privkey.pem`

## Option 3: Self-Signed (Development Only)

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "/CN=askalf.org"
```

## Using SSL Instead of Cloudflared

Edit `docker-compose.prod.yml`:

```yaml
nginx:
  ports:
    - "80:80"
    - "443:443"  # Uncomment this
  volumes:
    # Comment out cloudflared.conf line
    # - ./infrastructure/nginx/conf.d/cloudflared.conf:/etc/nginx/conf.d/default.conf:ro
    # Uncomment SSL lines
    - ./infrastructure/nginx/conf.d/default.conf:/etc/nginx/conf.d/default.conf:ro
    - ./infrastructure/ssl:/etc/nginx/ssl:ro
```

Then remove or comment out the cloudflared service.
