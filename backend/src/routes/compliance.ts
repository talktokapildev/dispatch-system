// backend/src/routes/compliance.ts
//
// GET  /api/v1/admin/compliance           — run all checks, return full report
// POST /api/v1/admin/compliance/confirm   — confirm a manual item
//        body: { key: string, notes?: string }

import { FastifyInstance } from "fastify";

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = "PASS" | "WARN" | "FAIL";

interface AutomatedCheck {
  id: string;
  condition: number | null; // null = operational alert, not a numbered condition
  title: string;
  status: CheckStatus;
  value: string; // display value e.g. "3 / 20"
  detail: string; // what was actually found
  requirement: string; // what TfL requires
  howToFix?: string; // shown when FAIL or WARN
}

interface ManualCheck {
  id: string;
  condition: number | null;
  title: string;
  requirement: string;
  howToConfirm: string;
  confirmedAt?: string;
  confirmedBy?: string;
  notes?: string;
}

// ── Manual item definitions ───────────────────────────────────────────────────

const MANUAL_ITEMS: Omit<
  ManualCheck,
  "confirmedAt" | "confirmedBy" | "notes"
>[] = [
  {
    id: "insurance",
    condition: 1,
    title: "Public Liability Insurance",
    requirement:
      "Maintain public liability insurance with a minimum indemnity of £5m for any one event, accessible to members of the public.",
    howToConfirm:
      "Verify your current insurance certificate covers private hire operations with £5m minimum cover. Check the expiry date.",
  },
  {
    id: "fare_agreement",
    condition: 2,
    title: "Fare Agreement Before Journey",
    requirement:
      "Agree the fare for the journey or provide an accurate estimate before the booking is accepted.",
    howToConfirm:
      "Confirm the passenger app and booking flow shows fare estimate before confirmation on every booking type.",
  },
  {
    id: "self_reporting",
    condition: 3,
    title: "Self-Reporting to TfL (48 hours)",
    requirement:
      "If arrested, charged, cautioned or convicted of any offence, notify TfL within 48 hours. Includes all driving offences and Fixed Penalty Notices.",
    howToConfirm:
      "Confirm you have a personal process in place to notify TfL within 48 hours of any relevant incident.",
  },
  {
    id: "licence_changes",
    condition: 4,
    title: "Notify TfL of Licence Changes",
    requirement:
      "Notify TfL of any material changes to the information provided for your licence within 14 days.",
    howToConfirm:
      "Confirm any changes to address, directors or key personnel have been notified to TfL.",
  },
  {
    id: "driver_dismissal",
    condition: 5,
    title: "Driver Dismissal Notification",
    requirement:
      "If a driver is dismissed for unsatisfactory conduct, notify TfL of the driver's name, circumstances and the driving of a private hire vehicle, within 14 days.",
    howToConfirm:
      "Confirm a process exists to notify TfL within 14 days of any driver dismissal for misconduct.",
  },
  {
    id: "no_cb_apparatus",
    condition: 6,
    title: "No CB Apparatus",
    requirement:
      "Shall not use CB (Citizens Band) apparatus in connection with private hire bookings.",
    howToConfirm:
      "Confirm CB radio is not used in your dispatch or operational process.",
  },
  {
    id: "fare_structure",
    condition: 10,
    title: "Fare Structure Compliance",
    requirement:
      "Must charge a fare in accordance with your published fare structure only. Must not use a taxi meter unless using a London licensed taxi.",
    howToConfirm:
      "Verify the pricing config reflects your published fare structure and no unapproved charges are being applied.",
  },
  {
    id: "licence_fee",
    condition: 12,
    title: "Annual Licence Fee Payment",
    requirement:
      "Annual licence fee instalments must be paid no later than 14 days before the end of the one-year period. Failure may result in licensing action.",
    howToConfirm:
      "Confirm the next annual instalment has been paid or scheduled. Licence anniversary: 07 January each year.",
  },
  {
    id: "operating_model",
    condition: 16,
    title: "Notify TfL of Operating Model Changes",
    requirement:
      "Notify TfL of any material changes to the operating model that may affect compliance with the PHV Act 1998 or licensing conditions, before those changes are made.",
    howToConfirm:
      "Confirm any planned changes to technology, booking process or driver/passenger contracts have been reviewed against TfL's guidance at tfl.gov.uk/info-for/taxis-and-private-hire/changes-to-operating-models.",
  },
  {
    id: "no_public_access",
    condition: null,
    title: "Code 8 — No Public Access",
    requirement:
      "Licence condition: Subject to No Public Access. All bookings must be made in advance through the licensed operator. PHV drivers must not ply for hire.",
    howToConfirm:
      "Confirm the service operates as advance-booking only and no walk-up / street hailing is facilitated or advertised.",
  },
  {
    id: "equality_safeguarding",
    condition: null,
    title: "Equality Act & Safeguarding",
    requirement:
      "Obligations under the Equality Act 2010 including assistance dog acceptance. Safeguarding policy for children and adults at risk must be in place.",
    howToConfirm:
      "Confirm you have read the PHV Operator's Handbook sections on Equality Act obligations and safeguarding, and policies are documented.",
  },
];

// ── Automated checks ──────────────────────────────────────────────────────────

async function runAutomatedChecks(
  prisma: FastifyInstance["prisma"]
): Promise<AutomatedCheck[]> {
  const now = Date.now();
  const days30 = new Date(now + 30 * 86400000);
  const days60 = new Date(now + 60 * 86400000);
  const days7 = new Date(now + 7 * 86400000);
  const ago7 = new Date(now - 7 * 86400000);
  const ago30 = new Date(now - 30 * 86400000);

  // Run all DB queries in parallel
  const [
    driverCount,
    contactPhone,
    staffList,
    lastUploadSetting,
    completedBookings,
    completedWithPhv,
    completedWithDispatcher,
    totalBookings,
    lostPropertyCount,
    activeVehicles,
    ulezVehicles,
    driversPcoExpiring,
    vehiclesMotExpiring,
    vehiclesInsuranceExpiring,
    recentCompleted,
    recentWithDriver,
    recentWithDispatcher,
  ] = await Promise.all([
    // 1. Vehicle cap
    prisma.driver.count(),

    // 2. Contact phone
    prisma.systemSetting.findUnique({ where: { key: "contactPhone" } }),

    // 3. Staff register + DBS
    prisma.user.findMany({
      where: { roles: { hasSome: ["ADMIN", "DISPATCHER"] } },
      include: { adminProfile: true },
    }),

    // 4. Weekly upload
    prisma.systemSetting.findUnique({ where: { key: "lastTflExportDate" } }),

    // 5. PHV on bookings (total completed with driver)
    prisma.booking.count({
      where: { status: "COMPLETED", driverId: { not: null } },
    }),

    // 6. PHV on bookings (with licence number)
    prisma.booking.count({
      where: {
        status: "COMPLETED",
        driverId: { not: null },
        driverPhvLicenceNumber: { not: null },
      },
    }),

    // 7. Respondent on bookings (with dispatchedBy)
    prisma.booking.count({
      where: { status: "COMPLETED", dispatchedBy: { not: null } },
    }),

    // 8. Total booking records
    prisma.booking.count(),

    // 9. Lost property records
    prisma.lostProperty.count(),

    // 10. Active vehicles (ULEZ)
    prisma.vehicle.count({ where: { isActive: true } }),

    // 11. ULEZ compliant vehicles
    prisma.vehicle.count({ where: { isActive: true, isUlezCompliant: true } }),

    // 12. Drivers with PCO expiring within 60 days
    prisma.driver.count({ where: { pcoLicenseExpiry: { lte: days60 } } }),

    // 13. Vehicles with MOT expiring within 30 days
    prisma.vehicle.count({
      where: { isActive: true, motExpiry: { lte: days30 } },
    }),

    // 14. Vehicles with insurance expiring within 30 days
    prisma.vehicle.count({
      where: { isActive: true, insuranceExpiry: { lte: days30 } },
    }),

    // 15. Recent completed bookings (last 30 days)
    prisma.booking.count({
      where: { status: "COMPLETED", completedAt: { gte: ago30 } },
    }),

    // 16. Recent completed with driver assigned
    prisma.booking.count({
      where: {
        status: "COMPLETED",
        completedAt: { gte: ago30 },
        driverId: { not: null },
      },
    }),

    // 17. Recent completed with dispatcher recorded (last 30 days only)
    prisma.booking.count({
      where: {
        status: "COMPLETED",
        completedAt: { gte: ago30 },
        dispatchedBy: { not: null },
      },
    }),
  ]);

  // ── Process results ────────────────────────────────────────────────────────

  // Condition 11 — Vehicle cap
  const vehicleCap: AutomatedCheck = {
    id: "vehicle_cap",
    condition: 11,
    title: "Vehicle Cap (Max 20)",
    status: driverCount >= 20 ? "FAIL" : driverCount >= 18 ? "WARN" : "PASS",
    value: `${driverCount} / 20`,
    detail: `${driverCount} active driver${
      driverCount !== 1 ? "s" : ""
    } registered`,
    requirement:
      "Must not exceed 20 PHVs available at all operating centres at any time (Tier 11-20 licence). Exceeding this is a breach and may result in licence suspension.",
    howToFix:
      driverCount >= 20
        ? "You have reached the maximum. Remove a driver before registering new ones."
        : driverCount >= 18
        ? `You can add ${20 - driverCount} more driver${
            20 - driverCount === 1 ? "" : "s"
          } before reaching the cap.`
        : undefined,
  };

  // Condition 14 — Contact phone
  const hasPhone = !!contactPhone?.value?.trim();
  const contactCheck: AutomatedCheck = {
    id: "contact_phone",
    condition: 14,
    title: "Operating Centre Contact",
    status: hasPhone ? "PASS" : "FAIL",
    value: hasPhone ? contactPhone!.value : "Not set",
    detail: hasPhone
      ? `Contact number ${
          contactPhone!.value
        } is set and displayed in passenger app`
      : "No contact phone number configured in Settings → General",
    requirement:
      "The passenger must be able to speak to a person at the operating centre at all times during business hours and during a journey.",
    howToFix: !hasPhone
      ? "Add a contact phone number in Settings → General."
      : undefined,
  };

  // Condition 18 — Annual DBS (operator, due 07 Jan each year)
  const adminUser = staffList.find((s: any) => s.roles?.includes("ADMIN"));
  const dbs = adminUser?.adminProfile;
  const dbsCheckDate = dbs?.dbsCheckDate ? new Date(dbs.dbsCheckDate) : null;
  const nextJan7 = (() => {
    const d = new Date();
    d.setMonth(0);
    d.setDate(7);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  })();
  const daysToAnniversary = Math.ceil((nextJan7.getTime() - now) / 86400000);
  const dbsStatus: CheckStatus = !dbsCheckDate
    ? "FAIL"
    : daysToAnniversary <= 28
    ? "WARN"
    : "PASS";
  const operatorDbs: AutomatedCheck = {
    id: "operator_dbs",
    condition: 18,
    title: "Annual DBS — Operator",
    status: dbsStatus,
    value: dbsCheckDate
      ? `${daysToAnniversary} days to next renewal`
      : "No DBS recorded",
    detail: dbsCheckDate
      ? `Last check: ${dbsCheckDate.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })} · Next renewal due: ${nextJan7.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`
      : "No DBS certificate date recorded in Staff Register",
    requirement:
      "Within 28 days of each licence anniversary (07 January), undertake a Basic DBS check. Certificate must be provided to TfL within 7 days of request.",
    howToFix:
      dbsStatus !== "PASS"
        ? "Update DBS details in Staff Register. Renew via TfL's approved service provider."
        : undefined,
  };

  // Condition 19 + 24 — Staff register completeness + DBS checks
  const totalStaff = staffList.length;
  const completeStaff = staffList.filter(
    (s: any) =>
      s.firstName &&
      s.lastName &&
      s.adminProfile?.dateOfBirth &&
      s.adminProfile?.dbsCertificateNumber &&
      s.adminProfile?.dbsCheckDate
  ).length;
  const staffPct =
    totalStaff > 0 ? Math.round((completeStaff / totalStaff) * 100) : 100;
  const staffRegister: AutomatedCheck = {
    id: "staff_register",
    condition: 19,
    title: "Staff Register",
    status: staffPct === 100 ? "PASS" : staffPct >= 75 ? "WARN" : "FAIL",
    value: `${completeStaff} / ${totalStaff} complete`,
    detail: `${totalStaff} staff member${
      totalStaff !== 1 ? "s" : ""
    } · ${completeStaff} with full name, DOB and DBS details`,
    requirement:
      "Keep a register of all booking and dispatch staff including: (a) full name, (b) date of birth, (c) DBS certificate reference and date. All staff must have a basic DBS check.",
    howToFix:
      staffPct < 100
        ? `${totalStaff - completeStaff} staff member${
            totalStaff - completeStaff > 1 ? "s are" : " is"
          } missing details. Update in Staff Register.`
        : undefined,
  };

  // Condition 20 — Weekly upload
  const lastUpload = lastUploadSetting?.value
    ? new Date(lastUploadSetting.value)
    : null;
  const daysSinceUpload = lastUpload
    ? Math.floor((now - lastUpload.getTime()) / 86400000)
    : null;
  const uploadStatus: CheckStatus = !lastUpload
    ? "FAIL"
    : daysSinceUpload! > 7
    ? "FAIL"
    : daysSinceUpload! > 5
    ? "WARN"
    : "PASS";
  const weeklyUpload: AutomatedCheck = {
    id: "weekly_upload",
    condition: 20,
    title: "Weekly TfL Upload",
    status: uploadStatus,
    value: lastUpload
      ? `${daysSinceUpload} day${daysSinceUpload !== 1 ? "s" : ""} ago`
      : "Never recorded",
    detail: lastUpload
      ? `Last recorded upload: ${lastUpload.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}`
      : "No TfL upload has been recorded in the system",
    requirement:
      "Every Monday, upload driver data report and vehicle data report to tfl.gov.uk/ph-operators.",
    howToFix:
      uploadStatus !== "PASS"
        ? 'Go to Reports → TfL Weekly Upload and download both CSVs, then upload to tfl.gov.uk/ph-operators. Click "Mark as Uploaded" here to record completion.'
        : undefined,
  };

  // Condition 21 — PHV licence on bookings
  const phvPct =
    completedBookings > 0
      ? Math.round((completedWithPhv / completedBookings) * 100)
      : 100;
  const phvCheck: AutomatedCheck = {
    id: "phv_on_bookings",
    condition: 21,
    title: "PHV Licence on Booking Records",
    status: phvPct === 100 ? "PASS" : phvPct >= 90 ? "WARN" : "FAIL",
    value: `${phvPct}% (${completedWithPhv} / ${completedBookings})`,
    detail: `${completedWithPhv} of ${completedBookings} completed bookings have PHV licence number recorded`,
    requirement:
      "From 1 July 2024, each booking record must include the driver's PHV licence number.",
    howToFix:
      phvPct < 100
        ? `${completedBookings - completedWithPhv} booking${
            completedBookings - completedWithPhv > 1 ? "s are" : " is"
          } missing PHV licence. Run the backfill SQL from the compliance setup docs.`
        : undefined,
  };

  // Condition 22 — Vehicle reg on bookings (check via drivers having vehicles)
  const driversWithVehicle = await prisma.driver.count({
    where: { vehicle: { isNot: null } },
  });
  const vehicleRegPct =
    driverCount > 0
      ? Math.round((driversWithVehicle / driverCount) * 100)
      : 100;
  const vehicleRegCheck: AutomatedCheck = {
    id: "vehicle_reg_on_bookings",
    condition: 22,
    title: "Vehicle Reg on Booking Records",
    status:
      vehicleRegPct === 100 ? "PASS" : vehicleRegPct >= 90 ? "WARN" : "FAIL",
    value: `${driversWithVehicle} / ${driverCount} drivers`,
    detail: `${driversWithVehicle} of ${driverCount} driver${
      driverCount !== 1 ? "s" : ""
    } have a vehicle with registration plate registered`,
    requirement:
      "From 1 July 2024, each booking record must include the vehicle registration mark.",
    howToFix:
      vehicleRegPct < 100
        ? "Some drivers have no vehicle registered. Add vehicle details via Drivers → Edit."
        : undefined,
  };

  // Condition 23 — Respondent on bookings (last 30 days only)
  // Older bookings predate the dispatchedBy field — checking all-time would always fail.
  // We only check recent bookings so the metric reflects current system behaviour.
  const recentDispatcherPct =
    recentCompleted > 0
      ? Math.round((recentWithDispatcher / recentCompleted) * 100)
      : 100;
  const respondentCheck: AutomatedCheck = {
    id: "respondent_on_bookings",
    condition: 23,
    title: "Booking Respondent Recorded",
    status:
      recentDispatcherPct === 100
        ? "PASS"
        : recentDispatcherPct >= 80
        ? "WARN"
        : "FAIL",
    value:
      recentCompleted === 0
        ? "No recent bookings"
        : `${recentDispatcherPct}% (${recentWithDispatcher} / ${recentCompleted} in last 30 days)`,
    detail:
      recentCompleted === 0
        ? "No completed bookings in the last 30 days to check"
        : `${recentWithDispatcher} of ${recentCompleted} completed bookings (last 30 days) have dispatcher recorded`,
    requirement:
      "From 1 July 2024, each booking record must include the name of the individual who responded to the booking request.",
    howToFix:
      recentDispatcherPct < 80
        ? "Recent bookings are missing dispatcher record. Ensure all bookings are dispatched through the admin panel or auto-dispatch."
        : undefined,
  };

  // Condition 8 — Booking records preserved
  const bookingRecords: AutomatedCheck = {
    id: "booking_records",
    condition: 8,
    title: "Booking Records Preserved",
    status: totalBookings > 0 ? "PASS" : "WARN",
    value: `${totalBookings.toLocaleString()} records`,
    detail: `${totalBookings.toLocaleString()} booking records stored in the system`,
    requirement:
      "Shall preserve records of all private hire bookings, vehicles and drivers available to carry out bookings.",
  };

  // Condition 9 — Lost property procedure
  const lostProperty: AutomatedCheck = {
    id: "lost_property",
    condition: 9,
    title: "Lost Property Procedure",
    status: "PASS",
    value: `${lostPropertyCount} report${
      lostPropertyCount !== 1 ? "s" : ""
    } on record`,
    detail:
      "Lost property feature is active. Passengers can report via the app and admin can manage via Alerts.",
    requirement:
      "Must have and maintain a procedure for dealing with property left behind by customers. Must record and retain prescribed particulars of any property found or reported missing.",
  };

  // Condition 13 — Pre-journey particulars
  const particularsPct =
    recentCompleted > 0
      ? Math.round((recentWithDriver / recentCompleted) * 100)
      : 100;
  const preJourneyParticulars: AutomatedCheck = {
    id: "pre_journey_particulars",
    condition: 13,
    title: "Pre-Journey Driver Particulars",
    status:
      particularsPct >= 99 ? "PASS" : particularsPct >= 90 ? "WARN" : "FAIL",
    value: `${particularsPct}%`,
    detail: `${recentWithDriver} of ${recentCompleted} completed bookings (last 30 days) had driver assigned`,
    requirement:
      "Before the commencement of each journey, provide the passenger with driver and vehicle particulars as specified by the licensing authority.",
  };

  // Condition 25 — ULEZ
  const ulezPct =
    activeVehicles > 0
      ? Math.round((ulezVehicles / activeVehicles) * 100)
      : 100;
  const ulezCheck: AutomatedCheck = {
    id: "ulez",
    condition: 25,
    title: "ULEZ Compliance",
    status: ulezPct === 100 ? "PASS" : ulezPct >= 80 ? "WARN" : "FAIL",
    value: `${ulezVehicles} / ${activeVehicles} compliant`,
    detail: `${ulezVehicles} of ${activeVehicles} active vehicles marked as ULEZ compliant`,
    requirement:
      "PHVs travelling within the ULEZ must meet Euro 4 (petrol) or Euro 6 (diesel) emission standards. Subject to £12.50 daily charge if non-compliant.",
    howToFix:
      ulezPct < 100
        ? "Update ULEZ status on non-compliant vehicles in Drivers → Vehicle details."
        : undefined,
  };

  // Operational — Driver PCO expiry
  const pcoExpiry: AutomatedCheck = {
    id: "driver_pco_expiry",
    condition: null,
    title: "Driver PCO Licence Expiry",
    status: driversPcoExpiring > 0 ? "WARN" : "PASS",
    value:
      driversPcoExpiring > 0
        ? `${driversPcoExpiring} expiring soon`
        : "All current",
    detail:
      driversPcoExpiring > 0
        ? `${driversPcoExpiring} driver${
            driversPcoExpiring > 1 ? "s have" : " has"
          } PCO licence expiring within 60 days`
        : "No driver PCO licences expiring within 60 days",
    requirement:
      "All drivers must hold a valid TfL PCO licence at all times. A driver with an expired licence must not carry out bookings.",
    howToFix:
      driversPcoExpiring > 0
        ? "Review expiring PCO licences in Drivers → Documents."
        : undefined,
  };

  // Operational — Vehicle MOT
  const motExpiry: AutomatedCheck = {
    id: "vehicle_mot_expiry",
    condition: null,
    title: "Vehicle MOT Expiry",
    status: vehiclesMotExpiring > 0 ? "WARN" : "PASS",
    value:
      vehiclesMotExpiring > 0
        ? `${vehiclesMotExpiring} expiring soon`
        : "All current",
    detail:
      vehiclesMotExpiring > 0
        ? `${vehiclesMotExpiring} vehicle${
            vehiclesMotExpiring > 1 ? "s have" : " has"
          } MOT expiring within 30 days`
        : "No vehicle MOTs expiring within 30 days",
    requirement:
      "All PHVs must hold a valid MOT certificate at all times when in use for private hire.",
    howToFix:
      vehiclesMotExpiring > 0
        ? "Review expiring MOTs in Drivers → Vehicle details."
        : undefined,
  };

  // Operational — Vehicle insurance
  const insuranceExpiry: AutomatedCheck = {
    id: "vehicle_insurance_expiry",
    condition: null,
    title: "Vehicle Insurance Expiry",
    status: vehiclesInsuranceExpiring > 0 ? "WARN" : "PASS",
    value:
      vehiclesInsuranceExpiring > 0
        ? `${vehiclesInsuranceExpiring} expiring soon`
        : "All current",
    detail:
      vehiclesInsuranceExpiring > 0
        ? `${vehiclesInsuranceExpiring} vehicle${
            vehiclesInsuranceExpiring > 1 ? "s have" : " has"
          } insurance expiring within 30 days`
        : "No vehicle insurance policies expiring within 30 days",
    requirement:
      "All PHVs must be covered by hire and reward insurance at all times.",
    howToFix:
      vehiclesInsuranceExpiring > 0
        ? "Review expiring insurance in Drivers → Vehicle details."
        : undefined,
  };

  return [
    vehicleCap,
    contactCheck,
    operatorDbs,
    staffRegister,
    weeklyUpload,
    phvCheck,
    vehicleRegCheck,
    respondentCheck,
    bookingRecords,
    lostProperty,
    preJourneyParticulars,
    ulezCheck,
    pcoExpiry,
    motExpiry,
    insuranceExpiry,
  ];
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function complianceRoutes(fastify: FastifyInstance) {
  // ── GET /api/v1/admin/compliance ────────────────────────────────────────────
  fastify.get(
    "/admin/compliance",
    { preHandler: [fastify.authenticateAdmin] },
    async (_request, reply) => {
      const [automated, confirmations] = await Promise.all([
        runAutomatedChecks(fastify.prisma),
        fastify.prisma.complianceConfirmation.findMany(),
      ]);

      // Hydrate manual items with confirmation data
      const confirmMap = Object.fromEntries(
        confirmations.map((c) => [c.key, c])
      );

      // Resolve names for confirmations
      const confirmerIds = [
        ...new Set(confirmations.map((c) => c.confirmedBy)),
      ];
      const confirmerUsers = confirmerIds.length
        ? await fastify.prisma.user.findMany({
            where: { id: { in: confirmerIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const confirmerMap = Object.fromEntries(
        confirmerUsers.map((u) => [u.id, `${u.firstName} ${u.lastName}`])
      );

      const manual: ManualCheck[] = MANUAL_ITEMS.map((item) => {
        const conf = confirmMap[item.id];
        return {
          ...item,
          confirmedAt: conf?.confirmedAt?.toISOString(),
          confirmedBy: conf?.confirmedBy,
          confirmedByName: conf ? confirmerMap[conf.confirmedBy] : undefined,
          notes: conf?.notes ?? undefined,
        };
      });

      // Summary
      const autoPassing = automated.filter((c) => c.status === "PASS").length;
      const autoWarning = automated.filter((c) => c.status === "WARN").length;
      const autoFailing = automated.filter((c) => c.status === "FAIL").length;
      const manualConfirmed = manual.filter((m) => !!m.confirmedAt).length;
      const manualUnconfirmed = manual.filter((m) => !m.confirmedAt).length;

      return reply.send({
        automated,
        manual,
        summary: {
          autoPass: autoPassing,
          autoWarn: autoWarning,
          autoFail: autoFailing,
          manualConfirmed,
          manualUnconfirmed,
          totalIssues: autoWarning + autoFailing + manualUnconfirmed,
        },
        checkedAt: new Date().toISOString(),
      });
    }
  );

  // ── POST /api/v1/admin/compliance/confirm ───────────────────────────────────
  // Confirm a manual checklist item (or mark weekly upload as done)
  fastify.post(
    "/admin/compliance/confirm",
    { preHandler: [fastify.authenticateAdmin] },
    async (request, reply) => {
      const { key, notes } = request.body as { key: string; notes?: string };
      const adminUser = (request as any).user;

      if (!key) {
        return reply.status(400).send({ error: "key is required" });
      }

      // Allow manual items + weekly_upload
      const validKeys = [...MANUAL_ITEMS.map((m) => m.id), "weekly_upload"];
      if (!validKeys.includes(key)) {
        return reply
          .status(400)
          .send({ error: `Unknown compliance key: ${key}` });
      }

      // For weekly upload, also update the lastTflExportDate SystemSetting
      if (key === "weekly_upload") {
        await fastify.prisma.systemSetting.upsert({
          where: { key: "lastTflExportDate" },
          update: { value: new Date().toISOString() },
          create: { key: "lastTflExportDate", value: new Date().toISOString() },
        });
        return reply.send({ success: true, message: "Weekly upload recorded" });
      }

      await fastify.prisma.complianceConfirmation.upsert({
        where: { key },
        update: {
          confirmedAt: new Date(),
          confirmedBy: adminUser.userId,
          notes: notes ?? null,
        },
        create: {
          key,
          confirmedAt: new Date(),
          confirmedBy: adminUser.userId,
          notes: notes ?? null,
        },
      });

      return reply.send({ success: true, message: "Confirmation recorded" });
    }
  );
}
