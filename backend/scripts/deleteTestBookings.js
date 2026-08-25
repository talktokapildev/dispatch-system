// backend/scripts/deleteTestBookings.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const passenger = await prisma.user.findFirst({
    where: { phone: "+447700000001" },
    include: { passenger: true },
  });

  if (!passenger || !passenger.passenger) {
    console.log("No passenger found with that phone number");
    return;
  }

  const passengerId = passenger.passenger.id;

  const bookings = await prisma.booking.findMany({
    where: { passengerId },
    select: { id: true },
  });
  const bookingIds = bookings.map((b) => b.id);

  if (bookingIds.length === 0) {
    console.log("No bookings found for this passenger");
    return;
  }

  console.log(`Found ${bookingIds.length} booking(s) to delete`);

  // Delete child records that have FK constraints on Booking first
  const statusHistory = await prisma.bookingStatusHistory.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  console.log(`Deleted ${statusHistory.count} status history record(s)`);

  const receipts = await prisma.receipt.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  console.log(`Deleted ${receipts.count} receipt(s)`);

  const lostProperty = await prisma.lostProperty.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  console.log(`Deleted ${lostProperty.count} lost property record(s)`);

  // These don't have real FK constraints (plain String field), but clean up
  // orphaned references anyway to avoid confusing data later
  const earnings = await prisma.driverEarning.deleteMany({
    where: { bookingId: { in: bookingIds } },
  });
  console.log(`Deleted ${earnings.count} driver earning record(s)`);

  const walletTx = await prisma.walletTransaction.updateMany({
    where: { bookingId: { in: bookingIds } },
    data: { bookingId: null },
  });
  console.log(`Cleared bookingId on ${walletTx.count} wallet transaction(s)`);

  // Finally, delete the bookings themselves
  const result = await prisma.booking.deleteMany({
    where: { id: { in: bookingIds } },
  });
  console.log(`Deleted ${result.count} booking(s) for ${passenger.phone}`);
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
