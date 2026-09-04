# Sprint 26 — the campus dropdown, chat for every role, the pupil's own sign-in, and a phone-sized header

**2026-09-04.** Four things reported by the product owner. Three of them turned
out to be the same kind of fault: a feature that was built, shipped, and had
nothing pointing at it.

There is **no migration**. `0042` is still the next free number.

---

## 1 · The campus dropdown stuck after one change

**Reported:** *"On the dashboard, when I selected the Campus from top right, the
dashboard did update but the Campus dropdown stuck and remains disabled."*

The control set a `pending` flag immediately before `router.push` and nothing
ever set it back. `?branch=` changes the *search params* of the route the
component is already mounted on, so it is not unmounted and remounted — there
was no path that cleared the flag short of reloading the page. The dashboard
behind it updated correctly the whole time, which is exactly why it read as a
stuck control rather than a failed navigation.

**Two obvious repairs were tried in a browser and both failed.** `useTransition`
around the push left `isPending` true twenty seconds after the new dashboard had
finished rendering. Clearing the flag from an effect watching the new `?branch=`
never fired, because this component is not re-rendered when the navigation
lands. Each is the same bug wearing a better disguise, and the second is worse
because it looks correct in review.

There is now **no local pending state at all**. `RouteProgress` is already
mounted in the root layout, already counts every in-flight navigation, and
already has a fallback timer for a request that never settles. The private
per-control indicator was duplicating it and, unlike it, could wedge.

**The same defect was on the same screen, unreported.** The *Period* dropdown
beside it was written the same way. Nobody had got past the campus one to reach
it. Both are fixed.

> Verified: five consecutive changes across both controls, every one accepted,
> the figures tracking each campus (Defence 6, Karachi 0), no hint left behind.

---

## 2 · Messages was invisible to every administrator

**Reported:** *"I don't see the Message option in the Principal / School Admin
or Branch Admin portal. Why??"*

Not a permission, and not a bug in the sidebar. **No school on the platform had
a `chat` row in `school_modules` at all.**

The module flag read false everywhere, and it gated exactly one thing: the
administrative sidebar entry. The teacher, parent and pupil navigations never
consulted it, and no route under `/api/school/chat/**` consulted it either. So
at the same school, teachers were chatting while their own head could not find
the screen.

- the flag now means one thing on **all four portals**;
- the **pages** enforce it, not only the links — a link is not a permission;
- the entry is called **Messages** here too, which is what the other three
  portals have always called it;
- and it is switched **on** at all three schools.

---

## 3 · Oversight — reading the school's correspondence

**Reported:** School Admin reads everything; Principal reads their branches;
Principal with limited grades reads those grades plus all staff-to-staff; Branch
Admin reads none of it.

New permission `chat.oversight` and a new screen, **All conversations**, beside
*Reported messages*. They are separate permissions because they are separate
acts: one is a safeguarding investigation, the other is a head reading what
their school is saying.

| Role | Reads |
| --- | --- |
| School Administrator | every conversation at the school, every campus |
| Principal | every conversation at the campuses assigned to them |
| Principal, with grades | staff↔staff at their campuses, **plus** pupil and parent threads for their own grades |
| Branch Administrator | **nothing** |

The grade-limited head is the interesting row. A thread about a pupil is
attributable to a grade through that pupil's active enrollment; a thread between
two members of staff is not. A division head still sees *all* staff-to-staff
correspondence at their campuses — only the pupil-facing half narrows.

**Read-only by construction, not by hiding a composer.** Posting goes through
the send path, which requires a seat in the conversation, and an overseer is
never seated. The screen could not write into a thread even if somebody added a
box to it.

**Everybody in a conversation is told.** The disclosure that used to appear only
on pupil threads now appears on staff threads too. A covert audit is
surveillance; a disclosed one is a deterrent.

### The defect QA found here

The rule held in the **list** and not at the **door**. `chat.moderate` — which a
principal holds by default — opens any thread *about a pupil* and never asked
whose. Measured at Askari, whose Principal 1 covers Pre-Nursery to Class 4:

```
GET /api/school/chat/oversight        -> 6 threads, all staff-only
GET /conversations/<a Class 5 thread> -> 200
```

Absent from their list, readable by id. Moderation reach is now derived from
what the caller *is*, independently of which door they came through — and
deliberately **not** by requiring oversight for both, because a Branch
Administrator holds `chat.moderate` and not `chat.oversight`, and folding them
together would have removed the one chat duty the product owner kept for that
role.

> Verified across three callers: Askari School Admin 15 conversations and
> Class 5 → 200; Askari Principal 1 six conversations and Class 5 → **404**;
> LGS Branch Admin oversight API **403**, staff thread **404**.

---

## 4 · The pupil sign-in nobody could use

**Reported:** *"I'm unable to use the mechanism that you have created for
student login."*

Correct — because there was no way to. `POST /students/[id]/credentials` was
written in Sprint 24 and **nothing in the product ever called it**. No button,
on any screen. No school had ever issued a pupil a login. It also assumed a
clerk would read a generated password across a counter and hand it to a child,
which does not survive contact with a school office.

**Decided with the product owner and built:**

- the login ID is **still** the `…@students.<school>.invalid` address, and the
  child is **still** never emailed;
- the student detail screen now shows that ID, with a **Generate new password**
  button;
- the password goes to the **guardians**, at the real addresses the school
  already holds;
- it is no longer returned to the browser at all — the only copy that leaves the
  server is the one in the outbox row;
- a new enrolment, a converted application, and a promotion into an eligible
  class each send it with nobody pressing anything.

> ⚠️ **The trade, stated rather than buried.** A password in a parent's inbox is
> readable by anyone who can open that inbox, and reading it leaves no trace.
> The counter slip had the opposite profile: hard to intercept, easy to lose.
> The mitigations are that the password is rotated whenever anybody asks —
> there is no recovery flow to compromise, only reissue — and that a pupil
> account reaches a pupil's own portal and nothing else.

### "Grade 6 or above" is stored, not derived

`sort_order` is a ladder position, not a grade number. At **both** LGS and
Askari the class called "6" sits at **9**, behind three pre-primary years. A
literal `sort_order >= 6` would have issued logins to eight-year-olds at both
schools. So the threshold is the school's own setting, and it was set by finding
each school's own "6" by name, once:

| School | Student sign-in starts at |
| --- | --- |
| Lahore Grammar School | Year 6 |
| Askari School System | Class 6 *(was Class 2)* |
| Beacon House | unset — the school has no grades yet, so no pupil logins |

> Verified end to end by temporarily lowering LGS's threshold: credential
> minted, `auth_user_id` set, sentinel phone preserved, and the email delivered
> to the guardian carrying the portal URL, the login ID and the password — with
> the password absent from the API response and the screen. Threshold restored,
> and the button correctly disappears below it.

---

## 5 · The mobile header

**Reported:** *"The message UI is messed up on mobile. The header is all
cluttered."*

Nine things were competing for 375 pixels on one 64px row, and the two carrying
live state — which school, which child — were the two that lost, because they
were the only two that were text. The child switcher was also a `<select>` in a
flex row with no `min-w-0` reaching it, so it could never render narrower than
its widest option and ran under the search icon and the bell. `truncate` had
nothing to truncate.

Below `sm`, three redundant labels come off — the school name where a context
slot is filled, the portal label, and the role chip that says "Parent" next to a
portal called Parent — and the switcher may finally shrink. All three return at
tablet width.

**Chat is now master/detail on a phone**, which it never was: the list until
something is open, the thread once it is, and a *← All conversations* control
that exists only where there is somewhere to go back to.

> Verified at 375px on the production build: switcher **105–182px**, search icon
> **194–230px** — no overlap, nothing escaping the header, no horizontal scroll.

---

## Also fixed, found by driving it

- **Chat was emailing pupils at an address that cannot receive email.** The
  digest read `school_users.email` without asking what kind of address was in
  it, so every pupil generated a queue row per hour that could only ever end
  `failed` — burying real delivery failures. Nothing was delivered, because the
  TLD cannot resolve, but the docblock claiming no code path can email a minor
  had quietly stopped being true.
- **An emergency link for somebody with no account reported success.** A member
  who has never set a password has no `auth_user_id`; the route answered `ok`
  and the next request bounced to the login page with no explanation. It is
  refused and named now.

---

## Green build

`typecheck` · `lint` · `check-loaders` · `check-forms` · `check-address-phone` ·
`check-cnic` · `check-currency` · `check-sprint-periods` · `check-accounting` ·
`check-theme` · `check-portals` · `check-provisioning` · `check-dashboard` ·
`check-reports` · `check-sprint26` · `build`.

`npm run check-sprint26` executes every new statement against the real schema —
28 assertions — including the six-relation oversight list whose two derived
subqueries are the exact shape Sprint 18 shipped a `42702` with.

## Known, and not fixed here

- **`npm run build` into the same `.next` as `next dev` leaves the dev server
  serving a stale client bundle**, and the browser then caches it across a
  server restart. This cost most of the QA round: three consecutive
  measurements were of code that had already been deleted. Prove the bundle
  before trusting a browser result, or test against the production build.
- Four of the five parent accounts in the test data have never set a password,
  so they cannot sign in at all. That is test data, not a defect.
