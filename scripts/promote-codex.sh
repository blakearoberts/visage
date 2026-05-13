#!/usr/bin/env bash
set -euo pipefail

workflow_name="${PROMOTE_CODEX_WORKFLOW:-CI}"
commit_message=""

usage() {
  cat <<'USAGE'
Usage: npm run promote:codex -- [-m "Commit message"]

Commits staged changes on codex, pushes codex, waits for remote CI on the exact
codex SHA, fast-forwards main only after that CI succeeds, pushes main, waits for
the main run, then checks local codex back out.

Options:
  -m, --message  Commit staged changes with this message before promotion.
  -h, --help     Show this help.
USAGE
}

die() {
  echo "promote-codex: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

current_branch() {
  git branch --show-current
}

find_run_id() {
  local branch="$1"
  local sha="$2"

  gh run list \
    --branch "$branch" \
    --limit 20 \
    --json databaseId,headSha,workflowName \
    --jq ".[] | select(.headSha == \"$sha\" and .workflowName == \"$workflow_name\") | .databaseId" |
    head -n 1
}

wait_for_run() {
  local branch="$1"
  local sha="$2"
  local run_id=""

  for _ in {1..60}; do
    run_id="$(find_run_id "$branch" "$sha")"
    if [[ -n "$run_id" ]]; then
      break
    fi
    sleep 2
  done

  [[ -n "$run_id" ]] ||
    die "could not find $workflow_name run for $branch at $sha"

  gh run watch "$run_id" --exit-status

  local conclusion
  local head_sha
  conclusion="$(gh run view "$run_id" --json conclusion --jq .conclusion)"
  head_sha="$(gh run view "$run_id" --json headSha --jq .headSha)"
  [[ "$head_sha" == "$sha" ]] ||
    die "$workflow_name run $run_id used $head_sha, expected $sha"
  [[ "$conclusion" == "success" ]] ||
    die "$workflow_name run $run_id concluded with $conclusion"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m | --message)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      commit_message="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

require_command git
require_command gh

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

[[ "$(current_branch)" == "codex" ]] ||
  die "run this from the local codex branch"

trap '[[ "$(current_branch 2>/dev/null || true)" == "codex" ]] || git checkout codex >/dev/null 2>&1 || true' EXIT

gh auth status >/dev/null

if ! git diff --cached --quiet; then
  [[ -n "$commit_message" ]] ||
    die "staged changes require -m/--message"

  overlap="$(
    git diff --cached --name-only | while IFS= read -r path; do
      if ! git diff --quiet -- "$path"; then
        printf '%s\n' "$path"
      fi
    done
  )"
  [[ -z "$overlap" ]] ||
    die "staged paths also have unstaged edits; finish these first: $overlap"

  git commit -m "$commit_message"
elif [[ -n "$commit_message" ]]; then
  die "no staged changes to commit"
fi

[[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
  die "working tree is dirty; commit or move changes aside before promotion"

git fetch origin main:refs/remotes/origin/main
git merge-base --is-ancestor origin/main HEAD ||
  die "codex does not contain origin/main; update codex before promotion"

sha="$(git rev-parse HEAD)"
git push -u origin codex

wait_for_run codex "$sha"

git fetch origin main:refs/remotes/origin/main
git checkout main
git pull --ff-only origin main
git merge --ff-only "$sha"
git push origin main

git checkout codex
wait_for_run main "$sha"

git fetch --prune origin
if ! git ls-remote --exit-code --heads origin codex >/dev/null 2>&1; then
  git branch --unset-upstream codex >/dev/null 2>&1 || true
fi
git checkout codex
