import { Hono } from "hono";
import type { Env } from "../../shared/types";
import { createServices } from "../services";

const unmappedRoutes = new Hono<{ Bindings: Env }>();

// The unmapped queue: distinct raw names with member_id NULL, each with where they appeared. Read-only,
// so any tier including viewer can reach it — but a valid API key is still required.
unmappedRoutes.get("/", async (c) => {
  const { eventService } = createServices(c.env.DB);
  return c.json(await eventService.listUnmapped());
});

export default unmappedRoutes;
