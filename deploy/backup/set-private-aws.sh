#!/usr/bin/env bash
# Run on the Mac: copies the ourtaiko-private IAM user's access key from the
# clipboard to /etc/ourtaiko-private/aws.env on ourtaiko-prod (root, 600).
# The values are never printed.
set -euo pipefail
host=${1:-ourtaiko-prod}

read -rp 'Copy the Access key ID to the clipboard, then press Enter: '
id=$(pbpaste | tr -d '[:space:]')
[[ "$id" =~ ^AKIA[A-Z0-9]{16}$ ]] || { echo 'That does not look like an access key ID (AKIA… 20 characters).' >&2; exit 1; }
read -rp 'Copy the Secret access key to the clipboard, then press Enter: '
secret=$(pbpaste | tr -d '[:space:]')
[[ ${#secret} -eq 40 ]] || { echo 'That does not look like a secret access key (40 characters).' >&2; exit 1; }

printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n' "$id" "$secret" | ssh -o BatchMode=yes "$host" '
  set -e
  sudo -n install -d -o root -g root -m 700 /etc/ourtaiko-private
  sudo -n sh -c "umask 077; cat > /etc/ourtaiko-private/aws.env.new && mv /etc/ourtaiko-private/aws.env.new /etc/ourtaiko-private/aws.env"
  sudo -n stat -c "%n %U:%G %a" /etc/ourtaiko-private/aws.env'
printf '' | pbcopy
echo 'Saved. The clipboard has been cleared.'
