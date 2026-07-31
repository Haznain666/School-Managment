/**
 * The arithmetic check on the public application form.
 *
 * `/apply` is unauthenticated by necessity — an applicant has no account yet —
 * so it needs something between a script and the school's admissions inbox.
 * This is deliberately the cheapest possible answer: it stops casual form
 * spam and nothing more. It is not a defence against a determined attacker,
 * and it is not treated as one; the endpoint's real protections are that it
 * writes only to `admission_applications`, that it cannot reach any other
 * table, and that every submission is read by a human before it becomes a
 * student.
 *
 * The question travels with the answer rather than living in a session,
 * because a session store for an anonymous form is a lot of moving parts for
 * a spam filter. That means the sum is verifiable client-side; that is fine
 * for the threat it addresses.
 */

export interface CaptchaChallenge {
  /** e.g. `What is 7 + 3?` */
  question: string;
  /** The operands, so the server can re-derive the sum from the question. */
  first: number;
  second: number;
}

const MIN_OPERAND = 1;
const MAX_OPERAND = 9;

function randomOperand(): number {
  return MIN_OPERAND + Math.floor(Math.random() * (MAX_OPERAND - MIN_OPERAND + 1));
}

export function createCaptchaChallenge(): CaptchaChallenge {
  const first = randomOperand();
  const second = randomOperand();
  return { question: formatQuestion(first, second), first, second };
}

export function formatQuestion(first: number, second: number): string {
  return `What is ${first} + ${second}?`;
}

const QUESTION_PATTERN = /^What is (\d{1,2}) \+ (\d{1,2})\?$/;

/**
 * Re-derives the expected sum from the question text and compares it.
 *
 * The question is parsed rather than trusted: a submission carrying a
 * hand-written question would otherwise let the client choose both sides of
 * the comparison and always pass.
 */
export function verifyCaptcha(question: string, answer: string): boolean {
  const match = QUESTION_PATTERN.exec(question.trim());
  if (match === null) return false;

  const first = Number.parseInt(match[1] ?? '', 10);
  const second = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;

  if (first < MIN_OPERAND || first > MAX_OPERAND) return false;
  if (second < MIN_OPERAND || second > MAX_OPERAND) return false;

  const given = Number.parseInt(answer.trim(), 10);
  return Number.isFinite(given) && given === first + second;
}
