import { writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { uploadsDir } from "@/lib/paths";
import { enqueueProcessBook } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 80 * 1024 * 1024;

function titleFromFilename(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  return NextResponse.json({ books: db.listBooks() });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 80MB)" }, { status: 400 });
  }

  const id = db.newId();
  const filename = `${id}.pdf`;
  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(path.join(uploadsDir(), filename), buf);

  db.insertBook({ id, title: titleFromFilename(file.name), author: null, filename });
  enqueueProcessBook(id);

  return NextResponse.json({ book: db.getBook(id) }, { status: 201 });
}
