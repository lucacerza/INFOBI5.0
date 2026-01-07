// Client-Side Aggregation Pivot Logic
// Takes Raw Flat Data and builds a Pivot Tree
// Replaces Perspective.js functionality

interface RowData {
    [key: string]: any;
}

export function buildPivotHierarchy(
    flatData: RowData[], 
    groupBy: string[], 
    splitBy: string[],
    metrics: string[]
) {
    if (!flatData || flatData.length === 0) return { tree: [], splitColumns: [] };

    // 1. Identify all unique split combinations (for columns)
    const splitSignatures = new Set<string>();

    // We treat SplitBy as a combined key (e.g. "2022|SupplierA")
    // Values are just strings representing the column header path
    flatData.forEach(row => {
        if (splitBy.length > 0) {
            const splitVals = splitBy.map(col => row[col] ?? "N/A");
            const signature = splitVals.join("|||");
            splitSignatures.add(signature);
        }
    });

    const sortedSplitSignatures = Array.from(splitSignatures).sort();

    // 2. Client-side Aggregation Map
    // We need to aggregate metrics for every GroupBy path + SplitBy path
    // Key: GroupPath (e.g. "North|Italy") -> Value: { [SplitSig]: { [Metric]: Sum } }

    // Also need to build the tree structure (Grand Total -> North -> Italy)

    // Root node (Grand Total)
    const rootNode: any = {
        _id: "root",
        _label: "Total",
        _depth: 0,
        subRows: [],
        aggregates: {} // Global totals
    };

    // Helper to find or create a node in the tree
    // We can use a flat map to access nodes quickly by path
    const nodeMap = new Map<string, any>();
    nodeMap.set("", rootNode); // Root has empty path

    flatData.forEach(row => {
        // 1. Resolve Split Signature for this row
        let splitSig = "Total";
        if (splitBy.length > 0) {
            splitSig = splitBy.map(col => row[col] ?? "N/A").join("|||");
        }

        // 2. Traverse/Build Group Hierarchy
        let currentPath = "";
        let parentNode = rootNode;

        // 2a. Update Grand Total (Root)
        updateAggregates(parentNode, splitSig, metrics, row);

        groupBy.forEach((groupCol, index) => {
            const groupVal = row[groupCol] ?? "N/A";
            const newPath = currentPath ? `${currentPath}|||${groupVal}` : String(groupVal);

            let node = nodeMap.get(newPath);
            if (!node) {
                node = {
                    _id: newPath,
                    _label: groupVal,
                    _depth: index + 1,
                    subRows: [],
                    aggregates: {},
                    ...Object.fromEntries(groupBy.slice(0, index + 1).map((g, i) => [g, row[g]])) // Store dimensions
                };
                nodeMap.set(newPath, node);
                parentNode.subRows.push(node);
            }

            // 2b. Update Leaf/Group Totals
            updateAggregates(node, splitSig, metrics, row);

            currentPath = newPath;
            parentNode = node;
        });
    });

    // Determine return value based on if we have groups
    let resultRows = rootNode.subRows;
    if (groupBy.length === 0) {
        // If NO groups, we return the Grand Total Root as the single data row
        resultRows = [rootNode];
    }
    
    // 3. Flatten Aggregates into Node Properties for the Table
    // The Table component expects properties like "2022_Sales" directly on the node object.

    const colMaxLengths: Record<string, number> = {};

    const trackLength = (key: string, val: any) => {
        const len = String(val??"").length;
        if (!colMaxLengths[key] || len > colMaxLengths[key]) {
            colMaxLengths[key] = len;
        }
    };
    
    // Also track hierarchy width
    let hierarchyMaxWidth = 0;

    const flattenNode = (node: any) => {
        // Track Hierarchy Width (approx 10px per char + depth * 20px)
        const labelLen = String(node._label || "Total").includes("|||") 
            ? String(node._label).split("|||").pop()!.length 
            : String(node._label || "Total").length;
        
        // Base chars + indentation factor (e.g. 3 chars per depth level)
        const totalHierLen = labelLen + (node._depth * 4); 
        if (totalHierLen > hierarchyMaxWidth) hierarchyMaxWidth = totalHierLen;

        // Flatten "Total" (Row Total)
        if (node.aggregates["Total"]) {
            metrics.forEach(m => {
                node[m] = node.aggregates["Total"][m];
                trackLength(m, node[m]);
            });
        }

        // Flatten Split Columns
        Object.keys(node.aggregates).forEach(sig => {
            if (sig === "Total") return;
            metrics.forEach(m => {
                // Key format: "2022|SupplierA_Sales"
                const key = `${sig}_${m}`; 
                node[key] = node.aggregates[sig][m];
                trackLength(key, node[key]);
            });
        });

        // Recurse
        if (node.subRows && node.subRows.length > 0) {
            node.subRows.forEach(flattenNode);
        }
    };

    flattenNode(rootNode);

    // If we have no groups, we still want to show rows.
    // If groupBy is empty, the rootNode.subRows will be empty.
    // In that case, we should probably just return the flatData aggregated (Grand Total only)?
    // Or if we have splitBy but no groupBy, we show 1 row with columns.
    
    let resultTree = rootNode.subRows;
    if (groupBy.length === 0) {
        // If no row groups, the root node IS the single result row
        // But we want it to look like a regular row
        rootNode._label = "Grand Total";
        resultTree = [rootNode];
    }
    
    // Convert char lengths to approx pixels (assuming ~8px per char for monospace/digits, + padding)
    const colWidths: Record<string, number> = {};
    Object.keys(colMaxLengths).forEach(k => {
        colWidths[k] = Math.max(60, Math.min(400, colMaxLengths[k] * 10 + 20)); // min 60, max 400
    });
    // Hierarchy width
    colWidths['hierarchy'] = Math.max(150, Math.min(500, hierarchyMaxWidth * 9 + 40));

    return { 
        tree: resultTree, 
        splitColumns: sortedSplitSignatures,
        colWidths
    };
}

function updateAggregates(node: any, splitSig: string, metrics: string[], row: any) {
    // 1. Update Split Specific
    if (!node.aggregates[splitSig]) node.aggregates[splitSig] = {};
    metrics.forEach(m => {
        const val = Number(row[m]) || 0;
        node.aggregates[splitSig][m] = (node.aggregates[splitSig][m] || 0) + val;
    });

    // 2. Update Row Total (Accumulate everything only ONCE per row?)
    // Wait, if we iterate rows, we just sum up.
    // For "Total", we just aggregate regardless of split signature.
    if (!node.aggregates["Total"]) node.aggregates["Total"] = {};
    metrics.forEach(m => {
        const val = Number(row[m]) || 0;
        node.aggregates["Total"][m] = (node.aggregates["Total"][m] || 0) + val;
    });
}

