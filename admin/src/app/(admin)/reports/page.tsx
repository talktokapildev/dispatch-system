"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { SectionHeader, StatCard } from "@/components/ui";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { PoundSterling, Car, TrendingUp, BookOpen } from "lucide-react";
import { format, subDays, subMonths } from "date-fns";

const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

const PIE_COLOURS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444"];
const BAR_TYPE_COLOURS: Record<string, string> = {
  ASAP: "#f59e0b",
  PREBOOKED: "#3b82f6",
  AIRPORT_PICKUP: "#10b981",
  AIRPORT_DROPOFF: "#06b6d4",
  CORPORATE: "#8b5cf6",
};

export default function ReportsPage() {
  const [rangeIdx, setRangeIdx] = useState(1);
  const range = RANGES[rangeIdx];
  const from = format(subDays(new Date(), range.days), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["revenue-report", range.days],
    queryFn: () =>
      api
        .get("/admin/reports/revenue", { params: { from, to } })
        .then((r) => r.data.data),
  });

  const paymentData = data
    ? Object.entries(data.byPaymentMethod as Record<string, number>).map(
        ([name, value]) => ({ name, value })
      )
    : [];

  const typeData = data
    ? Object.entries(data.byType as Record<string, number>).map(
        ([name, value]) => ({
          name: name.replace(/_/g, " "),
          value,
          fill: BAR_TYPE_COLOURS[name] ?? "#64748b",
        })
      )
    : [];

  const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = rows
      .map((r) => r.map((v) => `"${(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTflDrivers = async () => {
    const res = await api.get("/admin/reports/tfl-export");
    const drivers = res.data.data.drivers;
    const rows = [
      ["Private hire driver licence number", "Forename", "Surname"],
      ...drivers.map((d: any) => [d.pcoBadgeNumber, d.firstName, d.lastName]),
    ];
    downloadCsv(
      `tfl-driver-report-${format(new Date(), "yyyy-MM-dd")}.csv`,
      rows
    );
  };

  const downloadTflVehicles = async () => {
    const res = await api.get("/admin/reports/tfl-export");
    const vehicles = res.data.data.vehicles;
    const rows = [
      ["VRM", "Vehicle make", "Vehicle licence number"],
      ...vehicles.map((v: any) => [
        v.licensePlate,
        v.make,
        v.phvLicenceNumber ?? "",
      ]),
    ];
    downloadCsv(
      `tfl-vehicle-report-${format(new Date(), "yyyy-MM-dd")}.csv`,
      rows
    );
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <SectionHeader
        title="Reports & Analytics"
        subtitle="Revenue, booking trends, and operational insights"
        action={
          <div className="flex gap-1 p-1 bg-[var(--table-hover)] rounded-lg border border-[var(--border)]">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setRangeIdx(i)}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  rangeIdx === i
                    ? "bg-brand-500 text-black"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={`£${(data?.totalRevenue ?? 0).toFixed(2)}`}
          icon={PoundSterling}
          accent="text-brand-400"
        />
        <StatCard
          label="Platform Fees"
          value={`£${(data?.totalPlatformFee ?? 0).toFixed(2)}`}
          icon={TrendingUp}
          accent="text-green-400"
        />
        <StatCard
          label="Total Jobs"
          value={data?.totalJobs ?? 0}
          icon={BookOpen}
          accent="text-blue-400"
        />
        <StatCard
          label="Average Fare"
          value={`£${(data?.averageFare ?? 0).toFixed(2)}`}
          icon={Car}
          accent="text-violet-400"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Jobs by type */}
        <div className="card p-5">
          <p className="text-sm font-semibold text-white mb-5">Jobs by Type</p>
          {typeData.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={typeData}
                margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="#1e2d42"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: "#64748b", fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f1623",
                    border: "1px solid #1e2d42",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {typeData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-600 text-sm">
              No data
            </div>
          )}
        </div>

        {/* Payment methods */}
        <div className="card p-5">
          <p className="text-sm font-semibold text-white mb-5">
            Revenue by Payment Method
          </p>
          {paymentData.length ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie
                    data={paymentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {paymentData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLOURS[i % PIE_COLOURS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#0f1623",
                      border: "1px solid #1e2d42",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: any) => [`£${Number(v).toFixed(2)}`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {paymentData.map((p, i) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{
                          background: PIE_COLOURS[i % PIE_COLOURS.length],
                        }}
                      />
                      <span className="text-xs text-slate-400">
                        {p.name.replace(/_/g, " ")}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-white">
                      £{Number(p.value).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-52 flex items-center justify-center text-slate-600 text-sm">
              No data
            </div>
          )}
        </div>
      </div>

      {/* TfL Weekly Upload */}
      <div className="card p-5 border border-blue-500/20 bg-blue-500/5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-white mb-0.5">
              TfL Weekly Upload
            </p>
            <p className="text-xs text-slate-400">
              Required every Monday — upload to{" "}
              <a
                href="https://www.tfl.gov.uk/ph-operators"
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline"
              >
                tfl.gov.uk/ph-operators
              </a>
            </p>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">
            Licence condition
          </span>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => downloadTflDrivers()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-medium transition-colors"
          >
            ↓ Driver Data Report (CSV)
          </button>
          <button
            onClick={() => downloadTflVehicles()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-medium transition-colors"
          >
            ↓ Vehicle Data Report (CSV)
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-3">
          Driver report: PHV licence number, forename, surname · Vehicle report:
          VRM, make, PHV licence number
        </p>
      </div>

      {/* Export options */}
      <div className="card p-5">
        <p className="text-sm font-semibold text-white mb-4">Export Data</p>
        <div className="flex gap-3 flex-wrap">
          {[
            "Bookings CSV",
            "Driver Earnings",
            "Corporate Invoices",
            "VAT Summary",
          ].map((label) => (
            <button key={label} className="btn-ghost text-xs">
              ↓ {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600 mt-3">
          Exports use the selected date range above
        </p>
      </div>
    </div>
  );
}
