import { useState, useEffect, useCallback } from 'react';
import { LayoutGrid, Box, Sigma, ArrowRight, ArrowDown, GripVertical, X } from 'lucide-react';
import { 
  DndContext, 
  DragOverlay, 
  DragStartEvent, 
  DragEndEvent, 
  DragOverEvent, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  useDroppable,
  closestCenter,
  TouchSensor,
  KeyboardSensor
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy, 
  useSortable, 
  arrayMove,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface PivotBuilderProps {
  reportId: number;
  availableColumns: string[]; 
  initialConfig?: {
    group_by: string[];
    split_by: string[];
    metrics: string[]; 
  };
  onConfigChange?: (config: any) => void;
}

// --- DRAG & DROP COMPONENTS ---

function SortableItem({ id, children, onRemove, colorClass = "bg-white border-gray-200" }: any) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 999 : 'auto',
    };

    return (
        <div ref={setNodeRef} style={style} className={`flex items-center justify-between p-2 mb-1 border rounded cursor-grab active:cursor-grabbing group select-none text-xs shadow-sm ${colorClass}`}>
            <div className="flex items-center gap-2 truncate flex-1" {...attributes} {...listeners}>
                <GripVertical size={14} className="text-gray-400 flex-shrink-0" />
                <span className="truncate">{children}</span>
            </div>
            {onRemove && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onRemove(id); }} 
                  className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500"
                >
                   <X size={14}/>
                </button>
            )}
        </div>
    );
}

function DroppableContainer({ id, items, title, icon: Icon, onRemoveItem, placeholder, colorClass, colorText }: any) {
    const { setNodeRef } = useDroppable({ id });

    return (
        <div ref={setNodeRef} className="flex flex-col h-full">
             {title && (
                <div className={`p-2 border-b bg-gray-50 text-xs font-semibold ${colorText} uppercase flex items-center gap-1`}>
                    <Icon size={14} /> {title}
                </div>
             )}
            <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
                <div className="flex-1 p-2 overflow-y-auto min-h-[60px]">
                    {items.map((item: string) => (
                        <SortableItem key={item} id={item} onRemove={onRemoveItem} colorClass={colorClass}>
                           {item}
                        </SortableItem> 
                    ))}
                    {items.length === 0 && (
                        <div className="h-full flex items-center justify-center text-gray-300 text-[10px] italic border-2 border-dashed border-gray-100 rounded">
                            {placeholder}
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
}


export default function PivotBuilder({ reportId, availableColumns, initialConfig, onConfigChange }: PivotBuilderProps) {
  // --- STATE ---
  // Using a single state object for easier DnD management could be better, but keeping separate for clarity
  const [items, setItems] = useState<{
      available: string[];
      rows: string[];
      columns: string[];
      values: string[];
      sort: string[];
  }>({
      available: [],
      rows: [],
      columns: [],
      values: [],
      sort: []
  });

  const [activeId, setActiveId] = useState<string | null>(null);

  // Init State on Load
  useEffect(() => {
    // Re-initialize only when the report changes or available columns change
    // We deliberately exclude 'initialConfig' from dependencies to prevent 
    // feedback loops where parent updates trigger a reset of functionality.
    if (initialConfig) {
      const used = new Set([
        ...(initialConfig.group_by || []),
        ...(initialConfig.split_by || []),
        ...(initialConfig.metrics || [])
      ]);
      setItems({
          available: availableColumns.filter(c => !used.has(c)),
          rows: initialConfig.group_by || [],
          columns: initialConfig.split_by || [],
          values: initialConfig.metrics || [],
          sort: [] 
      });
    } else {
      setItems(prev => ({ ...prev, available: availableColumns }));
    }
  }, [reportId, availableColumns]); // Removed initialConfig from deps

  // Sync with Parent
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange({
        group_by: items.rows,
        split_by: items.columns,
        metrics: items.values,
        filters: {} // TODO
      });
    }
  }, [items.rows, items.columns, items.values]);


  // --- DND HANDLERS ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), // Require slight move to drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findContainer = (id: string) => {
    if (items.available.includes(id)) return 'available';
    if (items.rows.includes(id)) return 'rows';
    if (items.columns.includes(id)) return 'columns';
    if (items.values.includes(id)) return 'values';
    if (items.sort.includes(id)) return 'sort';
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      
      const activeContainer = findContainer(active.id as string);
      // If over a container directly (e.g. empty placeholder) use its id, else find the item's container
      const overContainer = (over.id in items) 
          ? over.id 
          : findContainer(over.id as string);

      if (!activeContainer || !overContainer || activeContainer === overContainer) {
          return;
      }

      // Moving between containers during drag (optimistic UI)
      setItems((prev: any) => {
          const activeItems = prev[activeContainer];
          const overItems = prev[overContainer];
          const activeIndex = activeItems.indexOf(active.id);
          const overIndex = (over.id in prev) 
            ? overItems.length + 1 
            : overItems.indexOf(over.id);

          let newIndex;
          if (over.id in prev) {
            newIndex = overItems.length + 1;
          } else {
            const isBelowOverItem =
              over &&
              open &&
              active.rect.current.translated &&
              active.rect.current.translated.top >
                over.rect.top + over.rect.height;

            const modifier = isBelowOverItem ? 1 : 0;
            newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1;
          }

          return {
              ...prev,
              [activeContainer]: [
                  ...prev[activeContainer].filter((item: string) => item !== active.id)
              ],
              [overContainer]: [
                  ...prev[overContainer].slice(0, newIndex),
                  active.id,
                  ...prev[overContainer].slice(newIndex, prev[overContainer].length)
              ]
          };
      });
  };

  const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      const activeContainer = findContainer(active.id as string);
      const overContainer = over ? ((over.id in items) ? over.id : findContainer(over.id as string)) : null;

      if (activeContainer && overContainer && activeContainer === overContainer) {
          const activeIndex = items[activeContainer as keyof typeof items].indexOf(active.id as string);
          const overIndex = items[overContainer as keyof typeof items].indexOf(over.id as string);
          
          if (activeIndex !== overIndex) {
              setItems((prev: any) => ({
                  ...prev,
                  [activeContainer]: arrayMove(prev[activeContainer], activeIndex, overIndex)
              }));
          }
      }
      setActiveId(null);
  };

  const handleRemove = (id: string, from: string) => {
      setItems((prev: any) => ({
          ...prev,
          [from]: prev[from].filter((item: string) => item !== id),
          available: [...prev.available, id].sort()
      }));
  };

  // --- RENDER ---
  return (
    <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
    >
        <div className="flex flex-col h-full bg-[#f3f4f6] text-sm border-r w-64 shadow-md flex-shrink-0">
             
             {/* 1. Columns List (Top Half) */}
             <div className="flex-1 flex flex-col min-h-0 bg-white border-b">
                 <div className="p-3 bg-gray-100 border-b font-semibold text-gray-700 uppercase text-xs tracking-wider">
                    Campi
                 </div>
                 <div className="flex-1 overflow-hidden">
                    <DroppableContainer 
                        id="available"
                        items={items.available}
                        placeholder="Nessun campo"
                        colorClass="bg-white hover:border-blue-300"
                        // No remove button for available
                    />
                 </div>
             </div>
    
             {/* 2. Drop Zones (Bottom Half) */}
             <div className="flex-1 flex flex-col min-h-0 bg-gray-50 overflow-y-auto">
                
                {/* Rows */}
                <div className="min-h-[100px] border-b">
                    <DroppableContainer 
                        id="rows"
                        title="Righe"
                        icon={Box}
                        items={items.rows}
                        onRemoveItem={(id: string) => handleRemove(id, 'rows')}
                        placeholder="Trascina qui..."
                        colorClass="bg-blue-50 border-blue-200 text-blue-800"
                        colorText="text-blue-600"
                    />
                </div>
                
                {/* Columns */}
                <div className="min-h-[80px] border-b">
                    <DroppableContainer 
                        id="columns"
                        title="Colonne"
                        icon={ArrowRight}
                        items={items.columns}
                        onRemoveItem={(id: string) => handleRemove(id, 'columns')}
                        placeholder="Trascina qui..."
                        colorClass="bg-orange-50 border-orange-200 text-orange-800"
                        colorText="text-orange-600"
                    />
                </div>
    
                {/* Values */}
                <div className="min-h-[80px] border-b">
                     <DroppableContainer 
                        id="values"
                        title="Valori"
                        icon={Sigma}
                        items={items.values}
                        onRemoveItem={(id: string) => handleRemove(id, 'values')}
                        placeholder="Trascina qui..."
                        colorClass="bg-green-50 border-green-200 text-green-800"
                        colorText="text-green-600"
                    />
                </div>

                {/* Sort */}
               {/* Hidden for now to save space, or functionality not requested explicitly yet */}
             </div>
    
          </div>
          
          <DragOverlay>
            {activeId ? (
                 <div className="p-2 bg-white border border-blue-500 shadow-xl rounded w-48 opacity-90 flex items-center gap-2 cursor-grabbing">
                    <GripVertical size={14} className="text-gray-400" />
                    <span className="truncate text-sm font-medium">{activeId}</span>
                </div>
            ) : null}
          </DragOverlay>

    </DndContext>
  );
}
