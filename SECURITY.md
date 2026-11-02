# Security Policy

askalf/askalf is the profile repository: the README, the scripts that draw its live panels, and
the workflows that run them. Each project has its own repository and its own policy; a report
about one of them belongs there.

## Reporting a vulnerability

Please **do not open a public issue** for security reports.

- **Preferred:** [GitHub private vulnerability reporting](https://github.com/askalf/askalf/security/advisories/new),
  which opens a private advisory only the maintainers see.
- **Email:** support@askalf.org with `profile security` in the subject.

You will get an acknowledgement within 72 hours. Please include a minimal reproduction where you can.

## Supported versions

Only `main` receives fixes; there are no releases.

## In scope

- A workflow here running code or reading data that a pull request from outside controls
- A token or credential reaching a job's log, a run page, a process argument or a published panel
- The published panels carrying markup or links that the data they are drawn from did not mean to put there

## Out of scope

- Findings that need write access to this repository already
- The numbers a panel shows: a wrong number is a normal issue
