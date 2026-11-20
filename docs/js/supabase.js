import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.SUPABASE_CONFIG || {};
export const supabase = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
});
export default supabase;
