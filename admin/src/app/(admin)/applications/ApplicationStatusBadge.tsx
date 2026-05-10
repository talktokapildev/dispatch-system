// admin/src/app/(admin)/applications/ApplicationStatusBadge.tsx

export function ApplicationStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING: {
      label: "Pending",
      className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    },
    APPROVED: {
      label: "Approved",
      className: "bg-green-500/15 text-green-400 border-green-500/20",
    },
    REJECTED: {
      label: "Rejected",
      className: "bg-red-500/15 text-red-400 border-red-500/20",
    },
  };
  const s = map[status] ?? {
    label: status,
    className: "bg-slate-500/15 text-slate-400 border-slate-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border ${s.className}`}
    >
      {s.label}
    </span>
  );
}
