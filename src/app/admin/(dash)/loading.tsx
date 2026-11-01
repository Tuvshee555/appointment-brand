export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-busy aria-label="Ачаалж байна">
      <div className="h-9 w-64 animate-pulse rounded-xs bg-sand" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-sand" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-card bg-sand" />
    </div>
  )
}
