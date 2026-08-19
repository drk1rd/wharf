import type { NextFunction, Request, Response } from "express";

const token = process.env.WHARF_TOKEN;

if (!token) {
  // eslint-disable-next-line no-console
  console.warn(
    "[wharf] WHARF_TOKEN is not set — the API is unauthenticated. Fine for local/dev use, " +
      "never expose this to the network without setting WHARF_TOKEN."
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!token) {
    next();
    return;
  }
  const provided = req.header("x-wharf-token");
  if (provided !== token) {
    res.status(401).json({ error: "missing or invalid x-wharf-token header" });
    return;
  }
  next();
}
