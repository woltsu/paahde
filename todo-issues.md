# Todo issues

Known problems not fixed on the spot (boy-scout rule, `CLAUDE.md`). Anyone, human or agent, adds here and picks from here.

- **Add** one bullet per finding, newest at the bottom: `- [area] what's wrong, where (`file:line`), why it matters. (date, who)`
- **Fix** it, then delete its bullet in the same commit. Fixed means gone; no done-list here.
- **Stale or wrong?** Delete it, and say why in the commit message.
- Keep it terse: one finding per bullet, a sentence or two. Long reasoning goes in the devlog or a doc.

## Open


- [netcode] The server's fire-rate check subtracts a bolt's whole flight (`server/world.ts:1096`): at the blaster's 450 m reach a hacked client may fire every ~0.45 s instead of 2.2 s. Track per-shot fire times (the trigger, not the landing) to close it. (2026-11-04, Claude)
- [tooling] `tools/db-backup.test.mjs` fails on Node < 24 (`node:sqlite` has no `backup` export, e.g. v23.6) and `package.json` has no `engines` field, so `npm run check` fails locally with nothing saying why. Add `"engines": { "node": ">=24" }` (and maybe an `.nvmrc`). (2026-11-04, Claude)
