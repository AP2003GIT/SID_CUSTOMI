import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { leagueStates } from "../../../db/schema";

const LEAGUE_ID = 1;
const MAX_STATE_BYTES = 750_000;

function requireUser(request: Request) {
  return request.headers.get("oai-authenticated-user-id");
}

export async function GET(request: Request) {
  const userId = requireUser(request);
  if (!userId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(leagueStates)
      .where(eq(leagueStates.id, LEAGUE_ID))
      .limit(1);

    return Response.json({
      state: row ? JSON.parse(row.state) : null,
      updatedAt: row?.updatedAt ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the league.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const userId = requireUser(request);
  if (!userId) return Response.json({ error: "Sign in is required." }, { status: 401 });

  try {
    const payload = (await request.json()) as { state?: unknown };
    if (!payload.state || typeof payload.state !== "object") {
      return Response.json({ error: "A valid league state is required." }, { status: 400 });
    }

    const serialized = JSON.stringify(payload.state);
    if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) {
      return Response.json({ error: "League history is too large to save." }, { status: 413 });
    }

    const db = getDb();
    const [row] = await db
      .insert(leagueStates)
      .values({ id: LEAGUE_ID, state: serialized, updatedBy: userId })
      .onConflictDoUpdate({
        target: leagueStates.id,
        set: { state: serialized, updatedBy: userId, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning({ updatedAt: leagueStates.updatedAt });

    return Response.json({ saved: true, updatedAt: row.updatedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the league.";
    return Response.json({ error: message }, { status: 500 });
  }
}
