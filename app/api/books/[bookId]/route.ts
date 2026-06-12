import { unlinkSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { uploadsDir } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ bookId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { bookId } = await params;
  const book = db.getBook(bookId);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  return NextResponse.json({ book, modules: db.getCurriculum(bookId) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { bookId } = await params;
  const book = db.getBook(bookId);
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  db.deleteBook(bookId);
  try {
    unlinkSync(path.join(uploadsDir(), book.filename));
  } catch {
    // file already gone
  }
  return NextResponse.json({ ok: true });
}
