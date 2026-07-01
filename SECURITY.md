# Security Policy

## Supported versions

The latest released version of iZerp receives security fixes. iZerp is a
client-side, dependency-free library that makes no network requests by default,
so its attack surface is small.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, report privately via GitHub's **Security Advisories**:
Repository → **Security** tab → **Report a vulnerability**. This keeps the report
confidential until a fix is available.

When reporting, include:

- a description of the issue and its impact,
- steps or a minimal page to reproduce it,
- the iZerp version and browser affected.

You'll get an acknowledgement, a fix will be prepared, and the advisory will be
published with credit (if you want it) once released.

## Scope notes

- iZerp escapes slide titles/notes it renders and reads/writes only its own
  `localStorage` keys. If you find a way to inject script through slide data,
  imported `.izerp` files, or the config, that's in scope.
- The optional `izerp-fonts.css` is the only thing that makes an external
  request (Google Fonts); the core library makes none.
