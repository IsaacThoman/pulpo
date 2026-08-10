CREATE TABLE "catalog_icons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'original' NOT NULL,
	"original_object_key" text NOT NULL,
	"monochrome_light_object_key" text NOT NULL,
	"monochrome_dark_object_key" text NOT NULL,
	"original_checksum" text NOT NULL,
	"monochrome_light_checksum" text NOT NULL,
	"monochrome_dark_checksum" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "custom_icon_id" uuid;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "custom_icon_id" uuid;--> statement-breakpoint
ALTER TABLE "catalog_icons" ADD CONSTRAINT "catalog_icons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "labs_custom_icon_id_catalog_icons_id_fk" FOREIGN KEY ("custom_icon_id") REFERENCES "public"."catalog_icons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_custom_icon_id_catalog_icons_id_fk" FOREIGN KEY ("custom_icon_id") REFERENCES "public"."catalog_icons"("id") ON DELETE no action ON UPDATE no action;