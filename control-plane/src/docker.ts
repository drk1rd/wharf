import Docker from "dockerode";
import net from "node:net";
import { PassThrough } from "node:stream";
import type { InstanceSecrets, ServiceManifest } from "./manifests/types.js";
import { buildTarArchive } from "./tar.js";
import type { LeafCert } from "./tls.js";

const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });

export function dockerClient(): Docker {
  return docker;
}

export async function ensureImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // not present locally — pull it
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

export interface CreatedContainer {
  containerId: string;
  volumeName: string;
  hostPort: number;
}

/** Wraps a value in single quotes for a POSIX shell, escaping any embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function createInstanceContainer(opts: {
  instanceId: string;
  manifest: ServiceManifest;
  version: string;
  secrets: InstanceSecrets;
  /** Present only when the caller (instances.ts) has already issued a leaf cert and this engine's manifest supports TLS. */
  tlsCert?: LeafCert;
}): Promise<CreatedContainer> {
  const { instanceId, manifest, version, secrets, tlsCert } = opts;
  const image = manifest.image(version);
  await ensureImage(image);

  const volumeName = `wharf-${instanceId}`;
  await docker.createVolume({ Name: volumeName });

  const useTls = Boolean(tlsCert && manifest.tls);

  // From here on, any failure must remove the volume we just created —
  // otherwise a failed create (bad image, no port available, ...) leaks it
  // forever, since the instance row never records a volume name to clean up
  // later (the row is only updated with it once this function returns).
  try {
    const portKey = `${manifest.containerPort}/tcp`;

    let entrypoint: string[] | undefined;
    let cmd: string[] | undefined;
    if (useTls && manifest.tls) {
      const { certDir, runtimeUser, entrypoint: baseEntrypoint, args } = manifest.tls;
      const argList = args(secrets, certDir).map(shellQuote).join(" ");
      // putArchive always writes as root regardless of the container's own
      // runtime user (it's the same mechanism `docker cp` uses), and several
      // engines (Postgres) refuse to start with a key file the server
      // process can't read, or that's group/world-readable. So: run as root
      // (the container's default user before the image's own entrypoint
      // drops privileges), fix ownership/permissions, then exec the image's
      // normal entrypoint with the TLS-flagged args — identical to what
      // would have run anyway, just with the certs usable first.
      const wrapper =
        `chown ${runtimeUser}:${runtimeUser} ${certDir}/server.crt ${certDir}/server.key ${certDir}/ca.crt ${certDir}/combined.pem 2>/dev/null; ` +
        `chmod 600 ${certDir}/server.key ${certDir}/combined.pem 2>/dev/null; ` +
        `exec ${baseEntrypoint} ${argList}`;
      entrypoint = ["sh", "-c"];
      cmd = [wrapper];
    } else {
      cmd = manifest.command ? manifest.command(secrets) : undefined;
    }

    const container = await docker.createContainer({
      name: `wharf-${instanceId}`,
      Image: image,
      Env: Object.entries(manifest.env(secrets)).map(([k, v]) => `${k}=${v}`),
      Entrypoint: entrypoint,
      Cmd: cmd,
      ExposedPorts: { [portKey]: {} },
      Labels: { "wharf.instance": instanceId, "wharf.engine": manifest.id },
      HostConfig: {
        PortBindings: { [portKey]: [{ HostPort: "" }] },
        Binds: [`${volumeName}:${manifest.dataPath}`],
        RestartPolicy: { Name: "unless-stopped" },
        NanoCpus: Math.round(parseFloat(manifest.resourceDefaults.cpu) * 1e9),
        Memory: manifest.resourceDefaults.memoryMb * 1024 * 1024,
      },
    });

    if (useTls && tlsCert && manifest.tls) {
      // A created-but-not-started container already has a real (writable)
      // root filesystem from its image layers, so putArchive works before
      // start() — path: "/" with the cert dir baked into each entry's name
      // (rather than certDir as the putArchive path) so Docker creates the
      // directory itself rather than requiring it to already exist.
      const relDir = manifest.tls.certDir.replace(/^\//, "");
      const files = [
        { name: `${relDir}/server.crt`, content: Buffer.from(tlsCert.certPem, "utf8"), mode: 0o644 },
        { name: `${relDir}/server.key`, content: Buffer.from(tlsCert.keyPem, "utf8"), mode: 0o600 },
        { name: `${relDir}/ca.crt`, content: Buffer.from(tlsCert.caCertPem, "utf8"), mode: 0o644 },
        { name: `${relDir}/combined.pem`, content: Buffer.from(tlsCert.combinedPem, "utf8"), mode: 0o600 },
      ];
      await container.putArchive(buildTarArchive(files), { path: "/" });
    }

    try {
      await container.start();
      const inspect = await container.inspect();
      const bindings = inspect.NetworkSettings.Ports[portKey];
      const hostPort = Number(bindings?.[0]?.HostPort);
      if (!hostPort) {
        throw new Error("container started but no host port was bound");
      }
      return { containerId: container.id, volumeName, hostPort };
    } catch (err) {
      await container.remove({ force: true }).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await docker.getVolume(volumeName).remove().catch(() => undefined);
    throw err;
  }
}

/** Live resource resize on a running container — no restart, no recreation. */
export async function updateContainerResources(containerId: string, opts: { cpu?: string; memoryMb?: number }): Promise<void> {
  const container = docker.getContainer(containerId);
  const update: { NanoCpus?: number; Memory?: number } = {};
  if (opts.cpu !== undefined) update.NanoCpus = Math.round(parseFloat(opts.cpu) * 1e9);
  if (opts.memoryMb !== undefined) update.Memory = opts.memoryMb * 1024 * 1024;
  await container.update(update);
}

export async function waitForPort(host: string, port: number, timeoutMs = 45000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function stopAndRemoveContainer(containerId: string, volumeName?: string): Promise<void> {
  const container = docker.getContainer(containerId);
  await container.stop().catch(() => undefined);
  await container.remove({ force: true }).catch(() => undefined);
  if (volumeName) {
    await docker.getVolume(volumeName).remove().catch(() => undefined);
  }
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
  blkReadBytes: number;
  blkWriteBytes: number;
}

export async function getContainerStats(containerId: string): Promise<ContainerStats> {
  const container = docker.getContainer(containerId);
  // dockerode types this as a stream by default; { stream: false } returns one snapshot.
  const raw = (await container.stats({ stream: false })) as unknown as {
    cpu_stats: {
      cpu_usage: { total_usage: number; percpu_usage?: number[] };
      system_cpu_usage: number;
      online_cpus?: number;
    };
    precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
    memory_stats: { usage?: number; limit?: number };
    networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
    blkio_stats?: { io_service_bytes_recursive?: { op: string; value: number }[] };
  };

  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta = raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
  const cpuCount = raw.cpu_stats.online_cpus ?? raw.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  let netRxBytes = 0;
  let netTxBytes = 0;
  for (const iface of Object.values(raw.networks ?? {})) {
    netRxBytes += iface.rx_bytes ?? 0;
    netTxBytes += iface.tx_bytes ?? 0;
  }

  let blkReadBytes = 0;
  let blkWriteBytes = 0;
  for (const entry of raw.blkio_stats?.io_service_bytes_recursive ?? []) {
    if (entry.op === "Read") blkReadBytes += entry.value;
    if (entry.op === "Write") blkWriteBytes += entry.value;
  }

  return {
    cpuPercent,
    memUsageBytes: raw.memory_stats.usage ?? 0,
    memLimitBytes: raw.memory_stats.limit ?? 0,
    netRxBytes,
    netTxBytes,
    blkReadBytes,
    blkWriteBytes,
  };
}

function demux(buffer: Buffer): string {
  // Docker multiplexes stdout/stderr with an 8-byte header per frame when the
  // container was not started with a TTY. Strip the headers to get plain text.
  let out = "";
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + size, buffer.length);
    out += buffer.subarray(start, end).toString("utf8");
    offset = start + size;
  }
  return out || buffer.toString("utf8");
}

export async function getContainerLogs(containerId: string, tail = 300): Promise<string> {
  const container = docker.getContainer(containerId);
  const buf = (await container.logs({ stdout: true, stderr: true, tail, timestamps: true })) as unknown as Buffer;
  return demux(buf);
}

/** Runs a command inside the container and returns raw stdout bytes (binary-safe). */
export async function execCapture(containerId: string, cmd: string[]): Promise<Buffer> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = await exec.start({ hijack: false, stdin: false });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
  stderr.on("data", (c: Buffer) => stderrChunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve, reject) => {
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const info = await exec.inspect();
  if (info.ExitCode) {
    throw new Error(`command failed (exit ${info.ExitCode}): ${Buffer.concat(stderrChunks).toString("utf8")}`);
  }
  return Buffer.concat(stdoutChunks);
}

/** Runs a command inside the container, feeding it stdin bytes (binary-safe, for restores). */
export async function execWithStdin(containerId: string, cmd: string[], input: Buffer): Promise<Buffer> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
  stderr.on("data", (c: Buffer) => stderrChunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  stream.write(input);
  stream.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  const info = await exec.inspect();
  if (info.ExitCode) {
    throw new Error(`restore failed (exit ${info.ExitCode}): ${Buffer.concat(stderrChunks).toString("utf8")}`);
  }
  return Buffer.concat(stdoutChunks);
}
