'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/Button';

/**
 * Ends the session server-side, then navigates to the login page.
 *
 * The cookie is httpOnly, so signing out has to be a request — the browser
 * cannot clear it itself. `router.refresh()` drops any cached server render
 * that was produced for the signed-in user.
 */
export function LogoutButton({ schoolSlug }: { schoolSlug: string | null }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await fetch('/api/school/auth/logout', { method: 'POST' });
      const target =
        schoolSlug === null || schoolSlug === ''
          ? '/login'
          : `/login?school=${encodeURIComponent(schoolSlug)}`;
      router.replace(target);
      router.refresh();
    } finally {
      setIsSigningOut(false);
    }
  }, [router, schoolSlug]);

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={isSigningOut}
      onClick={() => {
        void handleSignOut();
      }}
    >
      Sign out
    </Button>
  );
}
