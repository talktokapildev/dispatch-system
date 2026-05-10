"use client";
// admin/src/app/(admin)/settings/GeneralSection.tsx
// General operator settings — reads from and writes to GET/PUT /api/v1/settings.
// All inputs are controlled. Save calls PUT /api/v1/admin/settings.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle } from "lucide-react";
import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface GeneralSettings {
  companyName: string;
  licenceNumber: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
}

const DEFAULTS: GeneralSettings = {
  companyName: "OrangeRide",
  licenceNumber: "II786",
  contactEmail: "admin@orangeride.co.uk",
  contactPhone: "+447398341839",
  businessAddress: "Regus, One Elmfield Park, Bromley, BR1 1LU",
};

export function GeneralSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState<GeneralSettings>(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  // Fetch current values from backend
  const { isLoading, data: settingsData } = useQuery<GeneralSettings>({
    queryKey: ["system-settings"],
    queryFn: () =>
      api.get("/settings").then((r) => r.data.data as GeneralSettings),
  });

  // Populate form once settings load
  useEffect(() => {
    if (settingsData) {
      setForm((prev) => ({ ...prev, ...settingsData }));
    }
  }, [settingsData]);

  const set =
    (key: keyof GeneralSettings) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setDirty(true);
    };

  const saveMutation = useMutation({
    mutationFn: (values: GeneralSettings) => api.put("/admin/settings", values),
    onSuccess: () => {
      toast.success("Settings saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save settings"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={24} />
      </div>
    );
  }

  const FIELDS: { label: string; key: keyof GeneralSettings; hint?: string }[] =
    [
      { label: "Company Name", key: "companyName" },
      {
        label: "TfL Operator Licence Number",
        key: "licenceNumber",
        hint: "As it appears on your licence document",
      },
      {
        label: "Contact Email",
        key: "contactEmail",
        hint: "Shown to passengers for complaints and queries",
      },
      {
        label: "Contact Phone",
        key: "contactPhone",
        hint: "TfL Condition 14 — shown in passenger app during and after every booking",
      },
      {
        label: "Business Address",
        key: "businessAddress",
        hint: "Your registered operating centre address",
      },
    ];

  return (
    <>
      <h2
        className="text-sm font-semibold border-b pb-3"
        style={{ color: "var(--text)", borderColor: "var(--border)" }}
      >
        General Settings
      </h2>

      <div className="space-y-4 max-w-md">
        {FIELDS.map(({ label, key, hint }) => (
          <div key={key}>
            <label
              className="text-xs block mb-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              {label}
            </label>
            <input
              className="input w-full"
              value={form[key]}
              onChange={set(key)}
            />
            {hint && (
              <p
                className="text-[11px] mt-1"
                style={{ color: "var(--text-muted)" }}
              >
                {hint}
              </p>
            )}
          </div>
        ))}
      </div>

      <div
        className="pt-4 border-t mt-6"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="text-xs text-brand-400">Unsaved changes</span>
          )}
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || !dirty}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {saveMutation.isPending ? (
              <Spinner size={14} />
            ) : (
              <CheckCircle size={14} />
            )}
            {saveMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </>
  );
}
