import busboy from "busboy";
import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError, ValidationError } from "../../common/errors/index.js";
import * as attachmentsService from "./attachments.service.js";
import { attachmentIdParamsSchema, listAttachmentsQuerySchema, uploadParamsSchema } from "./attachments.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

/** The largest single-content-type limit core/storage/policy.ts declares - a busboy-level backstop; the real, per-content-type limit is enforced inside core/storage/upload.ts's storeUploadedFile. */
const BUSBOY_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * multipart/form-data, not JSON - express.json() (app.ts) no-ops for this
 * content type, so busboy reads `req` directly. Exactly one file part is
 * accepted; anything else is a 422, not a silent partial success.
 */
export function upload(req: Request, res: Response, next: NextFunction): void {
  try {
    const ctx = requireContext();
    const { entity, entityId, fieldKey } = uploadParamsSchema.parse(req.params);

    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: BUSBOY_MAX_FILE_SIZE_BYTES } });
    let sawFile = false;

    bb.on("file", (_name, fileStream, info) => {
      sawFile = true;
      attachmentsService
        .uploadAttachment(ctx, {
          entity,
          entityId,
          fieldKey,
          filename: info.filename,
          contentType: info.mimeType,
          stream: fileStream,
        })
        .then((row) => {
          res.status(201).json(row);
        })
        .catch(next);
    });

    bb.on("error", next);
    bb.on("close", () => {
      if (!sawFile) {
        next(new ValidationError("No file was uploaded"));
      }
    });

    req.pipe(bb);
  } catch (error) {
    next(error);
  }
}

export async function getDownloadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = attachmentIdParamsSchema.parse(req.params);
    const result = await attachmentsService.getAttachmentDownloadUrl(ctx, id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = listAttachmentsQuerySchema.parse(req.query);
    const result = await attachmentsService.listAttachments(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

