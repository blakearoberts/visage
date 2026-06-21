# Visage Auto-Merge Action Iteration Handoff

Updated: 2026-06-21T21:57:18Z

## Purpose

Use this document to continue iterating on Visage's Codex environment action for
auto-merge plus local cleanup. It lives beside the action so agents can discover
it from the repo:

```text
.codex/environments/auto-merge-action-handoff.md
```

Future sessions may reference this file directly and should update it after each
merged iteration. Because this file is tracked in git, keep it current when
action/skill behavior changes.

## Current State

- Latest observed successful test PR: #60
- Latest merged implementation PR: #61
- PR #60: in this repository
- PR #60 merge commit: `43ccf9935306d6455c96878d19ee1dfa639d5ac7`
- PR #60 post-action final cwd state: primary checkout on local `main`,
  fast-forwarded to `origin/main` at the merge commit.
- PR #60 local and remote PR branch cleanup: `codex/post-merge-checkout-sync`
  was deleted locally and remotely.
- AM-1 status: done in PR #59 by implementation; terminal-noise and token-usage
  impact were not inspectable from the follow-up thread.
- AM-5 status: done in PR #60 by implementation and action verification.
- AM-8 status: done in PR #61 by implementation. The action now invokes the
  watcher directly and no longer starts a child Codex cleanup session on
  success; watcher failures still hand off to ephemeral Codex RCA without saving
  a child session.
- AM-7 status: in progress on branch `codex/ready-draft-before-auto-merge`.
- Open backlog items: AM-2, AM-3, AM-4, and AM-6; AM-2 remains the next
  failure-path behavior slice, and AM-6 still needs its full structured result
  contract.
- Action/skill files to inspect before changing behavior:
  - `.codex/environments/auto-merge-and-cleanup.sh`
  - `.agents/skills/pr-merge-cleanup/SKILL.md`
  - `.agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`

Important branch workflow:

- Start new implementation branches from latest `origin/main`.
- Do not configure the new branch upstream manually. The Codex app Create PR
  flow should push and set the upstream itself.
- Keep local edits unstaged unless the user asks to stage/commit.

## How To Use This Document In A New Session

Suggested prompt:

```text
Read .codex/environments/auto-merge-action-handoff.md and pick one small open backlog item for the Visage auto-merge action/skill. Create a fresh local-only codex/* branch from latest origin/main, implement the smallest useful change, keep changes local and unstaged, verify it, and update the document with what changed and what remains.
```

New-session protocol:

1. Read this whole file.
2. Inspect the current repo files before trusting any older note here.
3. Pick one backlog item, or a tightly coupled pair if they are naturally one
   diff.
4. Create a fresh local-only `codex/*` branch from latest `origin/main`.
5. Implement the smallest faithful change.
6. Verify with targeted shell checks and a mocked action path when possible.
7. Keep changes local and unstaged unless explicitly told otherwise.
8. If the user opens and merges a PR for the work, update this document:
   - mark the backlog item done,
   - add PR number and merge commit,
   - update "Current State",
   - add any new observations,
   - add or revise follow-up backlog items so later agents are not confused.

## Document Maintenance Contract

Any session that uses this handoff and gets a PR merged should update this file
before its final answer.

Use these backlog statuses:

- `open`: known opportunity that still needs implementation or research.
- `in progress`: current branch is attempting this item.
- `done in PR #N`: merged and verified through the action flow or targeted
  checks.
- `superseded`: no longer relevant; explain why.
- `blocked`: cannot proceed without product support, user input, or a failing
  external dependency.

Update rules:

- Keep "Current State" current.
- Keep backlog item status and notes current.
- Add the PR number, merge commit, and observed action outcome to "Iteration
  Log".
- Prefer revising stale text over appending contradictory notes.
- Do not mark an item done just because code was written; mark it done only
  after it is merged or the user explicitly accepts a non-merged local result.

## Iteration Log

### PR #61: Model-Free Happy Path

- Status: merged
- PR: #61
- Merge commit: `22d26cc8c386e00b4d5ee3d20c41ac74eb5f5814`
- Result: the action now runs the deterministic cleanup watcher directly after
  enabling auto-merge, exits immediately on successful watcher cleanup, and
  invokes ephemeral Codex RCA only when the watcher fails.
- Important follow-up: PRs opened as draft still need to be marked ready for
  review before GitHub can enable or complete auto-merge.

### PR #60: Post-Merge Checkout Sync

- Status: merged
- PR: #60
- Merge commit: `43ccf9935306d6455c96878d19ee1dfa639d5ac7`
- Result: action completed successfully, merged the PR, switched the primary
  checkout to local `main`, fast-forwarded it from `origin/main`, and deleted
  local branch `codex/post-merge-checkout-sync`.
- Important follow-up: the cleanup work itself completed quickly, but the child
  Codex session still consumed a large fixed model-turn budget because the
  action used `codex exec resume --last` for deterministic success cleanup.

### PR #59: Compact Cleanup Handoff Prompt

- Status: merged
- PR: #59
- Merge commit: `9d4e9e591645c00941d9bf2fc78f217ce39559cf`
- Result: action completed successfully, merged the PR, deleted the local PR
  branch, and the remote PR branch was gone after pruning.
- Important follow-up: the checkout was left detached at `origin/main`, and
  local `main` remained stale until manually fast-forwarded.

### PR #58: Resume Cleanup From Last Codex Thread

- Status: merged
- PR: #58
- Merge commit: `ce544f31aea5cf860a73c84dd9a1cd4e8f3111d6`
- Result: action completed successfully, deleted the local PR branch, and
  archived the terminal cleanup session.
- Important follow-up: it did not archive the visible parent app session.

## PR #58 Test Run Summary

A test run opened PR #58 for the `codex/resume-last-auto-merge-cleanup` branch,
then triggered the Codex app environment action.

Observed process chain:

```text
bash .codex/environments/auto-merge-and-cleanup.sh
codex exec resume --last --output-last-message <temp-file> Use $pr-merge-cleanup
bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh
```

Observed cleanup session:

- The action started a terminal cleanup session via `codex exec resume --last`.
- That cleanup session had its own `CODEX_THREAD_ID`.
- Its transcript moved from active sessions to archived sessions after the
  action archived it.

Timeline:

- `2026-06-20T21:55:37Z`: action shell started.
- `2026-06-20T21:55:39Z`: `codex exec resume --last` started and auto-merge was
  enabled on PR #58.
- `2026-06-20T22:04:00Z`: watcher still alive; PR was `OPEN/BLOCKED`.
- `2026-06-20T22:06:33Z`: GitHub checks had been restarted and were in progress.
- `2026-06-20T22:07:34Z`: required checks were passing; PR was `OPEN/CLEAN`.
- `2026-06-20T22:07:37Z`: GitHub auto-merged PR #58.
- `2026-06-20T22:08:01Z`: watcher fetched/pruned origin, detached to
  `origin/main`, deleted local branch `codex/resume-last-auto-merge-cleanup`,
  and emitted archive markers.
- `2026-06-20T22:08:05Z`: parent action process chain was gone; cleanup session
  transcript had moved to archived sessions.

Final state produced by the action:

- Worktree was clean.
- `HEAD` was detached at merge commit
  `ce544f31aea5cf860a73c84dd9a1cd4e8f3111d6`.
- Local branch `codex/resume-last-auto-merge-cleanup` was deleted.
- The action archived the terminal cleanup session.
- The action did not archive the visible parent Codex app session.

Manual post-run cleanup after observation:

- The primary checkout was manually switched back to `main`.
- `fetch --prune` and `pull` were run manually to make local `main` clean and
  current.
- Treat that manual step as an automation opportunity, not as behavior the
  action already provided.

## Known Facts From PR #58

- `codex exec resume --last` launched from an action terminal produced a cleanup
  session with its own `CODEX_THREAD_ID`.
- That cleanup session was archived successfully after it emitted:

```text
CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready
CODEX_PR_MERGE_CLEANUP_THREAD_ID=<cleanup-session-thread-id>
```

- The archived session was the terminal cleanup session, not the visible parent
  app session that invoked the action.
- The resumed cleanup turn saw `CODEX_THREAD_ID`.
- The resumed cleanup turn did not see `PR_MERGE_CLEANUP_PR_URL` or
  `PR_MERGE_CLEANUP_BRANCH`, even though the parent shell set those variables on
  the `codex exec resume` command.
- Because those variables were absent, the agent rediscovered the branch and PR
  itself.
- The resumed cleanup agent printed/echoed large chunks of source files while
  orienting itself.
- The cleanup session consumed roughly 82k tokens even though Bash did the
  substantive watcher work.

## Known Facts From PR #60

- PR #60 merged at `2026-06-21T17:18:26Z`.
- The watcher cleanup command completed successfully in about 2.3 seconds.
- The action still launched a child Codex session through
  `codex exec resume --last`.
- The child session reread project and skill instructions, ran the deterministic
  watcher command, then ran three simple verification commands.
- The child session had four model steps and the app recorded about 95k total
  tokens for the archived cleanup session.
- The child session inherited the user's configured model and reasoning effort.
  In the observed run that was a high-reasoning configuration, which is
  disproportionate for deterministic happy-path cleanup.
- PR #60 showed that AM-3 is too narrow when framed only as "agent-side
  polling": even when the watcher exits almost immediately, the action still
  pays for a full child Codex turn.

## Backlog

### AM-1: Compact Handoff To Avoid Source Echoing

Status: done in PR #59

Problem:

The terminal output was noisy because the cleanup agent read and printed the
skill file and watcher script before doing useful work.

Goal:

Pass compact context to the cleanup turn so it does not need to rediscover or
echo source files. Include PR URL, branch, archive-marker contract, and the
exact command or result-file contract.

Likely files:

- `.codex/environments/auto-merge-and-cleanup.sh`
- `.agents/skills/pr-merge-cleanup/SKILL.md`

Notes:

- Environment variables did not propagate through `codex exec resume` in PR #58,
  so prefer prompt text or a compact handoff file over shell env for data the
  resumed agent must see.
- PR #59 implemented the prompt-text path by passing the PR URL, local branch,
  and Codex action archive-marker contract through stdin to `codex exec resume`.
  It intentionally did not change watcher polling behavior.

### AM-2: Exit Early On Required CI Failure

Status: open

Problem:

The watcher only waited for PR state `MERGED` or `CLOSED`. PR #58 initially had
`Checks / CI` completed with `FAILURE`, but the watcher continued polling.

Goal:

While waiting, inspect required check state. If a required check reaches a
terminal failure, exit non-zero and produce enough structured context for the
agent to report RCA: failed check name, conclusion, PR URL, and safest next
action. Do not emit archive markers on this path.

Likely file:

- `.agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`

Design caveat:

PR #58 later had checks rerun and eventually merged. If the watcher exits on
failure, the user can re-trigger the action after rerunning checks. That is
acceptable if the failure report is clear.

### AM-3: Stop Agent-Side Waiting

Status: open

Problem:

The cleanup agent can spend model turns waiting for or checking on deterministic
Bash work. PR #58 showed this during a long wait. PR #60 showed the same broader
problem even without a long wait: a nearly immediate happy-path cleanup still
paid for multiple model steps.

Goal:

Keep waiting and routine verification in Bash. A model should only be involved
when there is information that needs interpretation or RCA. Possible shapes:

- action runs watcher directly and only invokes Codex after watcher exits,
- action writes a compact result file and resumes Codex only for failures,
- watcher calls `codex exec resume` with a final result prompt,
- action uses a result file plus `--output-last-message` only for the final
  archive decision.

Likely files:

- `.codex/environments/auto-merge-and-cleanup.sh`
- `.agents/skills/pr-merge-cleanup/SKILL.md`
- `.agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`

Acceptance target:

The agent should not burn turns while Bash waits or after Bash has already
completed deterministic success cleanup. A happy-path cleanup should have
near-zero model token use.

### AM-4: Resolve Parent App Session Archive Semantics

Status: research open

Problem:

Expected behavior was for the action to resume/archive the visible parent Codex
app session. PR #58 archived only the terminal cleanup session created by
`codex exec resume --last`.

Goal:

Determine whether an action can target the invoking app session. Do not assume
the answer. Verify with local app/CLI behavior if possible.

Known uncertainty:

- The environment action terminal did not receive `CODEX_THREAD_ID`.
- `codex exec resume --last` in the action terminal did not visibly resume the
  parent app session.
- Archiving the cleanup session worked, but that may not be the desired product
  behavior.

Useful RCA question:

Can the action recover the invoking app-session id from Codex app state, or is
product support needed to propagate that id into action terminals?

### AM-5: Post-Merge Checkout Sync

Status: done in PR #60

Problem:

After PR #58 and PR #59 merged, the action left the primary checkout clean but
detached at the merge commit. Manual cleanup switched to `main`, ran
`fetch --prune`, and pulled.

Goal:

Leave the cwd in the expected post-merge base state:

- Primary checkout: `git fetch --prune origin`, `git switch main`,
  `git pull --ff-only`.
- Auxiliary worktree: `git fetch --prune origin`,
  `git switch --detach origin/main`.

Likely file:

- `.agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`

Guardrail:

Only switch to local `main` when cwd is the primary checkout, not an auxiliary
worktree. In linked worktrees, local `main` may already be checked out
elsewhere, so detached `origin/main` is safer.

Merged implementation:

- Primary checkout detection uses Git internals:
  `git rev-parse --path-format=absolute --git-common-dir` must equal
  `git rev-parse --absolute-git-dir`.
- Primary checkout final state: switch to the local base branch and fast-forward
  it from `origin/<base>`.
- Linked worktree final state: switch to detached `origin/<base>`.
- Local PR branch deletion still uses `git branch -d`.

### AM-6: Result Format And RCA Contract

Status: open

Problem:

Success/failure signaling is currently implicit: final agent text contains
markers, and failure paths depend on what the agent chooses to summarize.

Goal:

Define a compact result contract between watcher, action script, and agent.
Include:

- `status=success|failed|timed_out|closed_unmerged`
- `pr_url`
- `branch`
- `merged_at` or failed check data
- `checkout_final_state`
- `archive_recommended=yes|no`

This could be a temp file, JSON file, line protocol, or shell-sourced key/value
file. Prefer the simplest format that Bash can write and the agent can read.

Current partial slice:

- This branch keeps the archive-marker contract in the action prompt while the
  skill remains focused on PR watching and local branch cleanup. The broader
  structured result contract remains open.

### AM-7: Mark Draft PR Ready Before Auto-Merge

Status: in progress

Problem:

The Codex app Create PR flow may leave a pull request in draft state. A draft PR
cannot complete an auto-merge flow until it is marked ready for review.

Goal:

Before enabling auto-merge, have the action detect whether the current PR is a
draft and mark it ready for review if needed.

Likely file:

- `.codex/environments/auto-merge-and-cleanup.sh`

Notes:

- PR #60 was opened as draft, making this easy to verify against the current
  workflow shape.
- Keep this as an action preflight step; the cleanup watcher should not own PR
  readiness.
- Current local implementation checks `isDraft` with `gh pr view` and runs
  `gh pr ready` before `gh pr merge --auto --merge` only when the PR is still a
  draft.

### AM-8: Model-Free Happy Path

Status: done in PR #61

Problem:

The action invokes `codex exec resume --last` after enabling auto-merge, even
when the rest of the flow is deterministic. PR #60 merged almost immediately and
the watcher finished in about 2.3 seconds, but the child Codex session still
consumed about 95k total tokens because it loaded instructions, ran the watcher,
verified state, and emitted archive markers.

Goal:

Run successful cleanup without starting a model turn. The action should invoke
the watcher directly after enabling auto-merge, keep watcher output on stdout,
and exit successfully when cleanup succeeds.

Likely files:

- `.codex/environments/auto-merge-and-cleanup.sh`
- `.agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`
- `.agents/skills/pr-merge-cleanup/SKILL.md`

Design notes:

- Reserve Codex for failure or RCA paths, not deterministic success cleanup.
- Failure-path RCA is allowed to inherit the user's configured model and
  reasoning effort. Token minimization matters on success; diagnosis quality
  matters on failure.
- Do not block this slice on parent-session archive semantics. AM-4 still owns
  whether the invoking app session can be archived. A child cleanup session is
  not worth creating solely so it can archive itself.
- This item is a sharper follow-up to AM-3. AM-3 covers agent-side waiting in
  general; AM-8 is the concrete happy-path optimization.

Merged implementation:

- `.codex/environments/auto-merge-and-cleanup.sh` enables auto-merge, then runs
  the watcher directly with `PR_MERGE_CLEANUP_PR_URL` and
  `PR_MERGE_CLEANUP_BRANCH`.
- The action no longer calls `codex exec resume`, writes an archive-decision
  file, parses archive markers, or archives the child cleanup session.
- If the watcher exits non-zero, the action invokes `codex exec --ephemeral` for
  RCA with the PR URL, branch, and watcher exit status, then preserves the
  watcher failure status as the action exit code.
- The RCA output stays in the action terminal. It is not archived because no
  saved child session should be created for one-shot failure reporting.
- `.agents/skills/pr-merge-cleanup/SKILL.md` now clarifies that the skill is for
  manual cleanup, failure follow-up, or explicit user requests, not the action
  happy path.

## Suggested Chunk Order

1. Complete AM-7 through review, PR, and action verification.
2. AM-2: early exit on failed required checks.
3. AM-3: eliminate remaining agent-side waiting or routine verification.
4. AM-6: full result format and RCA contract, once the watcher/action boundary
   is clearer.
5. AM-4: research and prove whether parent app-session archive is possible.

Do not try to solve all items in one PR. The fastest path is small, reviewable
behavior changes with a real action test after each merge.

## Verification Checklist For Implementation PRs

Use targeted checks, not broad churn.

- `bash -n .codex/environments/auto-merge-and-cleanup.sh`
- `bash -n .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh`
- `git diff --check`
- `PR_MERGE_CLEANUP_PR_URL=<pr-url> PR_MERGE_CLEANUP_BRANCH=<local-branch> bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh --dry-run`
  with mocked or real safe PR context where applicable.
- Mock `gh`, `git`, and `codex` in `PATH` for action-script control-flow tests
  when the change affects orchestration.
- Manual AGENTS.md diff audit before final response.

When a PR is opened and merged for this workflow:

1. Trigger the action from the Codex app.
2. Watch the terminal/process flow.
3. Update this document with:
   - PR number,
   - merge commit,
   - exact final cwd/git state,
   - whether the parent or child session was archived,
   - token behavior if visible,
   - which backlog items are done or still open.

## Historical Raw Evidence

Keep these facts available for RCA, but do not treat them as current state
without verifying the repo.

PR #58 watcher command launched by the cleanup agent:

```bash
PR_MERGE_CLEANUP_PR_URL=<pr-url> \
PR_MERGE_CLEANUP_BRANCH=codex/resume-last-auto-merge-cleanup \
bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh
```

Successful watcher output excerpt:

```text
PR merged at 2026-06-20T22:07:37Z: <pr-url>
From github.com:<owner>/<repo>
 - [deleted]         (none)       -> origin/codex/resume-last-auto-merge-cleanup
   10e2490..ce544f3  main         -> origin/main
 * [new tag]         v0.0.4-rc.20 -> v0.0.4-rc.20
HEAD is now at ce544f3 Merge pull request #58 from <owner>/codex/resume-last-auto-merge-cleanup
Deleted branch codex/resume-last-auto-merge-cleanup.
```

Final cleanup agent message excerpt:

```text
pr-merge-cleanup completed. PR #58 merged at 2026-06-20T22:07:37Z; the script fetched/pruned origin, detached to origin/main at ce544f3, and deleted local branch codex/resume-last-auto-merge-cleanup.

Verification: worktree is clean, HEAD is detached, and the local branch ref is gone.

CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready
CODEX_PR_MERGE_CLEANUP_THREAD_ID=<cleanup-session-thread-id>
```
