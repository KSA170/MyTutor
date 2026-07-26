import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Profile } from "@mytutor/shared";
import { getToken, http, setToken } from "./http";

export interface AuthSession {
  userId: string;
  email: string | null;
}

interface AuthState {
  loading: boolean;
  session: AuthSession | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  session: null,
  profile: null,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

interface MeResponse {
  user: { id: string; email: string } | null;
  profile: Profile | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await http.get<MeResponse>("/auth/me");
      if (me.user) {
        setSession({ userId: me.user.id, email: me.user.email });
        setProfile(me.profile);
      } else {
        setSession(null);
        setProfile(null);
      }
    } catch {
      setSession(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (token || process.env.EXPO_PUBLIC_DEMO === "1") await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await http.post<{ token: string }>("/auth/login", {
      email,
      password,
    });
    await setToken(res.token);
    await loadMe();
  }, [loadMe]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await http.post<{ token: string }>("/auth/signup", {
        email,
        password,
        displayName,
      });
      await setToken(res.token);
      await loadMe();
    },
    [loadMe],
  );

  const signOut = useCallback(async () => {
    await setToken(null);
    setSession(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        profile,
        signIn,
        signUp,
        signOut,
        refreshProfile: loadMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
