#!/bin/sh
# Runs inside the nginx container before it starts. Uses the department certificate
# when present; otherwise generates a self-signed one so HTTPS works for evaluation.
set -e
CERT_DIR=/etc/nginx/certs
if [ ! -f "$CERT_DIR/server.crt" ] || [ ! -f "$CERT_DIR/server.key" ]; then
  echo "ensure-cert: no certificate found, generating a self-signed certificate (evaluation only)"
  apk add --no-cache openssl >/dev/null 2>&1 || true
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -subj "/CN=panjagutta-duty.local/O=Hyderabad City Police/OU=Panjagutta PS" \
    -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.crt"
fi
