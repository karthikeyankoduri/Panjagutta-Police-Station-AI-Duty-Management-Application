"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, getMe, LoginResponse } from "@/lib/api";

export interface AuthUser {
  username: string;
  role: string;
  sector_id: number | null;
  is_demo: boolean;
  must_change_password: boolean;
  staff_id?: number | null;
  staff_name?: string | null;
  session_timeout_minutes?: number;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: (reason?: "idle" | "manual") => Promise<void>;
  markPasswordChanged: () => void;
  idleWarning: boolean;
  keepAlive: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];
const WARNING_SECONDS = 60;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, user: null, isLoading: true });
  const [idleWarning, setIdleWarning] = useState(false);
  const lastActivity = useRef<number>(0);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    if (token && userStr) {
      try {
        setState({ token, user: JSON.parse(userStr), isLoading: false });
        return;
      } catch {
        /* fall through */
      }
    }
    setState({ token: null, user: null, isLoading: false });
  }, []);

  const persist = (token: string | null, user: AuthUser | null) => {
    if (token && user) {
      localStorage.setItem("token", token);
      localStorage.setItem("user", JSON.stringify(user));
    } else {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
    setState({ token, user, isLoading: false });
  };

  const login = async (username: string, password: string) => {
    const res: LoginResponse = await apiLogin(username, password);
    let extra: Partial<AuthUser> = {};
    if (!res.must_change_password) {
      try {
        const me = await getMe(res.access_token);
        extra = { staff_id: me.staff_id, staff_name: me.staff_name, sector_id: me.sector_id ?? null };
      } catch {
        /* profile is optional */
      }
    }
    const user: AuthUser = {
      username: res.username,
      role: res.role,
      sector_id: res.sector_id ?? null,
      is_demo: res.is_demo ?? false,
      must_change_password: res.must_change_password,
      session_timeout_minutes: res.session_timeout_minutes ?? 60,
      ...extra,
    };
    lastActivity.current = Date.now();
    persist(res.access_token, user);
    return user;
  };

  const logout = useCallback(async (reason: "idle" | "manual" = "manual") => {
    const token = localStorage.getItem("token");
    if (token) await apiLogout(token).catch(() => {});
    persist(null, null);
    setIdleWarning(false);
    if (reason === "idle" && typeof window !== "undefined") {
      window.location.href = "/login?expired=1";
    }
  }, []);

  const markPasswordChanged = () => {
    if (!state.user || !state.token) return;
    persist(state.token, { ...state.user, must_change_password: false });
  };

  const keepAlive = () => {
    lastActivity.current = Date.now();
    setIdleWarning(false);
  };

  // Client-side inactivity timeout (mirrors the server's AUTH_INACTIVITY_TIMEOUT_MINUTES).
  useEffect(() => {
    if (!state.token) return;
    const limitMs = (state.user?.session_timeout_minutes ?? 60) * 60 * 1000;
    if (!lastActivity.current) lastActivity.current = Date.now();
    const onActivity = () => {
      if (!idleWarning) lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= limitMs) {
        logout("idle");
      } else if (idle >= limitMs - WARNING_SECONDS * 1000) {
        setIdleWarning(true);
      }
    }, 5000);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(timer);
    };
  }, [state.token, state.user?.session_timeout_minutes, idleWarning, logout]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, markPasswordChanged, idleWarning, keepAlive }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
