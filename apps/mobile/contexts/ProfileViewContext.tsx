"use client";

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";

export type ProfileView = "business_hub" | "seller_hub" | "resale_hub" | "profile";

interface ProfileViewContextValue {
  profileView: ProfileView;
  setProfileView: (v: ProfileView) => void;
  switcherVisible: boolean;
  openSwitcher: () => void;
  closeSwitcher: () => void;
  hasSponsor: boolean;
  hasSeller: boolean;
  hasSubscriber: boolean;
  showSwitcher: boolean;
}

const ProfileViewContext = createContext<ProfileViewContextValue | null>(null);

export function ProfileViewProvider({
  children,
  hasSponsor,
  hasSeller,
  hasSubscriber,
  defaultView,
}: {
  children: React.ReactNode;
  hasSponsor: boolean;
  hasSeller: boolean;
  hasSubscriber: boolean;
  defaultView: ProfileView;
}) {
  const [profileView, setProfileView] = useState<ProfileView>(defaultView);

  // Sync profileView when defaultView changes (e.g. after sign-in as Seller)
  useEffect(() => {
    setProfileView(defaultView);
  }, [defaultView]);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const showSwitcher = hasSponsor || hasSeller || hasSubscriber;
  const openSwitcher = useCallback(() => setSwitcherVisible(true), []);
  const closeSwitcher = useCallback(() => setSwitcherVisible(false), []);

  const value = useMemo<ProfileViewContextValue>(
    () => ({
      profileView,
      setProfileView,
      switcherVisible,
      openSwitcher,
      closeSwitcher,
      hasSponsor,
      hasSeller,
      hasSubscriber,
      showSwitcher,
    }),
    [profileView, switcherVisible, openSwitcher, closeSwitcher, hasSponsor, hasSeller, hasSubscriber, showSwitcher]
  );

  return (
    <ProfileViewContext.Provider value={value}>{children}</ProfileViewContext.Provider>
  );
}

const defaultProfileViewValue: ProfileViewContextValue = {
  profileView: "profile",
  setProfileView: () => {},
  switcherVisible: false,
  openSwitcher: () => {},
  closeSwitcher: () => {},
  hasSponsor: false,
  hasSeller: false,
  hasSubscriber: false,
  showSwitcher: false,
};

export function useProfileView(): ProfileViewContextValue {
  const ctx = useContext(ProfileViewContext);
  return ctx ?? defaultProfileViewValue;
}
