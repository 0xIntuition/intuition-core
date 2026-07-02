# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository, or email **security@intuition.systems** with:

- A description of the issue and its impact
- Steps to reproduce
- Any suggested remediation

We aim to acknowledge reports within 3 business days. Support is best-effort — this is community-run infrastructure, not a managed service with an SLA.

## Scope

This repository contains self-hosted backend infrastructure. Deployment security (network exposure, credentials, database hardening) is the operator's responsibility — see `example.env` and the docs for the configuration surface. The default docker-compose credentials are for **local development only**; never expose them publicly.

## Supply chain

- Installs are Bun-only and enforce a 14-day minimum package release age (`bunfig.toml`).
- `bun run guard:supply-chain` checks for git-URL dependencies, lifecycle install scripts, and known IOCs; it runs in CI.
- Secret scanning (gitleaks) runs on every push and PR across full history.
