// ============================================================
// Haxball Futsal - Edge Function: verify-code
// Verifica un código y vincula el jugador a la cuenta web.
// Llamada desde la web con el JWT del usuario.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
        return json({ ok: false, error: "missing_auth" }, 401);
    }

    // Verificar el JWT del usuario con el cliente anon.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
        return json({ ok: false, error: "invalid_session" }, 401);
    }
    const userId = userData.user.id;

    let body: any;
    try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

    const code = String(body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
        return json({ ok: false, error: "invalid_code_format" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    // Buscar código válido.
    const { data: codeRow, error: codeError } = await supabase
        .from("verification_codes")
        .select("*")
        .eq("code", code)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (codeError || !codeRow) {
        return json({ ok: false, error: "invalid_or_expired_code" }, 400);
    }

    // Vincular jugador.
    const { error: updateError } = await supabase
        .from("players")
        .update({ auth_user_id: userId })
        .eq("normalized_name", codeRow.player_key);

    if (updateError) {
        console.error("link player error", updateError);
        return json({ ok: false, error: "link_failed" }, 500);
    }

    // Marcar código como usado.
    await supabase
        .from("verification_codes")
        .update({ used: true, used_by: userId, used_at: new Date().toISOString() })
        .eq("id", codeRow.id);

    return json({ ok: true, playerName: codeRow.player_name });
});
