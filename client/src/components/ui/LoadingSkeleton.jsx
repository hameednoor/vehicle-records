export function Skeleton({ className = '', width, height }) {
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return <div className={`skeleton ${className}`} style={style} />;
}

export function VehicleCardSkeleton() {
  return (
    <div className="card p-4 space-y-4 animate-fade-in">
      {/* Photo placeholder */}
      <Skeleton className="w-full h-40 rounded-lg" />
      {/* Title */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/2 rounded" />
      </div>
      {/* Stats row */}
      <div className="flex justify-between">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-4 w-24 rounded" />
      </div>
      {/* Badge */}
      <Skeleton className="h-6 w-24 rounded-full" />
      {/* Action buttons */}
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 flex-1 rounded-lg" />
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 5 }) {
  return (
    <tr className="animate-fade-in">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 rounded" width={`${60 + Math.random() * 40}%`} />
        </td>
      ))}
    </tr>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-6">
        <Skeleton className="w-full sm:w-48 h-48 rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-64 rounded" />
          <Skeleton className="h-5 w-48 rounded" />
          <Skeleton className="h-5 w-36 rounded" />
          <div className="flex gap-3 mt-4">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </div>
      </div>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-4 space-y-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-8 w-32 rounded" />
          </div>
        ))}
      </div>
      {/* Content */}
      <div className="card p-6 space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 rounded" width={`${70 + Math.random() * 30}%`} />
        ))}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card p-4 sm:p-6 space-y-2">
      <Skeleton className="h-4 w-24 rounded" />
      <Skeleton className="h-8 w-20 rounded" />
    </div>
  );
}
