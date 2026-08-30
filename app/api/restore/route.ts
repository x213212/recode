import { NextResponse } from "next/server";

import { restoreDatabase } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BACKUP_BYTES) {
      throw new Error("備份檔必須介於 1 byte 與 32 MB 之間");
    }

    const savedAt = Number(request.headers.get("X-Recode-Saved-At"));
    const state = restoreDatabase(
      new Uint8Array(buffer),
      Number.isFinite(savedAt) && savedAt > 0 ? savedAt : undefined
    );
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "資料庫還原失敗"
      },
      { status: 400 }
    );
  }
}
