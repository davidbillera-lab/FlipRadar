interface CompBadgeProps {
  count: number;
}

export function CompBadge({ count }: CompBadgeProps) {
  if (count >= 5) {
    return (
      <span title={`${count} sold comps — solid data`} className="inline-flex items-center gap-1 text-sm font-medium text-green-700">
        🟢 {count} comps
      </span>
    );
  }
  if (count >= 2) {
    return (
      <span title={`${count} sold comps — thin data`} className="inline-flex items-center gap-1 text-sm font-medium text-yellow-700">
        🟡 {count} comps
      </span>
    );
  }
  return (
    <span title={`${count} sold comp(s) — insufficient data`} className="inline-flex items-center gap-1 text-sm font-medium text-red-700">
      🔴 {count} comps
    </span>
  );
}
