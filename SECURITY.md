# Security Policy

Mycelium is local-first: there's no Mycelium-owned server, and no session data leaves your machine except through your own `claude`/`codex`/`kiro-cli` CLI calls (see [`docs/architecture.md`](./docs/architecture.md)'s Design Principles). The main security surface is local: the plain-file store under `~/.mycelium/`, and the subprocess calls it makes to your agent CLIs.

## Reporting a Vulnerability

Please report security issues privately through [GitHub's Security Advisories](https://github.com/krapie/mycelium/security/advisories/new) rather than filing a public issue.

Include what you found, the steps to reproduce it, and its potential impact. We'll acknowledge reports as soon as we can and keep you updated as a fix is worked on.

## Supported Versions

Mycelium is at an early (POC-stage) `0.x` release — only the latest published version is supported. Please make sure you're on the latest before reporting.
