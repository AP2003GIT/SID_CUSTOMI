# SID CUSTOMI

A private League of Legends custom-game ladder with durable match history, replay imports, and configurable Elo updates.

## Features

- Import classic ROFL and current ROFL2 replay files entirely in the browser
- Review detected teams, winners, champions, K/D/A, CS, gold, damage, and vision before saving
- Match replay Riot IDs to ladder players or create missing players during import
- Reject duplicate replay game IDs
- Record and correct results manually when a replay is unavailable
- Recalculate player Elo, records, win rate, and recent form after every result
- Persist normalized league state to Cloudflare D1 with a browser-local fallback
- Keep the original replay file on the user's device

## Tech stack

- Vinext / Next.js and React server routes
- Cloudflare Workers and D1
- Drizzle ORM
- Vanilla browser JavaScript for the tracker and local replay parser
- HTML and CSS with no client-side UI framework

## Local development

Requires Node.js `>=22.13.0`.

```sh
npm run install:ci
npm test
npm run dev
```

The replay importer is tested against synthetic classic ROFL and ROFL2 metadata fixtures. Riot's replay format is not a public compatibility contract, so new patches should be checked with a recent real replay before relying on new fields.

## Privacy

The browser reads the `.rofl` file locally. Only the reviewed, normalized match summary is included in SID CUSTOMI's saved league state; the raw replay is not uploaded or stored.

SID CUSTOMI is not endorsed by Riot Games. Riot Games and associated properties are trademarks or registered trademarks of Riot Games, Inc.
