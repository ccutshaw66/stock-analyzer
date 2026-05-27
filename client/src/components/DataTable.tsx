import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared data table — the template every page reuses for sortable columns,
// optional minimum-score filtering, and an optional refresh action. Built
// atop the shadcn table primitives in components/ui/table.tsx; uses design
// tokens for all colors/spacing.

export type DataTableColumnType = "score" | "price" | "number" | "text";

export type DataTableColumn<T> = {
  key: string;
  header: React.ReactNode;
  accessor: (row: T) => React.ReactNode;
  // Returns a comparable primitive for sorting. Defaults to the accessor's
  // result coerced to string/number. Provide this when the rendered cell
  // is JSX (e.g. a colored badge) but you want to sort by an underlying value.
  sortValue?: (row: T) => number | string | null | undefined;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  type?: DataTableColumnType;
  headClassName?: string;
  cellClassName?: string;
  // Width hint, applied to <th> via Tailwind class (e.g. "w-24")
  width?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  title?: React.ReactNode;
  rightSlot?: React.ReactNode;
  defaultSort?: { key: string; direction: "asc" | "desc" };
  // When true and at least one column has type="score", render a numeric
  // min-score input that hides rows below the threshold.
  showScoreFilter?: boolean;
  defaultMinScore?: number;
  scoreFilterLabel?: string;
  onRefresh?: () => void | Promise<unknown>;
  isRefreshing?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  emptyMessage?: React.ReactNode;
  className?: string;
  // Style hooks
  dense?: boolean;
};

type SortState = { key: string; direction: "asc" | "desc" } | null;

function compareValues(a: unknown, b: unknown): number {
  const aNil = a === null || a === undefined || a === "" || (typeof a === "number" && Number.isNaN(a));
  const bNil = b === null || b === undefined || b === "" || (typeof b === "number" && Number.isNaN(b));
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function coerceForSort(v: React.ReactNode): number | string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    data,
    getRowKey,
    title,
    rightSlot,
    defaultSort,
    showScoreFilter,
    defaultMinScore,
    scoreFilterLabel = "Min score",
    onRefresh,
    isRefreshing,
    onRowClick,
    rowClassName,
    emptyMessage = "No data",
    className,
    dense,
  } = props;

  const [sort, setSort] = React.useState<SortState>(defaultSort ?? null);
  const [minScore, setMinScore] = React.useState<number | null>(
    defaultMinScore ?? null,
  );

  const scoreColumn = React.useMemo(
    () => columns.find((c) => c.type === "score") ?? null,
    [columns],
  );

  const filtered = React.useMemo(() => {
    if (!scoreColumn || minScore === null) return data;
    return data.filter((row) => {
      const v = scoreColumn.sortValue
        ? scoreColumn.sortValue(row)
        : coerceForSort(scoreColumn.accessor(row));
      if (typeof v !== "number") return false;
      return v >= minScore;
    });
  }, [data, scoreColumn, minScore]);

  const sorted = React.useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const getVal = col.sortValue ?? ((row: T) => coerceForSort(col.accessor(row)));
    const sgn = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => sgn * compareValues(getVal(a), getVal(b)));
  }, [filtered, sort, columns]);

  const toggleSort = (key: string, sortable: boolean | undefined) => {
    if (sortable === false) return;
    setSort((curr) => {
      if (!curr || curr.key !== key) return { key, direction: "asc" };
      if (curr.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const showHeaderBar =
    !!title || !!rightSlot || !!onRefresh || (!!showScoreFilter && !!scoreColumn);

  const headPad = dense ? "px-2 py-1.5" : "px-3 py-2";
  const cellPad = dense ? "px-2 py-1" : "px-3 py-1.5";

  return (
    <div className={cn("w-full", className)}>
      {showHeaderBar && (
        <div className="flex items-center justify-between gap-3 mb-2 px-1">
          <div className="flex items-center gap-3 min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
            )}
            {showScoreFilter && scoreColumn && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <span>{scoreFilterLabel}</span>
                <input
                  type="number"
                  value={minScore ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setMinScore(v === "" ? null : Number(v));
                  }}
                  className="w-16 h-7 px-2 text-xs bg-background border border-card-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 tabular-nums"
                  placeholder="any"
                  data-testid="datatable-min-score"
                />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {rightSlot}
            {onRefresh && (
              <button
                type="button"
                onClick={() => onRefresh()}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md bg-muted text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="datatable-refresh"
                aria-label="Refresh"
              >
                {isRefreshing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                <span>Refresh</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="relative w-full overflow-auto rounded-md border border-card-border/40 bg-card">
        <table className="w-full caption-bottom text-sm">
          <thead className="bg-muted/30">
            <tr className="border-b border-card-border/40">
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const isSorted = sort?.key === c.key;
                const align = c.align ?? (c.type === "price" || c.type === "number" || c.type === "score" ? "right" : "left");
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key, c.sortable)}
                    aria-sort={
                      isSorted ? (sort?.direction === "asc" ? "ascending" : "descending") : "none"
                    }
                    className={cn(
                      headPad,
                      "text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none",
                      align === "right" && "text-right",
                      align === "center" && "text-center",
                      align === "left" && "text-left",
                      sortable && "cursor-pointer hover:text-foreground transition-colors",
                      c.width,
                      c.headClassName,
                    )}
                    data-testid={`datatable-head-${c.key}`}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        align === "right" && "flex-row-reverse",
                      )}
                    >
                      <span>{c.header}</span>
                      {sortable && (
                        <span className="inline-flex items-center text-muted-foreground/70">
                          {isSorted ? (
                            sort?.direction === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={getRowKey(row, i)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-card-border/30 last:border-0 hover:bg-muted/30 transition-colors",
                    onRowClick && "cursor-pointer",
                    rowClassName?.(row),
                  )}
                  data-testid="datatable-row"
                >
                  {columns.map((c) => {
                    const align = c.align ?? (c.type === "price" || c.type === "number" || c.type === "score" ? "right" : "left");
                    const isNumish = c.type === "price" || c.type === "number" || c.type === "score";
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          cellPad,
                          "text-sm text-foreground align-middle",
                          align === "right" && "text-right",
                          align === "center" && "text-center",
                          align === "left" && "text-left",
                          isNumish && "tabular-nums",
                          c.cellClassName,
                        )}
                      >
                        {c.accessor(row)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
