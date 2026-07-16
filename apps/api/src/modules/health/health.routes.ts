import { Router, type Router as ExpressRouter } from "express";

const startedAt = Date.now();

export const healthRouter: ExpressRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.0.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});
