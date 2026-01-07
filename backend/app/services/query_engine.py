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
from app.models.schemas import GridRequest, PivotDrillRequest

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
        filters: Optional[Dict[str, Any]] = None,
        sort: Optional[List[Dict[str, str]]] = None # List of {colId: str, sort: 'asc'|'desc'}
    ) -> tuple[bytes, int, float]:
        """
        Execute pivot query with ROLLUP for correct aggregations
        Returns: (arrow_bytes, row_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            import connectorx as cx
            
            is_mssql = "mssql" in conn_string.lower()
            is_mysql = "mysql" in conn_string.lower()
            is_mysql = "mysql" in conn_string
            
            def quote(col: str) -> str:
                if is_mssql:
                    return f"[{col}]"
                elif is_mysql:
                    return f"`{col}`"
                else:
                    return f'"{col}"'
            
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
                select_parts.append(quote(col))
            
            # Metrics with aggregations
            for m in metrics:
                if m.get('type') == 'margin':
                    # Margin formula: (revenue - cost) / revenue * 100
                    rev = m.get('revenueField', m.get('field', 'Venduto'))
                    cost = m.get('costField', 'Costo')
                    col_name = m.get('name', 'MarginePerc')
                    
                    rev_q = quote(rev)
                    cost_q = quote(cost)
                    col_name_q = quote(col_name)

                    if is_mssql:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM({rev_q}) = 0 THEN 0 
                                ELSE ROUND(CAST((SUM({rev_q}) - SUM({cost_q})) * 100.0 / SUM({rev_q}) AS DECIMAL(10,2)), 2)
                            END AS {col_name_q}
                        ''')
                    else:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM({rev_q}) = 0 THEN 0 
                                ELSE ROUND(CAST((SUM({rev_q}) - SUM({cost_q})) * 100.0 / SUM({rev_q}) AS DECIMAL(10,2)), 2)
                            END AS {col_name_q}
                        ''')
                else:
                    agg = m.get('aggregation', 'SUM').upper()
                    field = m.get('field', '')
                    name = m.get('name', field)
                    if field:
                        select_parts.append(f'{agg}({quote(field)}) AS {quote(name)}')
            
            # If no select parts, select all
            if not select_parts:
                select_parts = ['*']
            
            # Build GROUP BY (Client-side aggregation handles the hierarchy, so we just need flat grouped data)
            if group_by:
                group_clause = ', '.join(quote(col) for col in group_by)
                group_by_sql = f"GROUP BY {group_clause}"
            else:
                group_by_sql = ""

            # Build ORDER BY
            order_by_sql = ""
            if sort:
                order_clauses = []
                for s in sort:
                    col = quote(s['colId'])
                    direction = s['sort'].upper()
                    order_clauses.append(f"{col} {direction}")
                order_by_sql = "ORDER BY " + ", ".join(order_clauses)
            elif group_by:
                # Default sort by keys
                group_clause = ', '.join(quote(col) for col in group_by)
                order_by_sql = f"ORDER BY {group_clause}"

            
            # Build WHERE and HAVING clauses
            where_sql = ""
            having_sql = ""
            
            # Helper to check if a field is a metric (for HAVING)
            metric_names = {m.get('name', m.get('field')) for m in metrics}
            
            if filters:
                where_conditions = []
                having_conditions = []
                
                for field, filter_def in filters.items():
                    val = filter_def['value']
                    # Sanitization
                    if isinstance(val, str):
                        val = val.replace("'", "''")
                        
                    # Determine Operator
                    op = ""
                    if filter_def.get('type') == 'contains':
                        op = f"LIKE '%{val}%'"
                    elif filter_def.get('type') == 'equals':
                        op = f"= '{val}'"
                    elif filter_def.get('type') == 'greaterThan':
                        op = f"> {val}"
                    elif filter_def.get('type') == 'lessThan':
                        op = f"< {val}"
                    else:
                        continue # Skip unknown

                    # Check if Metric or Dimension
                    if field in metric_names:
                        # HAVING - needs the aggregated name quoted
                        having_conditions.append(f"{quote(field)} {op}")
                    else:
                        # WHERE - needs the original simple column name quoted
                        where_conditions.append(f"{quote(field)} {op}")

                if where_conditions:
                    where_sql = "WHERE " + " AND ".join(where_conditions)
                if having_conditions:
                    having_sql = "HAVING " + " AND ".join(having_conditions)
            
            # Final query
            sql = f"""
                SELECT {', '.join(select_parts)}
                FROM ({base_query}) AS base_data
                {where_sql}
                {group_by_sql}
                {having_sql}
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
    async def execute_grid_query(
        conn_string: str,
        base_query: str,
        request: GridRequest
    ) -> tuple[List[Dict[str, Any]], int, float]:
        """
        Execute query with server-side pagination, sorting, and filtering.
        Returns: (rows, total_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            import connectorx as cx
            
            # 1. Build WHERE clause (Basic implementation - requires sanitization in prod)
            where_clauses = []
            
            for col, filter_def in request.filterModel.items():
                # Basic sanitization for col name to prevent obvious injection
                clean_col = "".join(c for c in col if c.isalnum() or c in '_')
                
                val = filter_def.filter
                if isinstance(val, str):
                    val = val.replace("'", "''") # Escape single quotes
                    
                if filter_def.type == 'contains':
                    where_clauses.append(f"{clean_col} LIKE '%{val}%'")
                elif filter_def.type == 'equals':
                    if isinstance(val, str):
                        where_clauses.append(f"{clean_col} = '{val}'")
                    else:
                        where_clauses.append(f"{clean_col} = {val}")
                elif filter_def.type == 'startsWith':
                    where_clauses.append(f"{clean_col} LIKE '{val}%'")
            
            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # 2. Build ORDER BY
            order_clauses = []
            for sort in request.sortModel:
                clean_col = "".join(c for c in sort.colId if c.isalnum() or c in '_')
                direction = "DESC" if sort.sort == "desc" else "ASC"
                order_clauses.append(f"{clean_col} {direction}")
            
            order_sql = " ORDER BY " + ", ".join(order_clauses) if order_clauses else ""
            
            # 3. Construct SQL
            is_mssql = "mssql" in conn_string.lower()
            limit = request.endRow - request.startRow
            offset = request.startRow
            
            # Wrap base query to treat it as a table
            wrapped_base = f"SELECT * FROM ({base_query}) AS base"
            full_sql_structure = f"{wrapped_base} {where_sql}"
            
            # Get Total Count
            count_query = f"SELECT COUNT(*) as total FROM ({full_sql_structure}) AS count_tbl"
            count_df = cx.read_sql(conn_string, count_query)
            total_rows = int(count_df['total'][0]) if not count_df.empty else 0
            
            # Fetch Page
            if is_mssql:
                if not order_sql:
                     order_sql = "ORDER BY (SELECT NULL)"
                data_query = f"{full_sql_structure} {order_sql} OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"
            else:
                data_query = f"{full_sql_structure} {order_sql} LIMIT {limit} OFFSET {offset}"
            
            # Execute
            data_df = cx.read_sql(conn_string, data_query)
            rows = data_df.to_dicts()
            
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"Grid query: {len(rows)}/{total_rows} rows in {elapsed:.1f}ms")
            
            return rows, total_rows, elapsed
            
        except Exception as e:
            logger.error(f"Grid query error: {e}")
            raise

    @staticmethod
    async def execute_pivot_drill(
        conn_string: str,
        base_query: str,
        request: PivotDrillRequest
    ) -> tuple[List[Dict[str, Any]], int, float]:
        """
        Executes a Drill-Down query for Lazy Loading.
        Calculates aggregations for the specific node requested.
        """
        start = time.perf_counter()
        try:
            import connectorx as cx
            
            # 1. Determine which column we are expanding
            # If groupKeys is empty [], we are at top level -> Group by the 1st column in rowGroupCols
            # If groupKeys is ['Europe'], we are expanding Europe -> Filter by Region='Europe', Group by Country (2nd col)
            
            current_level = len(request.groupKeys)
            
            # If we digged deeper than defined groups, return empty (shouldn't happen in logic)
            if current_level >= len(request.rowGroupCols):
                 return [], 0, 0
            
            group_col = request.rowGroupCols[current_level] # The column to group by NOW
            
            # 2. Build WHERE clauses
            where_clauses = []
            
            # 2a. Parent Path Filters (The "Drill-Down" constraints)
            # e.g. groupKeys=['Europe'] -> WHERE Region='Europe'
            for idx, key in enumerate(request.groupKeys):
                parent_col = request.rowGroupCols[idx]
                if isinstance(key, str):
                    clean_key = key.replace("'", "''")
                    where_clauses.append(f"{parent_col} = '{clean_key}'")
                else:
                    where_clauses.append(f"{parent_col} = {key}")
            
            # 2b. Global filters from UI
            for col, filter_def in request.filterModel.items():
                clean_col = "".join(c for c in col if c.isalnum() or c in '_')
                val = filter_def.filter
                if isinstance(val, str):
                    val = val.replace("'", "''")
                if filter_def.type == 'contains':
                    where_clauses.append(f"{clean_col} LIKE '%{val}%'")
                elif filter_def.type == 'equals':
                     if isinstance(val, str): where_clauses.append(f"{clean_col} = '{val}'")
                     else: where_clauses.append(f"{clean_col} = {val}")
            
            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # 3. Build Select & Aggregations
            select_parts = [f"{group_col} as key_val"] # Key column used for tree structure
            group_by_parts = [group_col]
            
            # Support for Split By (Pivot Columns)
            # If pivotCols are present, we must include them in SELECT and GROUP BY
            for pivot_col in request.pivotCols:
                select_parts.append(f"{pivot_col} as {pivot_col}")
                group_by_parts.append(pivot_col)

            for val_col in request.valueCols:
                col_id = val_col['colId']
                agg = val_col.get('aggFunc', 'sum').upper()
                if agg == 'COUNT':
                     select_parts.append(f"COUNT(*) as {col_id}")
                else:
                    # Basic SUM, AVG, MIN, MAX
                    select_parts.append(f"{agg}({col_id}) as {col_id}")
            
            select_sql = ", ".join(select_parts)
            group_by_sql = ", ".join(group_by_parts)
            
            # 4. Construct SQL
            full_query = f"""
                SELECT {select_sql}
                FROM ({base_query}) AS base
                {where_sql}
                GROUP BY {group_by_sql}
            """
            
            # Note: We can add sort and limit here too for "virtual scrolling" inside a huge group
            # For now, let's assume a group member count < 1000 is manageable without pagination inside the node
            
            # Execute
            data_df = cx.read_sql(conn_string, full_query)
            rows = data_df.to_dicts()
            
            elapsed = (time.perf_counter() - start) * 1000
            return rows, len(rows), elapsed
            
        except Exception as e:
            logger.error(f"Pivot drill error: {e}")
            raise

    @staticmethod
    async def get_column_values(conn_string: str, base_query: str, column: str) -> List[Any]:
        """Fetch distinct sorted values for a column (used for Pivot Headers)"""
        try:
             import connectorx as cx
             # Sanitization
             clean_col = "".join(c for c in column if c.isalnum() or c in '_')
             
             query = f"SELECT DISTINCT {clean_col} FROM ({base_query}) AS base ORDER BY {clean_col}"
             df = cx.read_sql(conn_string, query)
             
             # Handle potential None/Null values
             values = df[clean_col].to_list()
             return [v for v in values if v is not None]
             
        except Exception as e:
            logger.error(f"Get values error: {e}")
            return []

    @staticmethod
    def hash_config(config: dict) -> str:
        """Create hash of pivot configuration for caching"""
        import json
        content = json.dumps(config, sort_keys=True)
        return hashlib.md5(content.encode()).hexdigest()[:16]

# Singleton
query_engine = QueryEngine()
