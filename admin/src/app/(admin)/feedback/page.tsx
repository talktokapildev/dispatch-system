"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { SectionHeader, Table, Spinner } from "@/components/ui";

function StarRow({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-slate-500">—</span>;
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          className={
            n <= rating ? "text-amber-400 fill-amber-400" : "text-slate-700"
          }
        />
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const [page, setPage] = useState(1);
  const [onlyWithComments, setOnlyWithComments] = useState(false);
  const limit = 30;

  const { data, isLoading } = useQuery({
    queryKey: ["feedback", page],
    queryFn: () =>
      api
        .get("/admin/feedback", { params: { page, limit } })
        .then((r) => r.data.data),
  });

  const items = (data?.items ?? []).filter(
    (b: any) =>
      !onlyWithComments || (b.feedback && b.feedback.trim().length > 0)
  );
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Feedback"
        subtitle="Passenger ratings and comments after each trip"
      />

      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer w-fit">
        <input
          type="checkbox"
          checked={onlyWithComments}
          onChange={(e) => setOnlyWithComments(e.target.checked)}
          className="rounded border-slate-600"
        />
        Only show ratings with a comment
      </label>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Passenger",
              "Driver",
              "Rating",
              "Comment",
              "Reference",
              "Date",
            ]}
            isEmpty={!items.length}
            emptyMessage="No feedback yet"
          >
            {items.map((b: any) => (
              <tr key={b.id} className="table-row">
                <td
                  className="px-4 py-3 text-xs font-medium"
                  style={{ color: "var(--text)" }}
                >
                  {b.passenger?.user?.firstName || "Unknown"}{" "}
                  {b.passenger?.user?.lastName}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {b.driver?.user?.firstName
                    ? `${b.driver.user.firstName} ${b.driver.user.lastName}`
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  <StarRow rating={b.rating} />
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 max-w-xs">
                  {b.feedback || <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-slate-500">
                  {b.reference}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {b.completedAt
                    ? format(new Date(b.completedAt), "dd MMM yyyy")
                    : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-ghost px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-ghost px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
