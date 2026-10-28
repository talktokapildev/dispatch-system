"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { format } from "date-fns";
import {
  Search,
  AlertTriangle,
  UserPlus,
  Pencil,
  Trash2,
  ExternalLink,
  RotateCw,
  RotateCcw,
  CheckCircle,
  Upload,
  Archive,
  Printer,
} from "lucide-react";
import {
  DriverBadge,
  SectionHeader,
  Table,
  Spinner,
  Modal,
} from "@/components/ui";
import { DocumentsPanel } from "@/components/Documents";
import { DriverVehicleHistory } from "@/components/VehicleHistory";
import {
  ArchiveDriverModal,
  DeleteDriverModal,
  DriverRegisterPanel,
  RestoreDriverModal,
  dayText,
  ukTodayKey,
} from "@/components/DriverRegister";

import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

const STATUSES = ["", "AVAILABLE", "ON_JOB", "BREAK", "OFFLINE", "ARCHIVED"];


const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  phone: "+44",
  email: "",
  pcoBadgeNumber: "",
  pcoLicenseExpiry: "",
  drivingLicenseNumber: "",
  vehicleId: "", // car from the Vehicles page ("" = none)
  availableFrom: "", // TfL register "Date first available" (new drivers; "" = today)
};

export default function DriversPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [archiveFor, setArchiveFor] = useState<any>(null);
  const [restoreFor, setRestoreFor] = useState<any>(null);
  const [deleteFor, setDeleteFor] = useState<any>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  // ── Profile photo cropper state ────────────────────────────────────────
  // We build the final crop entirely client-side (canvas) rather than via
  // Cloudinary URL params — Cloudinary silently ignores x_/y_ offsets when
  // combined with g_face+c_thumb on this plan (confirmed by direct testing:
  // it serves the raw, untransformed image instead of erroring), so
  // server-side repositioning isn't reliable. The exported canvas image is
  // uploaded through the same base64 `image` path used for manual uploads.
  const PREVIEW_SIZE = 240; // on-screen cropper canvas, px
  const OUTPUT_SIZE = 400; // exported photo size, px

  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [cropZoom, setCropZoom] = useState(1.2); // multiplier on top of "cover" scale
  const [pan, setPan] = useState({ x: 0, y: 0 }); // px, in PREVIEW_SIZE space
  const [imgLoaded, setImgLoaded] = useState(false);
  const [replacingPhoto, setReplacingPhoto] = useState(false);
  const [uploadMode, setUploadMode] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  const cropImgRef = useRef<HTMLImageElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  }>({ dragging: false, startX: 0, startY: 0, panStartX: 0, panStartY: 0 });

  useEffect(() => {
    setRotation(0);
    setCropZoom(1.2);
    setPan({ x: 0, y: 0 });
    setImgLoaded(false);
    cropImgRef.current = null;
    setReplacingPhoto(false);
    setUploadMode(false);
    setUploadPreview(null);
  }, [selected?.id]);

  function computeBaseScale(
    canvasSize: number,
    naturalW: number,
    naturalH: number,
    deg: number
  ) {
    const swapped = deg === 90 || deg === 270;
    const w = swapped ? naturalH : naturalW;
    const h = swapped ? naturalW : naturalH;
    return Math.max(canvasSize / w, canvasSize / h);
  }

  function drawFrame(
    ctx: CanvasRenderingContext2D,
    canvasSize: number,
    img: HTMLImageElement,
    deg: number,
    zoomMultiplier: number,
    panPx: { x: number; y: number },
    panSpaceSize: number
  ) {
    const baseScale = computeBaseScale(
      canvasSize,
      img.naturalWidth,
      img.naturalHeight,
      deg
    );
    const scale = baseScale * zoomMultiplier;
    const panRatio = canvasSize / panSpaceSize;

    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.save();
    // Circular clip, fixed to canvas — independent of image transform below
    ctx.beginPath();
    ctx.arc(canvasSize / 2, canvasSize / 2, canvasSize / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(
      canvasSize / 2 + panPx.x * panRatio,
      canvasSize / 2 + panPx.y * panRatio
    );
    ctx.rotate((deg * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();
  }

  // Redraw the live preview whenever any crop param changes
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = cropImgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, PREVIEW_SIZE, img, rotation, cropZoom, pan, PREVIEW_SIZE);
  }, [rotation, cropZoom, pan, imgLoaded]);

  // Load the raw badge image into an offscreen Image element once we have
  // a suggested-photo URL and no manual upload is in progress.
  function loadCropImage(badgeUrl: string) {
    const img = new Image();
    img.crossOrigin = "anonymous"; // required so the canvas isn't "tainted"
    img.onload = () => {
      cropImgRef.current = img;
      setImgLoaded(true);
    };
    img.onerror = () => {
      toast.error(
        "Couldn't load the badge image for cropping — try uploading manually instead."
      );
    };
    img.src = badgeUrl;
  }

  function exportCroppedPhoto(): string | null {
    const img = cropImgRef.current;
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawFrame(ctx, OUTPUT_SIZE, img, rotation, cropZoom, pan, PREVIEW_SIZE);
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  function onDragStart(clientX: number, clientY: number) {
    dragStateRef.current = {
      dragging: true,
      startX: clientX,
      startY: clientY,
      panStartX: pan.x,
      panStartY: pan.y,
    };
  }

  function onDragMove(clientX: number, clientY: number) {
    if (!dragStateRef.current.dragging) return;
    const dx = clientX - dragStateRef.current.startX;
    const dy = clientY - dragStateRef.current.startY;
    setPan({
      x: dragStateRef.current.panStartX + dx,
      y: dragStateRef.current.panStartY + dy,
    });
  }

  function onDragEnd() {
    dragStateRef.current.dragging = false;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["drivers", status],
    queryFn: () =>
      api
        .get("/admin/drivers", {
          params: { ...(status && { status }), limit: 100 },
        })
        .then((r) => r.data.data),
    refetchInterval: 15_000,
  });

  // /drivers?open=<id> (e.g. from TfL Records): open that driver once the list has loaded,
  // looking in Archived too for drivers who have left.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);
  useEffect(() => {
    if (!openId || !data) return;
    const items: any[] = data?.items ?? data ?? [];
    const found = items.find((d: any) => d.id === openId);
    if (found) {
      setSelected(found);
      setOpenId(null);
      window.history.replaceState(null, "", "/drivers");
    } else if (status !== "ARCHIVED") {
      setStatus("ARCHIVED");
    } else {
      setOpenId(null);
    }
  }, [openId, data, status]);

  // Cars on the fleet, for the vehicle pickers
  const { data: fleetData } = useQuery({
    queryKey: ["vehicles", "active"],
    queryFn: () =>
      api
        .get("/admin/vehicles", { params: { status: "active" } })
        .then((r) => r.data.data),
  });
  const fleetVehicles: any[] = fleetData?.items ?? [];
  // Free cars first, then the ones other drivers have
  const vehicleOptions = (driverId?: string) =>
    [...fleetVehicles].sort(
      (a, b) =>
        Number(!!a.driver && a.driver.id !== driverId) -
          Number(!!b.driver && b.driver.id !== driverId) ||
        a.licensePlate.localeCompare(b.licensePlate)
    );

  const changeVehicle = useMutation({
    mutationFn: ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null }) =>
      api.put(`/admin/drivers/${driverId}`, { vehicleId }),
    onSuccess: (res) => {
      toast.success("Vehicle changed");
      setSelected((s: any) => (s ? { ...s, vehicle: res.data.data.vehicle } : s));
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Could not change the vehicle"),
  });

  const { data: expiringDocs } = useQuery({
    queryKey: ["expiring-docs"],
    queryFn: () =>
      api
        .get("/admin/drivers/documents/expiring", { params: { days: 60 } })
        .then((r) => r.data.data),
  });

  const { data: suggestedPhoto, isLoading: suggestedLoading } = useQuery({
    queryKey: ["suggested-photo", selected?.id],
    queryFn: () =>
      api
        .get(`/admin/drivers/${selected.id}/suggested-photo`)
        .then((r) => r.data),
    enabled: !!selected?.id && !selected?.photoUrl,
    retry: false,
  });

  // Once the suggested badge URL arrives, load it into the cropper
  useEffect(() => {
    if (suggestedPhoto?.badgeUrl && !uploadMode) {
      loadCropImage(suggestedPhoto.badgeUrl);
    }
  }, [suggestedPhoto?.badgeUrl, uploadMode]);

  const savePhoto = useMutation({
    mutationFn: (payload: { photoUrl?: string; image?: string }) =>
      api.patch(`/admin/drivers/${selected.id}/photo`, payload),
    onSuccess: (res) => {
      toast.success("Profile photo updated");
      const finalUrl = res?.data?.photoUrl;
      setSelected((s: any) => (s ? { ...s, photoUrl: finalUrl } : s));
      setReplacingPhoto(false);
      setUploadMode(false);
      setUploadPreview(null);
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.error ?? "Failed to save photo"),
  });

  const addDriver = useMutation({
    mutationFn: (payload: any) => api.post("/admin/drivers", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      setFormError("");
    },
    onError: (err: any) => {
      setFormError(err.response?.data?.error ?? "Failed to create driver");
    },
  });

  const editDriver = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      api.put(`/admin/drivers/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setShowAdd(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError("");
    },
    onError: (err: any) =>
      setFormError(err.response?.data?.error ?? "Failed to update driver"),
  });

  const openEdit = (d: any) => {
    setEditing(d);
    setForm({
      firstName: d.user.firstName,
      lastName: d.user.lastName,
      phone: d.user.phone,
      email: d.user.email ?? "",
      pcoBadgeNumber: d.pcoBadgeNumber,
      pcoLicenseExpiry: d.pcoLicenseExpiry?.split("T")[0] ?? "",
      drivingLicenseNumber: d.drivingLicenseNumber ?? "",
      vehicleId: d.vehicle?.id ?? "",
      availableFrom: "",
    });
    setFormError("");
    setShowAdd(true);
    setSelected(null);
  };

  const set =
    (key: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () => {
    setFormError("");
    if (!editing) {
      const required = [
        "firstName",
        "lastName",
        "phone",
        "pcoBadgeNumber",
        "pcoLicenseExpiry",
        "drivingLicenseNumber",
      ];
      const missing = required.find(
        (k) => !form[k as keyof typeof form].trim()
      );
      if (missing) {
        setFormError("Please fill in all required fields");
        return;
      }
    }

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      pcoBadgeNumber: form.pcoBadgeNumber.trim(),
      pcoLicenseExpiry: form.pcoLicenseExpiry,
      drivingLicenseNumber: form.drivingLicenseNumber.trim(),
      vehicleId: form.vehicleId || null,
      ...(!editing && form.availableFrom ? { availableFrom: form.availableFrom } : {}),
    };

    if (editing) {
      editDriver.mutate({ id: editing.id, payload });
    } else {
      addDriver.mutate(payload);
    }
  };

  const drivers: any[] = data?.items ?? data ?? [];
  const activeDriverCount = drivers.filter((d: any) => !d.archivedAt).length;
  const filtered = search
    ? drivers.filter(
        (d) =>
          `${d.user.firstName} ${d.user.lastName}`
            .toLowerCase()
            .includes(search.toLowerCase()) ||
          d.pcoBadgeNumber.includes(search) ||
          d.vehicle?.licensePlate?.toLowerCase().includes(search.toLowerCase())
      )
    : drivers;

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Drivers"
        subtitle={`${activeDriverCount} driver${activeDriverCount === 1 ? "" : "s"} · vehicles and the TfL 20-vehicle limit are on the Vehicles page`}
        action={
          <button
            onClick={() => {
              setShowAdd(true);
              setFormError("");
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold transition-colors"
          >
            <UserPlus size={15} />
            Add Driver
          </button>
        }
      />

      {/* Expiry alerts */}
      {expiringDocs?.length > 0 && (
        <div className="card p-4 border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-center gap-2 text-yellow-400 mb-3">
            <AlertTriangle size={14} />
            <span className="text-sm font-medium">
              {expiringDocs.length} documents expired or expiring within 60 days
            </span>
          </div>
          <div className="space-y-1.5">
            {expiringDocs.slice(0, 3).map((doc: any) => (
              <div
                key={doc.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-400">
                  {doc.owner.label} — {doc.label}
                </span>
                <span
                  className={`font-medium ${
                    doc.daysLeft < 0 ? "text-red-400" : "text-yellow-400"
                  }`}
                >
                  {doc.daysLeft < 0 ? "Expired" : "Expires"}{" "}
                  {format(new Date(doc.expiryDate), "dd MMM yyyy")}
                </span>
              </div>
            ))}
            {expiringDocs.length > 3 && (
              <p className="text-xs text-slate-600">
                +{expiringDocs.length - 3} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            className="input pl-9"
            placeholder="Search name, PCO badge, plate…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="input w-auto"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size={24} />
          </div>
        ) : (
          <Table
            headers={[
              "Driver",
              "PCO Badge",
              "Vehicle",
              "Status",
              "Documents",
              "Rating",
              "Total Jobs",
              "PCO Expiry",
              "ULEZ",
              "Location",
            ]}
            isEmpty={!filtered.length}
            emptyMessage="No drivers found"
          >
            {filtered.map((d: any) => {
              const isArchived = !!d.archivedAt;
              const pcoExpiry = new Date(d.pcoLicenseExpiry);
              const daysUntil = Math.ceil(
                (pcoExpiry.getTime() - Date.now()) / 86400000
              );
              const isExpiringSoon = daysUntil <= 30;
              return (
                <tr
                  key={d.id}
                  className={`table-row cursor-pointer ${
                    isArchived ? "opacity-40" : ""
                  }`}
                  onClick={() => setSelected(d)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-bold">
                        {d.user.firstName[0]}
                        {d.user.lastName[0]}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-white">
                          {d.user.firstName} {d.user.lastName}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {d.callSign && (
                            <span className="font-mono text-slate-400 mr-1.5">{d.callSign}</span>
                          )}
                          {d.user.phone}
                        </p>
                        {isArchived && d.leftOn && (
                          <p className="text-[10px] text-slate-500">
                            Left {dayText(d.leftOn.slice(0, 10))}
                            {d.deletableFrom && ` · keep until ${dayText(d.deletableFrom.slice(0, 10))}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {d.pcoBadgeNumber}
                  </td>
                  <td className="px-4 py-3">
                    {d.vehicle ? (
                      <div>
                        <p className="text-xs text-white">
                          {d.vehicle.make} {d.vehicle.model}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {d.vehicle.licensePlate} · {d.vehicle.colour}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">No vehicle</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isArchived ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-500">
                        ARCHIVED
                      </span>
                    ) : (
                      <DriverBadge status={d.status} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.compliance ? (
                      d.compliance.eligible ? (
                        <span
                          className={`text-xs font-medium ${
                            d.compliance.expiringSoon
                              ? "text-amber-400"
                              : "text-green-400"
                          }`}
                          title={
                            d.compliance.expiringSoon
                              ? `${d.compliance.expiringSoon} expiring within 30 days`
                              : "All approved and in date"
                          }
                        >
                          {d.compliance.expiringSoon ? "⚠ Expiring" : "✓ OK"}
                        </span>
                      ) : (
                        <span
                          className="text-xs text-red-400 font-medium block max-w-[180px] truncate"
                          title={d.compliance.summary}
                        >
                          ✗ {d.compliance.summary}
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-brand-400 text-xs font-medium">
                      ★ {d.rating.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {d.totalJobs}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium ${
                        isExpiringSoon ? "text-red-400" : "text-slate-400"
                      }`}
                    >
                      {isExpiringSoon && (
                        <AlertTriangle size={10} className="inline mr-1" />
                      )}
                      {format(pcoExpiry, "dd MMM yyyy")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {d.vehicle?.isUlezCompliant ? (
                      <span className="text-xs text-green-400 font-medium">
                        ✓ ULEZ
                      </span>
                    ) : d.vehicle ? (
                      <span className="text-xs text-red-400">✗ Non-ULEZ</span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {d.liveLocation ? (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />{" "}
                        Live
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>

      {/* ── Add/Edit Driver Modal ── */}
      <Modal
        open={showAdd}
        onClose={() => {
          setShowAdd(false);
          setEditing(null);
          setForm(EMPTY_FORM);
        }}
        title={
          editing
            ? `Edit — ${editing?.user?.firstName} ${editing?.user?.lastName}`
            : "Add New Driver"
        }
      >
        <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
          {/* Personal */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Personal Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  First Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="John"
                  value={form.firstName}
                  onChange={set("firstName")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Last Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={set("lastName")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Phone <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  placeholder="+447700900000"
                  value={form.phone}
                  onChange={set("phone")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Email
                </label>
                <input
                  className="input w-full"
                  placeholder="john@email.com"
                  value={form.email}
                  onChange={set("email")}
                />
              </div>
            </div>
          </div>

          {/* PCO */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              PCO / Licence
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PCO Badge No. <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="PCO123456"
                  value={form.pcoBadgeNumber}
                  onChange={set("pcoBadgeNumber")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  PCO Expiry <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full"
                  type="date"
                  value={form.pcoLicenseExpiry}
                  onChange={set("pcoLicenseExpiry")}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">
                  Driving Licence No. <span className="text-red-400">*</span>
                </label>
                <input
                  className="input w-full font-mono"
                  placeholder="SMITH123456AB9CD"
                  value={form.drivingLicenseNumber}
                  onChange={set("drivingLicenseNumber")}
                />
              </div>
              {!editing && (
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">
                    Date first available
                  </label>
                  <input
                    className="input w-full"
                    type="date"
                    max={ukTodayKey()}
                    value={form.availableFrom}
                    onChange={set("availableFrom")}
                  />
                  <p className="text-[10px] text-slate-600 mt-1">
                    TfL register. Leave empty for today.
                  </p>
                </div>
              )}
            </div>
            {!editing && (
              <p className="text-[10px] text-slate-600 mt-2">
                Address, date of birth, NI number and call sign go in the driver&apos;s
                TfL register section after they are created.
              </p>
            )}
          </div>

          {/* Vehicle */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">
              Vehicle
            </p>
            <select
              className="input w-full"
              value={form.vehicleId}
              onChange={set("vehicleId")}
            >
              <option value="">No vehicle (assign later)</option>
              {vehicleOptions(editing?.id).map((v: any) => (
                <option key={v.id} value={v.id}>
                  {v.licensePlate} — {v.make} {v.model}
                  {v.driver && v.driver.id !== editing?.id
                    ? ` (currently ${v.driver.user.firstName} ${v.driver.user.lastName ?? ""})`
                    : ""}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-600 mt-2">
              New car? Add it on the{" "}
              <a href="/vehicles" className="text-brand-400 hover:text-brand-300">
                Vehicles page
              </a>{" "}
              first, then pick it here. Vehicle details are edited there too.
            </p>
          </div>
        </div>

        {formError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-3">
            {formError}
          </p>
        )}

        <div className="flex gap-3 pt-3">
          <button
            onClick={() => setShowAdd(false)}
            className="flex-1 btn-ghost py-2.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={addDriver.isPending || editDriver.isPending}
            className="flex-2 flex-1 px-6 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-400 disabled:opacity-50 text-black text-sm font-semibold transition-colors"
          >
            {addDriver.isPending || editDriver.isPending
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
              ? "Save Changes"
              : "Create Driver"}
          </button>
        </div>
      </Modal>

      {/* ── Driver detail modal ── */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          selected ? `${selected.user.firstName} ${selected.user.lastName}` : ""
        }
      >
        {selected && (
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* Action buttons */}
            <div className="flex gap-2 justify-end flex-wrap">
              <a
                href={`/tfl-records?driver=${selected.id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500 transition-colors"
              >
                <Printer size={12} /> TfL record
              </a>
              {!selected.archivedAt ? (
                <>
                  <button
                    onClick={() => openEdit(selected)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500 transition-colors"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                  <button
                    onClick={() => setArchiveFor(selected)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Archive size={12} /> Archive (left)
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setRestoreFor(selected)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] text-slate-300 hover:text-white hover:border-brand-500 transition-colors"
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                  {(() => {
                    const from = selected.deletableFrom?.slice(0, 10) ?? null;
                    const can = !!from && from <= ukTodayKey();
                    return (
                      <button
                        onClick={() => can && setDeleteFor(selected)}
                        disabled={!can}
                        title={
                          can
                            ? "Delete permanently"
                            : `TfL: records are kept for 12 months after leaving${from ? ` — can be deleted from ${dayText(from)}` : ""}`
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={12} /> Delete permanently
                      </button>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Status & stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                <p className="text-[10px] text-slate-500 mb-1">Status</p>
                <DriverBadge status={selected.status} />
              </div>
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                <p className="text-[10px] text-slate-500 mb-1">Rating</p>
                <p className="text-xs text-brand-400 font-medium">
                  ★ {selected.rating.toFixed(1)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                <p className="text-[10px] text-slate-500 mb-1">Total Jobs</p>
                <p className="text-xs text-[var(--text)] font-medium">
                  {selected.totalJobs}
                </p>
              </div>
            </div>

            {/* Profile Photo */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Profile Photo
                </p>
                {selected.photoUrl && !replacingPhoto && (
                  <span className="text-[10px] text-green-400 font-medium">
                    ✓ Live on passenger app
                  </span>
                )}
              </div>
              <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                {selected.photoUrl && !replacingPhoto ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={selected.photoUrl}
                      alt="Driver profile"
                      className="w-16 h-16 rounded-full object-cover border border-[var(--border)]"
                    />
                    <button
                      onClick={() => setReplacingPhoto(true)}
                      className="text-[11px] text-brand-400 hover:text-brand-300"
                    >
                      Replace photo
                    </button>
                  </div>
                ) : uploadMode ? (
                  <div className="space-y-3">
                    {uploadPreview ? (
                      <div className="flex items-center gap-4">
                        <img
                          src={uploadPreview}
                          alt="Upload preview"
                          className="w-24 h-24 rounded-full object-cover border border-[var(--border)]"
                        />
                        <button
                          onClick={() => setUploadPreview(null)}
                          className="text-[11px] text-slate-500 hover:text-slate-300"
                        >
                          Choose a different file
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 py-6 cursor-pointer hover:border-brand-500/50 transition-colors">
                        <Upload size={18} className="text-slate-500" />
                        <span className="text-[11px] text-slate-400">
                          Click to choose a photo
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileSelect}
                        />
                      </label>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setUploadMode(false);
                          setUploadPreview(null);
                        }}
                        className="flex-1 text-[11px] text-slate-500 hover:text-slate-300 py-2"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() =>
                          uploadPreview &&
                          savePhoto.mutate({ image: uploadPreview })
                        }
                        disabled={!uploadPreview || savePhoto.isPending}
                        className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-xs font-medium transition-all disabled:opacity-50"
                      >
                        {savePhoto.isPending ? (
                          <Spinner size={13} />
                        ) : (
                          <CheckCircle size={13} />
                        )}
                        Confirm & Publish
                      </button>
                    </div>
                  </div>
                ) : suggestedLoading ? (
                  <div className="flex justify-center py-4">
                    <Spinner size={16} />
                  </div>
                ) : suggestedPhoto?.badgeUrl ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-slate-400">
                      Auto-cropped from PCO badge — drag to reposition, then
                      review before publishing.
                    </p>

                    <div className="flex justify-center">
                      {!imgLoaded ? (
                        <div
                          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
                          className="flex items-center justify-center rounded-full bg-slate-800/50"
                        >
                          <Spinner size={18} />
                        </div>
                      ) : (
                        <canvas
                          ref={previewCanvasRef}
                          width={PREVIEW_SIZE}
                          height={PREVIEW_SIZE}
                          className="rounded-full border border-[var(--border)] cursor-grab active:cursor-grabbing touch-none"
                          onMouseDown={(e) => onDragStart(e.clientX, e.clientY)}
                          onMouseMove={(e) => onDragMove(e.clientX, e.clientY)}
                          onMouseUp={onDragEnd}
                          onMouseLeave={onDragEnd}
                          onTouchStart={(e) =>
                            onDragStart(
                              e.touches[0].clientX,
                              e.touches[0].clientY
                            )
                          }
                          onTouchMove={(e) =>
                            onDragMove(
                              e.touches[0].clientX,
                              e.touches[0].clientY
                            )
                          }
                          onTouchEnd={onDragEnd}
                        />
                      )}
                    </div>

                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => setRotation((r) => (r + 270) % 360)}
                        className="p-1.5 rounded border border-[var(--border)] text-slate-400 hover:text-white transition-colors"
                        title="Rotate left"
                      >
                        <RotateCcw size={13} />
                      </button>
                      <button
                        onClick={() => setRotation((r) => (r + 90) % 360)}
                        className="p-1.5 rounded border border-[var(--border)] text-slate-400 hover:text-white transition-colors"
                        title="Rotate right"
                      >
                        <RotateCw size={13} />
                      </button>
                      {(pan.x !== 0 || pan.y !== 0) && (
                        <button
                          onClick={() => setPan({ x: 0, y: 0 })}
                          className="px-2 text-[11px] text-slate-500 hover:text-slate-300"
                        >
                          Recentre
                        </button>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 flex justify-between mb-1">
                        <span>Zoom</span>
                        <span>{cropZoom.toFixed(1)}x</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={cropZoom}
                        onChange={(e) =>
                          setCropZoom(parseFloat(e.target.value))
                        }
                        className="w-full accent-brand-500"
                      />
                    </div>

                    <button
                      onClick={() => {
                        const dataUrl = exportCroppedPhoto();
                        if (dataUrl) savePhoto.mutate({ image: dataUrl });
                        else
                          toast.error(
                            "Couldn't process the photo — try again."
                          );
                      }}
                      disabled={savePhoto.isPending || !imgLoaded}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-xs font-medium transition-all disabled:opacity-50"
                    >
                      {savePhoto.isPending ? (
                        <Spinner size={13} />
                      ) : (
                        <CheckCircle size={13} />
                      )}
                      Confirm & Publish to Passenger App
                    </button>

                    <button
                      onClick={() => setUploadMode(true)}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 py-1"
                    >
                      <Upload size={11} /> Or upload a different photo instead
                    </button>

                    {replacingPhoto && (
                      <button
                        onClick={() => setReplacingPhoto(false)}
                        className="w-full text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      No approved PCO badge on file yet.
                    </p>
                    <button
                      onClick={() => setUploadMode(true)}
                      className="flex items-center gap-1.5 text-[11px] text-brand-400 hover:text-brand-300"
                    >
                      <Upload size={11} /> Upload a photo manually
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Contact */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                Contact
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                  <p className="text-[10px] text-slate-500 mb-1">Phone</p>
                  <p className="text-xs text-[var(--text)] font-mono">
                    {selected.user.phone}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]">
                  <p className="text-[10px] text-slate-500 mb-1">Email</p>
                  <p className="text-xs text-[var(--text)]">
                    {selected.user.email ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* TfL driver register */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                TfL driver register
              </p>
              <DriverRegisterPanel driverId={selected.id} />
            </div>

            {/* Licence */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                Licence
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "PCO Badge",
                    value: (
                      <span className="font-mono">
                        {selected.pcoBadgeNumber}
                      </span>
                    ),
                  },
                  {
                    label: "PCO Expiry",
                    value: format(
                      new Date(selected.pcoLicenseExpiry),
                      "dd MMM yyyy"
                    ),
                  },
                  {
                    label: "Driving Licence No.",
                    value: (
                      <span className="font-mono">
                        {selected.drivingLicenseNumber ?? "—"}
                      </span>
                    ),
                  },
                  {
                    label: "Onboarded",
                    value: selected.onboardingComplete ? "✓ Yes" : "✗ Pending",
                  },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)]"
                  >
                    <p className="text-[10px] text-slate-500 mb-1">{label}</p>
                    <div className="text-xs text-[var(--text)] font-medium">
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Vehicle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Vehicle
                </p>
                {selected.vehicle && (
                  <a
                    href={`/vehicles?id=${selected.vehicle.id}`}
                    className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    Edit on Vehicles page
                    <ExternalLink size={10} />
                  </a>
                )}
              </div>
              {!selected.archivedAt && (
                <div className="flex items-center gap-2 mb-2">
                  <select
                    className="input flex-1 text-xs"
                    value={selected.vehicle?.id ?? ""}
                    disabled={changeVehicle.isPending}
                    onChange={(e) =>
                      changeVehicle.mutate({
                        driverId: selected.id,
                        vehicleId: e.target.value || null,
                      })
                    }
                    aria-label="Change vehicle"
                  >
                    <option value="">No vehicle</option>
                    {vehicleOptions(selected.id).map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.licensePlate} — {v.make} {v.model}
                        {v.driver && v.driver.id !== selected.id
                          ? ` (currently ${v.driver.user.firstName} ${v.driver.user.lastName ?? ""})`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {changeVehicle.isPending && <Spinner size={14} />}
                </div>
              )}
              {!selected.vehicle && (
                <p className="text-xs text-slate-500">
                  No vehicle assigned — this driver won't receive jobs until they have one.
                </p>
              )}
            </div>
            {selected.vehicle && (
              <div>
                <div className="p-3 rounded-lg bg-[var(--card-hover)] border border-[var(--border)] space-y-3">
                  <div>
                    <p className="text-sm text-[var(--text)] font-medium">
                      {selected.vehicle.year} {selected.vehicle.make}{" "}
                      {selected.vehicle.model} · {selected.vehicle.colour}
                    </p>
                    <div className="flex gap-4 mt-1 text-xs text-slate-500 flex-wrap">
                      <span>
                        Plate:{" "}
                        <span className="font-mono text-slate-300">
                          {selected.vehicle.licensePlate}
                        </span>
                      </span>
                      <span>Class: {selected.vehicle.class}</span>
                      <span>Seats: {selected.vehicle.seats}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)]">
                    {[
                      {
                        label: "PHV Licence",
                        value: selected.vehicle.phvLicenceNumber ? (
                          <span className="font-mono">
                            {selected.vehicle.phvLicenceNumber}
                          </span>
                        ) : (
                          "—"
                        ),
                      },
                      {
                        label: "PHV Expiry",
                        value: selected.vehicle.phvLicenceExpiry
                          ? format(
                              new Date(selected.vehicle.phvLicenceExpiry),
                              "dd MMM yyyy"
                            )
                          : "—",
                      },
                      {
                        label: "MOT Expiry",
                        value: selected.vehicle.motExpiry
                          ? format(
                              new Date(selected.vehicle.motExpiry),
                              "dd MMM yyyy"
                            )
                          : "—",
                      },
                      {
                        label: "Insurance Expiry",
                        value: selected.vehicle.insuranceExpiry
                          ? format(
                              new Date(selected.vehicle.insuranceExpiry),
                              "dd MMM yyyy"
                            )
                          : "—",
                      },
                      {
                        label: "PHV Disc No.",
                        value: selected.vehicle.phvDiscNumber ? (
                          <span className="font-mono">
                            {selected.vehicle.phvDiscNumber}
                          </span>
                        ) : (
                          "—"
                        ),
                      },
                      {
                        label: "Emission",
                        value: selected.vehicle.emissionStandard ?? "—",
                      },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[10px] text-slate-500">{label}</p>
                        <p className="text-xs text-[var(--text)] font-medium mt-0.5">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 pt-2 border-t border-[var(--border)] text-xs">
                    <span
                      className={
                        selected.vehicle.isUlezCompliant
                          ? "text-green-400 font-medium"
                          : "text-red-400"
                      }
                    >
                      {selected.vehicle.isUlezCompliant
                        ? "✓ ULEZ Compliant"
                        : "✗ Non-ULEZ"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Vehicle history */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
                Vehicle history
              </p>
              <DriverVehicleHistory driverId={selected.id} />
            </div>

            {/* Documents */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">
                  Documents
                </p>
                <a
                  href={`/documents?driver=${selected.id}&tab=all`}
                  className="text-[11px] text-brand-400 hover:underline"
                >
                  View in Documents →
                </a>
              </div>
              <DocumentsPanel
                driverId={selected.id}
                ownerLabel={`${selected.user.firstName} ${selected.user.lastName ?? ""}`.trim()}
              />
            </div>
          </div>
        )}
      </Modal>

      <ArchiveDriverModal
        driver={archiveFor}
        onClose={() => setArchiveFor(null)}
        onDone={() => {
          setArchiveFor(null);
          setSelected(null);
        }}
      />
      <RestoreDriverModal
        driver={restoreFor}
        onClose={() => setRestoreFor(null)}
        onDone={() => {
          setRestoreFor(null);
          setSelected(null);
        }}
      />
      <DeleteDriverModal
        driver={deleteFor}
        onClose={() => setDeleteFor(null)}
        onDone={() => {
          setDeleteFor(null);
          setSelected(null);
        }}
      />
    </div>
  );
}
