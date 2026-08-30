import { NextResponse } from "next/server";

import {
  assertValidState,
  readStoredSnapshot,
  writeStoredStateIfNewer
} from "@/lib/database";
import {
  CURRENT_STATE_VERSION,
  CURRENT_SYNC_PROTOCOL_VERSION
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = readStoredSnapshot();
    return NextResponse.json(
      {
        state: snapshot?.state ?? null,
        updatedAt: snapshot?.updatedAt ?? null
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "資料庫讀取失敗"
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const protocolVersion = Number(
      request.headers.get("X-Recode-Sync-Protocol")
    );
    if (protocolVersion !== CURRENT_SYNC_PROTOCOL_VERSION) {
      throw new Error(
        "舊分頁使用過期的同步協定，已拒絕覆蓋；請重新整理頁面"
      );
    }

    const payload: unknown = await request.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("state" in payload) ||
      !("savedAt" in payload)
    ) {
      throw new Error("狀態寫入缺少版本資訊");
    }
    const state = (payload as { state: unknown }).state;
    const savedAt = Number((payload as { savedAt: unknown }).savedAt);
    assertValidState(state);
    if (Number(state.version) < CURRENT_STATE_VERSION) {
      throw new Error(
        "舊分頁使用過期的記憶模型，已拒絕覆蓋；請重新整理頁面"
      );
    }
    const result = writeStoredStateIfNewer(state, savedAt);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "資料庫寫入失敗"
      },
      { status: 400 }
    );
  }
}
