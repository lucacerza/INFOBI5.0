import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { tableFromIPC } from 'apache-arrow';
import { PivotTable } from './PivotTable';
import { buildPivotHierarchy } from '../utils/pivotLogic';
import api from '../services/api';
import { useDashboardStore } from '../stores/dashboardStore';

interface PivotConfig {
  group_by: string[];
  split_by: string[];
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
  const { activeFilters, setFilter } = useDashboardStore(); // Store Hook
  
  // Two modes: 
  // 1. Flat Data (Client-side aggregation - legacy/small data)
  const [flatData, setFlatData] = useState<any[]>([]);
  // 2. Tree Data (Server-side lazy loading)
  const [treeData, setTreeData] = useState<any[]>([]);
  const [grandTotal, setGrandTotal] = useState<any>(null); // New Grand Total State
  const [lazySplitCols, setLazySplitCols] = useState<string[]>([]);
  const [config, setConfig] = useState<PivotConfig>({
    group_by: [],
    split_by: [],
    metrics: [],
    filters: {}
  });

  const isLazy = true; // Enabled by default now

  // Load Schema & Initial Data
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setTreeData([]); 
        setFlatData([]);

        // 1. Fetch Schema
        const { data: schemaData } = await api.get(`/pivot/${reportId}/schema`);
        
        if (mounted) {
            // Merge Dashboard Global Filters with Report Filters
            const globalFilters = Object.entries(activeFilters).reduce((acc, [key, val]) => {
                acc[key] = { value: val.value, type: 'equals' }; // Simplified mapping
                return acc;
            }, {} as Record<string, any>);

            const newConfig = {
                group_by: schemaData.default_group_by || [],
                split_by: schemaData.layout?.split_by || [],
                metrics: schemaData.default_metrics || [],
                filters: { ...globalFilters } // Initial merge
            };
            setConfig(newConfig);

            // 2. Initial Fetch (Root Level)
            if (isLazy) {
                // Fetch independent Grand Total (No grouping)
                await loadGrandTotal(newConfig, globalFilters);

                // Determine if we have any grouping.
                if (newConfig.group_by.length > 0) {
                   await loadLazyLevel(newConfig, globalFilters, 0); // Pass global filters
                } else {
                   await loadFlatData(newConfig, globalFilters);
                }
            } else {
                await loadFlatData(newConfig, globalFilters);
            }
        }
      } catch (err: any) {
        if (mounted) setError(err.message || "Failed to load pivot schema");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [reportId, activeFilters]); // Refetch when activeFilters change

  // --- LAZY LOADING LOGIC ---
  
  const loadGrandTotal = async (currentConfig: PivotConfig, filters: Record<string, any>) => {
      // Grand total query: No Group By, Same Filters, Same Metrics.
      // If splitBy exists, we might get multiple rows (one per split).
      // We will aggregate them client side for the simple "Total Row" or pass array.
      // For simplicity, let's assume currently we just want the absolute global totals if no split.
      // If split exists, we probably want one row with columns for each split.
      
      const requestBody = {
          group_by: [], // No grouping = Grand Total
          split_by: currentConfig.split_by[0] || null,
          metrics: currentConfig.metrics,
          filters: filters,
          sort: []
      };

      try {
          const res = await api.post(`/pivot/${reportId}`, requestBody, {
              responseType: 'arraybuffer'
          });
          const table = tableFromIPC(res.data);
          const rows = table.toArray().map(r => r.toJSON());
          
          if (rows.length > 0) {
              // If splitBy is active, rows will contain multiple entries (one per split value).
              // We can pass this raw list to PivotTable and let it format the "Total Row" using buildGroupedColumns logic or similar.
              setGrandTotal(rows);
          }
      } catch (err) {
          console.error("Failed to load Grand Total", err);
      }
  };

  const loadLazyLevel = async (currentConfig: PivotConfig, parentFilters: Record<string, any>, depth: number, parentNodeId: string | null = null) => {
      const groupCol = currentConfig.group_by[depth];
      if (!groupCol) return; 

      const nextDepth = depth + 1;
      const hasMoreLevels = nextDepth < currentConfig.group_by.length;

      // Merge Filters: Report Config + Parent Context + Dashboard Global
      // Note: parentFilters argument usually comes from drill-down context (Years=2023)
      // We also need to ensure activeFilters are applied to EVERY level query.
      
      const dashboardFilters = Object.entries(activeFilters).reduce((acc, [key, val]) => {
         acc[key] = { value: val.value, type: 'equals' };
         return acc;
      }, {} as Record<string, any>);
      
      const combinedFilters = { 
          ...currentConfig.filters, 
          ...dashboardFilters,
          ...parentFilters 
      };

      // Request only THIS level
      const requestBody = {
        group_by: [groupCol], 
        split_by: currentConfig.split_by[0] || null,
        metrics: currentConfig.metrics,
        filters: combinedFilters,
        sort: []
      };

      try {
        const res = await api.post(`/pivot/${reportId}`, requestBody, {
            responseType: 'arraybuffer'
        });

        const table = tableFromIPC(res.data);
        const rows = table.toArray().map(r => r.toJSON());
        
        // Use pivotLogic helper to organize these rows into nodes (handling splitBy aggregation)
        const metricNames = currentConfig.metrics.map(m => m.field);
        
        // buildPivotHierarchy returns Root -> [Nodes]
        // We only care about [Nodes] (the children of the temporary root)
        const { tree: chunkTree, splitColumns } = buildPivotHierarchy(rows, [groupCol], currentConfig.split_by, metricNames);
        
        // chunkTree[0] is the "Grand Total". We want its children.
        const nodes = chunkTree[0]?.subRows || [];

        // Post-process nodes
        const processNodes = (n: any) : any => {
            return {
                ...n,
                _depth: depth + 1, // Visual depth
                _hasChildren: hasMoreLevels, 
                subRows: [] // Start empty
            };
        };

        const processedNodes = nodes.map(processNodes);

        // Update Tree Data
        if (parentNodeId === null) {
             // Root load
             setTreeData(processedNodes);
        } else {
             // Append to parent
             setTreeData(prev => {
                // Deep clone to safely mutate
                const updateTree = (list: any[]): any[] => {
                    return list.map(node => {
                        if (node._id === parentNodeId) {
                            // Fix children IDs to include parent path
                            const childrenWithPaths = processedNodes.map((child: any) => ({
                                ...child,
                                _id: `${parentNodeId}|||${child._label}`
                            }));
                            return { 
                                ...node, 
                                subRows: childrenWithPaths
                            };
                        }
                        if (node.subRows && node.subRows.length > 0) {
                            return { ...node, subRows: updateTree(node.subRows) };
                        }
                        return node;
                    });
                };
                
                return updateTree(prev);
            });
        }
        
        setLazySplitCols(prev => Array.from(new Set([...prev, ...splitColumns])).sort());

      } catch (err) {
          console.error("Lazy Load Error", err);
      }
  };

  const handleExpand = (node: any) => {
      // If node already has fetched children, don't refetch
      if (node.subRows && node.subRows.length > 0) return;

      // Node depth indicates which group level it belongs to
      // Root children (Year) have depth 1. They map to group_by[0].
      // We want to load group_by[1].
      // So index to load is `node._depth`.
      // Example: Year (depth 1) -> expand -> load group_by[1] (Supplier)
      
      const nextLevelIndex = node._depth;
      
      const pathParts = String(node._id).split("|||");
      const filters: Record<string, any> = {};
      
      // Reconstruct filters from path
      pathParts.forEach((part, index) => {
          if (index < config.group_by.length) {
              const col = config.group_by[index];
              filters[col] = { value: part, type: 'equals' }; 
          }
      });

      loadLazyLevel(config, filters, nextLevelIndex, node._id);
  };

  const loadFlatData = async (currentConfig: PivotConfig, globalFilters: Record<string, any> = {}) => {
    
    // Merge filters
    const combinedFilters = {
       ...currentConfig.filters,
       ...globalFilters
    };

    const requestBody = {
        group_by: currentConfig.group_by,
        split_by: currentConfig.split_by[0] || null,
        metrics: currentConfig.metrics,
        filters: combinedFilters,
        sort: []
    };

    try {
        const res = await api.post(`/pivot/${reportId}`, requestBody, {
            responseType: 'arraybuffer'
        });
        const table = tableFromIPC(res.data);
        const rows = table.toArray().map(r => r.toJSON());
        setFlatData(rows);
    } catch (err: any) {
        throw new Error(err.response?.data?.detail || err.message);
    }
  };

  const handleFilter = (filterContext: Record<string, any>) => {
      // Set global filters based on context
      Object.entries(filterContext).forEach(([field, value]) => {
          setFilter(field, value);
      });
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500 gap-2">
        <AlertTriangle size={32} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      )}

      {isLazy ? (
          <PivotTable 
            treeData={treeData} 
            grandTotal={grandTotal}
            groupBy={config.group_by}
            splitBy={config.split_by}
            splitColumnValues={lazySplitCols}
            metrics={config.metrics.map(m => ({ field: m.field, aggregation: m.aggregation || 'SUM' }))}
            onExpand={handleExpand}
            onFilter={handleFilter}
            isLoading={isLoading}
          />
      ) : (
          <PivotTable 
            data={flatData}
            groupBy={config.group_by}
            splitBy={config.split_by}
            metrics={config.metrics.map(m => ({ field: m.field, aggregation: m.aggregation || 'SUM' }))}
          />
      )}
    </div>
  );
}
