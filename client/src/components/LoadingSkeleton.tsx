export function LoadingSkeleton() {
  return (
    <div className="space-y-6" data-testid="loading-skeleton">
      {/* Verdict skeleton */}
      <div className="bg-card border border-card-border rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-10 w-20 skeleton-shimmer rounded-md" />
          <div className="space-y-2 flex-1">
            <div className="h-6 w-48 skeleton-shimmer rounded" />
            <div className="h-4 w-64 skeleton-shimmer rounded" />
          </div>
          <div className="h-12 w-24 skeleton-shimmer rounded-lg" />
        </div>
        <div className="h-4 w-full skeleton-shimmer rounded" />
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 skeleton-shimmer rounded" style={{ width: `${70 + i * 5}%` }} />
            ))}
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 skeleton-shimmer rounded" style={{ width: `${60 + i * 8}%` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Cards skeleton */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-card border border-card-border rounded-lg p-6 space-y-3">
          <div className="h-5 w-32 skeleton-shimmer rounded" />
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className="h-4 skeleton-shimmer rounded" style={{ width: `${50 + j * 10}%` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
