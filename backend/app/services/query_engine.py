"""
High-Performance Query Engine
- ConnectorX: 10x faster than pandas for DB reads
- Polars: Blazing fast DataFrame operations
- Arrow IPC: Zero-copy serialization
"""
import logging
import hashlib
import time
from typing import Optional, List, Dict, Any
import polars as pl
import pyarrow as pa
import pyarrow.ipc as ipc
from io import BytesIO

logger = logging.getLogger(__name__)

class QueryEngine:
    """Execute queries and return Arrow IPC format"""
    
    @staticmethod
    def build_connection_string(conn_type: str, config: dict) -> str:
        """Build connection string for ConnectorX"""
        if conn_type == "mssql":
            return f"mssql://{config['username']}:{config['password']}@{config['host']}:{config.get('port', 1433)}/{config['database']}?TrustServerCertificate=true"
        elif conn_type == "postgresql":
            return f"postgresql://{config['username']}:{config['password']}@{config['host']}:{config.get('port', 5432)}/{config['database']}"
        elif conn_type == "mysql":
            return f"mysql://{config['username']}:{config['password']}@{config['host']}:{config.get('port', 3306)}/{config['database']}"
        else:
            raise ValueError(f"Unsupported database type: {conn_type}")
    
    @staticmethod
    async def execute_query(
        conn_string: str,
        query: str,
        limit: Optional[int] = None
    ) -> tuple[bytes, int, float]:
        """
        Execute query and return Arrow IPC bytes
        Returns: (arrow_bytes, row_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            # Use ConnectorX for blazing fast reads
            import connectorx as cx
            
            # Apply limit if specified
            if limit:
                query = f"SELECT TOP {limit} * FROM ({query}) AS subq" if "mssql" in conn_string else f"SELECT * FROM ({query}) AS subq LIMIT {limit}"
            
            # Read directly to Arrow
            arrow_table = cx.read_sql(conn_string, query, return_type="arrow")
            
            # Serialize to IPC
            sink = BytesIO()
            with ipc.new_stream(sink, arrow_table.schema) as writer:
                writer.write_table(arrow_table)
            
            elapsed = (time.perf_counter() - start) * 1000
            arrow_bytes = sink.getvalue()
            
            logger.info(f"Query executed: {arrow_table.num_rows} rows in {elapsed:.1f}ms")
            
            return arrow_bytes, arrow_table.num_rows, elapsed
            
        except Exception as e:
            logger.error(f"Query error: {e}")
            raise
    
    @staticmethod
    async def execute_pivot(
        conn_string: str,
        base_query: str,
        group_by: List[str],
        metrics: List[Dict[str, Any]],
        filters: Optional[Dict[str, Any]] = None
    ) -> tuple[bytes, int, float]:
        """
        Execute pivot query with ROLLUP for correct aggregations
        Returns: (arrow_bytes, row_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            import connectorx as cx
            
            is_mssql = "mssql" in conn_string
            
            # If no group_by and no metrics, just return the base query
            if not group_by and not metrics:
                arrow_table = cx.read_sql(conn_string, base_query, return_type="arrow")
                
                sink = BytesIO()
                with ipc.new_stream(sink, arrow_table.schema) as writer:
                    writer.write_table(arrow_table)
                
                elapsed = (time.perf_counter() - start) * 1000
                return sink.getvalue(), arrow_table.num_rows, elapsed
            
            # Build SELECT clause
            select_parts = []
            
            # Group by columns
            for col in group_by:
                select_parts.append(f'[{col}]' if is_mssql else f'"{col}"')
            
            # Metrics with aggregations
            for m in metrics:
                if m.get('type') == 'margin':
                    # Margin formula: (revenue - cost) / revenue * 100
                    rev = m.get('revenueField', m.get('field', 'Venduto'))
                    cost = m.get('costField', 'Costo')
                    col_name = m.get('name', 'MarginePerc')
                    if is_mssql:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM([{rev}]) = 0 THEN 0 
                                ELSE ROUND(CAST((SUM([{rev}]) - SUM([{cost}])) * 100.0 / SUM([{rev}]) AS DECIMAL(10,2)), 2)
                            END AS [{col_name}]
                        ''')
                    else:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM("{rev}") = 0 THEN 0 
                                ELSE ROUND(CAST((SUM("{rev}") - SUM("{cost}")) * 100.0 / SUM("{rev}") AS DECIMAL(10,2)), 2)
                            END AS "{col_name}"
                        ''')
                else:
                    agg = m.get('aggregation', 'SUM').upper()
                    field = m.get('field', '')
                    name = m.get('name', field)
                    if field:
                        if is_mssql:
                            select_parts.append(f'{agg}([{field}]) AS [{name}]')
                        else:
                            select_parts.append(f'{agg}("{field}") AS "{name}"')
            
            # If no select parts, select all
            if not select_parts:
                select_parts = ['*']
            
            # Build GROUP BY with ROLLUP
            if group_by:
                if is_mssql:
                    group_clause = ', '.join(f'[{col}]' for col in group_by)
                    group_by_sql = f"GROUP BY ROLLUP({group_clause})"
                    # SQL Server ORDER BY without NULLS FIRST
                    order_parts = []
                    for i, col in enumerate(group_by):
                        order_parts.append(f"CASE WHEN [{col}] IS NULL THEN 0 ELSE 1 END, [{col}]")
                    order_by_sql = "ORDER BY " + ", ".join(order_parts)
                else:
                    group_clause = ', '.join(f'"{col}"' for col in group_by)
                    group_by_sql = f"GROUP BY ROLLUP({group_clause})"
                    order_by_sql = "ORDER BY " + ", ".join(f"{i+1} NULLS FIRST" for i in range(len(group_by)))
            else:
                group_by_sql = ""
                order_by_sql = ""
            
            # Build WHERE clause from filters
            where_sql = ""
            if filters:
                conditions = []
                for field, filter_def in filters.items():
                    col = f'[{field}]' if is_mssql else f'"{field}"'
                    if filter_def.get('type') == 'contains':
                        conditions.append(f"{col} LIKE '%{filter_def['value']}%'")
                    elif filter_def.get('type') == 'equals':
                        conditions.append(f"{col} = '{filter_def['value']}'")
                    elif filter_def.get('type') == 'greaterThan':
                        conditions.append(f"{col} > {filter_def['value']}")
                    elif filter_def.get('type') == 'lessThan':
                        conditions.append(f"{col} < {filter_def['value']}")
                if conditions:
                    where_sql = "WHERE " + " AND ".join(conditions)
            
            # Final query
            sql = f"""
                SELECT {', '.join(select_parts)}
                FROM ({base_query}) AS base_data
                {where_sql}
                {group_by_sql}
                {order_by_sql}
            """
            
            logger.info(f"Pivot SQL: {sql[:500]}...")
            
            # Execute
            arrow_table = cx.read_sql(conn_string, sql, return_type="arrow")
            
            # Serialize to IPC
            sink = BytesIO()
            with ipc.new_stream(sink, arrow_table.schema) as writer:
                writer.write_table(arrow_table)
            
            elapsed = (time.perf_counter() - start) * 1000
            arrow_bytes = sink.getvalue()
            
            logger.info(f"Pivot executed: {arrow_table.num_rows} rows in {elapsed:.1f}ms")
            
            return arrow_bytes, arrow_table.num_rows, elapsed
            
        except Exception as e:
            logger.error(f"Pivot error: {e}")
            raise
    
    @staticmethod
    def hash_config(config: dict) -> str:
        """Create hash of pivot configuration for caching"""
        import json
        content = json.dumps(config, sort_keys=True)
        return hashlib.md5(content.encode()).hexdigest()[:16]

# Singleton
query_engine = QueryEngine()
