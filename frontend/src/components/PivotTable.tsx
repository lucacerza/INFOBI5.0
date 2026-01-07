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
  groupBy: string[];
  splitBy: string[];
  metrics: { field: string; aggregation: string }[];
  onExpand?: (node: any) => void;
  isLoading?: boolean;
}

// Helper to recursively build grouped columns
function buildGroupedColumns(
  metrics: { field: string; aggregation: string }[],
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
                        {info.getValue() == null ? "-" : info.getValue() as number}
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

export function PivotTable({ data, treeData, groupBy, splitBy, metrics, onExpand, isLoading }: PivotProps) {
  const [expanded, setExpanded] = useState({ root: true });

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
                        className="flex items-center gap-1 w-full h-full"
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
                        <span className="font-medium text-gray-800 text-[10px] truncate" title={label}>
                             {cleanedLabel}
                        </span>
                    </div>
                );
            }
        });

        // Metrics (Simplification: assuming no SplitBy for lazy mode or handled elsewhere for now)
        // If SplitBy is active, we need to know the columns. 
        // We can pass `columns` as prop? Or deduce from first row?
        // Let's just handle standard metrics for now.
        metrics.forEach(metric => {
            cols.push({
                accessorKey: metric.field,
                header: metric.field,
                size: 100,
                cell: info => <div className="text-right tabular-nums text-[10px] w-full px-1">{info.getValue() as number ?? "-"}</div>
            });
        });
        
        return { tableData: treeData, tableColumns: cols };
    }

    // CLIENT SIDE MODE (Original)
    if (!data || data.length === 0) return { tableData: [], tableColumns: [] };

    // RAW DATA MODE
    if (groupBy.length === 0 && splitBy.length === 0 && metrics.length === 0) {
        const rawKeys = Object.keys(data[0]);
        const rawCols = rawKeys.map(key => ({
            accessorKey: key,
            header: key,
            size: 120, // Default fixed
            cell: (info: any) => String(info.getValue())
        }));
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
                cell: info => <div className="text-right tabular-nums text-[10px] w-full px-1">{info.getValue() as number}</div>
            });
        });
    }

    return { tableData: tree, tableColumns: cols };
  }, [data, groupBy, splitBy, metrics]);


  const table = useReactTable({
    data: tableData,
    columns: tableColumns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    defaultColumn: {
        size: 100, // fallback
        minSize: 40,
        maxSize: 600,
    }
  });

  const { rows } = table.getRowModel();

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32, // More compact row height for [10px] font
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="h-full w-full overflow-auto border border-gray-200 bg-white text-[10px]"
      style={{ isolation: "isolate" }} // Create stacking context
    >
        <div 
           className="min-w-full inline-block" // Ensure content expands
           style={{ width: table.getTotalSize() }}
        >
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white shadow-sm border-b border-gray-200">
                {table.getHeaderGroups().map((headerGroup) => (
                    <div 
                        key={headerGroup.id} 
                        className="flex w-full"
                    >
                        {headerGroup.headers.map((header, index) => {
                            const isFirst = index === 0 && headerGroup.headers.length > 0 && header.column.id === 'hierarchy'; // Simplified check (column not header)
                            return (
                                <div
                                    key={header.id}
                                    className={`flex items-center justify-center p-1 border-r border-gray-200 bg-gray-50 font-bold text-gray-600 uppercase tracking-tight
                                        ${isFirst ? 'sticky left-0 z-40 bg-gray-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : ''}
                                    `}
                                    style={{
                                        width: header.getSize(),
                                        flex: `0 0 ${header.getSize()}px`, // STRICT FLEX WIDTH
                                        overflow: "hidden"
                                    }}
                                >
                                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>

            {/* Virtual Body */}
            <div
                className="relative"
                style={{
                    height: `${totalSize}px`,
                }}
            >
                {virtualRows.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const visibleCells = row.getVisibleCells();

                    return (
                        <div
                            key={row.id}
                            className="absolute top-0 left-0 w-full flex hover:bg-blue-50 transition-colors"
                            style={{
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start}px)`,
                            }}
                        >
                            {visibleCells.map((cell, index) => {
                                const isFirst = index === 0;
                                return (
                                    <div
                                        key={cell.id}
                                        className={`flex items-center border-r border-b border-gray-100 bg-white
                                            ${isFirst ? 'sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] font-medium text-gray-800' : 'text-gray-600'}
                                        `}
                                        style={{
                                            width: cell.column.getSize(),
                                            flex: `0 0 ${cell.column.getSize()}px`, // STRICT FLEX WIDTH
                                            overflow: "hidden" 
                                        }}
                                    >
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
  );
}
