import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  orgId: string | null;
  role: 'superadmin' | 'staff' | 'client' | null;
  orgLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [role, setRole] = useState<'superadmin' | 'staff' | 'client' | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);

  const fetchMembership = async (userId: string) => {
    setOrgLoading(true);
    try {
      const { data, error } = await supabase
        .from('memberships')
        .select('org_id, role')
        .eq('user_id', userId);

      if (error) throw error;

      if (data && data.length > 0) {
        if (data.length > 1) {
          console.warn("User has multiple org memberships. Multi-org selection is not yet implemented. Using the first one.");
        }
        setOrgId(data[0].org_id);
        setRole(data[0].role);
      } else {
        setOrgId(null);
        setRole(null);
      }
    } catch (e) {
      console.error("Failed to fetch user membership", e);
      setOrgId(null);
      setRole(null);
    } finally {
      setOrgLoading(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchMembership(session.user.id).then(() => setLoading(false));
      } else {
        setOrgId(null);
        setRole(null);
        setLoading(false);
      }
    });

    // Supabase fires onAuthStateChange (TOKEN_REFRESHED, and sometimes a re-emitted SIGNED_IN) every time the tab
    // regains focus/visibility, for the SAME user, with no actual change worth reacting to. Re-running
    // fetchMembership on every one of these toggled orgLoading true->false, which made AuthGate swap MainDashboard
    // out for the spinner and back - unmounting it and wiping its in-app navigation state (the `view` useState
    // reset to its default 'dashboard'/'research' each time). Bug report: "anytime I navigate away from the tab...
    // it takes me back to the homepage dashboard." Fix: only react when the signed-in user actually changes
    // (sign-in, sign-out, or a different user) - a same-user event just updates the token silently.
    let lastUserId: string | null = null;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      const uid = session?.user?.id ?? null;
      if (uid === lastUserId) return;
      lastUserId = uid;
      if (session?.user) {
        fetchMembership(session.user.id).then(() => setLoading(false));
      } else {
        setOrgId(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  // PROMPT 42 Stage 1 - a real, second sign-in path (not a test-only backdoor): Google is primary, this is the
  // fallback for when it's unavailable, and it is what the Playwright harness drives - "through the real login
  // form, exactly as a person does" ruled out both storage injection and a special test-only route.
  const signInWithPassword = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, orgId, role, orgLoading, signInWithGoogle, signInWithPassword, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
