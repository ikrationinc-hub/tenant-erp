ALTER TABLE "purchases" DROP CONSTRAINT "purchases_buyer_id_users_id_fk";
--> statement-breakpoint
UPDATE "purchases" SET "buyer_id" = "company_id";
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_companies_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;