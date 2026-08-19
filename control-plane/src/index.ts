import "dotenv/config";
import express from "express";
import cors from "cors";
import { requireAuth } from "./auth.js";
import { instancesRouter } from "./routes/instances.js";
import { browseRouter } from "./routes/browse.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use("/api", requireAuth, instancesRouter);
app.use("/api", requireAuth, browseRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[wharf] control plane listening on :${port}`);
});
