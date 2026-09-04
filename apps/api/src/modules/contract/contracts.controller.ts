import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { getPresignedDownloadUrl } from "../../core/storage/download.js";
import * as assemblyService from "./contract-assembly.service.js";
import * as generationService from "./contract-generation.service.js";
import * as contractsService from "./contracts.service.js";
import {
  addContractClauseSchema,
  contractClauseIdParamsSchema,
  contractIdParamsSchema,
  contractsListQuerySchema,
  createContractSchema,
  editContractClauseTextSchema,
  emailContractSchema,
  generationJobIdParamsSchema,
  reorderContractClausesSchema,
  sendForApprovalSchema,
  sendForESignatureSchema,
  updateContractSchema,
} from "./contracts.validator.js";
import * as clauseRulesService from "./clause-rules.service.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = contractsListQuerySchema.parse(req.query);
    const result = await contractsService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.getById(ctx, id);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function getDocumentUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const presigned = await contractsService.getDocumentUrl(ctx, id);
    res.status(200).json(presigned);
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createContractSchema.parse(req.body);
    const contract = await contractsService.create(ctx, input);
    res.status(201).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = updateContractSchema.parse(req.body);
    const contract = await contractsService.update(ctx, id, input);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.approve(ctx, id);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function sign(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.sign(ctx, id);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function close(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.close(ctx, id);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function sendForApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = sendForApprovalSchema.parse(req.body);
    const contract = await contractsService.sendForApproval(ctx, id, input);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function revise(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const contract = await contractsService.revise(ctx, id);
    res.status(201).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function emailContract(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = emailContractSchema.parse(req.body);
    const contract = await contractsService.emailContract(ctx, id, input);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function sendForESignature(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = sendForESignatureSchema.parse(req.body);
    const contract = await contractsService.sendForESignature(ctx, id, input);
    res.status(200).json(contract);
  } catch (error) {
    next(error);
  }
}

export async function runRules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const result = await clauseRulesService.runRules(ctx, id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// --- Assembly ---------------------------------------------------------------

export async function addClause(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = addContractClauseSchema.parse(req.body);
    const row = await assemblyService.addClause(ctx, id, input.clauseId);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function removeClause(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, contractClauseId } = contractClauseIdParamsSchema.parse(req.params);
    await assemblyService.removeClause(ctx, id, contractClauseId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function reorderClauses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const input = reorderContractClausesSchema.parse(req.body);
    const rows = await assemblyService.reorderClauses(ctx, id, input.contractClauseIds);
    res.status(200).json({ items: rows });
  } catch (error) {
    next(error);
  }
}

export async function editClauseText(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, contractClauseId } = contractClauseIdParamsSchema.parse(req.params);
    const input = editContractClauseTextSchema.parse(req.body);
    const row = await assemblyService.editClauseText(ctx, id, contractClauseId, input.resolvedText);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function resnapshot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const diff = await assemblyService.resnapshotToLatest(ctx, id);
    res.status(200).json({ items: diff });
  } catch (error) {
    next(error);
  }
}

export async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const result = await assemblyService.preview(ctx, id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

// --- Generation ---------------------------------------------------------------

export async function generate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id } = contractIdParamsSchema.parse(req.params);
    const handle = await generationService.enqueueGeneration(ctx, id);
    res.status(202).json(handle);
  } catch (error) {
    next(error);
  }
}

export async function getGenerationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const { id, jobId } = generationJobIdParamsSchema.parse(req.params);
    const status = await generationService.getGenerationJobStatus(ctx, id, jobId);
    if (status.state === "completed" && status.result) {
      const [docx, pdf] = await Promise.all([
        getPresignedDownloadUrl(status.result.docxStorageKey),
        getPresignedDownloadUrl(status.result.pdfStorageKey),
      ]);
      res.status(200).json({ ...status, downloadUrls: { docx: docx.url, pdf: pdf.url } });
      return;
    }
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
}
