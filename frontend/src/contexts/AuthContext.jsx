import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, fmtErr } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Cookie is sent automatically; ask the backend who we are.
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    try {
      const { data } = await api.post("/auth/login", { username, password });
      setUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: fmtErr(e) };
    }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await api.get("/auth/me");
    setUser(data);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
