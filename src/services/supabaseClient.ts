import { createClient } from "@supabase/supabase-js";

// Optional chaining on `.env`, with a process.env fallback, so this also works when imported
// under plain Node (e.g. a throwaway verification script run via
// `node --experimental-strip-types`), where import.meta.env doesn't exist at all - Vite always
// populates import.meta.env itself, so browser behavior is unchanged.
const supabaseUrl = ((import.meta as any).env?.VITE_SUPABASE_URL ?? (globalThis as any).process?.env?.VITE_SUPABASE_URL) as string | undefined;
const supabaseAnonKey = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? (globalThis as any).process?.env?.VITE_SUPABASE_ANON_KEY) as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set."
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");
