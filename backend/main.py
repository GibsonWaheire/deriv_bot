from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, health
from app.api import trade
from app.core.ws_manager import broadcaster, ws_signals_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start the Deriv public WS broadcaster on startup
    await broadcaster.start()
    yield


app = FastAPI(title="Digit Strategy Terminal API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(trade.router, prefix="/api/trade")


@app.websocket("/ws/signals")
async def signals_ws(websocket: WebSocket):
    await ws_signals_endpoint(websocket)
