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
      // The navbar is painted in the school's primary colour, so the ghost
      // variant's slate lettering would be the one unreadable thing on it.
      // `cn` is tailwind-merge, so these win over the variant's own classes.
      className="text-brand-onPrimary hover:bg-brand-onPrimary/15"
      isLoading={isSigningOut}
      onClick={() => {
        void handleSignOut();
      }}
    >
      Sign out
    </Button>
  );
}
