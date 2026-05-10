"use client";
// admin/src/app/(admin)/settings/ComplianceSection.tsx

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";

export function ComplianceSection() {
  const { data: staff } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get("/admin/staff").then((r) => r.data.data),
  });

  // Find operator (System Admin / first ADMIN user)
  // Prefer ADMIN role — that's the operator (Kapil). Fall back to first staff if needed.
  const operator =
    (staff ?? []).find((s: any) => s.roles?.includes("ADMIN")) ??
    (staff ?? []).find((s: any) => s.roles?.includes("DISPATCHER")) ??
    (staff ?? [])[0];

  const dbs = operator?.adminProfile;
  const dbsCheckDate = dbs?.dbsCheckDate ? new Date(dbs.dbsCheckDate) : null;
  // DBS typically renewed annually — show expiry as 1 year from check date
  const dbsExpiry = dbsCheckDate
    ? new Date(
        dbsCheckDate.getFullYear() + 1,
        dbsCheckDate.getMonth(),
        dbsCheckDate.getDate()
      )
    : null;
  const daysUntilExpiry = dbsExpiry
    ? Math.ceil((dbsExpiry.getTime() - Date.now()) / 86400000)
    : null;
  const isCritical = daysUntilExpiry !== null && daysUntilExpiry <= 30;
  const isWarning =
    daysUntilExpiry !== null && daysUntilExpiry > 30 && daysUntilExpiry <= 60;
  const isOk = daysUntilExpiry !== null && daysUntilExpiry > 60;

  return (
    <>
      <h2
        className="text-sm font-semibold border-b pb-3"
        style={{ color: "var(--text)", borderColor: "var(--border)" }}
      >
        TfL Compliance Settings
      </h2>
      <div className="space-y-4">
        {/* ── Operator DBS Tracking (TfL Item 7) ── */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            {isCritical ? (
              <ShieldAlert size={14} className="text-red-400" />
            ) : isWarning ? (
              <ShieldAlert size={14} className="text-yellow-400" />
            ) : (
              <ShieldCheck size={14} className="text-green-400" />
            )}
            <p
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              Operator DBS Certificate
            </p>
          </div>

          {!dbs?.dbsCertificateNumber ? (
            <div className="p-3 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs text-slate-400">
              No DBS details on record. Add them in the{" "}
              <a href="/staff" className="text-brand-400 hover:underline">
                Staff Register
              </a>
              .
            </div>
          ) : (
            <div
              className={`p-4 rounded-lg border ${
                isCritical
                  ? "bg-red-500/10 border-red-500/20"
                  : isWarning
                  ? "bg-yellow-500/10 border-yellow-500/20"
                  : "bg-green-500/10 border-green-500/20"
              }`}
            >
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p style={{ color: "var(--text-muted)" }} className="mb-0.5">
                    Operator
                  </p>
                  <a
                    href="/staff"
                    className="font-medium text-brand-400 hover:underline"
                  >
                    {operator?.firstName} {operator?.lastName}
                  </a>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }} className="mb-0.5">
                    DBS Certificate No.
                  </p>
                  <p
                    className="font-mono font-medium"
                    style={{ color: "var(--text)" }}
                  >
                    {dbs.dbsCertificateNumber}
                  </p>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }} className="mb-0.5">
                    Check Date
                  </p>
                  <p className="font-medium" style={{ color: "var(--text)" }}>
                    {dbsCheckDate
                      ? dbsCheckDate.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </p>
                </div>
                <div>
                  <p style={{ color: "var(--text-muted)" }} className="mb-0.5">
                    Due for Renewal
                  </p>
                  <p
                    className={`font-semibold ${
                      isCritical
                        ? "text-red-400"
                        : isWarning
                        ? "text-yellow-400"
                        : "text-green-400"
                    }`}
                  >
                    {dbsExpiry
                      ? dbsExpiry.toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                    {daysUntilExpiry !== null && (
                      <span className="ml-1.5 font-normal text-[11px]">
                        (
                        {daysUntilExpiry > 0
                          ? `${daysUntilExpiry} days`
                          : "EXPIRED"}
                        )
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {(isCritical || isWarning) && (
                <div
                  className={`mt-3 pt-3 border-t text-xs ${
                    isCritical
                      ? "border-red-500/20 text-red-300"
                      : "border-yellow-500/20 text-yellow-300"
                  }`}
                >
                  {isCritical
                    ? "⚠ DBS renewal due within 30 days — renew immediately to maintain TfL compliance."
                    : "⚠ DBS renewal due within 60 days — schedule renewal soon."}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
          These settings appear on all passenger receipts and are legally
          required under TfL Operator Licence II786.
        </div>
        {[
          { label: "Operator Licence Number", value: "II786" },
          { label: "Operator Name (as licensed)", value: "ORANGERIDE" },
          {
            label: "Registered Address",
            value: "Regus, One Elmfield Park, Bromley, BR1 1LU",
          },
        ].map(({ label, value }) => (
          <div key={label}>
            <label
              className="text-xs block mb-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              {label}
            </label>
            <input defaultValue={value} className="input max-w-md" />
          </div>
        ))}
        <div className="space-y-3 pt-2">
          {[
            {
              label: "Alert when PCO licence expires within 60 days",
              defaultChecked: true,
            },
            {
              label: "Alert when vehicle MOT expires within 30 days",
              defaultChecked: true,
            },
            {
              label: "Alert when vehicle insurance expires within 30 days",
              defaultChecked: true,
            },
            {
              label: "Block driver from receiving jobs if documents expired",
              defaultChecked: true,
            },
            {
              label: "Include driver PCO badge on passenger receipts",
              defaultChecked: true,
            },
          ].map(({ label, defaultChecked }) => (
            <label
              key={label}
              className="flex items-center gap-3 cursor-pointer"
            >
              <input
                type="checkbox"
                defaultChecked={defaultChecked}
                className="accent-brand-500"
              />
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}
