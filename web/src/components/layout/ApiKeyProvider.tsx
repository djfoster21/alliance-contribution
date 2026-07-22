import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { ApiKeyContext, type Role } from "@/lib/apiKey";
import { readApiKey, writeApiKey } from "@/lib/apiKey";

export function ApiKeyProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string>(() => readApiKey());
  const [role, setRole] = useState<Role>(null);
  const [checking, setChecking] = useState<boolean>(() => readApiKey() !== "");

  useEffect(() => {
    if (!apiKey) {
      setRole(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    api
      .authMe()
      .then((res) => {
        if (!cancelled) setRole(res.role);
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  const setApiKey = (key: string) => {
    writeApiKey(key);
    setApiKeyState(readApiKey());
  };

  return (
    <ApiKeyContext.Provider value={{ apiKey, setApiKey, role, checking }}>
      {children}
    </ApiKeyContext.Provider>
  );
}
