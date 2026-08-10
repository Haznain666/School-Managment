#!/usr/bin/env bash
#
# Reads the Super Admin variables out of the ALREADY RUNNING server process and
# reports whether each one survived the trip into it.
#
# ── Why this exists alongside check-super-admin-env.mjs ──────────────────────
# That script reads its own environment, which is the environment of whatever
# shell you launched it from. On a panel-managed host that is NOT the same
# environment: the panel injects variables into the process it supervises, and
# an SSH session inherits none of them. Running the .mjs by hand can therefore
# report "missing" for a variable the server has, or "present" for a stale one
# exported in a login profile — both answers about the wrong process.
#
# /proc/<pid>/environ is the environment the kernel actually handed the running
# server. It cannot disagree with what `process.env` sees inside it.
#
# ── What it does not print ───────────────────────────────────────────────────
# No secret leaves this script. The hash appears only as a length and its
# `$2b$12$` prefix, which every bcrypt hash on earth shares and which narrows a
# guess by nothing. The JWT secret appears only as a length. The password is
# read with the terminal echo off and is never written to disk, to the
# environment, or to your shell history.
#
# Usage, on the host, over SSH:
#
#   bash scripts/check-super-admin-live.sh
#
# Requires Linux (/proc) and read access to the server process, which you have
# when it runs as your own user.

set -u

# Test seam: point this at a captured environ file to exercise the parser off
# the host. Unset in real use, where /proc is the only source.
ENVIRON_FILE="${SUPER_ADMIN_ENVIRON_FILE:-}"

echo
echo "Super Admin variables, as the RUNNING server process holds them"
echo "==============================================================="

if [ -z "$ENVIRON_FILE" ]; then
  # The standalone build's entry point. Narrow to node so a stray editor or
  # tail holding the same string is not mistaken for the server.
  PID="$(pgrep -f 'node.*server\.js' | head -1 || true)"

  if [ -z "${PID:-}" ]; then
    echo
    echo "  ✗ Could not find a running 'node server.js'."
    echo "    Check the process name with:  ps aux | grep node"
    echo "    Then re-run as:  SUPER_ADMIN_ENVIRON_FILE=/proc/<pid>/environ bash \$0"
    exit 1
  fi

  echo
  echo "  Server process: PID $PID"
  ENVIRON_FILE="/proc/$PID/environ"
fi

if [ ! -r "$ENVIRON_FILE" ]; then
  echo
  echo "  ✗ Cannot read $ENVIRON_FILE"
  echo "    The server is running as a different user. Re-run as that user."
  exit 1
fi

problems=0

# environ is NUL-separated, which is what lets a value contain anything at all.
report() {
  name="$1"
  count="$(tr '\0' '\n' < "$ENVIRON_FILE" | grep -c "^${name}=" || true)"

  if [ "${count:-0}" -eq 0 ]; then
    echo "  ✗ $name — NOT SET in the running process (sign-in would return 500)"
    problems=$((problems + 1))
    return
  fi

  # A duplicate is not a footnote. Which one `getenv` returns is a libc detail,
  # not something to state confidently, so every occurrence is described and the
  # ambiguity is the finding.
  if [ "$count" -gt 1 ]; then
    echo "  ✗ $name — defined ${count} times in this process."
    echo "      Which one wins is a libc detail, not something to rely on."
    echo "      Remove the duplicate. Each occurrence:"
    problems=$((problems + 1))
  fi

  # Process substitution, not a pipe: a piped `while` runs in a subshell, and
  # every `problems` increment inside it would be discarded on exit — the check
  # would print its findings and then report a clean bill of health.
  occurrence=0
  while IFS= read -r line; do
    occurrence=$((occurrence + 1))
    value="${line#*=}"
    [ "$count" -gt 1 ] && printf '      [%s] ' "$occurrence"
    describe "$name" "$value"
  done < <(tr '\0' '\n' < "$ENVIRON_FILE" | grep "^${name}=")
}

describe() {
  name="$1"
  value="$2"
  len="${#value}"

  case "$name" in
    SUPER_ADMIN_EMAIL)
      # Not a secret, and the whole point is to compare it against what you type.
      echo "  $name = '$value'  (${len} chars)"
      case "$value" in
        *[[:space:]]*) echo "      ⚠ contains whitespace — trimmed before comparison, but check it" ;;
      esac
      ;;

    SUPER_ADMIN_PASSWORD_HASH)
      prefix="$(printf '%.7s' "$value")"
      echo "  $name — length ${len}, starts '${prefix}'"

      if [ "$len" -eq 60 ] && [ "${value#\$2}" != "$value" ] && [ "${value#*\\}" = "$value" ]; then
        echo "      ✓ well-formed: 60 chars, \$2 prefix intact, no backslashes"
      else
        problems=$((problems + 1))
        if [ "${value#*\\}" != "$value" ]; then
          echo "      ✗ contains backslashes — the escaped \\\$2b\\\$12\\\$ form reached the"
          echo "        panel unexpanded. Store the RAW hash there instead."
        elif [ "${value#\$2}" = "$value" ]; then
          echo "      ✗ the \$2b\$ prefix is gone — something expanded \$2b and \$12 as"
          echo "        variables. Escape them, or single-quote the value."
        else
          echo "      ✗ ${len} chars, not 60 — bcryptjs returns false for any other"
          echo "        length WITHOUT raising an error. This is the silent 401."
        fi
      fi
      ;;

    *)
      echo "  $name — length ${len} (value withheld)"
      ;;
  esac
}

echo
echo "1-2. The variables"
report SUPER_ADMIN_EMAIL
report SUPER_ADMIN_PASSWORD_HASH
report SUPER_ADMIN_JWT_SECRET

echo
echo "4. Files that would override the panel"
echo "   Next loads these at startup and they WIN over injected variables."
found_env=0
for f in .env .env.local .env.production .env.production.local; do
  if [ -f "$f" ]; then
    echo "  ✗ $f exists here ($(wc -c < "$f" | tr -d ' ') bytes) — delete it and restart"
    found_env=1
    problems=$((problems + 1))
  fi
done
[ "$found_env" -eq 0 ] && echo "  ✓ none beside the server — the panel is the only source"

echo
echo "3. Does the password actually match the hash?"
printf '   Type the Super Admin password (not echoed, not stored): '
stty -echo 2>/dev/null || true
read -r PW
stty echo 2>/dev/null || true
echo

if [ -n "${PW:-}" ]; then
  HASH="$(tr '\0' '\n' < "$ENVIRON_FILE" | grep '^SUPER_ADMIN_PASSWORD_HASH=' | head -1 | cut -d= -f2-)"
  # Both values go in on stdin, never as argv: arguments are world-readable in
  # /proc while the command runs.
  printf '%s\n%s\n' "$PW" "$HASH" | node -e '
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", async () => {
      const [pw, hash] = chunks.join("").split("\n");
      const { compare } = await import("bcryptjs");
      try {
        const ok = await compare(pw, hash);
        console.log(ok
          ? "  ✓ password matched: TRUE — the credentials are correct."
          : "  ✗ password matched: FALSE — this is exactly your 401.");
        process.exit(ok ? 0 : 1);
      } catch (error) {
        console.log("  ✗ bcrypt threw: " + error.message);
        process.exit(1);
      }
    });
  ' || problems=$((problems + 1))
  unset PW
else
  echo "  (skipped)"
fi

echo
echo "==============================================================="
if [ "$problems" -eq 0 ]; then
  echo "No problem found. If sign-in still fails, the email you TYPE differs"
  echo "from the one printed above."
else
  echo "$problems problem(s) found — each returns 401 with nothing in the log."
fi
echo
