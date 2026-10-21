# Deployment — checklist step 22

## Free hosting: Render + MongoDB Atlas Free

The repository-root [render.yaml](../render.yaml) selects Render's **free**
Docker web service, one instance, and **no persistent disk**. Saved boards,
answers, owner IDs, progress, memberships, buzzer state, and sessions live in
MongoDB when `MONGODB_URI` is set. File storage remains available for local use.
Render startup refuses to run without MongoDB, preventing accidental use of
its temporary filesystem for saved classroom data.

The application is prepared locally, not published. You still need your own
Git repository, Render account, Atlas account/Free cluster, Microsoft Entra
credentials, and public URL. Do not select paid plans or attach a Render disk.

## 1. Create the free database

1. In MongoDB Atlas, create an **M0 / Free** cluster; do not choose Flex or a
   dedicated paid cluster. Follow [Atlas Free setup](https://www.mongodb.com/docs/atlas/tutorial/deploy-free-tier-cluster/).
2. Create a database user with read/write access to the `jeopardy` database.
   Use a unique password. This is a database user, separate from your Atlas login.
3. Add your Render service's outbound IP ranges to Atlas's Network Access list.
   Render shows these in the service's Connect/Outbound section. Add your own
   IP only if testing the database from your computer.
4. Choose Connect > Drivers > Node.js and copy the connection URI. Replace
   its password placeholder with the URL-encoded database password. Keep the
   real URI private; enter it in Render as `MONGODB_URI`, never in source code.
5. Set `MONGODB_DATABASE=jeopardy`.

See [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).
No existing local games are uploaded automatically. Keep a backup of your local
`Jeopardy/data` directory. The new database starts with an empty library.

## 2. Create the free Render service

1. Push this workspace to your Git repository, including `render.yaml`.
2. In Render select New > Blueprint, connect that repository, and inspect the
   configuration. It must say **Free**, with no disk or paid database.
3. Enter `MONGODB_URI`, `APP_URL`, and the three Microsoft Entra values:
   `MS_ENTRA_TENANT_ID`, `MS_ENTRA_CLIENT_ID`, `MS_ENTRA_CLIENT_SECRET`.
4. Set `MS_ENTRA_REDIRECT_URI` to `https://YOUR-SERVICE.onrender.com/api/auth/callback`.
   `APP_URL` must be the corresponding HTTPS origin without a path.
5. Register that exact redirect URI as a **Web** callback in Microsoft Entra.
6. If the assigned Render URL differs from the initial values, update `APP_URL`
   and the redirect URI in Render and Entra, then redeploy. Preserve the generated
   `SESSION_SECRET` across deployments.

The Blueprint supplies `HOST=0.0.0.0`, `TRUST_PROXY=1`, the readiness path
`/api/ready`, and a stable generated signing secret. Update prompted secrets
manually on existing services; `sync: false` prompts apply at creation.
The Docker build/context paths assume this workspace's nested application layout.
If publishing only the inner app directory, move the Blueprint into that repo
and change `dockerfilePath` to `./Dockerfile` and `dockerContext` to `.`.

References: [Render Blueprints](https://render.com/docs/blueprint-spec),
[free hosting limits](https://render.com/docs/free),
[outbound IPs](https://render.com/docs/outbound-ip-addresses).

## Free-tier limits and storage behavior

- Render sleeps after 15 minutes without inbound traffic. Open the app before
  class and allow it to wake up. Free usage quotas still apply.
- Only one API instance is supported: roster/buzzer state and mutation ordering
  remain in process while running. MongoDB restores their saved state on restart.
- Each state snapshot is stored atomically in MongoDB, with a 15 MB application
  limit per snapshot (including the full saved-game library). Oversized writes
  fail without replacing the previous snapshot. This is for small classroom
  deployments, not an unlimited multi-school service.
- Database failures return errors and fail readiness; they never fall back to
  an empty local library. Session expiration is enforced on reads and by a TTL index.
- Sheets imports are saved snapshots; editing the spreadsheet does not update
  a saved board. Each import creates a new owned game and opens it in the editor.
  Earlier copies remain available in the saved-game selector.
- Back up/export your data and review the providers' current free-tier limits.

## Local verification

From the workspace root:

```powershell
npm run setup
npm test
npm run lint
npm run test:deployment
npm run test:database
```

The deployment test builds the frontend and checks the production server with
disposable file storage, secure cookies, WebSockets, and restart recovery.
The database test starts a disposable real MongoDB process and tests production
API sessions, ownership, saved boards, scores, team assignments, WebSockets,
restart with a fresh filesystem, expiry/logout, and database outage behavior.
The first database test downloads a MongoDB test binary. It does not use your
Atlas credentials or change your existing games. These checks do not build Docker
or perform a real Microsoft OAuth login.

## Public acceptance after publishing

```powershell
npm run verify:deployment -- https://YOUR-SERVICE.onrender.com
```

Then sign in with a real Microsoft account, create/edit a game, join from two
student devices, test scores/reveals/buzzing/replay and the private answer display,
and redeploy the service. Confirm games, sessions, and teams return afterward.
Verify the real WebSocket upgrade in browser DevTools. Confirm a database outage
fails the health check instead of starting an empty game library.

The public URL, real TLS/proxy, Microsoft login, Render Docker build, and remote
device tests must pass before calling deployment complete.
