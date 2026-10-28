"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, getMe, LoginResponse } from "@/lib/api";

interface AuthState {
  token: string | null;
  user: { username: string; role: string; sector_id: number | null; is_demo: boolean; must_change_password: boolean } | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, user: null, isLoading: true });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    if (token && userStr) {
      try {
        setState({ token, user: JSON.parse(userStr), isLoading: false });
      } catch {
        setState({ token: null, user: null, isLoading: false });
      }
    } else {
      setState({ token: null, user: null, isLoading: false });
    }
  }, []);

  const login = async (username: string, password: string) => {
    const res: LoginResponse = await apiLogin(username, password);
    // Fetch full profile to get sector_id and is_demo from the server
    let sector_id: number | null = null;
    let is_demo = false;
    try {
      const me = await getMe(res.access_token);
      sector_id = me.sector_id ?? null;
      is_demo = me.is_demo ?? false;
    } catch {
      // If /me fails, fall back to safe defaults
    }
    const user = {
      username: res.username,
      role: res.role,
      sector_id,
      is_demo,
      must_change_password: res.must_change_password,
    };
    localStorage.setItem("token", res.access_token);
    localStorage.setItem("user", JSON.stringify(user));
    setState({ token: res.access_token, user, isLoading: false });
  };

  const logout = async () => {
    if (state.token) {
      await apiLogout(state.token).catch(() => {});
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setState({ token: null, user: null, isLoading: false });
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
