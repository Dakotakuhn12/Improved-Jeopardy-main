# Improved Jeopardy

A configurable Jeopardy-style classroom game backed by a Node/Express API.

## Run locally

From the project folder containing `Jeopardy` and the root `package.json`
(`Improved-Jeopardy-main/Improved-Jeopardy-main` in the extracted workspace), install both sets of dependencies once:

```bash
npm run setup
```

Start the API and Vite together in one terminal:

```bash
npm run dev
```

Open `http://localhost:5173`. Keep that terminal running; Ctrl+C stops both servers.
Port 3001 is the API. Until a production build exists, its home page shows startup instructions.

Alternatively, from the `Jeopardy` subfolder, start the API with `npm run server`
and start the frontend in a second terminal with:

```bash
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`). Requests to `/api` are proxied to the Express server on port 3001.

## Microsoft / Outlook login setup

This project uses Microsoft Entra ID (Azure AD) for sign-in. The app is already wired to use the `/api/auth/login` OAuth flow, so your part is to create the Azure app registration and fill in the environment values.

### What you need to do in Azure

1. Open the Azure portal and sign in with your school Microsoft account.
2. Go to Microsoft Entra ID > App registrations > New registration.
3. Set:
   - Name: `Improved Jeopardy`
   - Supported account types: `Accounts in this organizational directory only` if you want only school accounts to sign in.
4. After registration, copy these values:
   - Directory (tenant) ID
   - Application (client) ID
5. Go to Certificates & secrets > New client secret.
   - Save the value immediately; Azure will only show it once.
6. Go to Authentication > Add a platform > Web.
   - Redirect URI: `http://localhost:3001/api/auth/callback`
   - For production, also add `https://your-domain.com/api/auth/callback`
7. Save the app registration.

### Fill in your local environment

Create a root `.env` file (or update the one already in the project) with values like this:

```env
MS_ENTRA_TENANT_ID=<your-tenant-id>
MS_ENTRA_CLIENT_ID=<your-app-client-id>
MS_ENTRA_CLIENT_SECRET=<your-client-secret>
MS_ENTRA_REDIRECT_URI=http://localhost:3001/api/auth/callback
APP_URL=http://localhost:5173
SESSION_SECRET=replace-with-a-long-random-string
```

Use a real random string for `SESSION_SECRET` in production.

### Start the app

```bash
npm run setup
npm run dev
```

Then open the Vite app and click "Continue with Outlook". If the tenant, client ID, secret, and redirect URI match your Azure app registration, the sign-in flow will complete successfully.

## Student sessions

### Socket.IO connections (checklist step 12)

The editor, host board, and student view show **Live connection** status. Hosts
can click **Check connection**; browsers in that game display the verification
time. Other games do not receive the check. Each connection authenticates with
the existing session cookie. Student identity and team are read on the server;
clients cannot grant themselves host privileges or join another game's room.

Temporary network loss triggers automatic reconnect and room rejoin. Leaving,
host removal, logout, and game deletion close the corresponding connections.
An ended or expired session requires joining/signing in again. Saved sessions
and memberships now survive API restarts.

Vite proxies `/socket.io` (including WebSockets) to port 3001. In production,
serve Socket.IO and the frontend from the same origin, proxy WebSocket upgrades,
and set `APP_URL` to that origin. Development also accepts `http://localhost:5173`.

Run `npm run test:sockets` from the parent folder to test real WebSocket clients,
polling fallback, session authentication, room isolation, host event permissions,
transport reconnection, and membership removal using isolated game fixtures.
### Real-time synchronization (checklist step 13)

Students receive scores, used clues, selected questions, answer reveals, game
phase, Final Jeopardy, team changes, and membership changes through Socket.IO.
The host roster also updates through sockets. Two-second application polling
has been removed. The host saves through authenticated API routes (with a short
autosave delay); the server broadcasts the state after saving.
On reconnect, a complete snapshot restores updates missed while offline.

Student snapshots and public game-code responses omit unrevealed answers.
Selected answers are sent only after reveal; Final Jeopardy answers are sent
only once that round's answer is revealed. Full game/answer API reads require
host sign-in. Student clients cannot select questions or change scores.
Game mutations are serialized to prevent overlapping saves losing changes.

Run `npm run test:sync` from either project folder for multi-client tests of
isolated rooms, answer filtering, game actions, team/roster updates, missed
offline updates, resets, concurrent saves, and reconnection. Saved games are
untouched by the tests.

### Buzzer (checklist step 14)

Assign students to teams, start the game, and open a question. In the host
question dialog, click **Open buzzer** when students may answer. Assigned
students can tap **BUZZ!**. The first eligible press processed by the server
locks the buzzer and announces the student's name and team to that game.
Scores remain under host control; buzzing does not award points automatically.

**Reset buzzer** clears the winner and opens a fresh attempt for everyone.
**Close buzzer** disables presses. Closing/finishing the question, revealing its
answer, editing the board, or starting Final Jeopardy also disables it.
Each attempt has a server-generated round ID, so delayed requests from a prior
attempt cannot win the next one. Student identity/team come from the session.
Reconnects and API restarts restore the current buzzer state.

Run `npm run test:buzzer` from either project folder. It includes simultaneous
presses, duplicate/stale requests, team requirements, role permissions, host
reset/close, answer-reveal lockout, game isolation, reconnects, and the existing
student/team/synchronization regression checks.

### Private host answer display (checklist step 15)

Click **Open host answer display** in the editor or live board. A separate tab
shows the selected question, its correct answer before reveal, student reveal
status, scores, and the first buzzer result. Final Jeopardy also shows its
question and correct answer privately. Keep this tab on the teacher's screen.

The display requires the host's existing Microsoft session in that browser.
It receives a dedicated `host:state` Socket.IO event restricted to authenticated
hosts in that game's room. Students receive the separately filtered public
snapshot. The display is read-only and restores the latest state after refresh
or reconnect; it does not trigger board autosaves or change game progress.
Logout, removal of the game, or an ended connection clears the private display.

Run `npm run test:host-display` from either project folder for live updates,
private-answer filtering, authorization, Final Jeopardy, reconnect recovery,
and the existing regression suite.

### Team management

Hosts can add, rename, and remove teams in the editor.
Team names must be unique (ignoring case and surrounding spaces), with 1–50
characters. Renaming preserves scores and memberships. New teams start at zero;
removing teams clears their scores and final-round data as well as assignments.
The assignment controls wait until added or removed teams have saved.

The student roster shows
joined students and team sizes, with a team selector for each student.
**Assign evenly** redistributes the roster across all teams. **Remove student**
ends that student's membership; they can join again with the game code.
Students see their assigned team update automatically. Removing a team leaves
its students unassigned. Roster management requires host sign-in.
Membership and assignments are saved and restored when the API restarts.

From the parent project folder, run `npm run test:teams` for isolated HTTP tests
of team creation, renaming, validation, authorization, balancing, reassignment,
deletion cleanup, and student session behavior. Test fixtures do not change saved
games. The audit verifies restart recovery; no known student-session persistence
gap remains. Passing these tests does not mean all security work is complete.

Students choose **Join with a game code**, enter their name and the host's code,
and join without a Microsoft account. The browser remembers their session for
up to seven days, so refreshing or reopening the app resumes their game.
Scores and used clues arrive through the live connection. **Leave game** clears student
membership without signing out a host using the same browser.

Sessions are stored on disk and survive API restarts until expiration or logout.
Each browser profile has one student session; use separate
profiles or devices for different students. Student session responses omit unrevealed answers.

- `POST /api/student/session` — join with `{ "name": "Alex", "code": "ABC123" }`
- `GET /api/student/session` — resume membership and fetch the current board
- `DELETE /api/student/session` — leave the game

## API

The Game Editor can create new games and reopen saved games. It remembers the last-opened game in the browser, and editor changes save automatically. Game records are currently persisted in `data/games.json`.

- `GET /api/health` — server health check
- `GET /api/games` — list saved games
- `POST /api/games` — create a new empty game
- `GET /api/games/:gameId` — retrieve a game and its progress; creates an empty record if it does not exist
- `PUT /api/games/:gameId` — save game configuration with `{ "game": ... }`
- `PUT /api/games/:gameId/progress` — save `{ "scores": ..., "usedClues": [...] }`
- `POST /api/games/:gameId/reset` — reset scores and used clues

## Import from Google Sheets

In the Game Editor, paste a Google Sheets link (or spreadsheet ID) into **Import a game board**. The sheet must be shared as **Anyone with the link**. The selected tab is imported when the URL contains its `gid`.

Use this header row; `Value` is optional and defaults to $100, $200, and so on within each category:

| Category | Question | Answer | Value |
| --- | --- | --- | --- |
| Science | This gas makes up most of Earth's atmosphere. | Nitrogen | 100 |

Game data is persisted to `data/games.json`, which is deliberately excluded from Git so local games are not committed.

## Replay (checklist step 17)

On the host's live board, click **Replay game**. A confirmation explains the
reset; **Cancel** leaves the current round untouched. Confirming starts the same
game again with zero scores, every question available, cleared Final Jeopardy
wagers/results, no open question, and a closed buzzer with no winner.

The game ID/code, title, questions/answers, teams, joined students, and student
team assignments remain unchanged. Students and the private host display update
through Socket.IO without rejoining or refreshing. Only a signed-in host may
replay. Pending host saves finish before the reset, and the replay state is
persisted so restarting the API does not restore the previous round's progress.
This replaces current progress; it does not archive previous round results.

Run `npm run test:replay` from either project folder. Tests cover reset fields,
board/code/member retention, host permissions, live updates, stale buzz rejection,
reusable clues, and replay persistence after restart, plus existing regressions.

## Save game state (checklist step 16)

The existing autosave now preserves boards, teams, scores, used clues, the active
question, game phase, answer-reveal status, Final Jeopardy wagers/results,
student membership/assignment, host/student sessions, and buzzer rounds/winners.
Reopening a saved game restores its live state instead of resetting the board.
Allow the short autosave delay to finish before closing the host tab.

Local data is stored in `Jeopardy/data`:

- `games.json`: boards and live game progress.
- `students.json`: student identities and team memberships.
- `buzzers.json`: buzzer rounds and winners.
- `sessions/`: expiring session records; logout removes the record.
- `session-secret`: stable local signing secret, used only without `SESSION_SECRET`.

These local files are excluded from Git. JSON saves use temporary files and
atomic replacement; invalid JSON raises an error instead of silently replacing
saved games with empty data. Back up the data directory to preserve local games.
Changing `SESSION_SECRET` invalidates old cookies. One browser profile still has
one student identity. Session expiry, leaving, and host removal still apply.

For deployment, set a stable `SESSION_SECRET` and point `JEOPARDY_DATA_DIR` at a
persistent writable directory. This file store is intended for one API process;
multiple server instances will need shared database/session storage.

Run `npm run test:persistence` from either project folder. The suite uses a
separate temporary directory and performs actual API restarts, verifying saved
game/student/buzzer recovery, host session/logout behavior, expiration, saved
local signing secrets, and corruption handling.

## Sharing student invitations (checklist step 19)

The editor and live board include **Share this game**: **Copy join link**,
**Copy code**, and a QR code all refer to the selected game's saved code.
Browsers with native sharing also show **Share…**. Cancelling native sharing
does not change the game. Clipboard failures leave a selectable link for manual
copying and show feedback instead of silently failing.

Students open the link or scan the QR code, see the code already filled in, and
enter their name. Existing membership resumes for that same game; a link to a
different game opens its join form. Joining does not require Microsoft sign-in
or grant host access. Invite links remove host-display/private query parameters.
Unknown or deleted codes cannot join. Replay keeps the same invitation code.

By default the link uses the browser's current origin. Set the frontend build
variable `VITE_APP_URL` to your deployed app URL if necessary, then rebuild.
The QR code uses exactly the same join URL. A `localhost` URL is only usable on
that computer; students on phones or other computers need a reachable deployed
URL (deployment is checklist step 22). Sharing does not publish the app itself.

Run `npm run test:sharing` from either project folder. Automated tests cover URL
generation, private-parameter removal, invalid URLs, link parsing, choosing the
correct saved session, joining/switching games, unknown/deleted codes, host
permissions, and answer filtering, alongside the existing regression suite.
Clipboard permissions, native share dialogs, and QR scanning need browser/device
checks. This feature shares student invitations, not editable copies of boards.

## Security hardening (checklist step 20)

Game creation now requires Microsoft sign-in. Each new game belongs to its
creating host. Another host cannot list its private board, view its answers,
edit/delete/replay it, manage its roster, or join its private socket room.
Student invite codes continue to allow joining and viewing filtered public state.

Older saved games have no recorded owner. The first signed-in host to open an
older game claims the existing unowned local library; that migration is saved
in `data/legacy-owner.json`. Sign in with the intended teacher account first.
Subsequent hosts cannot claim or manage that library.

Expected protections include same-origin checks on writes, JSON content/body
limits, bounded board/progress values, protected session cookies, OAuth state
validation, noncached API responses, clickjacking/content-type/referrer/CSP
headers, cryptographically generated game codes, and restricted socket origins.
Expired socket sessions are checked periodically. Import responses have time
and size limits. Public game-code lookups and student joins allow 120 requests
per IP per minute; login attempts allow 20. General API traffic allows 1,200.
Excess traffic receives HTTP 429 and a Retry-After header. Socket clients allow
100 messages per ten seconds and 15 simultaneous connections per session.
Limits currently apply per API process and should be reviewed for school NATs.

For production, supply a stable `SESSION_SECRET` of at least 32 characters,
serve over HTTPS, and set `APP_URL` to that origin. Startup rejects a missing or
weak production signing secret. Set `TRUST_PROXY=1` only behind one trusted
reverse proxy; otherwise proxy headers are not trusted for rate limiting.
Do not expose the data directory or put secrets in frontend `VITE_*` variables.

Run `npm run test:security` from either folder for authorization, cross-site
requests, malformed/oversized input, headers, rate/connection limits, production
secret checks, and the normal regression suite. Run `npm audit` in the nested
project folder and `npm --prefix Jeopardy audit` there to check dependencies.
Both dependency audits reported zero known vulnerabilities after this change.
These checks do not replace production HTTPS/proxy validation or a full security
review; deployment validation belongs to step 22.

## Production build commands

```bash
npm run build
npm start
```

The Express server serves the compiled frontend from `dist` when it is present.
Set `APP_URL` to your production origin when deploying (or `http://localhost:3001`
when testing the production build locally).
