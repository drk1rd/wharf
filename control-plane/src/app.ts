import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { identify, requireAuth, authRequired } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { instancesRouter } from "./routes/instances.js";
import { browseRouter } from "./routes/browse.js";
import { askEnabled } from "./ask.js";

export function buildApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  app.use(identify);

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.get("/api/config", (_req, res) => {
    res.json({ askEnabled: askEnabled(), authRequired: authRequired() });
  });

  app.use("/api", authRouter);

  app.use("/api", requireAuth, instancesRouter);
  app.use("/api", requireAuth, browseRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  });

  return app;
}
