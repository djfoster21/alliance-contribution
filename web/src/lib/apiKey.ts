import { createContext, useContext } from "react";
import { API_KEY_STORAGE } from "./api";

export function readApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE) ?? "";
}

export function writeApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed);
  else localStorage.removeItem(API_KEY_STORAGE);
}

export type Role = "admin" | "manager" | "viewer" | null;

export type ApiKeyContextValue = {
  /** The current API key ("" when unset). Every request needs one — viewer tier is the read floor. */
  apiKey: string;
  /** Persist a new key (or clear it with an empty string). */
  setApiKey: (key: string) => void;
  /** Role resolved from the current key via GET /api/auth/me (null when unset or not recognised). */
  role: Role;
  /** True until the first /api/auth/me answer lands, so the gate doesn't flash on load. */
  checking: boolean;
};

export const ApiKeyContext = createContext<ApiKeyContextValue | null>(null);

export function useApiKey(): ApiKeyContextValue {
  const ctx = useContext(ApiKeyContext);
  if (!ctx) throw new Error("useApiKey must be used within an ApiKeyProvider");
  return ctx;
}
