import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { api } from '../lib/api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        setLoading(false);
      } else {
        signInAnonymously(auth).catch(err => {
          console.error("Anonymous auth failed", err);
          setLoading(false);
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Only claim books if we just signed in as a permanent user
    if (user && !user.isAnonymous) {
      const claim = async () => {
        try {
          const token = await user.getIdToken();
          const res = await api.claimBooks(token);
          if (res.claimed_count > 0) {
            console.log(`Claimed ${res.claimed_count} anonymous books.`);
          }
        } catch (e) {
          console.error('Failed to claim books:', e);
        }
      };
      claim();
    }
  }, [user]);

  const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
  const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const logout = () => signOut(auth);

  const value = {
    user,
    loading,
    loginWithGoogle,
    loginWithEmail,
    logout,
    getToken: async () => {
      if (!auth.currentUser) return null;
      return await auth.currentUser.getIdToken();
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
