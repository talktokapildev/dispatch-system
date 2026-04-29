-- TfL Condition 6: add dispatcher record to Booking
ALTER TABLE "Booking" ADD COLUMN "dispatchedBy" TEXT;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_dispatchedBy_fkey"
  FOREIGN KEY ("dispatchedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Booking_dispatchedBy_idx" ON "Booking"("dispatchedBy");

-- Rename companyName to name on CorporateAccount
ALTER TABLE "CorporateAccount" RENAME COLUMN "companyName" TO "name";
DROP INDEX IF EXISTS "CorporateAccount_companyName_idx";
CREATE INDEX "CorporateAccount_name_idx" ON "CorporateAccount"("name");