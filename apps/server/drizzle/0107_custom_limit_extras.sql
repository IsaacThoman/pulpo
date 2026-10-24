ALTER TABLE "billing_custom_limits" ADD COLUMN "covers_extras" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_funders" ADD COLUMN "covers_extras" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "extra_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "reservation_extra_check" CHECK ("budget_reservations"."extra_reserved_micros" >= 0);