# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in AskAlf, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Email: **security@askalf.org**

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## Scope

This policy covers:
- The AskAlf self-hosted platform (this repository)
- The `@askalf/agent` npm package
- The askalf.org website

## What to report

- Authentication or authorization bypasses
- SQL injection or command injection
- Credential exposure
- Container escape vulnerabilities
- Agent sandboxing bypasses
- Cost guardrail circumvention

## What NOT to report

- Vulnerabilities in upstream dependencies (report to the dependency maintainer)
- Issues requiring physical access to the host machine
- Social engineering attacks
- DoS attacks against self-hosted instances you control

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest main branch | Yes |
| Older commits | No |

We only support the latest version. Update to the latest commit for security fixes.
