"""
INFOBI 5.0 - High Performance BI Platform
Focus: Speed, Mobile, Industry 5.0
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse

from app.core.config import settings
from app.db.database import init_db
from app.services.warmup import WarmupService
from app.api import auth, connections, reports, pivot, dashboards, export

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup"""
    logger.info("🚀 Starting INFOBI 5.0...")
    await init_db()
    logger.info("✅ Database initialized")
    
    # Warmup connections in background
    import asyncio
    asyncio.create_task(WarmupService.warmup_all_connections())
    
    yield
    logger.info("👋 Shutting down INFOBI 5.0")

app = FastAPI(
    title="INFOBI 5.0",
    description="High Performance BI for Industry 5.0",
    version="5.0.0",
    lifespan=lifespan,
    default_response_class=ORJSONResponse,  # Faster JSON serialization
)

# Middleware for performance
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Query-Time", "X-Cache-Hit", "X-Row-Count"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(connections.router, prefix="/api/connections", tags=["Connections"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(pivot.router, prefix="/api/pivot", tags=["Pivot"])
app.include_router(dashboards.router, prefix="/api/dashboards", tags=["Dashboards"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "4.0.0"}

@app.get("/")
async def root():
    return {"message": "INFOBI 4.0 - High Performance BI", "docs": "/docs"}
