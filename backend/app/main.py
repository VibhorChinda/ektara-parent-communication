import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import campaigns, cron, parents, templates, webhooks

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Parent Communication API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.WEB_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(parents.router)
app.include_router(templates.router)
app.include_router(campaigns.router)
app.include_router(webhooks.router)
app.include_router(cron.router)


@app.get("/health")
def health():
    return {"status": "ok"}
