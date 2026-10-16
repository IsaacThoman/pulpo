CREATE TABLE "model_user_grants" (
	"model_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_user_grants_model_id_user_id_pk" PRIMARY KEY("model_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_user_grants" ADD CONSTRAINT "model_user_grants_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_user_grants" ADD CONSTRAINT "model_user_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_user_grants" ADD CONSTRAINT "model_user_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_user_grants_user_idx" ON "model_user_grants" USING btree ("user_id");