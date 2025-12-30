/**
 * PerspectiveViewer Component
 * 
 * KEY FEATURE: Perspective.js is used ONLY for visualization.
 * All calculations (including margins) are done on the server via /api/pivot endpoint.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import debounce from 'lodash.debounce';
import perspective from '@finos/perspective';
import '@finos/perspective-viewer';
import '@finos/perspective-viewer-datagrid';
import '@finos/perspective-viewer-d3fc';
import '@finos/perspective-viewer/dist/css/themes.css';
import { Loader2, RefreshCw } from 'lucide-react';

interface PerspectiveViewerProps {
  reportId: number;
  className?: string;
  onConfigChange?: (config: any) => void;
}

interface PivotConfig {
  group_by: string[];
  split_by: string | null;
  metrics: Array<{
    name: string;
    field: string;
    type: string;
    aggregation?: string;
  }>;
  filters: Record<string, any>;
}

export default function PerspectiveViewer({ 
  reportId, 
  className = '',
  onConfigChange 
}: PerspectiveViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const workerRef = useRef<any>(null);
  const tableRef = useRef<any>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });
  const [schema, setSchema] = useState<any>(null);
  const [currentConfig, setCurrentConfig] = useState<PivotConfig>({
    group_by: [],
    split_by: null,
    metrics: [],
    filters: {}
  });

  // Initialize Perspective worker (once)
  useEffect(() => {
    workerRef.current = perspective.worker();
    return () => {
      if (tableRef.current) tableRef.current.delete();
      if (workerRef.current) workerRef.current.terminate();
    };
  }, []);

  // Load schema on mount
  useEffect(() => {
    loadSchema();
  }, [reportId]);

  // Debounced pivot request
  const debouncedPivotRequest = useCallback(
    debounce(async (config: PivotConfig) => {
      await executePivot(config);
    }, 300), // 300ms debounce
    [reportId]
  );

  const loadSchema = async () => {
    try {
      const response = await fetch(`/api/pivot/${reportId}/schema`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load schema');
      
      const data = await response.json();
      setSchema(data);
      
      // Set initial config from defaults
      setCurrentConfig({
        group_by: data.default_group_by || [],
        split_by: null,
        metrics: data.default_metrics || [],
        filters: {}
      });
      
      // Load initial data
      await executePivot({
        group_by: data.default_group_by || [],
        split_by: null,
        metrics: data.default_metrics || [],
        filters: {}
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const executePivot = async (config: PivotConfig) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const startTime = performance.now();
      
      const response = await fetch(`/api/pivot/${reportId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(config)
      });
      
      if (!response.ok) throw new Error('Pivot request failed');
      
      const queryTime = parseFloat(response.headers.get('X-Query-Time') || '0');
      const cached = response.headers.get('X-Cache-Hit') === 'true';
      const rowCount = response.headers.get('X-Row-Count');
      
      // Get Arrow data
      const arrayBuffer = await response.arrayBuffer();
      
      // Load into Perspective
      if (tableRef.current) {
        tableRef.current.delete();
      }
      
      tableRef.current = await workerRef.current.table(arrayBuffer);
      
      if (viewerRef.current) {
        await viewerRef.current.load(tableRef.current);
        
        // Configure viewer for flat display (data is already aggregated)
        await viewerRef.current.restore({
          plugin: 'Datagrid',
          columns: schema?.columns?.map((c: any) => c.name).filter((n: string) => n !== '_level') || [],
          sort: [],
          filter: [],
          group_by: [], // NO client-side grouping - data is pre-grouped!
          split_by: [],
          expressions: [], // NO expressions - margins are pre-calculated!
          aggregates: {}
        });
      }
      
      setStats({
        rows: parseInt(rowCount || '0'),
        time: queryTime,
        cached
      });
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigChange = (field: keyof PivotConfig, value: any) => {
    const newConfig = { ...currentConfig, [field]: value };
    setCurrentConfig(newConfig);
    debouncedPivotRequest(newConfig);
    onConfigChange?.(newConfig);
  };

  const handleRefresh = () => {
    executePivot(currentConfig);
  };

  // Setup viewer element
  useEffect(() => {
    if (!containerRef.current) return;
    
    const viewer = document.createElement('perspective-viewer');
    viewer.setAttribute('theme', 'Pro Light');
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(viewer);
    viewerRef.current = viewer;
    
    // Handle viewer config changes (only for visual settings)
    viewer.addEventListener('perspective-config-update', () => {
      // We don't use these for pivot - server handles that
      // But we could save visual preferences
    });
    
    return () => {
      containerRef.current?.removeChild(viewer);
    };
  }, []);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b bg-white">
        <div className="flex items-center gap-4">
          {/* Group By selector */}
          {schema && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-600">Raggruppa:</span>
              <select
                multiple
                value={currentConfig.group_by}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions, o => o.value);
                  handleConfigChange('group_by', values);
                }}
                className="border rounded px-2 py-1 text-sm min-w-[150px] h-[60px]"
              >
                {schema.columns
                  .filter((c: any) => c.type === 'string')
                  .map((c: any) => (
                    <option key={c.name} value={c.name}>{c.label}</option>
                  ))
                }
              </select>
            </div>
          )}
          
          {/* Metrics selector */}
          {schema && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-600">Metriche:</span>
              <select
                multiple
                value={currentConfig.metrics.map(m => m.name)}
                onChange={(e) => {
                  const names = Array.from(e.target.selectedOptions, o => o.value);
                  const metrics = names.map(name => {
                    // Check if it's an available metric (like margin)
                    const available = schema.available_metrics?.find((m: any) => m.name === name);
                    if (available) return available;
                    
                    // Otherwise it's a simple column
                    return {
                      name: name,
                      field: name,
                      type: 'sum',
                      aggregation: 'SUM'
                    };
                  });
                  handleConfigChange('metrics', metrics);
                }}
                className="border rounded px-2 py-1 text-sm min-w-[150px] h-[60px]"
              >
                {/* Available calculated metrics (margins etc) */}
                {schema.available_metrics?.map((m: any) => (
                  <option key={m.name} value={m.name}>📊 {m.name}</option>
                ))}
                {/* Numeric columns */}
                {schema.columns
                  .filter((c: any) => c.type === 'number')
                  .map((c: any) => (
                    <option key={c.name} value={c.name}>{c.label}</option>
                  ))
                }
              </select>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {stats.cached && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">CACHE</span>
            )}
            <span>{stats.rows.toLocaleString()} righe</span>
            <span className="text-green-600 font-medium">{stats.time}ms</span>
          </div>
          
          {/* Actions */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 rounded-lg transition"
            title="Aggiorna"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      
      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}
      
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-10">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      )}
      
      {/* Perspective container */}
      <div 
        ref={containerRef}
        className="flex-1 relative"
        style={{ minHeight: '400px' }}
      />
    </div>
  );
}
