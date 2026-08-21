#!/usr/bin/env node
import { Command } from "commander";

const API_URL = process.env.WHARF_API_URL ?? "http://localhost:8080";
const TOKEN = process.env.WHARF_TOKEN;

async function request(path, init) {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(TOKEN ? { "x-wharf-token": TOKEN } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/plain")) return res.text();
  return res.json();
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
