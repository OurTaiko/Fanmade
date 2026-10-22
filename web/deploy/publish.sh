#!/usr/bin/env bash
set -euo pipefail
base=${DEPLOY_BASE_PATH:-/opt/ourtaiko-fanmade}
site=${DEPLOY_SITE_PATH:-/opt/1panel/www/sites/fanmade.ourtaiko.org}
remote=${DEPLOY_GIT_REMOTE:-origin}
export PATH="$base/toolchains/node/bin:$base/toolchains/pnpm/bin:$PATH"
export GIT_TERMINAL_PROMPT=0
cd "$base/src/frontend"

# Serialize automatic and manual deployments before changing the checkout.
exec 9>"$(git rev-parse --git-path fanmade-publish.lock)"
flock -n 9 || { echo 'Another frontend deployment is running'; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Frontend checkout has local changes'; exit 1; }
test "$(git branch --show-current)" = main || { echo 'Frontend checkout must be on main'; exit 1; }
git fetch --no-tags "$remote" main
latest=$(git rev-parse FETCH_HEAD)
revision=${DEPLOY_REVISION:-$latest}
if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'DEPLOY_REVISION must be a full Git commit SHA'
  exit 1
fi
# A queued or manually re-run workflow must never publish an older commit.
if [ "$revision" != "$latest" ]; then
  echo "Skipping superseded frontend revision $revision; main is now $latest"
  exit 0
fi
git merge --ff-only "$revision"
test "$(git rev-parse HEAD)" = "$revision" || { echo 'Frontend checkout differs from requested revision'; exit 1; }
git submodule update --init --recursive
git lfs pull --include="web/public/edit/**"
cd web
pnpm install --frozen-lockfile
pnpm build
test -s dist/index.html || { echo 'Build did not produce dist/index.html'; exit 1; }
release="$site/releases/$revision"
staging=
next="$site/index.next.$$"
cleanup() {
  if [ -n "$staging" ]; then
    sudo -n rm -rf -- "$staging"
  fi
  sudo -n rm -f -- "$next"
}
trap cleanup EXIT

# Only expose a complete release; a failed copy can be retried safely.
if ! sudo -n test -d "$release"; then
  sudo -n install -d -m 755 "$site/releases"
  staging=$(sudo -n mktemp -d "$site/releases/.${revision}.XXXXXX")
  sudo -n cp -R dist/. "$staging/"
  sudo -n chmod -R a+rX "$staging"
  sudo -n mv -T "$staging" "$release"
  staging=
fi
sudo -n test -s "$release/index.html" || { echo 'Existing release is incomplete'; exit 1; }
if sudo -n test -d "$site/index" && ! sudo -n test -L "$site/index"; then
  if sudo -n test -e "$site/index.initial"; then
    echo 'Existing index.initial needs manual review'
    exit 1
  fi
  sudo -n mv "$site/index" "$site/index.initial"
fi
sudo -n ln -s "releases/$revision" "$next"
sudo -n mv -Tf "$next" "$site/index"
echo "Published frontend $revision"

# Keep the live release and the newest others, five in all. Only directories
# named by a commit are removed, and a failed removal never fails a deployment
# that is already live.
kept=1
while IFS= read -r name; do
  [[ "$name" =~ ^[0-9a-f]{40}$ ]] || continue
  [ "$name" != "$revision" ] || continue
  if [ "$kept" -lt 5 ]; then
    kept=$((kept + 1))
    continue
  fi
  sudo -n rm -rf -- "$site/releases/$name" || echo "Could not remove old release $name"
done < <(sudo -n ls -1t "$site/releases" || true)
