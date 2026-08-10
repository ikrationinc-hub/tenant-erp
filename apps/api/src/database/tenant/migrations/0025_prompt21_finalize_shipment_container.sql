INSERT INTO "containers" ("company_id", "code", "name", "created_by")
SELECT DISTINCT ps."company_id", ps."container_number", ps."container_number", ps."created_by"
FROM "purchase_shipments" ps
WHERE ps."container_id" IS NULL
ON CONFLICT ("company_id", "code") WHERE "deleted_at" IS NULL DO NOTHING;--> statement-breakpoint
UPDATE "purchase_shipments" ps
SET "container_id" = c."id"
FROM "containers" c
WHERE c."company_id" = ps."company_id" AND c."code" = ps."container_number" AND ps."container_id" IS NULL AND c."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ALTER COLUMN "container_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_shipments" DROP COLUMN "container_number";
