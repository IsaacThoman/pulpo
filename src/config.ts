import { join } from "@std/path";

function getNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: getNumber("PORT", 8000),
  appSecret: Deno.env.get("APP_SECRET") || "change-me-in-production",
  sessionCookieName: Deno.env.get("SESSION_COOKIE_NAME") || "llm_proxy_admin",
  sessionTtlHours: getNumber("SESSION_TTL_HOURS", 24 * 7),
  frontendDistDir: Deno.env.get("FRONTEND_DIST_DIR") ||
    join(Deno.cwd(), "frontend", "dist", "frontend", "browser"),
};
