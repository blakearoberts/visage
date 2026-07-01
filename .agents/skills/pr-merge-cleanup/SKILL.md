---
name: pr-merge-cleanup
description:
  Watch a GitHub pull request after auto-merge is enabled, then safely clean up
  the local PR branch. Use when explicitly invoked as $pr-merge-cleanup or when
  asked to wait for a PR merge and clean up the associated local branch.
---

# PR Merge Cleanup

## Workflow

If the prompt provides a PR URL and local branch, use them as the cleanup
inputs. Do not rediscover the PR or branch unless the provided values are
missing or invalid.

Run `scripts/watch-pr-merge-and-cleanup.sh` from this skill directory. Do not
spend tool calls rediscovering the PR or branch when the invocation environment
provides them.

The Visage auto-merge environment action calls the watcher directly on its happy
path. Use this skill for manual cleanup, failure follow-up, or explicit user
requests that need an agent to interpret the watcher result.

If the watcher reports a terminal required-check failure, perform an RCA before
responding. Do not stop at the watcher output, the obvious failing status, or a
list of investigation steps. Use the check details printed by the script as the
starting point, inspect the failing run/job logs, and inspect relevant repo code
or tests when the logs identify them.

The failure response must include:

- the concrete failing check, run, job, command, and test name when available
- short log evidence for the failure
- root cause facts separated from root cause inferences
- the recommended fix, or the safest next action if the fix is still unverified
- what was verified and what remains unverified

If any required RCA detail cannot be verified from available logs or code, state
that explicitly and explain what evidence is missing.

Required inputs:

- PR URL: GitHub pull request URL to watch.
- Local branch: local PR branch to switch away from and delete.

Command:

```bash
PR_MERGE_CLEANUP_PR_URL=<pr-url> \
PR_MERGE_CLEANUP_BRANCH=<local-branch> \
bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh
```

For validation without mutating Git state, add `--dry-run` to the command.

## Safety Rules

- Never force-delete a branch. The script must use `git branch -d`, not
  `git branch -D`.
- Do not delete the branch if the checkout is dirty, the PR closed unmerged,
  branch deletion is unsafe, or any cleanup step fails.
- Do not switch branches before the PR is merged.
- Return success only after Git cleanup succeeds; callers own any host-specific
  follow-up after this skill succeeds.
- On success, report the script result concisely, including any log message the
  script prints.
- On terminal required-check failure, report the RCA described above.
