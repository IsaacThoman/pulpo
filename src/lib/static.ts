import { extname, join, normalize } from "@std/path";
import { config } from "../config.ts";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

async function readAsset(path: string): Promise<Response | null> {
  try {
    const body = await Deno.readFile(path);
    const type = MIME_TYPES[extname(path)] || "application/octet-stream";
    return new Response(body, {
      headers: {
        "content-type": type,
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

export async function serveFrontend(
  pathname: string,
): Promise<Response | null> {
  const trimmedPath = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(trimmedPath).replace(/^(\.\.[/\\])+/, "");
  const assetPath = join(config.frontendDistDir, normalized);

  const directMatch = await readAsset(assetPath);
  if (directMatch) {
    return directMatch;
  }

  if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) {
    return null;
  }

  const fallback = await readAsset(join(config.frontendDistDir, "index.html"));
  if (fallback) {
    return fallback;
  }

  return new Response(
    "Frontend assets not found. Build the Angular app first.",
    {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}
