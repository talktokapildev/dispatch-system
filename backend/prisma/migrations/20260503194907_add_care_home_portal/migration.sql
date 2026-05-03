-- CreateEnum
CREATE TYPE "CareHomeAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResidentMobility" AS ENUM ('AMBULATORY', 'WALKING_AID', 'WHEELCHAIR', 'WHEELCHAIR_ASSIST', 'STRETCHER');

-- CreateEnum
CREATE TYPE "RecurrencePattern" AS ENUM ('DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "careHomeId" TEXT,
ADD COLUMN     "careHomeInvoiceId" TEXT,
ADD COLUMN     "recurringBookingId" TEXT,
ADD COLUMN     "residentId" TEXT;

-- CreateTable
CREATE TABLE "CareHomeAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "invoicingEmail" TEXT NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "status" "CareHomeAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareHomeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareHomeStaff" (
    "id" TEXT NOT NULL,
    "careHomeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareHomeStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareHomeResident" (
    "id" TEXT NOT NULL,
    "careHomeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "mobility" "ResidentMobility" NOT NULL DEFAULT 'AMBULATORY',
    "accessNotes" TEXT,
    "medicalNotes" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareHomeResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringBooking" (
    "id" TEXT NOT NULL,
    "careHomeId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "dropoffAddress" TEXT NOT NULL,
    "dropoffLat" DOUBLE PRECISION,
    "dropoffLng" DOUBLE PRECISION,
    "pattern" "RecurrencePattern" NOT NULL,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "scheduledTime" TEXT NOT NULL,
    "distanceMiles" DOUBLE PRECISION,
    "flatFare" DOUBLE PRECISION,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareHomeInvoice" (
    "id" TEXT NOT NULL,
    "careHomeId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareHomeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareHomeStaff_email_key" ON "CareHomeStaff"("email");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_careHomeId_fkey" FOREIGN KEY ("careHomeId") REFERENCES "CareHomeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "CareHomeResident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recurringBookingId_fkey" FOREIGN KEY ("recurringBookingId") REFERENCES "RecurringBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_careHomeInvoiceId_fkey" FOREIGN KEY ("careHomeInvoiceId") REFERENCES "CareHomeInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareHomeStaff" ADD CONSTRAINT "CareHomeStaff_careHomeId_fkey" FOREIGN KEY ("careHomeId") REFERENCES "CareHomeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareHomeResident" ADD CONSTRAINT "CareHomeResident_careHomeId_fkey" FOREIGN KEY ("careHomeId") REFERENCES "CareHomeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_careHomeId_fkey" FOREIGN KEY ("careHomeId") REFERENCES "CareHomeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringBooking" ADD CONSTRAINT "RecurringBooking_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "CareHomeResident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareHomeInvoice" ADD CONSTRAINT "CareHomeInvoice_careHomeId_fkey" FOREIGN KEY ("careHomeId") REFERENCES "CareHomeAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
