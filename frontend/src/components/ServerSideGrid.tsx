import { useEffect, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  ColumnDef,
  PaginationState,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import api from '../services/api';

interface ServerSideGridProps {
  reportId: number;
  columns: ColumnDef<any>[];
}

export default function ServerSideGrid({ reportId, columns }: ServerSideGridProps) {
  // State for server-side operations
  const [data, setData] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 100, // Chunk size requested by user (100 rows)
  });
  
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Fetch logic
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Map TanStack state to our API model
        const startRow = pagination.pageIndex * pagination.pageSize;
        const endRow = startRow + pagination.pageSize;
        
        const sortModel = sorting.map(s => ({
          colId: s.id,
          sort: s.desc ? 'desc' : 'asc'
        }));
        
        const filterModel = columnFilters.reduce((acc, curr) => {
          acc[curr.id] = {
            filterType: 'text', // Simplified for demo defaulting to text
            type: 'contains',   // Defaulting to contains
            filter: curr.value
          };
          return acc;
        }, {} as any);

        const response = await api.post(`/reports/${reportId}/grid`, {
            startRow,
            endRow,
            sortModel,
            filterModel
        });

        setData(response.data.rows);
        setRowCount(response.data.lastRow);
      } catch (err) {
        console.error("Failed to fetch grid data", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [reportId, pagination, sorting, columnFilters]); // Refetch when these change

  const table = useReactTable({
    data,
    columns,
    pageCount: Math.ceil(rowCount / pagination.pageSize),
    state: {
      pagination,
      sorting,
      columnFilters,
    },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    manualPagination: true, // Tell table we handle this on server
    manualSorting: true,    // server-side sorting
    manualFiltering: true,  // server-side filtering
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="h-full flex flex-col overflow-hidden border rounded-lg bg-white shadow-sm">
        {/* Simple Header with Loading State */}
        <div className="p-2 border-b flex justify-between items-center bg-gray-50">
            <span className="text-sm text-gray-500 font-mono">
                {isLoading ? 'Aggiornamento...' : `${rowCount.toLocaleString()} righe totali`}
            </span>
            <div className="space-x-2 flex items-center">
                 {/* Pagination Controls */}
                 <button 
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 text-sm"
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                >
                    Precedente
                </button>
                <span className="text-sm">
                    Pagina {table.getState().pagination.pageIndex + 1} di {table.getPageCount() || 1}
                </span>
                <button 
                    className="px-3 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50 text-sm"
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                >
                    Successiva
                </button>
            </div>
        </div>

      {/* Main Grid Area */}
      <div className="flex-1 overflow-auto relative">
        {isLoading && (
            <div className="absolute inset-0 bg-white/50 z-20 flex items-start justify-center pt-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        )}
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id} className="p-3 font-semibold text-gray-700 border-b border-r select-none cursor-pointer hover:bg-gray-200 transaction-colors"
                      onClick={header.column.getToggleSortingHandler()}>
                    <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{
                        asc: ' ↑',
                        desc: ' ↓',
                        }[header.column.getIsSorted() as string] ?? null}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-blue-50 border-b border-gray-100 transition-colors">
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id} className="p-2 border-r truncate max-w-[250px] text-gray-700">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
