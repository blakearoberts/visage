---
name: pr-merge-cleanup
description:
  Watch a GitHub pull request after auto-merge is enabled, then safely clean up
  the local PR branch. Use when explicitly invoked as $pr-merge-cleanup or when
  asked to wait for a PR merge and clean up the associated local branch.
---

# PR Merge Cleanup

## Workflow

Run `scripts/watch-pr-merge-and-cleanup.sh` from this skill directory. Do not
spend tool calls rediscovering the PR or branch when the invocation environment
provides them.

Required environment variables:

- `PR_MERGE_CLEANUP_PR_URL`: GitHub pull request URL to watch.
- `PR_MERGE_CLEANUP_BRANCH`: local PR branch to switch away from and delete.

Command:

```bash
bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh
```

For validation without mutating Git state:

```bash
bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh --dry-run
```

## Archive Decision

After the cleanup script succeeds, decide whether the invoking Codex thread can
be archived automatically. If cleanup completed normally and no user follow-up
is needed, include this exact line by itself in the final response:

```text
CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready
```

Do not include the marker if cleanup fails, times out, leaves the local branch
present, or leaves any follow-up action for the user.

## Safety Rules

- Never force-delete a branch. The script must use `git branch -d`, not
  `git branch -D`.
- Do not delete the branch if the checkout is dirty, the PR closed unmerged,
  branch deletion is unsafe, or any cleanup step fails.
- Do not switch branches before the PR is merged.
- Return success only after Git cleanup succeeds; callers own any host-specific
  follow-up after this skill succeeds.
- Report the script result concisely, including any log or failure message the
  script prints.
