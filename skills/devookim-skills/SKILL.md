---
name: devookim-skills
description: Manage skills with the devookim-skills CLI. Use when listing, installing, updating, or removing DevooKim/my-agents skills, or when vendoring an external skill and merging upstream changes into a locally modified copy.
---

# devookim-skills

The current CLI release is `0.2.1`, matching `cli/package.json`. Invoke every
command as `bunx devookim-skills@0.2.1 ...`. When the CLI version changes, update
this pinned version and `cli/package.json` in the same release. A bare package
name and `@latest` are not valid for operational commands because Bun/npm
resolution or cache state can select a different CLI release.

## Install skills

1. Run `bunx devookim-skills@0.2.1 find` when the skill name is unknown.
2. Use the same pinned command prefix for `add`, `update`, or `remove`.
3. Add `-g` only when the user wants a user-level installation.
4. Use `add --local` to test the current `my-agents` checkout before it is pushed.
5. Inside the `my-agents` checkout, use `-g`; project-scoped installation there would collide with the vendoring `skills-lock.json`.

## Vendor external skills

1. Resolve the checkout from `--repo`, then `DEVOOKIM_SKILLS_REPO`, then the current directory's ancestors.
2. Use `vendor add` to copy the complete skill directory into `skills/vendor/<name>/` and record its exact upstream commit in `skills-lock.json`.
3. Use `vendor check` before `vendor update` when the user requests a review without changes.
4. Use `vendor update` to 3-way merge the locked upstream base, the local copy, and the new upstream version.
5. When conflicts occur, resolve every listed file and run `vendor continue`; the lockfile remains unchanged until this succeeds.

Treat `skills/vendor/<name>/` and its `skills-lock.json` entry as one change. Preserve local modifications during upstream updates and inspect the resulting diff before reporting completion.
