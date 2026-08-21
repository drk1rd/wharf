#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Command } from "commander";

const API_URL = process.env.WHARF_API_URL ?? "http://localhost:8080";
const TOKEN = process.env.WHARF_TOKEN;

// Overridable so tests can point this at an isolated temp dir instead of a
// real user's home directory — same reasoning as WHARF_DATA_DIR on the
// control plane.
const CONFIG_DIR = process.env.WHARF_CONFIG_DIR ?? path.join(os.homedir(), ".wharf");
const SESSION_FILE = path.join(CONFIG_DIR, "sessions.json");

// Sessions are keyed by API URL, not a single slot — running against more
// than one self-hosted Wharf (or hosted + a local one) shouldn't mean
// logging in again every time you point the CLI somewhere else.
function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSessions(sessions) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), { mode: 0o600 });
  fs.chmodSync(SESSION_FILE, 0o600); // in case the file already existed with looser permissions
}

function saveSession(cookie, email) {
  const sessions = loadSessions();
  sessions[API_URL] = { cookie, email };
  writeSessions(sessions);
}

function clearSession() {
  const sessions = loadSessions();
  delete sessions[API_URL];
  writeSessions(sessions);
}

function currentSession() {
  return loadSessions()[API_URL] ?? null;
}

/**
 * WHARF_TOKEN — an explicit, deliberate credential set for this one
 * invocation — always wins over a session saved by a previous `wharf
 * login`. A forgotten login session silently overriding an explicit token
 * meant for CI/automation would be a much worse failure mode than the
 * reverse.
 */
async function request(reqPath, init) {
  const session = TOKEN ? null : currentSession();
  const res = await fetch(`${API_URL}/api${reqPath}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "x-wharf-token": TOKEN } : session ? { cookie: session.cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = body.error ?? `request failed: ${res.status}`;
    if (res.status === 401) {
      throw new Error(`${message} — run \`wharf login\` or set WHARF_TOKEN`);
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/plain")) return res.text();
  return res.json();
}

/** Login/signup only — needs the raw Set-Cookie header, which request() doesn't expose. */
async function authAction(authPath, body) {
  const res = await fetch(`${API_URL}/api${authPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(responseBody.error ?? `request failed: ${res.status}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("server didn't return a session — is WHARF_API_URL pointed at a real Wharf control plane?");
  }
  return { user: responseBody, cookie: setCookie.split(";")[0] };
}

function promptText(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Masks input as it's typed. Falls back to a plain (unmasked) prompt when stdin isn't a TTY — piped/CI input has no terminal to mask against anyway. */
function promptHidden(question) {
  if (!process.stdin.isTTY) return promptText(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let input = "";
    const onData = (char) => {
      switch (char) {
        case "\n":
        case "\r":
        case "": // Ctrl-D
          stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(input);
          break;
        case "": // Ctrl-C
          process.stdout.write("\n");
          process.exit(130);
          break;
        case "": // backspace
        case "\b":
          input = input.slice(0, -1);
          break;
        default:
          input += char;
      }
    };
    stdin.on("data", onData);
  });
}

function warnIfTokenSet() {
  if (TOKEN) {
    console.log("Note: WHARF_TOKEN is set in this environment and takes precedence over this session while it's set.");
  }
}

async function pollUntilSettled(id) {
  for (let i = 0; i < 60; i++) {
    const instance = await request(`/instances/${id}`);
    if (instance.status === "running" || instance.status === "error") return instance;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("timed out waiting for instance to become ready");
}

const program = new Command();
program.name("wharf").description("Spin up, browse, and connect to any database.").version("0.1.0");

program
  .command("login")
  .description("sign in with an email/password account (session stored locally, scoped to WHARF_API_URL)")
  .option("-e, --email <email>", "account email (or set WHARF_EMAIL)")
  .option("-p, --password <password>", "account password (or set WHARF_PASSWORD) — prefer the interactive prompt on a shared machine")
  .action(async (opts) => {
    const email = opts.email ?? process.env.WHARF_EMAIL ?? (await promptText("Email: "));
    const password = opts.password ?? process.env.WHARF_PASSWORD ?? (await promptHidden("Password: "));
    const { user, cookie } = await authAction("/auth/login", { email, password });
    saveSession(cookie, user.email);
    console.log(`Signed in as ${user.email}${user.isSuperadmin ? " (superadmin)" : ""}.`);
    warnIfTokenSet();
  });

program
  .command("signup")
  .description("create a new account — the very first account on a fresh instance becomes its superadmin")
  .option("-e, --email <email>", "account email (or set WHARF_EMAIL)")
  .option("-p, --password <password>", "account password, min 8 characters (or set WHARF_PASSWORD)")
  .action(async (opts) => {
    const email = opts.email ?? process.env.WHARF_EMAIL ?? (await promptText("Email: "));
    const password = opts.password ?? process.env.WHARF_PASSWORD ?? (await promptHidden("Password (min 8 characters): "));
    const { user, cookie } = await authAction("/auth/signup", { email, password });
    saveSession(cookie, user.email);
    console.log(
      user.isSuperadmin
        ? `Account created — this is the superadmin account for this instance. Signed in as ${user.email}.`
        : `Account created. Signed in as ${user.email}.`
    );
    warnIfTokenSet();
  });

program
  .command("logout")
  .description("sign out and forget the locally stored session for this WHARF_API_URL")
  .action(async () => {
    if (currentSession()) {
      await request("/auth/logout", { method: "POST" }).catch(() => undefined);
    }
    clearSession();
    console.log("Signed out.");
  });

program
  .command("whoami")
  .description("show which credential is currently authenticating CLI commands")
  .action(async () => {
    if (TOKEN) {
      console.log("Authenticated via WHARF_TOKEN (admin/service credential).");
      return;
    }
    if (!currentSession()) {
      console.log("Not signed in. Run `wharf login` (or `wharf signup` on a fresh instance).");
      return;
    }
    const me = await request("/auth/me");
    console.log(`${me.email}${me.isSuperadmin ? " (superadmin)" : ""}`);
  });

program
  .command("create <engine>")
  .description("create a new database instance (postgres, mongodb)")
  .option("-n, --name <name>", "instance name")
  .option("-v, --version <version>", "engine version")
  .action(async (engine, opts) => {
    const created = await request("/instances", {
      method: "POST",
      body: JSON.stringify({ engine, name: opts.name, version: opts.version }),
    });
    console.log(`Creating ${created.name} (${created.id})…`);
    const settled = await pollUntilSettled(created.id);
    if (settled.status === "error") {
      console.error(`Failed: ${settled.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Ready.`);
    console.log(`  id:         ${settled.id}`);
    console.log(`  connection: ${settled.connection.connectionString}`);
  });

program
  .command("list")
  .description("list your database instances")
  .action(async () => {
    const instances = await request("/instances");
    if (instances.length === 0) {
      console.log("No instances yet. Create one with: wharf create postgres");
      return;
    }
    for (const instance of instances) {
      console.log(`${instance.id}  ${instance.status.padEnd(9)} ${instance.engine}@${instance.version}  ${instance.name}`);
    }
  });

program
  .command("rm <id>")
  .description("delete a database instance")
  .action(async (id) => {
    await request(`/instances/${id}`, { method: "DELETE" });
    console.log(`Deleted ${id}.`);
  });

program
  .command("url <id>")
  .description("print the connection URL for an instance")
  .action(async (id) => {
    const instance = await request(`/instances/${id}`);
    if (!instance.connection) {
      console.error(`Instance is ${instance.status}, no connection info yet.`);
      process.exitCode = 1;
      return;
    }
    console.log(instance.connection.connectionString);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
