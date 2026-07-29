# Working agreements

Solo project, but run like a team repo — these are the standards for commits,
branches, PRs, and issues.

## Branches

`main` is protected: CI must pass, history is linear, squash-merge only.
Work on short-lived branches named `<type>/<short-slug>`, e.g. `feat/streak-bonus`,
`fix/checkoff-tz`, `chore/ruff-bump`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>(<scope>): <imperative summary, lowercase, no period>

Optional body: what and why, not how. Wrap at ~72 chars.
```

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`.
- **Scope** (optional): `backend` or `frontend`.
- Example: `feat(backend): taper habit weights after four ingrained weeks`

## Pull requests

- Title in Conventional Commit format — squash-merge uses it as the commit title
  and the PR body as the commit message, so write both for the git log.
- CI (`backend`, `frontend`, `docs`) must be green; enable auto-merge instead of
  waiting. `docs` lints Markdown — run `npx markdownlint-cli2` locally to check
  (rules in `.markdownlint.jsonc`, or use the VS Code markdownlint extension).
- A PR that makes a non-obvious technical choice updates `DECISIONS.md` in the
  same PR (Requirements → Choice → Rejected → What would change my mind).

## Issues

Use the issue forms (bug report / feature request). One issue per problem;
feature requests state the requirement before the proposed solution — solutions
belong in DECISIONS.md once chosen.
