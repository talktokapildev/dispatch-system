import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Admin user ───
  const passwordHash = await bcrypt.hash("Admin1234!", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@dispatch.com" },
    update: {},
    create: {
      phone: "+447000000000",
      email: "admin@dispatch.com",
      firstName: "System",
      lastName: "Admin",
      role: "ADMIN",
      isVerified: true,
      passwordHash,
      adminProfile: { create: { permissions: ["ALL"] } },
    },
  });

  const dispatcher = await prisma.user.upsert({
    where: { email: "dispatcher@dispatch.com" },
    update: {},
    create: {
      phone: "+447000000001",
      email: "dispatcher@dispatch.com",
      firstName: "Main",
      lastName: "Dispatcher",
      role: "DISPATCHER",
      isVerified: true,
      passwordHash,
      adminProfile: { create: { permissions: ["BOOKINGS", "DRIVERS", "MAP"] } },
    },
  });

  console.log(`✅ Admin: ${admin.email}`);
  console.log(`✅ Dispatcher: ${dispatcher.email}`);

  // ─── Pricing config ───
  const existingConfig = await (prisma as any).pricingConfig.findFirst();
  if (!existingConfig) {
    await (prisma as any).pricingConfig.create({
      data: {
        baseFare: 3.5,
        perMile: 1.8,
        perMinute: 0.2,
        minimumFare: 15.0,
        platformCommission: 0.15,
        nightPremium: 0.25,
        nightStartHour: 23,
        nightEndHour: 6,
        bankHolidayPremium: 0.25,
        christmasNyePremium: 0.75,
        gatwickDropoff: 10.0,
        gatwickPickup: 10.0,
        heathrowDropoff: 7.0,
        heathrowPickup: 7.0,
        meetAndGreet: 12.0,
        dartfordCrossing: 2.5,
        congestionCharge: 15.0,
        extraStopCharge: 5.0,
        freeWaitingMinutes: 10,
        waitingRatePerMinute: 0.5,
        retailCancelFreeMinutes: 15,
        accountCancelFreeHours: 2,
        careHomeUnder3miles: 15.0,
        careHome3to7miles: 22.0,
        careHome7to15miles: 32.0,
        careHome15to25miles: 48.0,
        careHome25to40miles: 70.0,
        careHomeHospitalDischarge: 10.0,
        careHomeHalfDay: 150.0,
        careHomeFullDay: 250.0,
        careHomeHourlyBeyondFull: 35.0,
      },
    });
    console.log("✅ Pricing config created");
  } else {
    console.log("✅ Pricing config already exists — skipped");
  }

  // ─── Sample corporate account ───
  await prisma.corporateAccount.upsert({
    where: { id: "sample-corp" },
    update: {},
    create: {
      id: "sample-corp",
      name: "Acme Corp Ltd", // ← was companyName
      contactName: "John Smith",
      contactEmail: "john@acme.com",
      contactPhone: "+447123456789",
      address: "123 Business Park, London, EC1A 1BB",
      invoicingEmail: "accounts@acme.com",
      paymentTermsDays: 30,
      creditLimit: 5000,
    },
  });

  console.log("✅ Sample corporate account created");
  console.log("\n🎉 Seed complete!");
  console.log("\n📋 Admin credentials:");
  console.log("   Email: admin@dispatch.com");
  console.log("   Password: Admin1234!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
