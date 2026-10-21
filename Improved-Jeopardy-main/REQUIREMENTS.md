# Remaining requirements and acceptance checks

## 21. Mobile / UI polish

- Support 320px and 375px phones, tablets, desktop, landscape, and 200% browser zoom.
- Keep page content within the viewport; allow wide game boards to scroll independently with a visible phone hint and keyboard focus.
- Stack editor fields and wrap actions; wrap long game, category, student, and team names.
- Provide 44px minimum button/input targets, 16px phone input text, and a large student buzzer.
- Keep dialog controls reachable on short screens, lock background scrolling, trap focus, support Escape, and restore focus after closing.
- Preserve browser zoom, visible keyboard focus, skip navigation, and reduced-motion preferences.
- Show copy/share errors and prevent invalid Final Jeopardy wagers.

Automated verification: `npm run test:mobile`, `npm test`, `npm run lint`, and `npm run build` from the workspace root. DOM tests verify behavior, not rendered CSS geometry. Manual device acceptance still includes the viewport sizes above, touch/keyboard input, QR scanning, and native clipboard/share permissions.

## Saved Google Sheets imports: database persistence

MongoDB persistence is now supported through `MONGODB_URI`, including owner IDs,
saved question/answer snapshots, progress, memberships, buzzer state, and sessions.
Every import now creates a new game and opens it in the editor, preserving
existing saved copies. Local development still uses JSON files when no database
is configured. Automatic migration of existing local files remains future work.

- Store each imported board, including questions, answers, categories, values, and Final Jeopardy, in a database associated with the authenticated user's stable ID.
- Persist a snapshot on import/save. Reopening and editing a saved game must read the database copy, without fetching the spreadsheet.
- Spreadsheet changes must never modify an existing saved game. Importing the spreadsheet again must create a new game and leave the previous game intact.
- Allow the owning user to list, reopen, edit, save, and delete saved games. Enforce ownership on every API and socket path; students must not receive unrevealed answers.
- MongoDB is a suitable option for nested board documents. It requires a server-only connection URI, credentials, database name, indexes for owner/game/code lookup, backups, and a migration plan for existing JSON games and ownership.
- Verify import/reopen/edit behavior, two-user isolation, spreadsheet changes after import, a second import creating a distinct game, restart persistence, and migration before retiring JSON storage.

## 22. Deployment

Target: Render. See [DEPLOYMENT.md](DEPLOYMENT.md) and the repository-root [render.yaml](../render.yaml).

- Build and serve the compiled React app and API from one HTTPS origin.
- Use Render's free plan, with one instance and no paid disk. Persist games and sessions in a MongoDB Atlas Free cluster.
- Supply Microsoft Entra credentials and register the exact public callback URL.
- Keep a stable generated session secret and use secure cookies behind the hosting proxy.
- Route Socket.IO including WebSocket upgrades, and expose `/api/ready` for health checks.
- Keep credentials and local data out of Git and Docker build context.
- Pass `npm run test:deployment` locally, then `npm run verify:deployment -- https://YOUR-SERVICE` publicly.
- Verify real Microsoft login, two-device gameplay, and persistence after redeployment before marking deployment complete.

Publishing requires a connected Git repository, a Render account, an Atlas Free
cluster and private connection URI, the public URL, and private Entra configuration.
Run `npm run test:database` for real MongoDB persistence/restart/outage checks.
Local testing cannot verify Render's container build, TLS, real OAuth, or remote devices.
