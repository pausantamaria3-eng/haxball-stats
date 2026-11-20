// ============================================================
// Haxball Futsal - Edge Function: generate-code
// Genera un código de 6 dígitos para vincular cuenta web.
// Llamada desde el servidor Haxball con secret.
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

    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

    const playerName = String(body?.playerName || "").trim();
    const playerKey = String(body?.playerKey || "").trim().toLowerCase();

    if (!playerName || !playerKey) {
        return json({ ok: false, error: "missing_player" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Asegurar que el jugador existe.
    await supabase.from("players").upsert(
        { name: playerName, normalized_name: playerKey, last_seen: new Date().toISOString() },
        { onConflict: "normalized_name" }
    );

    // Generar código de 6 dígitos.
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error } = await supabase.from("verification_codes").insert({
        code,
        player_name: playerName,
        player_key: playerKey,
        expires_at: expiresAt,
    });

    if (error) {
        console.error("insert code error", error);
        return json({ ok: false, error: "insert_failed" }, 500);
    }

    return json({ ok: true, code, expiresAt });
});
