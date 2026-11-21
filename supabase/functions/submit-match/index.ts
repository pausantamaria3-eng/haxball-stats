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

// ============================================================
// Valoración y ELO (misma fórmula que el servidor y la web)
// ============================================================

const ELO_START = 100;

function num(v: any): number {
    return Number(v) || 0;
}

function clampNum(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function calcMatchRating(p: any, match: any): number {
    let r = 5;

    const goals = num(p.goals);
    const ownGoals = num(p.ownGoals);
    const assists = num(p.assists);
    const saves = num(p.saves);
    const interceptions = num(p.interceptions);
    const shots = num(p.shots);
    const shotsOnTarget = num(p.shotsOnTarget);
    const passes = num(p.passes);
    const completedPasses = num(p.completedPasses);
    const lost = num(p.possessionLost);
    const oles = num(p.oles);
    const golazos = num(p.golazos);
    const xg = num(p.xg);

    const resultValid = Boolean(match) && match.status === "completed" &&
        !match.manual && match.end_reason !== "abandoned";

    if (resultValid) {
        const myScore = p.team === "red" ? num(match.red_score) : num(match.blue_score);
        const oppScore = p.team === "red" ? num(match.blue_score) : num(match.red_score);
        if (myScore > oppScore) r += 1.0;
        else if (myScore < oppScore) r -= 1.0;
        else r += 0.2;
    }

    r += Math.min(goals * 0.8, 2.4);
    r += Math.min(assists * 0.5, 1.5);
    r += Math.min(golazos * 0.4, 0.8);
    r += Math.min(shotsOnTarget * 0.12, 0.8);
    r += Math.min(Math.max(shots - shotsOnTarget, 0) * 0.02, 0.2);
    r += clampNum((goals - xg) * 0.25, -0.8, 0.8);
    r -= Math.min(ownGoals * 1.2, 2.4);
    r += Math.min(completedPasses * 0.03, 0.6);
    r -= Math.min(Math.max(passes - completedPasses, 0) * 0.02, 0.5);
    if (passes > 0) r += clampNum((completedPasses / passes - 0.7) * 2, -0.4, 0.4);
    r += Math.min(saves * 0.15, 1.0);
    r += Math.min(interceptions * 0.12, 0.8);
    r -= Math.min(lost * 0.03, 0.6);
    r += Math.min(oles * 0.2, 0.6);

    if (match) {
        const possession = p.team === "red" ? num(match.red_possession) : num(match.blue_possession);
        if (possession > 0) r += clampNum((possession - 50) * 0.02, -0.5, 0.5);
    }

    if (p.left || p.left_match) r -= 1.0;
    if (p.movedToSpectator || p.moved_to_spectator) r -= 0.5;

    if (!resultValid) r = Math.min(r, 7.5);
    r = clampNum(r, 0, 10);
    return Math.round(r * 10) / 10;
}

function pickMvp(players: any[], ratings: Map<string, number>) {
    let best: any = null;
    let bestRating = -Infinity;
    for (const p of players) {
        // Quien abandona (o pasa a espectador) no puede ser MVP
        if (p.left || p.left_match || p.movedToSpectator || p.moved_to_spectator) continue;
        const rating = ratings.get(p.key) ?? 0;
        if (!best || rating > bestRating ||
            (rating === bestRating && num(p.goals) > num(best.goals)) ||
            (rating === bestRating && num(p.goals) === num(best.goals) &&
                String(p.name || "").localeCompare(String(best.name || "")) < 0)) {
            best = p;
            bestRating = rating;
        }
    }
    return best ? { player: best, rating: bestRating } : null;
}

function computeEloDelta(o: {
    matchesPlayed: number;
    myTeamAvg: number;
    oppTeamAvg: number;
    outcome: "win" | "loss" | "draw";
    rating: number;
    isMvp: boolean;
    ownGoals: number;
    margin: number;
}): number {
    // Elo clásico ajustado por rendimiento, MVP, experiencia y diferencia de goles
    const expected = 1 / (1 + Math.pow(10, (o.oppTeamAvg - o.myTeamAvg) / 400));
    const actual = o.outcome === "win" ? 1 : o.outcome === "loss" ? 0 : 0.5;
    const k = o.matchesPlayed < 10 ? 24 : o.matchesPlayed < 30 ? 20 : 16;
    // La nota ya incluye el resultado: comparamos contra la nota neutra de ese resultado
    // para no contarlo dos veces (6,0 victoria / 4,0 derrota / 5,2 empate).
    const baseline = o.outcome === "win" ? 6 : o.outcome === "loss" ? 4 : 5.2;
    const adjustedActual = clampNum(
        actual + (o.rating - baseline) * 0.04 + (o.isMvp ? 0.12 : 0) - Math.min(o.ownGoals * 0.06, 0.18),
        0,
        1.35
    );
    const marginFactor = 1 + Math.min(o.margin, 5) * 0.05;
    return Math.round(k * (adjustedActual - expected) * marginFactor);
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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    // Subida de una grabación nativa (.hbr2) de HaxBall. Se llama desde el
    // headless justo después de cada gol; el nombre del archivo es
    // determinista: <externalId>/<goalIndex>.hbr2.
    if (payload.action === "upload-replay") {
        if (typeof payload.replay !== "string" || !payload.replay) {
            return json({ ok: false, error: "missing_replay" }, 400);
        }
        if (!Number.isInteger(payload.goalIndex) || payload.goalIndex < 0) {
            return json({ ok: false, error: "invalid_goal_index" }, 400);
        }

        const bytes = Uint8Array.from(atob(payload.replay), (c) => c.charCodeAt(0));
        const path = `${payload.externalId}/${payload.goalIndex}.hbr2`;

        const { error: uploadError } = await supabase.storage
            .from("replays")
            .upload(path, bytes, {
                contentType: "application/octet-stream",
                upsert: true,
            });

        if (uploadError) {
            console.error("replay upload error", uploadError);
            return json({ ok: false, error: "replay_upload_failed" }, 500);
        }

        const replayUrl = supabase.storage.from("replays").getPublicUrl(path).data.publicUrl;
        return json({ ok: true, replayUrl });
    }

    if (payload.type !== "official" && payload.type !== "informal") {
        return json({ ok: false, error: "invalid_type" }, 400);
    }
    if (!Array.isArray(payload.participants)) {
        return json({ ok: false, error: "invalid_participants" }, 400);
    }

    // Idempotencia
    const { data: existing } = await supabase
        .from("matches")
        .select("id, external_id")
        .eq("external_id", payload.externalId)
        .maybeSingle();

    if (existing) {
        return json({ ok: true, duplicate: true, matchId: existing.id });
    }

    // Solo partidas oficiales, completas, no manuales y sin abandono
    const eloEligible = Boolean(payload.eloEligible) &&
        payload.type === "official" &&
        payload.status === "completed" &&
        !payload.manual;
    const redWon = payload.redScore > payload.blueScore;
    const blueWon = payload.blueScore > payload.redScore;

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
            elo_eligible: eloEligible,
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

    // Snapshot de ELO y experiencia ANTES de aplicar cambios
    const ratingMatch = {
        status: payload.status,
        manual: payload.manual ?? false,
        end_reason: payload.endReason ?? null,
        red_score: num(payload.redScore),
        blue_score: num(payload.blueScore),
        red_possession: payload.redPossession,
        blue_possession: payload.bluePossession,
    };
    const allPlayers = Array.from(merged.values());
    const ratings = new Map<string, number>();
    for (const p of allPlayers) ratings.set(p.key, calcMatchRating(p, ratingMatch));
    const mvp = pickMvp(allPlayers, ratings);

    const playerIds = Array.from(playerByKey.values());
    const eloSnapshot = new Map<string, { elo: number; matches: number }>();
    if (playerIds.length) {
        const { data: snap } = await supabase
            .from("players")
            .select("id,elo,matches")
            .in("id", playerIds);
        for (const row of snap || []) {
            eloSnapshot.set(row.id, { elo: num(row.elo), matches: num(row.matches) });
        }
    }

    function teamAverage(team: string): number {
        const members = allPlayers.filter((p) => p.team === team);
        if (!members.length) return ELO_START;
        let sum = 0;
        for (const p of members) {
            const id = playerByKey.get(p.key);
            sum += id ? (eloSnapshot.get(id)?.elo ?? ELO_START) : ELO_START;
        }
        return sum / members.length;
    }
    const redAvg = teamAverage("red");
    const blueAvg = teamAverage("blue");
    const margin = Math.abs(num(payload.redScore) - num(payload.blueScore));

    for (const [key, p] of merged.entries()) {
        const playerId = playerByKey.get(key) ?? null;
        const snapshot = playerId ? eloSnapshot.get(playerId) : null;
        const eloBefore = snapshot?.elo ?? ELO_START;
        const matchesPlayed = snapshot?.matches ?? 0;

        let outcome: "win" | "loss" | "draw" = "draw";
        if (redWon) outcome = p.team === "red" ? "win" : "loss";
        else if (blueWon) outcome = p.team === "blue" ? "win" : "loss";

        let eloAfter = eloBefore;
        let eloChange = 0;
        // Solo las partidas oficiales (formales) penalizan ELO por abandono.
        const abandonPenalty = payload.type === "official" ? num(p.abandonPenalty) : 0;
        const hasEloMove = eloEligible || abandonPenalty > 0;

        if (abandonPenalty > 0) {
            // Abandono: se aplica la penalización fija aunque la partida
            // haya perdido el ELO por el propio abandono.
            eloAfter = Math.max(0, eloBefore - abandonPenalty);
            eloChange = eloAfter - eloBefore;
        } else if (eloEligible) {
            const myTeamAvg = p.team === "red" ? redAvg : blueAvg;
            const oppTeamAvg = p.team === "red" ? blueAvg : redAvg;
            const isMvp = Boolean(mvp && mvp.player === p);
            const rating = ratings.get(key) ?? 5;
            eloChange = computeEloDelta({
                matchesPlayed,
                myTeamAvg,
                oppTeamAvg,
                outcome,
                rating,
                isMvp,
                ownGoals: num(p.ownGoals),
                margin,
            });
            eloAfter = Math.max(0, eloBefore + eloChange);
            eloChange = eloAfter - eloBefore;
        }

        if (playerId) {
            const { data: pl } = await supabase
                .from("players")
                .select("matches, official_matches, informal_matches, wins, losses, draws, goals, own_goals, shots, shots_on_target, passes, completed_passes, assists, interceptions, saves, possession_lost, distance_covered, xg, golazos, oles")
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
                oles: (pl?.oles ?? 0) + (p.oles ?? 0),
                last_seen: new Date().toISOString(),
            };

            if (payload.type === "official") updates.official_matches = (pl?.official_matches ?? 0) + 1;
            else updates.informal_matches = (pl?.informal_matches ?? 0) + 1;

            if (outcome === "win") updates.wins = (pl?.wins ?? 0) + 1;
            else if (outcome === "loss") updates.losses = (pl?.losses ?? 0) + 1;
            else updates.draws = (pl?.draws ?? 0) + 1;

            await supabase.from("players").update(updates).eq("id", playerId);

            if (hasEloMove) {
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
            elo_before: hasEloMove ? eloBefore : null,
            elo_after: hasEloMove ? eloAfter : null,
            elo_change: hasEloMove ? eloChange : 0,
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
            oles: p.oles ?? 0,
        });
    }

    function buildReplayUrl(g: any, index: number): string | null {
        if (!g || (!g.hasReplay && !g.replayUrl)) return null;
        if (g.replayUrl) return g.replayUrl;
        const path = `${payload.externalId}/${index}.hbr2`;
        return supabase.storage.from("replays").getPublicUrl(path).data.publicUrl;
    }

    if (Array.isArray(payload.goals) && payload.goals.length > 0) {
        const goalRows = payload.goals.map((g: any, index: number) => ({
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
            assist_name: g.assistName ?? null,
            assist_player_key: g.assistKey ?? null,
            score_before: g.scoreBefore ?? null,
            score_after: g.scoreAfter ?? null,
            ball_speed_kmh: g.ballSpeedKmh ?? null,
            replay: g.replay ?? null,
            replay_url: buildReplayUrl(g, index),
        }));

        const { error: goalsError } = await supabase.from("match_goals").insert(goalRows);
        if (goalsError) {
            console.error("goals insert error", goalsError);
        }
    }

    return json({ ok: true, duplicate: false, matchId });
});
