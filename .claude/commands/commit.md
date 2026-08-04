---
description: Stage and commit changes with a Conventional Commit message
---

1. Run `git status` and `git diff` to understand what changed.
2. If the changes mix unrelated concerns, propose splitting them into
   multiple commits and wait for my approval.
3. Craft a Conventional Commit message (`feat:` / `fix:` / `chore:` /
   `refactor:` / `docs:` / `style:` / `test:`), imperative, lowercase
   after the prefix. No "and" in the message — if it needs "and", split.
4. Stage the relevant files (never `.env` or generated artifacts) and commit.
5. If the commit gets blocked by the commit gate hook, fix the reported
   errors first, then retry.
