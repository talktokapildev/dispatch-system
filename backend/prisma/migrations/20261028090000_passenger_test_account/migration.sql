-- Test / demo passenger accounts (bookings hidden from admin lists and stats by default)
ALTER TABLE "Passenger" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;

-- Kapil's own numbers and the demo passenger
UPDATE "Passenger" SET "isTestAccount" = true
WHERE "userId" IN (
  SELECT "id" FROM "User"
  WHERE "phone" IN ('+447587545986', '+447398341839', '+447700000001')
);
