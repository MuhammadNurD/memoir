import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { LinkedIdentity, UserProfile, Workspace } from "../shared/types";
import { apiFetch } from "./api";
import { changeInterfaceLanguage } from "../i18n";

export interface OAuthProvidersInfo {
  google: { configured: boolean; callbackUrl: string; missingVars: string[] };
  apple: { configured: boolean; callbackUrl: string; missingVars: string[] };
}

export interface AiProvidersInfo {
  transcription: {
    "whisper-local": boolean;
    openai: boolean;
    deepgram: boolean;
    gemini: boolean;
    transcriptImport: boolean;
  };
  summarization: {
    openai: boolean;
    gemini: boolean;
    extractiveLocal: boolean;
  };
}

interface SessionResponse {
  authenticated: boolean;
  user: UserProfile | null;
  workspace: Workspace | null;
  identities: LinkedIdentity[];
  oauthProviders: OAuthProvidersInfo;
  aiProviders: AiProvidersInfo;
}

interface AuthContextValue {
  loading: boolean;
  authenticated: boolean;
  user: UserProfile | null;
  workspace: Workspace | null;
  identities: LinkedIdentity[];
  oauthProviders: OAuthProvidersInfo | null;
  aiProviders: AiProvidersInfo | null;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
  updatePreferences: (patch: Partial<UserProfile>) => Promise<UserProfile>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionResponse>({
    authenticated: false,
    user: null,
    workspace: null,
    identities: [],
    oauthProviders: {
      google: { configured: false, callbackUrl: "", missingVars: [] },
      apple: { configured: false, callbackUrl: "", missingVars: [] },
    },
    aiProviders: {
      transcription: {
        "whisper-local": true,
        openai: false,
        deepgram: false,
        gemini: false,
        transcriptImport: true,
      },
      summarization: {
        openai: false,
        gemini: false,
        extractiveLocal: true,
      },
    },
  });

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiFetch<SessionResponse>("/api/auth/session");
      setSession(data);
      if (data.authenticated && data.user?.uiLanguage) {
        await changeInterfaceLanguage(data.user.uiLanguage);
      }
    } catch {
      // Keep unauthenticated state if session check fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    await apiFetch("/api/auth/signout", { method: "POST" });
    await refreshSession();
  }, [refreshSession]);

  const updatePreferences = useCallback(
    async (patch: Partial<UserProfile>) => {
      const res = await apiFetch<{ user: UserProfile }>("/api/user/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (res.user.uiLanguage) {
        await changeInterfaceLanguage(res.user.uiLanguage);
      }
      setSession((prev) => ({
        ...prev,
        user: res.user,
      }));
      return res.user;
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{
        loading,
        authenticated: session.authenticated,
        user: session.user,
        workspace: session.workspace,
        identities: session.identities,
        oauthProviders: session.oauthProviders,
        aiProviders: session.aiProviders,
        refreshSession,
        signOut,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
