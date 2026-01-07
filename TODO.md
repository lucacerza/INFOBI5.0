# Roadmap to "Power BI" Performance & Parity

## 1. Pivot Table Performance & Features (Priority)
- [ ] **Server-Side Sorting**: Currently, the lazy loader passes `sort: []`. Sorting requires the backend to sort the groups *before* returning the top N rows.
- [ ] **Horizontal Virtualization**: If "Split By" results in hundreds of columns (e.g., "Day of Year"), the DOM will get heavy. Need to implement column virtualization alongside row virtualization.
- [ ] **Measure Filtering**: Apply filters based on aggregated values (e.g., "Show Sales > 1000"). This requires `HAVING` clauses in the backend SQL generation.
- [ ] **Formatting & Totals**: Advanced formatting (Currency, Percentages) defined in the schema and ensuring Subtotals/Grand Totals are calculated correctly on the server to avoid adding up rounded numbers.

## 2. Dashboard Experience
- [ ] **Cross-Filtering**: Clicking a bar in a chart should update the filters for all other widgets (including the Pivot) on the dashboard. Deep linking/State management needed.
- [ ] **Shared Caching**: Ensure that if 4 widgets use the same dataset, we reuse the result or cache the base query.
- [ ] **Widget Interactivity**: Drill-through from a chart to the detailed Pivot/Report.

## 3. Backend & Data Engine
- [ ] **Smart Caching**: Current caching is likely basic. Implement aggressive caching for drill-down paths (if I expand "2023", cache the result so collapsing/expanding is instant).
- [ ] **Query Customization**: Allow "DirectQuery" vs "Import" modes conceptually. For massive data, ensure DuckDB uses parquet files effectively without loading everything to RAM if not needed.
- [ ] **Concurrency**: Ensure FastAPI handles multiple users running heavy analytical queries without blocking (Async DB drivers ok, but CPU bound tasks might need workers).

## 4. UX/UI Polish
- [ ] **Loading Skeletons**: Replace spinner with skeleton rows during lazy load for a smoother feel.
- [ ] **Column Resizing**: persist user adjustments to column widths.
