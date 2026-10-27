# SID CUSTOMI

A browser-local Elo tracker for League of Legends custom games.

## Tech stack

- Semantic HTML5
- Modern CSS with responsive layouts and no UI framework
- Vanilla JavaScript
- Browser `localStorage` for persistence
- Static hosting on ChatGPT Sites

## Current MVP

- Add players with a starting Elo
- Record equal-sized teams and a winner
- Calculate team-average Elo changes with a configurable K-factor
- Track standings, win rate, recent form, and match history
- Undo recorded matches
- Click any match in history to edit its teams or winner and recalculate Elo
- Store the league in the browser with `localStorage`

Open `dist/index.html` after packaging, or serve the project directory with a static web server during development.
