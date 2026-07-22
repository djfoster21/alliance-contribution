import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createServices } from "../../src/services";

describe("createServices", () => {
  it("wires all nine services", () => {
    const services = createServices(env.DB);

    expect(services.memberService).toBeDefined();
    expect(services.aliasService).toBeDefined();
    expect(services.activityService).toBeDefined();
    expect(services.scoringService).toBeDefined();
    expect(services.eventService).toBeDefined();
    expect(services.resolveService).toBeDefined();
    expect(services.recomputeService).toBeDefined();
    expect(services.statsService).toBeDefined();
    expect(services.backupService).toBeDefined();
  });
});
