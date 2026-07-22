import { describe, expect, it } from "vitest";
import { resolveRole } from "../../src/middleware/auth";
import type { Env } from "../../shared/types";

// Only the key bindings matter here; the rest of Env is irrelevant to role resolution.
function env(keys: Partial<Pick<Env, "API_KEY" | "ADMIN_API_KEY" | "VIEWER_API_KEY">>): Env {
  return keys as Env;
}

describe("resolveRole", () => {
  it("resolves the admin key to admin", () => {
    expect(resolveRole("a", env({ API_KEY: "m", ADMIN_API_KEY: "a" }))).toBe("admin");
  });

  it("resolves the manager key to manager", () => {
    expect(resolveRole("m", env({ API_KEY: "m", ADMIN_API_KEY: "a" }))).toBe("manager");
  });

  it("resolves the viewer key to viewer", () => {
    expect(resolveRole("v", env({ API_KEY: "m", ADMIN_API_KEY: "a", VIEWER_API_KEY: "v" }))).toBe(
      "viewer",
    );
  });

  it("resolves an unknown key to null", () => {
    expect(resolveRole("nope", env({ API_KEY: "m", ADMIN_API_KEY: "a" }))).toBeNull();
  });

  it("fails closed when VIEWER_API_KEY is unset", () => {
    expect(resolveRole("undefined", env({ API_KEY: "m", ADMIN_API_KEY: "a" }))).toBeNull();
  });

  // "undefined" is the value a caller would send if they stringified a missing key client-side. An unset
  // binding must never authenticate it, whatever safeEqual does with an undefined argument internally.
  it("fails closed when ADMIN_API_KEY is unset", () => {
    expect(resolveRole("undefined", env({ API_KEY: "m" }))).toBeNull();
  });

  it("fails closed when API_KEY is unset", () => {
    expect(resolveRole("undefined", env({ ADMIN_API_KEY: "a" }))).toBeNull();
  });

  it("fails closed when both keys are unset", () => {
    expect(resolveRole("undefined", env({}))).toBeNull();
  });
});
