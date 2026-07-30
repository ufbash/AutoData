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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, orgId, role, orgLoading, signInWithGoogle, signOut }}>
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
