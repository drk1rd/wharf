/**
 * Minimal USTAR tar writer — just enough to build a small in-memory archive
 * of a handful of flat files for dockerode's `container.putArchive()` (the
 * only way to write files into a sibling container's filesystem when the
 * control plane can't see that container's paths on the host — see
 * docker.ts). No dependency on tar-stream/tar-fs: the format needed here is
 * fully controlled (a few known small files, no directories, no symlinks),
 * so hand-rolling it is the same call this codebase already made for the
 * CSV parser and the Redis command tokenizer.
 */

export interface TarFile {
  name: string;
  content: Buffer;
  mode?: number;
}

function padOctal(value: number, fieldLen: number): string {
  return value.toString(8).padStart(fieldLen - 1, "0") + "\0";
}

function tarHeader(name: string, size: number, mode: number): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, "utf8");
  buf.write(padOctal(mode, 8), 100, 8, "utf8");
  buf.write(padOctal(0, 8), 108, 8, "utf8"); // uid
  buf.write(padOctal(0, 8), 116, 8, "utf8"); // gid
  buf.write(padOctal(size, 12), 124, 12, "utf8");
  buf.write(padOctal(Math.floor(Date.now() / 1000), 12), 136, 12, "utf8");
  buf.write("        ", 148, 8, "utf8"); // checksum field, spaces while computing
  buf.write("0", 156, 1, "utf8"); // typeflag: regular file
  buf.write("ustar\0", 257, 6, "utf8");
  buf.write("00", 263, 2, "utf8");

  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  buf.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return buf;
}

/** Builds a USTAR archive of the given flat files, ready for `container.putArchive()`. */
export function buildTarArchive(files: TarFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    if (Buffer.byteLength(file.name, "utf8") >= 100) {
      throw new Error(`tar entry name too long for USTAR: ${file.name}`);
    }
    parts.push(tarHeader(file.name, file.content.length, file.mode ?? 0o644));
    parts.push(file.content);
    const remainder = file.content.length % 512;
    if (remainder !== 0) parts.push(Buffer.alloc(512 - remainder));
  }
  parts.push(Buffer.alloc(1024)); // two zero-filled 512-byte blocks terminate the archive
  return Buffer.concat(parts);
}
