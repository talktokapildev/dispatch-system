-- AlterEnum
ALTER TYPE "BookingType" ADD VALUE 'CAREHOME';

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_passengerId_fkey";

-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "passengerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_passengerId_fkey" FOREIGN KEY ("passengerId") REFERENCES "Passenger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
