import logging
import asyncio
import connectorx as cx
from sqlalchemy import select
from app.db.database import AsyncSessionLocal, Connection
from app.services.query_engine import QueryEngine
from app.core.security import decrypt_password

logger = logging.getLogger(__name__)

class WarmupService:
    @staticmethod
    async def warmup_all_connections():
        """
        Iterates over all defined connections and executes a lightweight query (SELECT 1).
        This helps to:
        1. Verify network paths/DNS resolution.
        2. Warm up DB server plan caches.
        3. Establish connectivity early.
        """
        logger.info("🔥 Starting Connection Warmup...")
        
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Connection))
            connections = result.scalars().all()
            
            if not connections:
                logger.info("No connections to warm up.")
                return

            tasks = []
            for conn in connections:
                tasks.append(WarmupService._warmup_single(conn))
            
            # Run all warmups in parallel
            await asyncio.gather(*tasks)
            
        logger.info("✅ Connection Warmup Completed")

    @staticmethod
    async def _warmup_single(conn: Connection):
        try:
            conn_string = QueryEngine.build_connection_string(
                conn.db_type,
                {
                    "host": conn.host,
                    "port": conn.port,
                    "database": conn.database,
                    "username": conn.username,
                    "password": decrypt_password(conn.password_encrypted)
                }
            )
            
            # Run sync connectorx in a thread to verify connection
            # Using SELECT 1 is standard for lightweight connectivity check
            test_sql = "SELECT 1"
            if conn.db_type == "oracle":
                test_sql = "SELECT 1 FROM DUAL"
                
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None, 
                lambda: cx.read_sql(conn_string, test_sql, return_type="arrow")
            )
            logger.info(f"   OPEN: {conn.name} ({conn.host})")
            
        except Exception as e:
            logger.warning(f"   FAIL: {conn.name} - {str(e)}")
