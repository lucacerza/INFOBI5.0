"""Reports API with high-performance data streaming"""
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from pydantic import BaseModel
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user, get_current_admin
from app.core.security import decrypt_password
from app.models.schemas import ReportCreate, ReportUpdate, ReportResponse, GridRequest, GridResponse, PivotDrillRequest
from app.services.query_engine import QueryEngine
from app.services.cache import cache

logger = logging.getLogger(__name__)

router = APIRouter()

class TestQueryRequest(BaseModel):
    connection_id: int
    query: str

@router.post("/test-query")
async def test_query(
    request: TestQueryRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Test a SQL query and return column info and row count"""
    # Get connection
    result = await db.execute(select(Connection).where(Connection.id == request.connection_id))
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connessione non trovata")
    
    try:
        import connectorx as cx
        
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
        
        # Inject LIMIT/TOP directly to avoid subquery encapsulation
        import re
        q_clean = request.query.strip()
        
        if connection.db_type == "mssql":
            # Using Regex to inject TOP 100 after the first SELECT if not present
            # Case insensitive, matching word boundary
            if not re.search(r"(?i)\bSELECT\s+TOP\b", q_clean):
                 test_query = re.sub(r"(?i)^\s*SELECT", "SELECT TOP 100", q_clean, count=1)
            else:
                 test_query = q_clean
        else:
            # For Postgres/MySQL/SQLite, append LIMIT 100 if not present
            if not re.search(r"(?i)\bLIMIT\s+\d+", q_clean):
                # Remove trailing semicolon if exists
                if q_clean.endswith(';'):
                    q_clean = q_clean[:-1]
                test_query = f"{q_clean} LIMIT 100"
            else:
                test_query = q_clean
        
        # Execute
        arrow_table = cx.read_sql(conn_string, test_query, return_type="arrow")
        
        # Get sample data (first 50 rows) for preview
        sample_rows = arrow_table.slice(0, 50).to_pylist()
        
        return {
            "success": True,
            "row_count": arrow_table.num_rows,
            "columns": [field.name for field in arrow_table.schema],
            "sample_data": sample_rows,
            "message": "Query eseguita con successo"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{report_id}/grid", response_model=GridResponse)
async def get_report_grid_data(
    report_id: int,
    request: GridRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get paginated, sorted, and filtered data for a specific report.
    Implements Server-Side Row Model.
    """
    # 1. Get Report
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")
        
    # 2. Get Connection
    result = await db.execute(select(Connection).where(Connection.id == report.connection_id))
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connessione non trovata")
        
    try:
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
        
        # 3. Execute Server-Side Query
        rows, total_count, _ = await QueryEngine.execute_grid_query(
            conn_string,
            report.query,
            request
        )
        
        return {
            "rows": rows,
            "lastRow": total_count
        }
        
    except Exception as e:
        logger.error(f"Error executing grid query: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{report_id}/pivot-drill")
async def get_pivot_drill_data(
    report_id: int,
    request: PivotDrillRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get aggregated data specific to a tree node (Lazy Loading).
    Returns children for the requested groupKeys path.
    """
    # 1. Get Report & Connection
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report: raise HTTPException(status_code=404, detail="Report not found")
        
    result = await db.execute(select(Connection).where(Connection.id == report.connection_id))
    connection = result.scalar_one_or_none()
    if not connection: raise HTTPException(status_code=404, detail="Connessione non trovata")

    try:
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
        
        # 3. Execute Lazy Pivot
        rows, count, _ = await QueryEngine.execute_pivot_drill(
            conn_string,
            report.query,
            request
        )
        
        return {"rows": rows, "count": count}
        
    except Exception as e:
        logger.error(f"Error executing pivot drill: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{report_id}/column-values/{column}")
async def get_column_values(
    report_id: int,
    column: str,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get distinct values for a specific column (for Filters or Pivot Headers)"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report: raise HTTPException(status_code=404, detail="Report not found")
        
    result = await db.execute(select(Connection).where(Connection.id == report.connection_id))
    connection = result.scalar_one_or_none()
    if not connection: raise HTTPException(status_code=404, detail="Connessione non trovata")

    try:
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
        
        values = await QueryEngine.get_column_values(conn_string, report.query, column)
        return values
        
    except Exception as e:
        logger.error(f"Error fetching values: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.get("", response_model=List[ReportResponse])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """List all reports"""
    result = await db.execute(select(Report).order_by(Report.name))
    return result.scalars().all()

@router.post("", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    data: ReportCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Create a new report"""
    # Verify connection exists
    conn_result = await db.execute(select(Connection).where(Connection.id == data.connection_id))
    if not conn_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Connection not found")
    
    report = Report(
        name=data.name,
        description=data.description,
        connection_id=data.connection_id,
        query=data.query,
        default_group_by=data.default_group_by,
        default_metrics=[m.model_dump() for m in data.default_metrics],
        available_metrics=[m.model_dump() for m in data.available_metrics],
        column_labels=data.column_labels,
        cache_enabled=data.cache_enabled,
        cache_ttl=data.cache_ttl,
        created_by=user.id
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report

@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get report details"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report

@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: int,
    data: ReportUpdate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Update report"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "default_metrics" and value:
            value = [m.model_dump() if hasattr(m, 'model_dump') else m for m in value]
        if field == "available_metrics" and value:
            value = [m.model_dump() if hasattr(m, 'model_dump') else m for m in value]
        if value is not None:
            setattr(report, field, value)
    
    await db.commit()
    await db.refresh(report)
    
    # Invalidate cache
    await cache.invalidate_report(report_id)
    
    return report

@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Delete report"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    await db.delete(report)
    await db.commit()
    
    # Invalidate cache
    await cache.invalidate_report(report_id)

@router.put("/{report_id}/layout")
async def save_layout(
    report_id: int,
    layout: dict,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Save user's layout configuration"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.layout = layout
    await db.commit()
    
    return {"success": True}

@router.get("/{report_id}/data")
async def get_report_data(
    report_id: int,
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get report data as Arrow IPC stream
    This is the RAW data endpoint - no aggregations
    Use /pivot endpoint for aggregated data
    """
    start_time = time.perf_counter()
    
    # Get report
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Check cache first
    cache_hit = False
    query_hash = QueryEngine.hash_config({"query": report.query})
    
    if report.cache_enabled and not force_refresh:
        cached = await cache.get_query(report_id, query_hash)
        if cached:
            cache_hit = True
            arrow_bytes = cached
            row_count = -1  # Unknown from cache
            elapsed = (time.perf_counter() - start_time) * 1000
    
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
        
        # Execute query
        arrow_bytes, row_count, query_time = await QueryEngine.execute_query(
            conn_string,
            report.query
        )
        
        elapsed = (time.perf_counter() - start_time) * 1000
        
        # Cache result
        if report.cache_enabled:
            await cache.set_query(report_id, query_hash, arrow_bytes)
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Query-Time": f"{elapsed:.1f}",
            "X-Cache-Hit": str(cache_hit).lower(),
            "X-Row-Count": str(row_count) if row_count >= 0 else "cached",
            "Content-Disposition": f"attachment; filename=report_{report_id}.arrow"
        }
    )

@router.post("/{report_id}/refresh-cache")
async def refresh_cache(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Force refresh report cache"""
    await cache.invalidate_report(report_id)
    return {"success": True, "message": "Cache invalidated"}
