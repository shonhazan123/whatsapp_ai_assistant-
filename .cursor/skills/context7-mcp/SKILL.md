---
name: context7-mcp
description: >-
  Use Context7 MCP to resolve library IDs and fetch current documentation for
  frameworks, SDKs, APIs, CLIs, and cloud services. Prefer Context7 over web
  search for official, version-aware docs.
---

# Context7 MCP

Use Context7 MCP when the user asks about a **library, framework, SDK, API, CLI tool, or cloud service** — including common ones (React, Next.js, Prisma, Express, Tailwind, etc.). This includes syntax, setup, configuration, migrations, and debugging that depends on **current** docs. Prefer Context7 over web search for library documentation.

**Do not use** for: refactoring, scripts from scratch, business-logic debugging, code review, or general programming concepts.

## Steps

1. Start with `resolve-library-id` using the library name and the user’s question, unless they give an exact library ID in `/org/project` format.
2. Pick the best match (ID format: `/org/project`) by: exact name match, description relevance, snippet count, source reputation (High/Medium preferred), and benchmark score (higher is better). If results are wrong, try alternate names or queries (e.g. `next.js` not `nextjs`) or version-specific IDs when the user names a version.
3. Call `query-docs` with the selected library ID and the user’s **full** question (not single keywords).
4. Answer from the fetched docs.
