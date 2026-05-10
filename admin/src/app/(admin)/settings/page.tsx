"use client";
// admin/src/app/(admin)/settings/page.tsx
// Thin shell — each section is its own component file for maintainability.

import { useState } from "react";
import { SectionHeader } from "@/components/ui";
import { GeneralSection } from "./GeneralSection";
import { PricingSection } from "./PricingSection";
import { ComplianceSection } from "./ComplianceSection";

const SECTIONS = [
  "General",
  "Pricing",
  "Dispatch",
  "Notifications",
  "Compliance",
];

// ── Placeholder sections (Dispatch + Notifications not yet wired to backend) ─
function DispatchSection() {
  return (
    <>
      <h2
        className="text-sm font-semibold border-b pb-3"
        style={{ color: "var(--text)", borderColor: "var(--border)" }}
      >
        Dispatch Engine
      </h2>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 max-w-lg">
          {[
            {
              label: "Driver Accept Timeout (seconds)",
              value: "60",
              key: "acceptTimeout",
            },
            { label: "Max Dispatch Attempts", value: "3", key: "maxAttempts" },
            {
              label: "Max Search Radius (km)",
              value: "10",
              key: "searchRadius",
            },
            {
              label: "Pre-book Lead Time (minutes)",
              value: "30",
              key: "leadTime",
            },
          ].map(({ label, value, key }) => (
            <div key={key}>
              <label
                className="text-xs block mb-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                {label}
              </label>
              <input defaultValue={value} type="number" className="input" />
            </div>
          ))}
        </div>
        <div className="space-y-3 pt-2">
          {[
            {
              label: "Auto-dispatch ASAP jobs",
              description:
                "Automatically offer ASAP jobs to nearest available driver",
              defaultChecked: true,
            },
            {
              label: "Escalate to manual after max attempts",
              description:
                "Alert dispatcher if no driver accepts within configured attempts",
              defaultChecked: true,
            },
            {
              label: "Allow driver to reject jobs",
              description: "Drivers can decline job offers (recommended)",
              defaultChecked: true,
            },
          ].map(({ label, description, defaultChecked }) => (
            <label
              key={label}
              className="flex items-start gap-3 cursor-pointer group"
            >
              <input
                type="checkbox"
                defaultChecked={defaultChecked}
                className="mt-0.5 accent-brand-500"
              />
              <div>
                <p
                  className="text-xs group-hover:text-brand-400 transition-colors"
                  style={{ color: "var(--text)" }}
                >
                  {label}
                </p>
                <p
                  className="text-[11px] mt-0.5"
                  style={{ color: "var(--text-muted)" }}
                >
                  {description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

function NotificationsSection() {
  return (
    <>
      <h2
        className="text-sm font-semibold border-b pb-3"
        style={{ color: "var(--text)", borderColor: "var(--border)" }}
      >
        Notification Settings
      </h2>
      <div className="space-y-3">
        {[
          { label: "New booking created", channels: ["Push", "Email"] },
          { label: "Driver assigned", channels: ["Push", "SMS"] },
          { label: "Driver arrived", channels: ["Push", "SMS"] },
          { label: "Trip completed", channels: ["Push", "Email"] },
          { label: "Booking cancelled", channels: ["Push", "Email"] },
          { label: "Document expiry alert", channels: ["Email"] },
          { label: "Manual dispatch required", channels: ["Push", "Email"] },
        ].map(({ label, channels }) => (
          <div
            key={label}
            className="flex items-center justify-between py-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {label}
            </p>
            <div className="flex gap-2">
              {["Push", "SMS", "Email"].map((c) => (
                <label
                  key={c}
                  className="flex items-center gap-1.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    defaultChecked={channels.includes(c)}
                    className="accent-brand-500"
                  />
                  <span
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {c}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [active, setActive] = useState("General");

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Settings"
        subtitle="System configuration and preferences"
      />
      <div className="flex gap-5">
        {/* Side nav */}
        <div className="w-44 shrink-0 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setActive(s)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                active === s
                  ? "bg-brand-500/10 text-brand-400"
                  : "text-slate-400 hover:text-white hover:bg-[var(--table-hover)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Content panel */}
        <div className="flex-1 min-w-0">
          {active === "Pricing" ? (
            // Pricing has its own save button — rendered outside the card
            <PricingSection />
          ) : (
            <div className="card p-6 space-y-6">
              {active === "General" && <GeneralSection />}
              {active === "Dispatch" && <DispatchSection />}
              {active === "Notifications" && <NotificationsSection />}
              {active === "Compliance" && <ComplianceSection />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
