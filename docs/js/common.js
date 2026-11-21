import { supabase } from "./supabase.js";

export const ELO_START = 100;

export function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
        if (c == null) continue;
        node.append(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
}

export function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-ES", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
    });
}

export function fmtDuration(sec) {
    if (typeof sec !== "number" || !isFinite(sec)) return "—";
    const m = Math.floor(sec / 60);
    const r = Math.round(sec % 60);
    return m + ":" + String(r).padStart(2, "0");
}

export function fmtDistanceKm(units) {
    const n = Number(units) || 0;
    // 10 unidades = 1 metro → 10.000 unidades = 1 km
    const km = n / 10000;
    return km.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " km";
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

export function fmtRating(value) {
    const n = Number(value) || 0;
    return n.toFixed(1).replace(".", ",");
}

export function calcMatchRating(p, match) {
    const n = (v) => Number(v) || 0;
    let r = 5;

    const goals = n(p.goals);
    const ownGoals = n(p.own_goals);
    const assists = n(p.assists);
    const saves = n(p.saves);
    const interceptions = n(p.interceptions);
    const shots = n(p.shots);
    const shotsOnTarget = n(p.shots_on_target);
    const passes = n(p.passes);
    const completedPasses = n(p.completed_passes);
    const lost = n(p.possession_lost);
    const oles = n(p.oles);
    const golazos = n(p.golazos);
    const xg = n(p.xg);

    const resultValid = Boolean(match) && match.status === "completed" &&
        !match.manual && match.end_reason !== "abandoned";

    if (resultValid) {
        const myScore = p.team === "red" ? n(match.red_score) : n(match.blue_score);
        const oppScore = p.team === "red" ? n(match.blue_score) : n(match.red_score);
        if (myScore > oppScore) r += 1.0;
        else if (myScore < oppScore) r -= 1.0;
        else r += 0.2;
    }

    // Ataque
    r += Math.min(goals * 0.8, 2.4);
    r += Math.min(assists * 0.5, 1.5);
    r += Math.min(golazos * 0.4, 0.8);
    r += Math.min(shotsOnTarget * 0.12, 0.8);
    r += Math.min(Math.max(shots - shotsOnTarget, 0) * 0.02, 0.2);
    r += clamp((goals - xg) * 0.25, -0.8, 0.8);

    // Penalizaciones de ataque
    r -= Math.min(ownGoals * 1.2, 2.4);

    // Pases
    r += Math.min(completedPasses * 0.03, 0.6);
    r -= Math.min(Math.max(passes - completedPasses, 0) * 0.02, 0.5);
    if (passes > 0) {
        r += clamp((completedPasses / passes - 0.7) * 2, -0.4, 0.4);
    }

    // Defensa y estilo
    r += Math.min(saves * 0.15, 1.0);
    r += Math.min(interceptions * 0.12, 0.8);
    r -= Math.min(lost * 0.03, 0.6);
    r += Math.min(oles * 0.2, 0.6);

    // Posesión del equipo
    if (match) {
        const possession = p.team === "red" ? n(match.red_possession) : n(match.blue_possession);
        if (possession > 0) r += clamp((possession - 50) * 0.02, -0.5, 0.5);
    }

    if (p.left_match) r -= 1.0;
    if (p.moved_to_spectator) r -= 0.5;

    if (!resultValid) r = Math.min(r, 7.5);
    r = clamp(r, 0, 10);
    return Math.round(r * 10) / 10;
}

export function pickMatchMvp(participants, match) {
    let best = null;
    let bestRating = -Infinity;
    (participants || []).forEach((p) => {
        // Quien abandona (o pasa a espectador) no puede ser MVP
        if (p.left_match || p.left || p.moved_to_spectator || p.movedToSpectator) return;
        const rating = calcMatchRating(p, match);
        const goals = Number(p.goals) || 0;
        const bestGoals = Number(best && best.goals) || 0;
        const name = String(p.player_name || "");
        const bestName = String(best && best.player_name || "");
        if (rating > bestRating ||
            (rating === bestRating && goals > bestGoals) ||
            (rating === bestRating && goals === bestGoals && name.localeCompare(bestName) < 0)) {
            best = p;
            bestRating = rating;
        }
    });
    return best ? { player: best, rating: bestRating } : null;
}

export function teamColor(team) {
    return team === "red" ? "#ff6b6b" : "#6b8cff";
}

export function teamName(team) {
    return team === "red" ? "ROJO" : "AZUL";
}

export async function fetchTopPlayers(limit = 20) {
    const { data, error } = await supabase
        .from("players")
        .select("id,name,elo,matches,official_matches,informal_matches,wins,losses,draws,goals,own_goals")
        .order("elo", { ascending: false })
        .limit(limit);
    if (error) { console.error(error); return []; }
    return data || [];
}

export async function fetchRecentMatches(limit = 20) {
    const { data, error } = await supabase
        .from("matches")
        .select("id,external_id,type,status,map_name,started_at,ended_at,duration_seconds,red_score,blue_score,elo_eligible,manual,end_reason,spectator_name")
        .order("started_at", { ascending: false })
        .limit(limit);
    if (error) { console.error(error); return []; }
    return data || [];
}

export async function fetchPlayerByName(name) {
    const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("normalized_name", name.trim().replace(/\s+/g, " ").toLowerCase())
        .maybeSingle();
    if (error) { console.error(error); return null; }
    return data;
}

export async function fetchPlayerMatches(playerId, limit = 30) {
    const { data, error } = await supabase
        .from("match_participants")
        .select("match_id,team,goals,own_goals,left_match,moved_to_spectator,assists,saves,interceptions,shots,shots_on_target,passes,completed_passes,possession_lost,oles,golazos,xg,elo_before,elo_after,elo_change,matches(id,type,status,map_name,started_at,red_score,blue_score,manual,end_reason,red_possession,blue_possession)")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) { console.error(error); return []; }
    return data || [];
}

export async function fetchMatchDetail(matchId) {
    const [m, p, g] = await Promise.all([
        supabase.from("matches").select("*").eq("id", matchId).maybeSingle(),
        supabase.from("match_participants").select("*").eq("match_id", matchId).order("join_order"),
        supabase.from("match_goals").select("*").eq("match_id", matchId).order("created_at"),
    ]);
    return { match: m.data, participants: p.data || [], goals: g.data || [] };
}

export async function fetchGoalReplays(limit = 100) {
    const { data, error } = await supabase
        .from("match_goals")
        .select("*, matches!inner(id,type,status,map_name,started_at,red_score,blue_score,elo_eligible,manual,end_reason)")
        .not("replay_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) { console.error("fetchGoalReplays error:", error); throw error; }
    return data || [];
}

// Enlace al reproductor oficial de HaxBall. El hash va sin codificar porque
// el propio reproductor lo usa como URL directa del fichero .hbr2.
export function haxballReplayUrl(replayUrl) {
    if (!replayUrl) return null;
    return "https://www.haxball.com/replay?v=3#" + replayUrl;
}

export async function fetchPlayerEloHistory(playerId, limit = 50) {
    const { data, error } = await supabase
        .from("elo_history")
        .select("elo_before,elo_after,elo_change,created_at,match_id")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(limit);
    if (error) { console.error(error); return []; }
    return data || [];
}

export function setActiveNav() {
    const path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll("[data-nav]").forEach((a) => {
        if (a.getAttribute("href") === path) a.classList.add("active");
    });
}

export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
}

export async function getLinkedPlayerName() {
    const session = await getSession();
    if (!session) return null;
    const { data } = await supabase
        .from("players")
        .select("name")
        .eq("auth_user_id", session.user.id)
        .maybeSingle();
    return data?.name || null;
}

export async function signIn(provider) {
    await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: location.origin + location.pathname.replace("login.html", "index.html") },
    });
}

export async function signOut() {
    await supabase.auth.signOut();
    location.reload();
}

export async function renderAuthBox(container) {
    if (!container) return;
    const session = await getSession();

    // Indicador de cuenta Haxball (siempre visible).
    let hxName = null;
    if (session) {
        try {
            const { data: linked } = await supabase
                .from("players")
                .select("name")
                .eq("auth_user_id", session.user.id)
                .maybeSingle();
            if (linked && linked.name) hxName = linked.name;
        } catch (e) {
            console.error("renderAuthBox linked query error:", e);
        }
    }

    container.innerHTML = "";

    const hxSpan = el("span", { class: "pill " + (hxName ? "pill-green" : "pill-red"), style: "margin-right:12px" });
    if (hxName) {
        hxSpan.textContent = "Cuenta Haxball: " + hxName;
    } else {
        hxSpan.textContent = "Cuenta Haxball: no conectada";
    }
    container.append(hxSpan);

    if (session) {
        const user = session.user;
        const displayName = user.email || user.user_metadata?.full_name || "Usuario";
        const span = el("span", { class: "auth-user", style: "margin-right:8px" }, displayName);
        container.append(span);
        const btn = el("button", { class: "btn btn-sm", onClick: () => signOut() }, "Salir");
        container.append(btn);
    } else {
        const g = el("button", { class: "btn btn-sm btn-google", onClick: () => signIn("google") }, "Google");
        const d = el("button", { class: "btn btn-sm btn-discord", onClick: () => signIn("discord") }, "Discord");
        container.append(g, d);
    }
}
