#!/usr/bin/env bash
# Keep this local checkout in sync with GitHub automatically.
#
# Run it ONCE in its own terminal tab and leave it open. It watches origin and
# pulls new commits the moment they land, so you never run `git pull` by hand.
# Vite's hot-reload then shows frontend changes without a restart.
#
#   ./watch-sync.sh            # sync the branch you're currently on
#   ./watch-sync.sh main       # sync a specific branch
#   SYNC_INTERVAL=5 ./watch-sync.sh   # poll every 5s instead of 10s
#
# Safe by design: it pulls fast-forward only, so your uncommitted local work is
# never overwritten — if it can't fast-forward it just tells you and waits.
set -uo pipefail
cd "$(dirname "$0")"

branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
interval="${SYNC_INTERVAL:-10}"

echo "==> Auto-sync '$branch' with origin every ${interval}s (Ctrl+C to stop)"
git checkout "$branch" 2>/dev/null || true

while true; do
  if git fetch --quiet origin "$branch" 2>/dev/null; then
    local_sha=$(git rev-parse HEAD 2>/dev/null || echo none)
    remote_sha=$(git rev-parse "origin/$branch" 2>/dev/null || echo none)
    if [ "$remote_sha" != none ] && [ "$local_sha" != "$remote_sha" ]; then
      echo "[$(date +%H:%M:%S)] new commits on origin/$branch — pulling…"
      lock_before=$(git rev-parse "HEAD:frontend/package-lock.json" 2>/dev/null || echo x)
      if git pull --ff-only origin "$branch"; then
        lock_after=$(git rev-parse "HEAD:frontend/package-lock.json" 2>/dev/null || echo x)
        # Reinstall only when dependencies actually changed.
        if [ "$lock_before" != "$lock_after" ]; then
          echo "[$(date +%H:%M:%S)] dependencies changed — running npm install…"
          (cd frontend && npm install)
        fi
        echo "[$(date +%H:%M:%S)] up to date @ $(git rev-parse --short HEAD)"
      else
        echo "[$(date +%H:%M:%S)] can't fast-forward (local changes or diverged) — commit/stash, then it retries."
      fi
    fi
  fi
  sleep "$interval"
done
