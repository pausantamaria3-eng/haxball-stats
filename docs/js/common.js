import { supabase } from "./supabase.js";

export const ELO_START = 100;

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
        .select("match_id,team,goals,own_goals,left_match,moved_to_spectator,elo_before,elo_after,elo_change,matches(id,type,status,map_name,started_at,red_score,blue_score)")
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

export function renderAuthBox(container) {
    if (!container) return;
    getSession().then((session) => {
        if (session) {
            const user = session.user;
            container.innerHTML = "";
            const span = el("span", { class: "auth-user" }, user.email || user.user_metadata?.full_name || "Usuario");
            const btn = el("button", { class: "btn btn-sm", onClick: () => signOut() }, "Salir");
            container.append(span, btn);
        } else {
            container.innerHTML = "";
            const g = el("button", { class: "btn btn-sm btn-google", onClick: () => signIn("google") }, "Google");
            const d = el("button", { class: "btn btn-sm btn-discord", onClick: () => signIn("discord") }, "Discord");
            container.append(g, d);
        }
    });
}
