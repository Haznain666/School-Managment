# The school creation wizard, the rate limit that read as a refusal, and the clipped address dropdown

**Built 2026-08-23.** Migration `0031_subdomain_throttled_status.sql` is
**written and NOT applied.** It widens one CHECK constraint on `schools` and
changes no column and no row.

---

## 1. Adding a school is one flow now

`/super-admin/schools/new` was a single form. Branding, modules, integrations
and branches were four separate tabs under the school, and nothing on the create
screen said they existed — so the normal result of adding a school was a school
with no campus on it, default colours, and whatever module set the platform
ships.

It is now five steps in one flow:

| Step | | Skippable |
| --- | --- | --- |
| 1 | School | no |
| 2 | Branch | no |
| 3 | Branding | **yes** |
| 4 | Modules | **yes** |
| 5 | Integrations | **yes** |

Three of them may be skipped because all three have a working default: the
platform palette, the default module set, and no third-party account at all —
which is the ordinary state of a school, not an unfinished one. A school with no
campus does not run, so steps 1 and 2 have no skip. A step that was skipped says
so in the stepper; it is not quietly marked done.

**Step 1 saves as soon as you leave it.** A wizard abandoned after it leaves a
real, working school behind, which can be finished later from its own tabs. That
is also why steps 1 and 2 cannot be returned to: each of them creates a record,
and a Back button onto either would be a button offering to create a second one.

**The four panels are the same components the tabs render.** Nothing was
duplicated, and the tab pages are unchanged and still where a school is edited
later.

### The fields were reordered and renamed

Labels only — no column, no payload key and no API contract changed.

**School:** Head Office Name, Street Address, City, School Owner / School
Administrator, School Landline Number, School Mobile Number, School Admin Email,
Subdomain, School Code.

**Branch:** Main Branch, Branch Name, Street Address, City, Branch code, Branch
Landline Number, Branch Mobile Number, Branch Email, Curriculum Level, Classes
Taught.

There is deliberately **no principal field on the branch form**. Principals are
assigned per campus in School Admin → Settings, which already handles both the
single- and multiple-principal models, and a second place to type the name would
be a second answer to the same question.

---

## 2. "Hostinger refused the request (HTTP 429)" — it had not

The one school on the live deployment carried a red **Failed** badge and this,
verbatim, in the table cell beside it:

    Hostinger refused the request (HTTP 429). {
     "message": "Too Many Attempts.",
     "correlation_id": "a28cff8a-…"
    }

Nothing about the request was wrong. HTTP 429 is the host's rate limiter, and
the identical call succeeds a few seconds later. Three fixes:

* **`throttled` is now a status of its own** — an amber "Rate limited" badge,
  retryable, with a hint saying the host is throttling and to try again in a
  minute. Migration `0031` admits it to the CHECK constraint.
* **`Retry-After` is honoured, and there is a bounded retry**: at most two extra
  attempts, only for 429 and 5xx, with a five-second ceiling on the total added
  wait across a whole provision. A super-admin is never held on a form waiting
  for a limiter to cool off; the row is marked `throttled` instead.
* **The error is a sentence, not a JSON document.** The message is lifted out of
  the body and the correlation id follows it as `(ref …)` — kept for support,
  not shown as the headline.

**A provision also makes three API calls instead of four**, which is what
tripped the limiter in the first place: the parked-domain listing became a
fallback rather than a preamble, and the DNS zone is read once rather than
twice.

---

## 3. The address suggestions were being cut off by the card

`Card` clips its contents — that is what rounds a table's corners to the card
radius — and the address field sits near the bottom of nearly every card in the
product, so the suggestion list was sliced at the card border. The list is now
rendered outside the card entirely, positioned against the field, flipping above
it when there is no room below and following the field as the page scrolls.

Keyboard navigation, the screen-reader wiring and picking a suggestion by mouse
or by touch all behave exactly as before.

---

## For whoever applies the migration

`0031_subdomain_throttled_status.sql` performs two statements:

    ALTER TABLE "schools" DROP CONSTRAINT IF EXISTS "schools_subdomain_status_check";
    ALTER TABLE "schools" ADD CONSTRAINT "schools_subdomain_status_check"
      CHECK ("schools"."subdomain_status" IN
        ('pending','provisioning','ready','failed','throttled','unmanaged'));

Expand-only: every existing row satisfies both the old constraint and the new
one, and it is safe to apply while the current build is live. Until it is
applied, a provision that hits the limiter cannot record `throttled` and the row
keeps its previous status.

The school currently sitting at `failed` with a 429 recorded against it is left
alone. Nothing in code can know which historical failures were really rate
limits; pressing **Provision** on that row is what corrects it.
