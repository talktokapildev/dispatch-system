-- CreateTable
CREATE TABLE "ComplianceConfirmation" (
    "key" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "ComplianceConfirmation_pkey" PRIMARY KEY ("key")
);
