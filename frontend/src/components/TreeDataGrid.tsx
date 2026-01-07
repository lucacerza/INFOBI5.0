import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery } from 'react-query'; // Simulate React Query usage
import { 
  useReactTable, 
  flexRender,
  getCoreRowModel, 
  getExpandedRowModel, 
  ColumnDef, 
  ExpandedState,
  Row
} from '@tanstack/react-table';
import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import api, { reportsApi } from '../services/api';

interface TreeDataGridProps {
  reportId: number;
  rowGroups: string[];   // e.g. ['Region', 'Country']
  valueCols: string[];   // e.g. ['Sales', 'Profit']
  pivotCols?: string[];  // e.g. ['Year'] (Optional Matrix Mode)
}

export default function TreeDataGrid({ reportId, rowGroups, valueCols, pivotCols = [] }: TreeDataGridProps) {
  // --- STATE ---
  const [data, setData] = useState<any[]>([]); // Root level data (Wide format)
  const [expanded, setExpanded] = useState<ExpandedState>({});
  
  // Custom "Lazy" Loading State to track which rows are loading children
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});

  // Dynamic headers for Pivot Mode (e.g. ['2023', '2024'])
  // If we have multiple pivot cols, this would normally be a Tree too, simplified for single level now.
  const [pivotHeaders, setPivotHeaders] = useState<string[]>([]);

  // --- HELPER: Transform Long Data to Wide Data ---
  const transformToWide = useCallback((rows: any[]) => {
    if (!pivotCols || pivotCols.length === 0) return rows;

    // Group by key_val (The row identifier)
    const groupedMap = new Map<string, any>();

    rows.forEach(row => {
      const key = row.key_val; // The group value (e.g. "Europe")
      
      if (!groupedMap.has(key)) {
         // Initialize with basic info
         const baseRow: any = { key_val: key };
         // Copy other non-pivot properties if any needed? 
         // Actually, distinct properties like 'Region' are not in row yet, just 'key_val'
         groupedMap.set(key, baseRow);
      }
      
      const existing = groupedMap.get(key);
      
      // CREATE DYNAMIC KEYS: e.g. "2023_Sales"
      // Construct the pivot key part
      const pivotVal = pivotCols.map(p => row[p]).join("_"); 
      
      valueCols.forEach(v => {
         const dynamicKey = `${pivotVal}_${v}`;
         existing[dynamicKey] = row[v];
      });
    });

    return Array.from(groupedMap.values());
  }, [pivotCols, valueCols]);


  // --- API CALLER ---
  // Function to fetch children for a specific node path
  const fetchChildren = async (nodePath: string[], parentRow: Row<any>) => {
    const nodeId = parentRow.id;
    
    // Avoid double fetching
    if (loadingNodes[nodeId] || parentRow.original.subRows?.length > 0) return;

    setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));

    try {
      const response = await api.post(`/reports/${reportId}/pivot-drill`, {
        rowGroupCols: rowGroups,
        groupKeys: nodePath, // The path to the parent we are expanding
        valueCols: valueCols.map(v => ({ colId: v, aggFunc: 'sum' })),
        pivotCols: pivotCols, // Pass the split columns
        filterModel: {}, // Global filters would go here
      });

      // Transform API rows (Long) to TanStack structure (Wide) if needed
      let fetchedRows = response.data.rows;
      if (pivotCols.length > 0) {
          fetchedRows = transformToWide(fetchedRows);
      }

      const newChildren = fetchedRows.map((r: any) => ({
        ...r,
        // Mark as having children if we aren't at the deepest level yet
        subRows: nodePath.length + 1 < rowGroups.length ? [] : undefined 
      }));

      // Recursive function to find the parent in 'data' and attach children
      // (For huge datasets, a flat map or normalized store is better, strictly for demo:)
      const updateData = (nodes: any[], path: string[], depth: number): any[] => {
         return nodes.map(node => {
            // Match the node by the key value at this depth
            if (node.key_val === path[depth]) {
                if (depth === path.length - 1) {
                    // Found the parent! Attach children
                    return { ...node, subRows: newChildren };
                } else {
                    // Go deeper
                    return { ...node, subRows: updateData(node.subRows || [], path, depth + 1) };
                }
            }
            return node;
         });
      };

      setData(prevData => updateData(prevData, nodePath, 0));
      
    } catch (err) {
      console.error("Failed to load children", err);
    } finally {
      setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  // --- INITIAL LOAD (ROOT LEVEL + HEADERS) ---
  useEffect(() => {
    const initGrid = async () => {
       if (rowGroups.length === 0) return;
       
       try {
         // 1. If Pivot Mode, Fetch Headers first
         if (pivotCols.length > 0) {
            // Assume single pivot col for now or take first
            // To support multiple, we'd need Cartesian product of values
            const pCol = pivotCols[0]; 
            const values = await reportsApi.getColumnValues(reportId, pCol);
            setPivotHeaders(values); 
         } else {
            setPivotHeaders([]);
         }

         // 2. Fetch Root Data
         const response = await api.post(`/reports/${reportId}/pivot-drill`, {
            rowGroupCols: rowGroups,
            groupKeys: [], // Empty for root
            valueCols: valueCols.map(v => ({ colId: v, aggFunc: 'sum' })),
            pivotCols: pivotCols
         });
         
         let rootRows = response.data.rows;
         if (pivotCols.length > 0) {
             rootRows = transformToWide(rootRows);
         }

         const formattedRows = rootRows.map((r: any) => ({
             ...r,
             subRows: [] // Initialize empty subRows to indicate expandable
         }));
         setData(formattedRows);

       } catch (e) { console.error(e); }
    };
    initGrid();
  }, [reportId, rowGroups, valueCols, pivotCols]); // Re-fetch all if config changes


  // --- COLUMNS DEFINITION ---
  const columns = useMemo<ColumnDef<any>[]>(() => {
    // 1. The "Group" Column (The tree structure)
    const groupCol: ColumnDef<any> = {
      id: 'group_col',
      header: ({ table }) => (
        <span className="flex items-center gap-1 text-blue-800 font-bold">
             {rowGroups.join(" > ")}
        </span>
      ),
      size: 250,
      accessorFn: row => row.key_val, // The generic key from backend
      cell: ({ row, getValue }) => {
        return (
          <div 
             className="flex items-center gap-1 cursor-pointer select-none"
             style={{ paddingLeft: `${row.depth * 20}px` }}
             onClick={async (e) => {
                 // Toggle Expansion
                 const isExpanded = row.getIsExpanded();
                 
                 if (!isExpanded && row.depth < rowGroups.length - 1) {
                    // About to expand -> Fetch Data!
                    // Construct path: e.g. ['Europe', 'Italy']
                    const path = [];
                    let curr = row;
                    while (curr.depth >= 0) {
                        // Traverse up to build path (TanStack rows have parent ref)
                        // Simplified path building for this structure:
                        path.unshift(curr.original.key_val);
                        // Cast to any because 'parent' is not strictly in Row<T> but exists in model
                        curr = (curr as any).parent;
                        if (!curr) break;
                    }
                    await fetchChildren(path, row);
                 }
                 row.toggleExpanded(); 
             }}
          >
            {row.getCanExpand() ? (
                <button className="p-0.5 rounded hover:bg-gray-200">
                    {loadingNodes[row.id] ? (
                        <Loader2 size={14} className="animate-spin text-blue-500"/>
                    ) : row.getIsExpanded() ? (
                        <ChevronDown size={16} />
                    ) : (
                        <ChevronRight size={16} />
                    )}
                </button>
            ) : <span className="w-4" />} {/* Spacer for leaf nodes */}
            
            <span className="font-medium text-gray-700 truncate" title={getValue() as string}>{getValue() as string}</span>
          </div>
        );
      },
    };

    // 2. Value Columns
    let generatedCols: ColumnDef<any>[] = [];

    if (pivotCols.length > 0 && pivotHeaders.length > 0) {
        // MATRIX COLUMNS:
        // For each distinct pivot value (e.g. 2023), create columns for each Metric (e.g. Sales)
        generatedCols = pivotHeaders.flatMap(pHeader => 
            valueCols.map(metric => ({
                id: `${pHeader}_${metric}`,
                header: () => (
                    <div className="flex flex-col items-center">
                         <span className="text-[10px] text-gray-400 font-normal">{pHeader}</span>
                         <span>{metric}</span>
                    </div>
                ),
                accessorKey: `${pHeader}_${metric}`, // Matching the transformToWide logic
                cell: info => {
                   const val = info.getValue() as number;
                   return <span className={`font-mono ${val ? 'text-gray-700' : 'text-gray-300'}`}>
                     {val ? val.toLocaleString() : '-'}
                   </span>
                } 
            }))
        );
    } else {
        // FLAT COLUMNS (Standard Drill-Down)
        generatedCols = valueCols.map(col => ({
            header: col,
            accessorKey: col,
            cell: info => <span className="font-mono text-gray-600">{(info.getValue() as number)?.toLocaleString()}</span>
        }));
    }

    return [groupCol, ...generatedCols];
  }, [rowGroups, valueCols, pivotCols, pivotHeaders, loadingNodes, data]);


  // --- TABLE INSTANCE ---
  const table = useReactTable({
    data,
    columns,
    state: {
      expanded,
    },
    onExpandedChange: setExpanded,
    getSubRows: row => row.subRows, // Accessor for children
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(), // Required for tree view
    manualPagination: true,
    debugTable: true,
  });

  return (
    <div className="h-full overflow-auto border rounded bg-white">
      <table className="w-full text-left border-collapse text-sm">
        <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id} className="p-2 font-semibold text-gray-600 border-b border-r">
                   {header.isPlaceholder ? null : (
                      <div>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </div>
                   )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id} className="hover:bg-blue-50/50 border-b border-gray-100 transition-colors">
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="p-2 border-r">
                   {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.getRowModel().rows.length === 0 && (
         <div className="p-8 text-center text-gray-400 italic">
            Nessun dato caricato. Trascina le colonne per raggruppare.
         </div>
      )}
    </div>
  );
}

// Helper needed because I didn't import flexRender in the file top
// Removed duplicate imports and placed them at the top
