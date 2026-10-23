#!/usr/bin/env bash
set -euo pipefail
base=${DEPLOY_BASE_PATH:-/opt/ourtaiko-fanmade}
remote=${DEPLOY_GIT_REMOTE:-origin}
export GIT_TERMINAL_PROMPT=0
cd "$base/src/fanmade"

# Serialize automatic and manual deployments before changing the checkout.
exec 9>"$(git rev-parse --git-path fanmade-publish.lock)"
flock -n 9 || { echo 'Another Fanmade deployment is running'; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Fanmade checkout has local changes'; exit 1; }
test "$(git branch --show-current)" = main || { echo 'Fanmade checkout must be on main'; exit 1; }
if [ "${DEPLOY_ROLLBACK:-}" = true ]; then
  # A rollback reloads an archived image (rollback.yml); the checkout, and
  # with it the Compose file, stays at the current main.
  revision=${DEPLOY_REVISION:-}
  if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]] || [ -z "${DEPLOY_IMAGE_ARCHIVE:-}" ]; then
    echo 'A rollback needs DEPLOY_REVISION and DEPLOY_IMAGE_ARCHIVE'
    exit 1
  fi
else
  git fetch --no-tags "$remote" main
  latest=$(git rev-parse FETCH_HEAD)
  revision=${DEPLOY_REVISION:-$latest}
  if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
    echo 'DEPLOY_REVISION must be a full Git commit SHA'
    exit 1
  fi
  # A queued or manually re-run workflow must never publish an older commit.
  if [ "$revision" != "$latest" ]; then
    echo "Skipping superseded Fanmade revision $revision; main is now $latest"
    exit 0
  fi
  git merge --ff-only "$revision"
  test "$(git rev-parse HEAD)" = "$revision" || { echo 'Fanmade checkout differs from requested revision'; exit 1; }
  git submodule update --init --recursive
  git lfs pull --include="web/public/edit/**"
fi
# Build both halves from the same commit before replacing the running service.
export FANMADE_SOURCE_DIR="$PWD"
compose="$PWD/deploy/compose.production.yml"
archive=${DEPLOY_IMAGE_ARCHIVE:-}
if [ -n "$archive" ]; then
  test "$archive" = "$base/incoming/$revision/fanmade-image.tar.gz"
  [[ "${DEPLOY_IMAGE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]]
  actual=$(sha256sum -- "$archive")
  test "${actual%% *}" = "$DEPLOY_IMAGE_SHA256" || { echo 'Image archive checksum mismatch'; exit 1; }
  sudo -n docker load < "$archive"
  label=$(sudo -n docker image inspect "ourtaiko-fanmade:$revision" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
  test "$label" = "$revision" || { echo 'Image revision mismatch'; exit 1; }
  sudo -n docker tag "ourtaiko-fanmade:$revision" ourtaiko-fanmade:release
else
  sudo -n --preserve-env=FANMADE_SOURCE_DIR docker compose -f "$compose" build fanmade
fi
sudo -n --preserve-env=FANMADE_SOURCE_DIR docker compose -f "$compose" up -d --wait --no-deps fanmade
curl -fsS http://127.0.0.1:8080/readyz
echo "Published Fanmade $revision (API and website)"
if [ -n "$archive" ]; then
  rm -f -- "$archive"
  rmdir -- "$(dirname "$archive")"
fi
# Rollback images are kept in ourtaiko-private (fanmade/images/<commit>.tar.gz),
# not here: drop every other local tag; Docker deletes an image with its last tag.
sudo -n docker image ls ourtaiko-fanmade --format '{{.Tag}}' | while read -r tag; do
  if [ "$tag" != release ] && [ "$tag" != "$revision" ] && [ "$tag" != '<none>' ]; then
    sudo -n docker image rm "ourtaiko-fanmade:$tag" >/dev/null || true
  fi
done
