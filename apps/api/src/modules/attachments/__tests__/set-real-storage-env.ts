/**
 * Imported FIRST (before any src/ module) by attachments.test.ts, same
 * discipline as test/global-setup.ts's own doc comment: process.env must
 * be correct before src/config/env.ts is first evaluated, since it's a
 * module-level singleton read once. test/global-setup.ts's own S3_*
 * defaults ("test"/"test"/"hyperion-erp-test") only exist to satisfy
 * env.ts's schema for suites that inject a fake Scanner/mock storage -
 * they are NOT valid credentials against the real docker-compose MinIO,
 * whose actual root user is "hyperion"/"hyperion123" (docker/docker-
 * compose.yml). This suite deliberately exercises the REAL ClamAV daemon
 * and REAL MinIO (no setScanner, no mocked S3 client) - task requirement:
 * "the real file content is what ClamAV scanned" and "a clean upload's
 * presigned download URL actually resolves to the uploaded bytes" - so it
 * needs real, working credentials, not the fake-scanner suite's schema-
 * satisfying placeholders.
 */
process.env.S3_ACCESS_KEY_ID = "hyperion";
process.env.S3_SECRET_ACCESS_KEY = "hyperion123";
