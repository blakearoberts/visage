#!/usr/bin/env bash
set -euo pipefail

pr_create_attempts=15
pr_create_poll_interval_seconds=2
pr_url=""
branch=""

while [ "$pr_create_attempts" -gt 0 ]; do
  branch="$(git branch --show-current || true)"

  if [ -n "$branch" ]; then
    pr_url="$(gh pr list --head "$branch" --state open --json url --jq '.[0].url // empty')"
  fi

  if [ -n "$pr_url" ]; then
    break
  fi

  pr_create_attempts=$((pr_create_attempts - 1))
  if [ "$pr_create_attempts" -gt 0 ]; then
    sleep "$pr_create_poll_interval_seconds"
  fi
done

if [ -z "$branch" ]; then
  echo "Timed out waiting for the create PR flow to check out a local branch." >&2
  exit 1
fi

if [ -z "$pr_url" ]; then
  echo "Timed out waiting for a PR for the current branch: $branch" >&2
  exit 1
fi

is_draft="$(gh pr view "$pr_url" --json isDraft --jq '.isDraft')"

if [ "$is_draft" = "true" ]; then
  echo "Marking draft PR ready for review: $pr_url"
  gh pr ready "$pr_url"
fi

gh pr merge --auto --merge "$pr_url"

watcher_output="$(mktemp)"
set +e
PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh 2>&1 \
  | tee "$watcher_output" >&2
cleanup_status="${PIPESTATUS[0]}"
set -e

if [ "$cleanup_status" -eq 0 ]; then
  rm -f "$watcher_output"
  exit 0
fi

echo "PR merge cleanup failed with status $cleanup_status; starting Codex RCA." >&2

rca_prompt="$(mktemp)"
{
  cat <<PROMPT
The Visage Codex Auto-Merge action enabled auto-merge, then the direct cleanup
watcher failed.

PR URL: $pr_url
Local branch: $branch
Watcher exit status: $cleanup_status

Watcher output:
\`\`\`
PROMPT
  cat "$watcher_output"
  cat <<'PROMPT'
```

Perform a real RCA for the failed cleanup. Start from the watcher output above.
Use read-only inspection only: PR/check metadata, failing run/job logs, relevant
repo code or tests, and local Git state. Include the concrete failing check, run,
job, command, and test name when available.

Do not return a context summary or an investigation plan. If a required detail
cannot be verified, say exactly what evidence is missing and why.

Required response sections:

- Root cause facts
- Root cause inferences
- Evidence
- Recommendation
- Verification
- Blocked, if applicable

Do not rerun the auto-merge action or mutating cleanup watcher, do not merge or
close the PR, do not delete branches, and do not archive any Codex session.
PROMPT
} >"$rca_prompt"

rca_log="$(mktemp)"
echo "Codex RCA output is filtered; raw Codex stream log: $rca_log" >&2

set +e
codex exec --ephemeral --json - <"$rca_prompt" 2>>"$rca_log" \
  | tee -a "$rca_log" \
  | jq -r '
      select(.type == "item.started" or .type == "item.completed")
      | if .item.type == "command_execution" and .type == "item.started" then
          "tool: " + .item.command
        elif .item.type == "command_execution" and .type == "item.completed" then
          ("tool exit: " + (.item.exit_code | tostring)) as $status
          | (.item.aggregated_output // "" | gsub("\r"; "")) as $output
          | if $output == "" then
              $status
            elif ($output | length) > 1200 then
              $status + "\n[command output captured: " + (($output | length) | tostring) + " bytes]"
            else
              $status + "\n" + ($output | split("\n") | .[:20] | join("\n"))
            end
        elif .item.type == "agent_message" then
          .item.text
        else
          empty
        end
    ' >&2
rca_status="${PIPESTATUS[0]}"
set -e

if [ "$rca_status" -ne 0 ]; then
  echo "Codex RCA failed; preserving watcher failure status $cleanup_status." >&2
fi

rm -f "$rca_prompt" "$watcher_output"
exit "$cleanup_status"
