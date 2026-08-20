import { randomUUID } from "node:crypto";
import { Router } from "express";
import { usersRepo, sessionsRepo } from "../db.js";
import { clearSessionCookie, createSession, setSessionCookie } from "../auth.js";
import { hashPassword, isValidEmail, isValidPassword, verifyPassword } from "../users.js";

export const authRouter = Router();

function publicUser(user: { id: string; email: string; default_model: string | null }) {
  return { id: user.id, email: user.email, defaultModel: user.default_model };
}

authRouter.post("/auth/signup", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || !isValidEmail(email)) {
    res.status(400).json({ error: "a valid email is required" });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }
  if (usersRepo.getByEmail(email)) {
    res.status(409).json({ error: "an account with this email already exists" });
    return;
  }

  const user = {
    id: randomUUID(),
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    default_model: null,
    created_at: new Date().toISOString(),
  };
  usersRepo.insert(user);

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.status(201).json(publicUser(user));
});

authRouter.post("/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const user = usersRepo.getByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "invalid email or password" });
    return;
  }

  const { token, expiresAt } = createSession(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json(publicUser(user));
});

authRouter.post("/auth/logout", (req, res) => {
  const token = req.cookies?.wharf_session;
  if (typeof token === "string" && token) {
    sessionsRepo.remove(token);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/auth/me", (req, res) => {
  if (req.auth?.kind !== "user") {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  const user = usersRepo.getById(req.auth.userId);
  if (!user) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  res.json(publicUser(user));
});

authRouter.patch("/auth/me", (req, res) => {
  if (req.auth?.kind !== "user") {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  const { defaultModel } = req.body ?? {};
  if (defaultModel !== undefined && typeof defaultModel !== "string") {
    res.status(400).json({ error: "defaultModel must be a string" });
    return;
  }
  usersRepo.update(req.auth.userId, { default_model: defaultModel ?? null });
  const user = usersRepo.getById(req.auth.userId)!;
  res.json(publicUser(user));
});
