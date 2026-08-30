import { chmod, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, contents: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writePublicExecutable(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  await writeFile(path, contents, { mode: 0o755 });
  await chmod(path, 0o755);
}
