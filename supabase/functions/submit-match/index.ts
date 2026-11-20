// ============================================================
// Haxball Futsal - Edge Function: submit-match
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY")!;
const EDGE_SECRET = Deno.env.get("EDGE_SECRET") || "HaxballFutsalSecret2026xYzAbC";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-edge-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

Deno.serve(async (req: Request) => {
    // Preflight CORS
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const secret = req.headers.get("x-edge-secret");
    if (!secret || secret !== EDGE_SECRET) {
        return json({ ok: false, error: "unauthorized" }, 401);
    }

    let payload: any;
    try {
        payload = await req.json();
    } catch {
        return json({ ok: false, error: "invalid_json" }, 400);
    }

    if (!payload || typeof payload.externalId !== "string" || !payload.externalId) {
        return json({ ok: false, error: "missing_external_id" }, 400);
    }
    if (payload.type !== "official" && payload.type !== "informal") {
        return json({ ok: false, error: "invalid_type" }, 400);
    }
    if (!Array.isArray(payload.participants)) {
        return json({ ok: false, error: "invalid_participants" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    // Idempotencia
    const { data: existing } = await supabase
        .from("matches")
        .select("id, external_id")
        .eq("external_id", payload.externalId)
        .maybeSingle();

    if (existing) {
        return json({ ok: true, duplicate: true, matchId: existing.id });
    }

    const ELO_START = 100;
    const ELO_WIN = 10;
    const ELO_LOSS = 5;

    const eloEligible = Boolean(payload.eloEligible) && payload.type === "official";
    const redWon = payload.redScore > payload.blueScore;
    const blueWon = payload.blueScore > payload.redScore;
    const draw = payload.redScore === payload.blueScore;

    function normalizeName(name: string): string {
        return String(name).trim().replace(/\s+/g, " ").toLowerCase();
    }

    // Upsert players
    const playerByKey = new Map<string, string>();
    for (const p of payload.participants) {
        const key = p.key || normalizeName(p.name);
        if (playerByKey.has(key)) continue;

        const { data: upserted, error } = await supabase
            .from("players")
            .upsert(
                {
                    name: p.name,
                    normalized_name: key,
                    last_seen: new Date().toISOString(),
                },
                { onConflict: "normalized_name" }
            )
            .select("id, elo")
            .single();

        if (error || !upserted) {
            console.error("player upsert error", error);
            return json({ ok: false, error: "player_upsert_failed" }, 500);
        }
        playerByKey.set(key, upserted.id);
    }

    if (payload.spectator && payload.spectator.name) {
        const sKey = payload.spectator.key || normalizeName(payload.spectator.name);
        if (!playerByKey.has(sKey)) {
            const { data: sp } = await supabase
                .from("players")
                .upsert(
                    {
                        name: payload.spectator.name,
                        normalized_name: sKey,
                        last_seen: new Date().toISOString(),
                    },
                    { onConflict: "normalized_name" }
                )
                .select("id")
                .single();
            if (sp) playerByKey.set(sKey, sp.id);
        }
    }

    const { data: matchRow, error: matchError } = await supabase
        .from("matches")
        .insert({
            external_id: payload.externalId,
            server_version: payload.serverVersion ?? null,
            type: payload.type,
            status: payload.status,
            map_tier: payload.mapTier ?? null,
            map_name: payload.mapName ?? null,
            started_at: payload.startedAt ?? null,
            ended_at: payload.endedAt ?? null,
            duration_seconds: payload.durationSeconds ?? null,
            red_score: payload.redScore,
            blue_score: payload.blueScore,
            red_possession: payload.redPossession ?? null,
            blue_possession: payload.bluePossession ?? null,
            elo_eligible: payload.eloEligible ?? false,
            manual: payload.manual ?? false,
            end_reason: payload.endReason ?? null,
            spectator_name: payload.spectator?.name ?? null,
            spectator_key: payload.spectator?.key ?? null,
        })
        .select("id")
        .single();

    if (matchError || !matchRow) {
        console.error("match insert error", matchError);
        return json({ ok: false, error: "match_insert_failed" }, 500);
    }

    const matchId = matchRow.id;

    // Merge participants by key
    const merged = new Map<string, any>();
    for (const p of payload.participants) {
        const key = p.key || normalizeName(p.name);
        const prev = merged.get(key);
        if (!prev) {
            merged.set(key, { ...p, key, goals: p.goals ?? 0, ownGoals: p.ownGoals ?? 0 });
        } else {
            prev.goals = (prev.goals ?? 0) + (p.goals ?? 0);
            prev.ownGoals = (prev.ownGoals ?? 0) + (p.ownGoals ?? 0);
            prev.left = prev.left || p.left;
            prev.movedToSpectator = prev.movedToSpectator || p.movedToSpectator;
            prev.team = p.team || prev.team;
        }
    }

    for (const [key, p] of merged.entries()) {
        const playerId = playerByKey.get(key) ?? null;

        let eloBefore = ELO_START;
        if (playerId) {
            const { data: pl } = await supabase
                .from("players")
                .select("elo")
                .eq("id", playerId)
                .single();
            if (pl && typeof pl.elo === "number") eloBefore = pl.elo;
        }

        let outcome: "win" | "loss" | "draw" = "draw";
        if (redWon) outcome = p.team === "red" ? "win" : "loss";
        else if (blueWon) outcome = p.team === "blue" ? "win" : "loss";

        let eloAfter = eloBefore;
        let eloChange = 0;

        if (eloEligible && !draw) {
            if (outcome === "win") {
                eloAfter = eloBefore + ELO_WIN;
                eloChange = ELO_WIN;
            } else if (outcome === "loss") {
                eloAfter = Math.max(0, eloBefore - ELO_LOSS);
                eloChange = eloAfter - eloBefore;
            }
        }

        if (playerId) {
            const { data: pl } = await supabase
                .from("players")
                .select("matches, official_matches, informal_matches, wins, losses, draws, goals, own_goals, shots, shots_on_target, passes, completed_passes, assists, interceptions, saves, possession_lost, distance_covered, xg, golazos")
                .eq("id", playerId)
                .single();

            const updates: Record<string, unknown> = {
                elo: eloAfter,
                matches: (pl?.matches ?? 0) + 1,
                goals: (pl?.goals ?? 0) + (p.goals ?? 0),
                own_goals: (pl?.own_goals ?? 0) + (p.ownGoals ?? 0),
                shots: (pl?.shots ?? 0) + (p.shots ?? 0),
                shots_on_target: (pl?.shots_on_target ?? 0) + (p.shotsOnTarget ?? 0),
                passes: (pl?.passes ?? 0) + (p.passes ?? 0),
                completed_passes: (pl?.completed_passes ?? 0) + (p.completedPasses ?? 0),
                assists: (pl?.assists ?? 0) + (p.assists ?? 0),
                interceptions: (pl?.interceptions ?? 0) + (p.interceptions ?? 0),
                saves: (pl?.saves ?? 0) + (p.saves ?? 0),
                possession_lost: (pl?.possession_lost ?? 0) + (p.possessionLost ?? 0),
                distance_covered: (pl?.distance_covered ?? 0) + (p.distanceCovered ?? 0),
                xg: Math.round(((pl?.xg ?? 0) + (p.xg ?? 0)) * 1000) / 1000,
                golazos: (pl?.golazos ?? 0) + (p.golazos ?? 0),
                last_seen: new Date().toISOString(),
            };

            if (payload.type === "official") updates.official_matches = (pl?.official_matches ?? 0) + 1;
            else updates.informal_matches = (pl?.informal_matches ?? 0) + 1;

            if (outcome === "win") updates.wins = (pl?.wins ?? 0) + 1;
            else if (outcome === "loss") updates.losses = (pl?.losses ?? 0) + 1;
            else updates.draws = (pl?.draws ?? 0) + 1;

            await supabase.from("players").update(updates).eq("id", playerId);

            if (eloEligible) {
                await supabase.from("elo_history").insert({
                    player_id: playerId,
                    match_id: matchId,
                    elo_before: eloBefore,
                    elo_after: eloAfter,
                    elo_change: eloChange,
                });
            }
        }

        await supabase.from("match_participants").insert({
            match_id: matchId,
            player_id: playerId,
            player_name: p.name,
            player_key: key,
            team: p.team,
            join_order: p.joinOrder ?? null,
            goals: p.goals ?? 0,
            own_goals: p.ownGoals ?? 0,
            left_match: Boolean(p.left),
            moved_to_spectator: Boolean(p.movedToSpectator),
            elo_before: eloEligible ? eloBefore : null,
            elo_after: eloEligible ? eloAfter : null,
            elo_change: eloEligible ? eloChange : 0,
            shots: p.shots ?? 0,
            shots_on_target: p.shotsOnTarget ?? 0,
            passes: p.passes ?? 0,
            completed_passes: p.completedPasses ?? 0,
            assists: p.assists ?? 0,
            interceptions: p.interceptions ?? 0,
            saves: p.saves ?? 0,
            possession_lost: p.possessionLost ?? 0,
            distance_covered: p.distanceCovered ?? 0,
            xg: p.xg ?? 0,
            golazos: p.golazos ?? 0,
        });
    }

    if (Array.isArray(payload.goals) && payload.goals.length > 0) {
        const goalRows = payload.goals.map((g: any) => ({
            match_id: matchId,
            scoring_team: g.scoringTeam,
            player_id: g.playerKey ? playerByKey.get(g.playerKey) ?? null : null,
            player_name: g.playerName ?? null,
            player_key: g.playerKey ?? null,
            player_team: g.playerTeam ?? null,
            is_own_goal: Boolean(g.isOwnGoal),
            elapsed_seconds: g.elapsedSeconds ?? null,
            attribution: g.attribution ?? null,
            estimated: g.estimated ?? true,
            xg: g.xg ?? null,
            is_golazo: Boolean(g.isGolazo),
        }));

        const { error: goalsError } = await supabase.from("match_goals").insert(goalRows);
        if (goalsError) {
            console.error("goals insert error", goalsError);
        }
    }

    return json({ ok: true, duplicate: false, matchId });
});
