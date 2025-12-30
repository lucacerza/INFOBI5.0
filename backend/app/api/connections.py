"""Database Connections API"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.db.database import get_db, Connection
from app.core.deps import get_current_user, get_current_admin
from app.core.security import encrypt_password, decrypt_password
from app.models.schemas import ConnectionCreate, ConnectionUpdate, ConnectionResponse
from app.services.query_engine import QueryEngine

router = APIRouter()

@router.get("", response_model=List[ConnectionResponse])
async def list_connections(
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """List all database connections"""
    result = await db.execute(select(Connection).order_by(Connection.name))
    return result.scalars().all()

@router.post("", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_connection(
    data: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Create a new database connection"""
    conn = Connection(
        name=data.name,
        db_type=data.db_type,
        host=data.host,
        port=data.port,
        database=data.database,
        username=data.username,
        password_encrypted=encrypt_password(data.password),
        ssl_enabled=data.ssl_enabled
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn

@router.get("/{conn_id}", response_model=ConnectionResponse)
async def get_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get connection details"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn

@router.put("/{conn_id}", response_model=ConnectionResponse)
async def update_connection(
    conn_id: int,
    data: ConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Update connection"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "password" and value:
            setattr(conn, "password_encrypted", encrypt_password(value))
        elif value is not None:
            setattr(conn, field, value)
    
    await db.commit()
    await db.refresh(conn)
    return conn

@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Delete connection"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    await db.delete(conn)
    await db.commit()

@router.post("/{conn_id}/test")
async def test_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Test database connection"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
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
        
        # Simple test query
        import connectorx as cx
        cx.read_sql(conn_string, "SELECT 1", return_type="arrow")
        
        return {"success": True, "message": "Connection successful"}
    except Exception as e:
        return {"success": False, "message": str(e)}
