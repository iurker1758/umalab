<!-- Title must be a Conventional Commit: type(scope): summary — it becomes the squash commit. -->

## What

## Why

## Checklist

- [ ] Backend touched → `ruff check .` and `pytest` pass locally
- [ ] Frontend touched → `npm run build` passes locally
- [ ] Schema changed → Alembic migration included (upgrade *and* downgrade)
- [ ] Non-obvious choice made → `DECISIONS.md` entry added
