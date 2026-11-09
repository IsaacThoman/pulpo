CREATE TABLE "friend_suggestion_dismissals" (
	"user_id" uuid NOT NULL,
	"dismissed_user_id" uuid NOT NULL,
	"mutual_friend_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_suggestion_dismissals_user_id_dismissed_user_id_pk" PRIMARY KEY("user_id","dismissed_user_id"),
	CONSTRAINT "friend_suggestion_dismissals_not_self_check" CHECK ("friend_suggestion_dismissals"."user_id" <> "friend_suggestion_dismissals"."dismissed_user_id")
);
--> statement-breakpoint
ALTER TABLE "friend_suggestion_dismissals" ADD CONSTRAINT "friend_suggestion_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_suggestion_dismissals" ADD CONSTRAINT "friend_suggestion_dismissals_dismissed_user_id_users_id_fk" FOREIGN KEY ("dismissed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friend_suggestion_dismissals_dismissed_idx" ON "friend_suggestion_dismissals" USING btree ("dismissed_user_id");