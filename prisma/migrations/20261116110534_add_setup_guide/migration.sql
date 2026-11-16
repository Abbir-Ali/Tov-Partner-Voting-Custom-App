-- Add setupGuide JSON field to shop_settings for tracking onboarding progress
ALTER TABLE "shop_settings" ADD COLUMN "setupGuide" JSONB;
