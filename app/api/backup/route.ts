import { exportDatabase } from "@/lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { bytes, filename } = await exportDatabase();
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/vnd.sqlite3"
      }
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "資料庫備份失敗"
      },
      { status: 500 }
    );
  }
}
