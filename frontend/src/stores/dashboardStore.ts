import { create } from 'zustand';

interface Filter {
  field: string;
  operator: string;
  value: any;
}

interface DashboardState {
  // Map of field_name -> Filter
  activeFilters: Record<string, Filter>;
  
  setFilter: (field: string, value: any, operator?: string) => void;
  removeFilter: (field: string) => void;
  clearAllFilters: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  activeFilters: {},
  
  setFilter: (field, value, operator = '==') => set((state) => ({
    activeFilters: {
      ...state.activeFilters,
      [field]: { field, value, operator }
    }
  })),

  removeFilter: (field) => set((state) => {
    const newFilters = { ...state.activeFilters };
    delete newFilters[field];
    return { activeFilters: newFilters };
  }),

  clearAllFilters: () => set({ activeFilters: {} })
}));
