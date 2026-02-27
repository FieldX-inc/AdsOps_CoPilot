export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  authId: process.env.AUTH_ID ?? "dev",
  authPassword: process.env.AUTH_PASSWORD ?? "1234",
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  sessionCookieName: "adops_session",
  sessionMaxAgeSeconds: 60 * 60 * 8,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  aiRuntime: process.env.AI_RUNTIME === "adk" ? "adk" : "legacy",
};

export const hasSupabaseConfig =
  Boolean(env.supabaseUrl) && Boolean(env.supabaseServiceRoleKey);
