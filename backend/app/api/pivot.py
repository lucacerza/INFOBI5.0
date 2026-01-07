"""
PIVOT API - High Performance Aggregations
This is the KEY endpoint that solves the margin calculation problem.
All aggregations (including margins) are calculated server-side with ROLLUP.
"""
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user
from app.core.security import decrypt_password
from app.models.schemas import PivotRequest
from app.services.query_engine import QueryEngine
from app.services.cache import cache

logger = logging.getLogger(__name__)
router = APIRouter()

@router.post("/{report_id}")
async def execute_pivot(
    report_id: int,
    request: PivotRequest,
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Execute pivot query with ROLLUP for correct aggregations.
    
    This endpoint:
    1. Takes pivot configuration from Perspective.js frontend
    2. Builds SQL with GROUP BY ROLLUP for hierarchical aggregations
    3. Calculates margins CORRECTLY on each aggregation level
    4. Returns Arrow IPC for fast transfer
    5. Caches results for instant repeated queries
    
    The frontend (Perspective.js) becomes a pure visualizer - 
    all calculations happen here on the server.
    """
    start_time = time.perf_counter()
    
    # Get report and connection
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Build config hash for caching
    # INCLUDE NEW PARAMS: sort, HAVING logic implicitly via metrics/filters
    config = {
        "query": report.query,
        "group_by": request.group_by,
        "split_by": request.split_by,
        "metrics": [m.model_dump() for m in request.metrics],
        "filters": request.filters,
        "sort": request.sort,
        "mode": "lazy" # Differentiate from flat queries if needed
    }
    config_hash = QueryEngine.hash_config(config)
    
    # Check cache
    cache_hit = False
    if report.cache_enabled and not force_refresh:
        cached = await cache.get_pivot(report_id, config_hash)
        if cached:
            cache_hit = True
            arrow_bytes = cached
            row_count = -1
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"Pivot cache HIT for report {report_id} in {elapsed:.1f}ms")
    
    if not cache_hit:
        # Build connection string
        conn_string = QueryEngine.build_connection_string(
            connection.db_type,
            {
                "host": connection.host,
                "port": connection.port,
                "database": connection.database,
                "username": connection.username,
                "password": decrypt_password(connection.password_encrypted)
            }
        )
        
        # Merge default metrics with request metrics
        metrics = [m.model_dump() for m in request.metrics]
        if not metrics:
            metrics = report.default_metrics
        
        # Add available margin calculations if referenced
        for m in metrics:
            if m.get('type') == 'margin':
                # Find the definition in available_metrics
                for am in report.available_metrics:
                    if am.get('name') == m.get('name'):
                        m['revenueField'] = am.get('revenueField')
                        m['costField'] = am.get('costField')
                        break
        
        try:
            # Combine group_by and split_by for the query to ensure we get all dimensions
            # We do NOT want ROLLUP from backend anymore, as frontend does the tree building.
            all_groups = (request.group_by or report.default_group_by or []) + (request.split_by or [])
            # Deduplicate just in case
            all_groups = list(dict.fromkeys(all_groups))
            
            arrow_bytes, row_count, query_time = await QueryEngine.execute_pivot(
                conn_string,
                report.query,
                all_groups,
                metrics,
                request.filters,
                request.sort
            )
            
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"Pivot executed for report {report_id}: {row_count} rows in {elapsed:.1f}ms")
            
            # Cache result
            if report.cache_enabled:
                await cache.set_pivot(report_id, config_hash, arrow_bytes)
        except Exception as e:
            logger.error(f"Pivot Query Execution Failed: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Errore esecuzione query: {str(e)}")
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Query-Time": f"{elapsed:.1f}",
            "X-Cache-Hit": str(cache_hit).lower(),
            "X-Row-Count": str(row_count) if row_count >= 0 else "cached",
        }
    )

@router.get("/{report_id}/schema")
async def get_pivot_schema(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get available columns and metrics for pivot configuration.
    Used by frontend to populate the pivot configuration UI.
    """
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    try:
        # Get column info from a limited query
        conn_string = QueryEngine.build_connection_string(
            connection.db_type,
            {
                "host": connection.host,
                "port": connection.port,
                "database": connection.database,
                "username": connection.username,
                "password": decrypt_password(connection.password_encrypted)
            }
        )
        
        import connectorx as cx
        
        # Get just 1 row to infer schema
        # Inject LIMIT/TOP directly to avoid subquery encapsulation
        import re
        q_clean = report.query.strip()
        
        if connection.db_type == "mssql":
            if not re.search(r"(?i)\bSELECT\s+TOP\b", q_clean):
                 limit_query = re.sub(r"(?i)^\s*SELECT", "SELECT TOP 1", q_clean, count=1)
            else:
                 # If TOP is present, we still want to limit to 1 for schema check
                 # Replace existing TOP N with TOP 1
                 limit_query = re.sub(r"(?i)\bTOP\s+\d+", "TOP 1", q_clean, count=1)
        else:
            if not re.search(r"(?i)\bLIMIT\s+\d+", q_clean):
                 if q_clean.endswith(';'):
                    q_clean = q_clean[:-1]
                 limit_query = f"{q_clean} LIMIT 1"
            else:
                 limit_query = re.sub(r"(?i)\bLIMIT\s+\d+", "LIMIT 1", q_clean)
        
        logger.info(f"Executing schema query for report {report_id}")
        
        # Run sync connectorx in executor to avoid blocking main thread
        import asyncio
        loop = asyncio.get_running_loop()
        arrow_table = await loop.run_in_executor(
            None,
            lambda: cx.read_sql(conn_string, limit_query, return_type="arrow")
        )
        
        columns = []
        for field in arrow_table.schema:
            col_type = str(field.type)
            is_numeric = any(t in col_type.lower() for t in ['int', 'float', 'decimal', 'double', 'numeric'])
            
            columns.append({
                "name": field.name,
                "type": "number" if is_numeric else "string",
                "label": report.column_labels.get(field.name, field.name) if report.column_labels else field.name
            })
        
        return {
            "columns": columns,
            "default_group_by": report.default_group_by or [],
            "default_metrics": report.default_metrics or [],
            "available_metrics": report.available_metrics or []
        }
    except Exception as e:
        logger.error(f"Schema error for report {report_id}: {str(e)}")
        # Return empty schema instead of crashing
        raise HTTPException(
            status_code=500, 
            detail=f"Errore nel caricamento dello schema: {str(e)}"
        )
