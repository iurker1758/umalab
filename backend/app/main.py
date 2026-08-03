"""UmaLab API: app construction and router wiring. Routes live in app/routers/,
request/response models in app/schemas.py.

Schema is managed by Alembic — run `alembic upgrade head` before starting.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import designer, roster, sparks

app = FastAPI(title="UmaLab")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(roster.router)
app.include_router(designer.router)
app.include_router(sparks.router)
