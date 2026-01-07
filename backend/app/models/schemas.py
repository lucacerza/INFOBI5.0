"""Pydantic schemas for API validation"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr

# Auth
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str]
    role: str
    is_active: bool
    
    class Config:
        from_attributes = True

# Connections
class ConnectionCreate(BaseModel):
    name: str
    db_type: str  # mssql, postgresql, mysql
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_enabled: bool = False

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_enabled: Optional[bool] = None

class ConnectionResponse(BaseModel):
    id: int
    name: str
    db_type: str
    host: str
    port: int
    database: str
    username: str
    ssl_enabled: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

# Reports
class MetricDefinition(BaseModel):
    name: str
    field: str
    type: str = "sum"  # sum, avg, count, min, max, margin
    aggregation: str = "SUM"
    # For margin calculations
    revenueField: Optional[str] = None
    costField: Optional[str] = None

class ReportCreate(BaseModel):
    name: str
    description: Optional[str] = None
    connection_id: int
    query: str
    default_group_by: List[str] = []
    default_metrics: List[MetricDefinition] = []
    available_metrics: List[MetricDefinition] = []
    column_labels: Dict[str, str] = {}
    cache_enabled: bool = True
    cache_ttl: int = 3600

class ReportUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    query: Optional[str] = None
    default_group_by: Optional[List[str]] = None
    default_metrics: Optional[List[MetricDefinition]] = None
    available_metrics: Optional[List[MetricDefinition]] = None
    column_labels: Optional[Dict[str, str]] = None
    layout: Optional[Dict[str, Any]] = None
    cache_enabled: Optional[bool] = None
    cache_ttl: Optional[int] = None

class ReportResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    connection_id: int
    query: str
    default_group_by: List[str]
    default_metrics: List[dict]
    available_metrics: List[dict]
    column_labels: Dict[str, str]
    layout: Dict[str, Any]
    cache_enabled: bool
    cache_ttl: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Pivot Request
class PivotRequest(BaseModel):
    group_by: List[str] = []
    split_by: Optional[str] = None
    metrics: List[MetricDefinition] = []
    filters: Dict[str, Any] = {}
    sort: Optional[List[Dict[str, str]]] = None

# Dashboard
class WidgetPosition(BaseModel):
    x: int
    y: int
    w: int
    h: int

class WidgetCreate(BaseModel):
    report_id: int
    widget_type: str = "grid"
    title: Optional[str] = None
    config: Dict[str, Any] = {}
    position: WidgetPosition

class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    auto_refresh: bool = False
    refresh_interval: int = 300

class DashboardResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    layout: Dict[str, Any]
    auto_refresh: bool
    refresh_interval: int
    widgets: List[dict] = []
    created_at: datetime
    
    class Config:
        from_attributes = True

# Grid / Server-Side Row Models
class SortModel(BaseModel):
    colId: str
    sort: str  # 'asc' or 'desc'

class FilterModel(BaseModel):
    filterType: str  # 'text', 'number', 'date'
    type: str        # 'equals', 'contains', 'greaterThan', etc.
    filter: Optional[Any] = None
    filterTo: Optional[Any] = None  # For ranges

class GridRequest(BaseModel):
    startRow: int = 0
    endRow: int = 100
    sortModel: List[SortModel] = []
    filterModel: Dict[str, FilterModel] = {}
    groupKeys: List[str] = []

class GridResponse(BaseModel):
    rows: List[Dict[str, Any]]
    lastRow: int

# Pivot / Drill-Down Models
class PivotDrillRequest(BaseModel):
    # Columns currently in the "Row Groups" area (e.g. ['Region', 'Country'])
    rowGroupCols: List[str] 
    # Columns in the "Values" area (e.g. [{'colId': 'Sales', 'aggFunc': 'sum'}])
    valueCols: List[Dict[str, str]]
    # Path to the current node being expanded (e.g. ['Europe']) to get its children
    groupKeys: List[str] 
    # Filters active globally
    filterModel: Dict[str, FilterModel] = {}
    # Sorting
    sortModel: List[SortModel] = []
    # If using "Split By" (Pivot Columns)
    pivotCols: List[str] = []
    # Start/End for pagination WITHIN the group children (virtual scrolling inside a node)
    startRow: int = 0
    endRow: int = 100

