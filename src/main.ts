import { Hono } from "hono";
import { config } from "./config.ts";
import { db } from "./db.ts";
import { serveFrontend } from "./lib/static.ts";
import { api } from "./routes/api.ts";
import { startPayloadRetentionCleanup } from "./services/payload-retention.ts";

const app = new Hono();

startPayloadRetentionCleanup(db);

app.route("/", api);

app.get("*", async (c) => {
  const response = await serveFrontend(c.req.path);
  if (response) {
    return response;
  }

  return c.json({ error: "Not found" }, 404);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

Deno.serve({ port: config.port }, app.fetch);
