ALTER TABLE "companies" ALTER COLUMN "country_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "currency_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "country_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "currency_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tax_registration_no" text;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE restrict ON UPDATE no action;