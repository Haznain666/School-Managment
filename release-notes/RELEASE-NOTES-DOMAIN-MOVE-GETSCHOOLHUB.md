# Release notes — the move to app.getschoolhub.com

**Date:** 2026-09-26

## What changed

- The platform's address is now **app.getschoolhub.com** (was
  schoolhub.codexmill.com). Every link the platform sends — invitations,
  sign-in links, invoice emails — follows the hosting settings, so they switch
  as soon as the new site is live.
- The platform's contact address is now **support@getschoolhub.com**.
- A suspended school now sees that address on its "account suspended" screen,
  where it previously read only "Contact SchoolHub", and the platform invoice
  prints it when no bank account is on file.
- Each school's own address becomes `<school>.app.getschoolhub.com`. The school
  subdomain check now covers the new domain.

## Live

Serving on https://app.getschoolhub.com as build `6d1ba0d71885`. The first
deploy of the new site answered 503, and a redeploy fixed it.
