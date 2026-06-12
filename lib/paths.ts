import { mkdirSync } from "node:fs";
import path from "node:path";

export function dataDir(): string {
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), "uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}
