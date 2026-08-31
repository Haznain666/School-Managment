/**
 * One name in, two columns out.
 *
 * `school_users.name` is one column and a person is entitled to be called what
 * they are called; `staff` splits the same person across `first_name` and
 * `last_name`, both `NOT NULL`. Every screen that creates one record from the
 * other has to bridge that, and doing it in two places is how the same person
 * ends up filed under two different surnames.
 *
 * Split on the **last** space, so "Muhammad Ali Khan" is "Muhammad Ali" and
 * "Khan" rather than the reverse — Pakistani given names are routinely two
 * words and the family name is routinely last.
 *
 * A single word leaves the surname **empty** rather than inventing a
 * placeholder. `staffFullName` trims, so the record still reads correctly
 * everywhere, and an empty cell on the HR screen is an honest invitation to
 * complete it. A dash would look like a surname.
 *
 * Deliberately not `server-only`: the browser needs it to fill the same two
 * fields on the Users & Staff profile, and a second copy there is exactly the
 * drift this exists to prevent.
 */
export function splitPersonName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim().replace(/\s+/g, ' ');
  const cut = trimmed.lastIndexOf(' ');

  return cut === -1
    ? { firstName: trimmed, lastName: '' }
    : { firstName: trimmed.slice(0, cut), lastName: trimmed.slice(cut + 1) };
}
