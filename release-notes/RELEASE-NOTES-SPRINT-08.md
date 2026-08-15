# Release notes — Sprint 8: Roles & permissions

**Status:** shipped. Migration `0010_sprint8_roles_permissions.sql`, applied.

> Reconstructed after the fact, though its design is documented in `SPRINTS.md`
> §0.3. See [how these were written](README.md#how-these-were-written).

Until this sprint, what a role could do was fixed in code. A school that wanted
its coordinator to see fees had to ask for a code change. Now it is a switch.

---

## What a school gets

**A permissions screen** at `/dashboard/settings/permissions`: every role down
one axis, every permission down the other, grouped by module.

**Permissions are defined in code; grants are data.** A school cannot invent a
permission — one that no route checks would read on screen as a guarantee and
enforce nothing. What a school controls is which of its roles hold which of the
defined permissions.

**One rule cannot be configured away.** A school administrator always keeps
`permissions.manage`. Without that, an administrator could revoke their own
ability to manage permissions and leave the school with no way back short of a
support ticket.

---

## The design decision that keeps paying off

**The table stores a school's *departures* from the default, not every grant.**

With a full grant table, a permission added by a future sprint arrives granted
to nobody at every existing school, silently — the feature ships and no one can
see it. With overrides, it arrives with a sensible default everywhere and a
school that has customised something keeps its customisation.

This is why every sprint since has been able to add permission keys — Sprint 9
added five for exams, Sprint 10 three for roll management, Sprint 11 three for
communications — and have them work at every existing school on the day they
ship, without a data migration and without anyone touching a settings screen.

**It also means adding permission keys is part of the definition of done for any
sprint that adds a module.** The database constraint that lists valid permission
keys is generated from the code, so a sprint that adds one also alters that
constraint.

---

## Things worth knowing

- **Students and parents are not configurable.** Nothing they reach is
  permission-gated — their portals answer by identity, not by permission — so a
  toggle against them would be a control that does nothing, which is the worst
  kind to put in front of an administrator.
- **A role that was rejected on purpose.** A twelfth `school_administrator` role
  was proposed and declined: its definition was a *permission set*, and this
  sprint exists precisely so a school can express one without hard-coding one
  school's org chart into three tables.

---

## Not in this release

- Per-record or per-campus permissions. Scoping to a campus is done by the
  queries themselves, not by a grant.
- Any audit of who changed a permission and when.
