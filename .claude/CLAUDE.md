# gstack

For all web browsing, use the `/browse` skill from gstack. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/plan-ceo-review` — CEO-perspective plan review
- `/plan-eng-review` — Engineering-perspective plan review
- `/plan-design-review` — Design-perspective plan review
- `/design-consultation` — Design consultation
- `/review` — PR review
- `/ship` — Ship workflow
- `/browse` — Headless browser for web browsing
- `/qa` — QA with fixes
- `/qa-only` — QA report only (no fixes)
- `/qa-design-review` — Design audit + fix loop
- `/setup-browser-cookies` — Set up browser cookies
- `/retro` — Retrospective
- `/document-release` — Post-ship documentation updates

## Setup

Teammates: install gstack by running:
```bash
git clone https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```
