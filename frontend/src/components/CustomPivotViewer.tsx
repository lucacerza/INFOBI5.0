import { useEffect, useState, useMemo } from 'react';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { tableFromIPC } from 'apache-arrow';
import { PivotTable } from './PivotTable';
import { buildPivotHierarchy } from '../utils/pivotLogic';
import api from '../services/api';

interface PivotConfig {
  group_by: string[];
  split_by: string[]; // Made array for consistency
  metrics: Array<{
    name: string;
    field: string;
    type: string;
    aggregation?: string;
  }>;
  filters: Record<string, any>;
}

interface CustomPivotViewerProps {
  reportId: number;
  className?: string;
}

export default function CustomPivotViewer({ reportId, className = '' }: CustomPivotViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [schema, setSchema] = useState<any>(null);
  const [config, setConfig] = useState<PivotConfig>({
    group_by: [],
    split_by: [],
    metrics: [],
    filters: {}
  });

  // Load Schema & Initial Data
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // 1. Fetch Schema
        const { data: schemaData } = await api.get(`/pivot/${reportId}/schema`);
        
        if (mounted) {
            setSchema(schemaData);
            
            // Set defaults
            const newConfig = {
                group_by: schemaData.default_group_by || [],
                split_by: [], // TODO: Where to get default split?
                metrics: schemaData.default_metrics || [],
                filters: {}
            };
            setConfig(newConfig);

            // 2. Fetch Data
            await loadData(newConfig);
        }
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load pivot schema");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [reportId]);

  const loadData = async (currentConfig: PivotConfig) => {
    // Prepare request body
    // Backend expects: group_by, split_by, metrics, filters, sort
    // Adjust split_by to string if backend expects string
    const requestBody = {
        group_by: currentConfig.group_by,
        split_by: currentConfig.split_by[0] || null, // Backend currently takes single split string?
        metrics: currentConfig.metrics,
        filters: currentConfig.filters,
        sort: [] // TODO: Add sort support
    };

    try {
        const res = await api.post(`/pivot/${reportId}`, requestBody, {
            responseType: 'arraybuffer'
        });

        // Read Arrow Stream
        const arrayBuffer = res.data;
        const table = tableFromIPC(arrayBuffer); // Apache Arrow handles ArrayBuffer
        const rows = table.toArray().map(r => r.toJSON());
        
        console.log("Loaded Rows:", rows.length);
        setData(rows);
    } catch (err: any) {
        throw new Error(err.response?.data?.detail || err.message || "Error loading pivot data");
    }
  };

  // Transform Data for PivotTable
  const { treeData, columns } = useMemo(() => {
    if (!data.length || !config) return { treeData: [], columns: [] };

    // Use our logic to build the tree
    // metrics list of field names
    const metricFields = config.metrics.map(m => m.name || m.field); // pivot logic needs identification
    
    // Call the builder
    const { tree, splitColumns } = buildPivotHierarchy(
        data, 
        config.group_by, 
        config.split_by, 
        metricFields
    );
    
    return { treeData: tree, splitColumns };
  }, [data, config]);


  if (isLoading && !data.length) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 border rounded-lg ${className}`}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-500">Caricamento Pivot...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-red-50 border border-red-200 rounded-lg p-6 ${className}`}>
        <AlertTriangle className="w-10 h-10 text-red-500 mb-2" />
        <h3 className="text-lg font-semibold text-red-700">Errore Caricamento</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-white border border-red-300 rounded text-red-700 hover:bg-red-50"
        >
            Riprova
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
        {/* Controls / Config Bar could go here */}
        
        <div className="flex-1 overflow-hidden relative">
            <PivotTable 
                data={data} // Passing raw data? No, PivotTable expects prepared data? 
                // Wait, PivotTable implementation I wrote took (data, groupBy, splitBy) and did memo inside.
                // But specifically for 'buildPivotHierarchy', I put it in a utility. 
                // Let's verify PivotTable.tsx content.
                // PivotTable.tsx: "const { tableData, tableColumns } = useMemo(...)".
                // It calls "Placeholder transformation logic".
                // I should update PivotTable.tsx to use the Real Logic from props or utility.
                
                // Let's pass the raw props and let PivotTable use the utility, 
                // OR process here and pass Processed data.
                // The PivotTable I wrote earlier had 'data' prop as "any[] // Raw flat data".
                // So I can pass 'data' (the flat rows) and 'groupBy'/'splitBy'.
                // And inside PivotTable I should import 'buildPivotHierarchy'.
                
                groupBy={config.group_by}
                splitBy={config.split_by}
                metrics={config.metrics.map(m => ({ field: m.name || m.field, aggregation: m.aggregation || 'SUM' }))}
            />
        </div>
        
        {/* Footer Stats */}
        <div className="bg-white border-t p-2 text-xs text-gray-500 flex justify-between">
            <span>Righe: {data.length.toLocaleString()}</span>
            <span>Raggruppamenti: {config.group_by.join(', ') || 'Nessuno'}</span>
        </div>
    </div>
  );
}
