'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * Sign-out for the suspended page.
 *
 * Not `LogoutButton`: that one is painted for the school's navbar, and this
 * page has no navbar. A full navigation rather than `router.replace`, because
 * the next screen is the login page and nothing of this one should survive.
 */
export function SuspendedSignOut({ schoolSlug }: { schoolSlug: string | null }) {
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await fetch('/api/school/auth/logout', { method: 'POST' });
    } finally {
      window.location.href =
        schoolSlug === null || schoolSlug === ''
          ? '/login'
          : `/login?school=${encodeURIComponent(schoolSlug)}`;
    }
  }, [schoolSlug]);

  return (
    <Button
      variant="secondary"
      isLoading={isSigningOut}
      onClick={() => {
        void handleSignOut();
      }}
    >
      Sign out
    </Button>
  );
}
