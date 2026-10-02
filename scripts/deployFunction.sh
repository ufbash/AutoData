#!/usr/bin/env bash
# The ONLY sanctioned way to deploy an Edge Function (AGENTS.md section 3). It deploys, then runs the production smoke, and
# exits non-zero LOUDLY if either fails - so a deploy without a smoke cannot happen by forgetting.
# Usage: npm run deploy:fn -- <function-name> [<function-name> ...]
# A deploy takes effect immediately and there is no staging: confirm with Bashir BEFORE running this (AGENTS.md section 3).
set -uo pipefail
cd "$(dirname "$0")/.."
PROJECT_REF="xrotvpuainpfdulhfhtt"
[ "$#" -ge 1 ] || { echo "usage: npm run deploy:fn -- <function-name> [...]" >&2; exit 2; }
loud() { printf '\n\033[1;41m%s\033[0m\n\n' " $1 " >&2; }
for fn in "$@"; do
  [ -d "supabase/functions/$fn" ] || { loud "NO SUCH FUNCTION: $fn"; exit 2; }
  ok=0
  for attempt in 1 2; do   # the platform returns an occasional transient 500 on deploy
    if supabase functions deploy "$fn" --project-ref "$PROJECT_REF"; then ok=1; break; fi
    echo "deploy of $fn failed (attempt $attempt)" >&2
  done
  [ "$ok" = 1 ] || { loud "DEPLOY FAILED: $fn - nothing was smoke-tested because nothing new is live"; exit 1; }
done
echo "--- production smoke after deploying: $*"
if ! npm run smoke; then
  loud "SMOKE FAILED AFTER DEPLOYING: $* - ROLL BACK OR FIX FORWARD NOW. DO NOT MOVE ON."
  exit 1
fi
echo "DEPLOYED AND SMOKE-TESTED: $*"
