import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { buildPivotHierarchy } from "../utils/pivotLogic";
import { ArrowDown, ArrowRight } from "lucide-react";

// Types for our custom pivot
export interface PivotProps {
  data?: any[]; // Raw flat data
  treeData?: any[]; // Pre-built tree data (for lazy loading)
  grandTotal?: any[]; // Grand Total Rows
  groupBy: string[];
  splitBy: string[];
  splitColumnValues?: string[]; // Unique values for split columns (needed for lazy mode)
  metrics: { field: string; aggregation: string; type?: string; format?: string }[];
  onExpand?: (node: any) => void;
  onFilter?: (filterContext: Record<string, any>) => void; // Filter callback
  isLoading?: boolean;
}

const formatValue = (value: any, metric: { type?: string; format?: string }) => {
    if (value == null) return "-";
    if (typeof value !== 'number') return value;

    if (metric.type === 'currency' || metric.format === 'currency') {
        return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value);
    }
    if (metric.type === 'percent' || metric.type === 'margin' || metric.format === 'percent') {
        return new Intl.NumberFormat('it-IT', { style: 'percent', minimumFractionDigits: 2 }).format(value / 100); 
        // Assuming data comes as 25.5 for 25.5%, or 0.255? 
        // Backend margin calculation: ROUND of (..)*100. So 25.50. So divide by 100 if style=percent expects 0-1.
        // Wait, standard JS Percent expects 0-1. My backend returns 0-100 usually for margins.
        // Let's assume backend returns 25.5. I should just format as number + "%" if the value is > 1.
        // Or if I use style='percent', I must divide by 100.
        // Safe bet: if value is > 1 and type is percent, divide by 100? No, 200% exists.
        // Let's just append "%" if style is percent but not use Intl 'percent' which multiplies by 100.
        
        return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2 }).format(value) + "%";
    }
    
    return new Intl.NumberFormat('it-IT').format(value);
};

// Helper to recursively build grouped columns
function buildGroupedColumns(
  metrics: { field: string; aggregation: string; type?: string }[],
  splitColumns: string[],
  colWidths: Record<string, number>
): ColumnDef<any>[] {
  const result: ColumnDef<any>[] = [];
  const rootGroup: { [key: string]: any } = {};

  // 1. Build a Tree from split signatures
  splitColumns.forEach((sig) => {
    const parts = sig.split("|||");
    let current = rootGroup;
    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
      if (index === parts.length - 1) {
        current.__leaf = true; // Marker
        current.__fullSig = sig; // Store full signature for accessor
      }
    });
  });

  // 2. Recursive function to convert Tree to ColumnDefs
  function recurse(level: any, parentKey: string = ""): ColumnDef<any>[] {
    return Object.keys(level).map((key) => {
      if (key === "__leaf" || key === "__fullSig") return null;

      const node = level[key];
      // If leaf (lowest split level -> show metrics)
      if (node.__leaf) {
        return {
          id: `${node.__fullSig}_${key}`,
          header: key,
          columns: metrics.map((metric) => {
             const keyPart = `${node.__fullSig}_${metric.field}`;
             // Get calculated Width!
             const calculatedSize = colWidths[keyPart] || 100;

             return {
                accessorKey: keyPart,
                header: metric.field,
                size: calculatedSize,
                cell: (info) => (
                    <div className="text-right tabular-nums text-[10px] w-full px-1 truncate pointer-events-none">
                         {formatValue(info.getValue(), metric)}
                    </div>
                ),
             };
          })
        };
      }

      // Group Header
      return {
        id: `group_${parentKey}_${key}`,
        header: key,
        columns: recurse(node, key),
      };
    }).filter(Boolean) as ColumnDef<any>[];
  }

  return recurse(rootGroup);
}

export function PivotTable({ data, treeData, grandTotal, groupBy, splitBy, splitColumnValues, metrics, onExpand, onFilter, isLoading }: PivotProps) {
  const [expanded, setExpanded] = useState({ root: true });
  const [columnSizing, setColumnSizing] = useState({}); // Resizing State

  // 1. Build Data & Stats
  const { tableData, tableColumns } = useMemo(() => {
    // LAZY / TREE MODE
    if (treeData) {
        // Reuse similar column logic but skip hierarchy building
        // We need to calculate columns based on metrics and (potentially) splitBy found in tree
        // For now, assume splitBy logic is similar or we use what we have.
        // We do need `colWidths` logic here too if we want auto-sizing.
        // For lazy loading, we might just use fixed widths or Recalculate based on visible.
        
        // Dynamic Columns creation
        const cols: ColumnDef<any>[] = [];

        // Hierarchy Column
        if (groupBy.length > 0) {
            cols.push({
                id: 'hierarchy',
                header: '',
                accessorFn: row => row._label,
                size: 250, 
                cell: ({ row }) => {
                    const label = String(row.original._label || "Total");
                    const cleanedLabel = label.includes("|||") ? label.split("|||").pop() : label;
                    const hasChildren = row.original._hasChildren || row.subRows?.length > 0;
                    
                    return (
                        <div
                            style={{
                                paddingLeft: `${row.depth * 1.25}rem`,
                            }}
                            className="flex items-center gap-1 w-full h-full group"
                        >
                            {/* Always show expander if it says it has children, even if local subRows are empty (Lazy) */}
                            {(hasChildren || row.getCanExpand()) ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        row.toggleExpanded();
                                        if (!row.getIsExpanded() && onExpand) {
                                            onExpand(row.original);
                                        }
                                    }}
                                    style={{ cursor: "pointer" }}
                                    className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500"
                                >
                                    {row.getIsExpanded() ? <ArrowDown size={10} /> : <ArrowRight size={10} />}
                                </button>
                            ) : (
                                <span className="w-4 flex-shrink-0"></span>
                            )}
                            <span 
                            className="font-medium text-gray-800 text-[10px] truncate cursor-pointer hover:underline hover:text-blue-600" 
                            title={`${label} (Click to Filter)`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (onFilter) {
                                    // Construct filter from path
                                    // Path is like "2023|||Q1|||January"
                                    // This maps to groupBy[0]=2023, groupBy[1]=Q1, groupBy[2]=January
                                    const parts = String(row.original._id).split("|||");
                                    const filterContext: Record<string, any> = {};
                                    parts.forEach((val, idx) => {
                                        if(groupBy[idx]) {
                                            filterContext[groupBy[idx]] = val;
                                        }
                                    });
                                    onFilter(filterContext);
                                }
                            }}
                            >
                                {cleanedLabel}
                            </span>
                        </div>
                    );
                }
            });
        }

        // Metrics & Splits for Lazy/Tree Mode
        if (splitBy.length > 0 && splitColumnValues && splitColumnValues.length > 0) {
            // Use same builder as client-side, but with empty width map for now
            const groupedCols = buildGroupedColumns(metrics, splitColumnValues, {});
            cols.push(...groupedCols);
        } else {
             metrics.forEach(metric => {
                cols.push({
                    accessorKey: metric.field,
                    header: metric.field,
                    size: 100,
                    cell: info => <div className="text-right tabular-nums text-[10px] w-full px-1 truncate">{formatValue(info.getValue(), metric)}</div>
                });
            });
        }
        
        return { tableData: treeData, tableColumns: cols };
    }

    // CLIENT SIDE MODE (Original)
    if (!data || data.length === 0) return { tableData: [], tableColumns: [] };

    // RAW DATA MODE / FLAT DIMENSION MODE
    // If no metrics are selected, the user wants to see the raw table data for the selected dimensions (Rows/Cols)
    // or all data if nothing is selected.
    if (metrics.length === 0) {
        const selectedDimensions = [...groupBy, ...splitBy];
        // If specific dimensions selected, show them. If NOT, show ALL raw keys from first row.
        const keysToShow = selectedDimensions.length > 0 ? selectedDimensions : Object.keys(data[0]);

        const rawCols = keysToShow.map(key => ({
            accessorKey: key,
            header: key,
            size: 150, 
            cell: (info: any) => {
                const val = info.getValue();
                return val === null || val === undefined ? "" : String(val);
            }
        }));
        
        // We use the raw 'data' array directly
        return { tableData: data, tableColumns: rawCols };
    }

    const metricNames = metrics.map(m => m.field);

    // Call PivotLogic - NOW RETURNS colWidths!
    const { tree, splitColumns, colWidths } = buildPivotHierarchy(data, groupBy, splitBy, metrics.map(m => m.field)); // Use metricNames?
    
    // Dynamic Columns creation
    const cols: ColumnDef<any>[] = [];
    
    // Hierarchy Column
    if (groupBy.length > 0) {
        const hierWidth = colWidths ? colWidths['hierarchy'] : 250;
        cols.push({
            id: 'hierarchy',
            header: '',
            accessorFn: row => row._label,
            size: hierWidth, 
            cell: ({ row }) => {
                const label = String(row.original._label || "Total");
                const cleanedLabel = label.includes("|||") ? label.split("|||").pop() : label;
                return (
                    <div
                        style={{
                            paddingLeft: `${row.depth * 1.25}rem`,
                        }}
                        className="flex items-center gap-1 w-full h-full"
                    >
                        {row.getCanExpand() ? (
                            <button
                                onClick={row.getToggleExpandedHandler()}
                                style={{ cursor: "pointer" }}
                                className="w-4 h-4 flex-shrink-0 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500"
                            >
                                {row.getIsExpanded() ? <ArrowDown size={10} /> : <ArrowRight size={10} />}
                            </button>
                        ) : (
                            <span className="w-4 flex-shrink-0"></span>
                        )}
                        <span className="font-medium text-gray-800 text-[10px] truncate" title={label}>
                             {cleanedLabel}
                        </span>
                    </div>
                );
            }
        });
    }

    // Metric columns
    if (splitBy.length > 0 && splitColumns.length > 0) {
        const groupedCols = buildGroupedColumns(metrics, splitColumns, colWidths || {});
        cols.push(...groupedCols);
    } else {
        metrics.forEach(metric => {
            cols.push({
                accessorKey: metric.field,
                header: metric.field,
                size: (colWidths && colWidths[metric.field]) || 100,
                cell: info => <div className="text-right tabular-nums text-[10px] w-full px-1 truncate">{formatValue(info.getValue(), metric)}</div>
            });
        });
    }

    return { tableData: tree, tableColumns: cols };
  }, [data, groupBy, splitBy, metrics]);


  const table = useReactTable({
    data: tableData,
    columns: tableColumns,
    getSubRows: (row) => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    defaultColumn: {
        size: 100, 
        minSize: 40,
        maxSize: 600,
    },
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
        expanded,
        columnSizing, 
    },
    onExpandedChange: setExpanded,
    onColumnSizingChange: setColumnSizing,
  });

  const { rows } = table.getRowModel();
  const flatHeaders = table.getFlatHeaders();
  const headerGroups = table.getHeaderGroups(); // Get header groups for multi-level headers

  // Vertical Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32, 
    overscan: 10,
  });

  const hasHierarchy = groupBy.length > 0;

  // Horizontal Virtualization
  // If hierarchy exists, we skip index 0 in virtualization and fix it to left.
  // If NO hierarchy, we virtualize everything from index 0.
  const columnVirtualizer = useVirtualizer({
      horizontal: true,
      count: hasHierarchy ? flatHeaders.length - 1 : flatHeaders.length, 
      getScrollElement: () => parentRef.current,
      estimateSize: (index) => flatHeaders[index + (hasHierarchy ? 1 : 0)]?.getSize() ?? 100, 
      overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems(); 
  
  const totalHeight = rowVirtualizer.getTotalSize();
  const virtualColsWidth = columnVirtualizer.getTotalSize();
  const hierarchyColWidth = hasHierarchy ? (flatHeaders[0]?.getSize() || 250) : 0;
  const totalWidth = hierarchyColWidth + virtualColsWidth;
  
  // Calculate total header height (32px * depth)
  const headerHeight = headerGroups.length * 32;

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto border border-gray-200 bg-white text-[10px]"
      style={{ isolation: "isolate" }} 
    >
        <div 
           style={{ 
               width: `${totalWidth}px`,
               height: `${totalHeight}px`,
               position: 'relative'
           }}
        >
            {/* Sticky Header Section */}
            <div 
                className="sticky top-0 z-30 bg-white shadow-sm border-b border-gray-200 flex flex-col" 
                style={{ width: `${totalWidth}px`, height: `${headerHeight}px` }}
            >
               {headerGroups.map((headerGroup, groupIndex) => {
                   // Optimization: Map ColumnID -> Header for this group to avoid O(N) lookup
                   // Note: headerGroup.headers contains the headers for THIS level.
                   const headerMap = new Map();
                   headerGroup.headers.forEach(h => headerMap.set(h.column.id, h));

                   // Calculate Segments for this Header Group based on Virtual Columns
                   const visibleSegments: any[] = [];
                   let currentSegment: any = null;

                   virtualColumns.forEach(virtualCol => {
                        const leafIndex = virtualCol.index + (hasHierarchy ? 1 : 0); 
                        const leafHeader = flatHeaders[leafIndex];
                        if (!leafHeader) return;

                        // Traverse up the COLUMN tree to find the column at this depth
                        let col = leafHeader.column;
                        while (col.depth > headerGroup.depth && col.parent) {
                            col = col.parent;
                        }
                        
                        // Now find the header for this column in the current group
                        const header = headerMap.get(col.id);
                        if (!header) return;

                        if (currentSegment && currentSegment.header.id === header.id) {
                            // Extend segment
                            currentSegment.width += virtualCol.size;
                        } else {
                            // New segment
                            if (currentSegment) visibleSegments.push(currentSegment);
                            currentSegment = {
                                header: header,
                                start: virtualCol.start,
                                width: virtualCol.size,
                                isLeaf: headerGroup.depth === headerGroups.length - 1
                            };
                        }
                   });
                   if (currentSegment) visibleSegments.push(currentSegment);

                   return (
                   <div key={headerGroup.id} className="flex relative" style={{ height: '32px', width: '100%' }}>
                       
                       {/* Fixed Hierarchy Header */}
                       {hasHierarchy && (
                       <div 
                            className="sticky left-0 z-40 bg-gray-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] flex items-center justify-center p-1 border-r border-gray-200 border-b font-bold text-gray-600 uppercase"
                            style={{ width: hierarchyColWidth, height: '100%' }}
                       >
                            {groupIndex === headerGroups.length - 1 ? 
                                flexRender(flatHeaders[0].column.columnDef.header, flatHeaders[0].getContext()) 
                                : '' 
                            }
                       </div>
                       )}

                       {/* Virtualized Headers */}
                       <div className="relative" style={{ width: virtualColsWidth, height: '100%' }}>
                           {visibleSegments.map((segment) => {
                                const header = segment.header;
                                const isSorted = header.column.getIsSorted();

                                return (
                                    <div
                                        key={header.id}
                                        className={`absolute top-0 flex items-center justify-center p-1 border-r border-b border-gray-200 bg-gray-50 font-bold text-gray-600 uppercase group select-none
                                            ${segment.isLeaf ? '' : 'bg-gray-100/50'}
                                            ${header.column.getCanSort() ? 'cursor-pointer hover:bg-gray-200' : ''}
                                        `}
                                        style={{
                                            left: segment.start,
                                            width: segment.width,
                                            height: '100%'
                                        }}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        <div className="w-full text-center truncate flex items-center justify-center gap-1">
                                             {flexRender(header.column.columnDef.header, header.getContext())}
                                             {/* Sort Indicators */}
                                             {{
                                                asc: <span className="text-blue-500">▲</span>,
                                                desc: <span className="text-blue-500">▼</span>,
                                              }[isSorted as string] ?? null}
                                        </div>

                                        {/* Resizer */}
                                        <div
                                            onMouseDown={header.getResizeHandler()}
                                            onTouchStart={header.getResizeHandler()}
                                            onClick={(e) => e.stopPropagation()}
                                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none hover:bg-blue-300 opacity-0 group-hover:opacity-100 ${
                                                header.column.getIsResizing() ? 'bg-blue-500 opacity-100' : ''
                                            }`}
                                        />
                                    </div>
                                );
                           })}
                       </div>
                   </div>
                   );
               })}
            </div>

            {/* Grand Total Row */}
            {grandTotal && grandTotal.length > 0 && (
                 <div 
                    className="sticky z-30 bg-yellow-50 border-b border-gray-300 font-bold text-gray-800 flex shadow-sm"
                    style={{ width: `${totalWidth}px`, height: '32px', top: `${headerHeight}px` }}
                 >
                     {/* Hierarchy Label for Total */}
                     {hasHierarchy && flatHeaders[0] && (
                        <div 
                            className="sticky left-0 z-40 bg-yellow-100/80 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] flex items-center px-4 border-r border-gray-300 h-full truncate"
                            style={{ width: hierarchyColWidth }}
                        >
                            GRAND TOTAL
                        </div>
                     )}

                     {/* Metric Values for Total */}
                     <div className="relative h-full" style={{ width: virtualColsWidth }}>
                        {virtualColumns.map((virtualCol) => {
                            const colIndex = virtualCol.index + (hasHierarchy ? 1 : 0);
                            const column = flatHeaders[colIndex];
                            
                            if (!column) return null; 

                            // Find value in grandTotal array
                            let value = "-";
                            const colId = column.id; 
                            
                            // Try multiple accessors
                            if (grandTotal.length === 1) {
                                // 1. Try exact ID
                                if (grandTotal[0][colId] !== undefined) value = grandTotal[0][colId];
                                // 2. Try only Field name (if no split)
                                else if (grandTotal[0][column.column.columnDef.header as string] !== undefined) value = grandTotal[0][column.column.columnDef.header as string];
                                // 3. For split cols "2022_Venduto", try to match
                            }
                            
                            const metricConfig = metrics.find(m => m.field === column.column.columnDef.header); 
                            
                            return (
                                <div
                                    key={`total_${colIndex}`}
                                    className="absolute top-0 flex items-center justify-end border-r border-gray-200 p-1 h-full text-right"
                                    style={{
                                        left: virtualCol.start,
                                        width: virtualCol.size
                                    }}
                                >
                                    {metricConfig ? formatValue(value, metricConfig) : value}
                                </div>
                            );
                        })}
                     </div>
                 </div>
            )}


            {/* Virtual Body */}
            <div className="relative" style={{ height: `${totalHeight}px` }}>
            {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const visibleCells = row.getVisibleCells();
                
                return (
                    <div
                        key={row.id}
                        className={`absolute left-0 w-full flex items-center border-b border-gray-100 hover:bg-blue-50 transition-colors
                            ${row.getIsExpanded() ? 'bg-blue-50/30' : ''}
                        `}
                        style={{
                            top: virtualRow.start, // Use top instead of translate for fewer composition layers
                            height: virtualRow.size,
                            width: `${totalWidth}px`
                        }}
                    >
                        {/* Fixed Hierarchy Cell */}
                        {hasHierarchy && visibleCells[0] && (
                            <div 
                                className="sticky left-0 z-20 bg-inherit shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] flex items-center border-r border-gray-100 p-1 h-full"
                                style={{ width: hierarchyColWidth, minWidth: hierarchyColWidth }}
                            >
                                {flexRender(visibleCells[0].column.columnDef.cell, visibleCells[0].getContext())}
                            </div>
                        )}

                        {/* Virtualized Metric Cells */}
                        <div className="relative h-full" style={{ width: virtualColsWidth }}>
                            {virtualColumns.map((virtualCol) => {
                                const colIndex = virtualCol.index + (hasHierarchy ? 1 : 0);
                                const cell = visibleCells[colIndex];
                                if (!cell) return null; // Safety check for cell
                                return (
                                    <div
                                        key={cell.id}
                                        className="absolute top-0 flex items-center border-r border-gray-100 p-1 h-full text-right justify-end"
                                        style={{
                                            left: virtualCol.start,
                                            width: virtualCol.size
                                        }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            </div>

            {/* Loading Overlay */}
            {isLoading && (
               <div className="sticky left-0 top-0 w-full h-[300px] z-50 pointer-events-none flex items-start justify-center pt-20">
                   <div className="bg-white/80 backdrop-blur px-6 py-4 rounded-full shadow-xl border border-blue-100 flex items-center gap-3">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-blue-600 font-medium">Updating...</span>
                   </div>
               </div>
            )}
        </div>
    </div>
  );
}
