CREATE TABLE "signup_confirmations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"form_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_confirmations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "signup_forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"double_opt_in" boolean DEFAULT true NOT NULL,
	"redirect_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_forms_form_id_unique" UNIQUE("form_id"),
	CONSTRAINT "signup_forms_form_id_check" CHECK ("signup_forms"."form_id" ~ '^frm_')
);
--> statement-breakpoint
ALTER TABLE "signup_confirmations" ADD CONSTRAINT "signup_confirmations_form_id_signup_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."signup_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_forms" ADD CONSTRAINT "signup_forms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_confirmations_form_id_email_idx" ON "signup_confirmations" USING btree ("form_id","email");--> statement-breakpoint
CREATE INDEX "signup_forms_team_id_idx" ON "signup_forms" USING btree ("team_id");