-- Add reasonText column to votes table for "Other" chip free-text
ALTER TABLE "votes" ADD COLUMN "reasonText" TEXT;
