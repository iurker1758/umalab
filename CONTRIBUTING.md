# Working agreements

Solo project, but run like a team repo — these are the standards for commits,
branches, PRs, and issues.

## Branches

`main` is squash-merge only, with linear history — **by convention, not by
enforcement.** Branch protection is a paid feature on private repos, so
nothing is required server-side and CI cannot block a merge. Treat the rules
below as binding on yourself.
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
- All four CI jobs (`backend`, `frontend`, `docs`, `e2e`) must be green before
  you merge — **wait for them yourself**. With no required checks configured,
  `gh pr merge --auto` is not "merge when CI passes", it is merge now: PR #55
  squashed onto `main` while `e2e` was still running. `gh run watch <id>
  --exit-status` is the honest version. `docs` lints Markdown — run
  `npx markdownlint-cli2` locally to check (rules in `.markdownlint.jsonc`, or
  use the VS Code markdownlint extension).
- A PR that makes a non-obvious technical choice updates `DECISIONS.md` in the
  same PR (Requirements → Choice → Rejected → What would change my mind).

## Issues

Use the issue forms (bug report / feature request). One issue per problem;
feature requests state the requirement before the proposed solution — solutions
belong in DECISIONS.md once chosen.
