from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, health
from app.api import trade, bot, affiliate
from app.core.ws_manager import broadcaster, ws_signals_endpoint
from app.core.database import engine, Base
import app.models.affiliate  # noqa: F401 — register ORM models


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create DB tables — non-fatal if DB is unavailable
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"DB init skipped (non-fatal): {e}")

    # Start the Deriv public WS broadcaster
    await broadcaster.start()
    yield


app = FastAPI(title="Digit Strategy Terminal API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(trade.router, prefix="/api/trade")
app.include_router(bot.router, prefix="/api/bot")
app.include_router(affiliate.router, prefix="/api/affiliate")


@app.websocket("/ws/signals")
async def signals_ws(websocket: WebSocket):
    await ws_signals_endpoint(websocket)
