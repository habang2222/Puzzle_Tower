# Puzzle Tower

Puzzle Tower is a full-stack web puzzle game. Players clear tile stages with a move limit, save records, log in, build maps, upload community maps, and compare rankings by stage.

## Features

- React + Vite frontend
- Express backend API
- Railway Postgres in production, SQLite fallback for local development
- 15 built-in stages
- Increasing difficulty with walls, move limits, teleport tiles, keys, and locks
- Local best record fallback
- Email/password signup and login
- Player-made map builder and upload flow
- Custom block editor with safe JSON block rules
- Moving custom blocks with `push`, `chase`, and `moveBlock` commands
- Public custom block library and download API
- Public community map list
- Community map tags, search, and creator filters
- Public custom block tags, search, and creator filters
- Creator must clear a custom map once before upload
- Ranking save and lookup API
- Admin stage CRUD API
- Reserved Admin nickname protection with unicode/control-character filtering
- Persistent DB storage with `DATABASE_URL` or configurable SQLite data directory
- Responsive sticky game controls
- Mouse hover tile descriptions
- Input proof and rate checks for stronger macro-record blocking
- AdSense slot integration
- GitHub Pages deployment workflow for the frontend
- Render/Railway-ready backend configuration

## Project Structure

```text
client/       React game frontend
server/       Express API server
render.yaml   Render backend deployment example
```

## Local Setup

```bash
npm run install:all
npm run dev:server
npm run dev:client
```

Frontend:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:4000
```

Health check:

```text
http://localhost:4000/api/health
```

## Environment Variables

Create `client/.env` when the backend is deployed:

```env
VITE_API_URL=https://YOUR-BACKEND-DOMAIN
```

Create `server/.env` if you want to change server settings:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
CLIENT_URL=http://localhost:5173
ADMIN_TOKEN=change-this-token
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-this-admin-password
JWT_SECRET=replace-this-with-a-long-random-value
JWT_EXPIRES_IN=12h
ALLOW_LOCAL_ADMIN123=false
EMAIL_VERIFICATION_EXPOSE_CODE=false
PASSWORD_RESET_EXPOSE_CODE=false
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM=Puzzle Tower <onboarding@your-verified-domain.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=Puzzle Tower <your-email@gmail.com>
PUZZLE_TOWER_DATA_DIR=./data
# Production Postgres, usually provided by Railway.
DATABASE_URL=postgresql://user:password@host:port/database
```

When `DATABASE_URL` is set, the backend uses Postgres. Without `DATABASE_URL`, `PUZZLE_TOWER_DATA_DIR` controls where `puzzle-tower.sqlite` is stored. Locally, the default is `server/data/`.
`ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional. When set, the server connects those login credentials to the reserved internal `Admin` account on startup. Do not commit real admin credentials to git.
If environment variables are not available, open the in-app Admin screen, enter the admin setup token, Admin email, and Admin password, then press "Admin 로그인 설정".
The admin setup token is `ADMIN_TOKEN`, not the Admin login password. The old `admin123` fallback is disabled by default. For a temporary local-only demo, set `ALLOW_LOCAL_ADMIN123=true`; never set that variable on Railway/production. On Railway/production, set a long random `ADMIN_TOKEN` or log in as the `Admin` account; admin APIs also accept the normal Admin login JWT.
Signup verification codes are stored hashed and expire after 10 minutes. Password reset codes are stored hashed and expire after 15 minutes. On Railway, prefer `RESEND_API_KEY` and `RESEND_FROM` because outbound SMTP can time out on lower plans. SMTP remains as a fallback when the host allows it. Without an email provider, local/dev runs return the code for testing. On production, set `EMAIL_VERIFICATION_EXPOSE_CODE=true` or `PASSWORD_RESET_EXPOSE_CODE=true` only for classroom demos, not for real public accounts.

## API List

### Health

```http
GET /api/health
GET /api/storage/status
```

### Stages

```http
GET /api/stages
GET /api/stages?q=logic&creator=Admin&tag=extreme
GET /api/stages/:level
```

### Auth

```http
POST /api/auth/email-verification/request
POST /api/auth/register
POST /api/auth/login
POST /api/auth/password-reset/request
POST /api/auth/password-reset/confirm
GET /api/auth/me
```

`POST /api/auth/email-verification/request` body:

```json
{
  "email": "maker@example.com",
  "nickname": "maker"
}
```

`POST /api/auth/register` body:

```json
{
  "nickname": "maker",
  "email": "maker@example.com",
  "password": "secret123",
  "confirmPassword": "secret123",
  "verificationCode": "123456"
}
```

Protected API requests use:

```http
Authorization: Bearer <token>
```

### Community Maps

```http
GET /api/community/stages
GET /api/community/stages?q=hard&creator=maker&tag=logic
GET /api/me/stages
POST /api/community/stages
PUT /api/community/stages/:id
DELETE /api/community/stages/:id
```

`POST /api/community/stages` body:

```json
{
  "title": "My Map",
  "difficulty": "Community",
  "moveLimit": 12,
  "tags": ["logic", "hard"],
  "creatorClearVerified": true,
  "clearHash": "client-generated-clear-hash",
  "board": [
    "P..G",
    ".##.",
    "....",
    "...."
  ],
  "customBlocks": [
    {
      "name": "Slow Neon",
      "tile": "S",
      "color": "#6ee7ff",
      "effect": "slow",
      "moveCost": 2,
      "description": "이 블록 위에 서 있으면 이동 횟수를 2칸 사용합니다.",
      "message": "이 블록은 이동 횟수를 2 사용합니다."
    }
  ]
}
```

The frontend requires the creator to test-play and clear the current map before upload. The API also rejects community map create/update requests unless `creatorClearVerified` is `true`.

### Custom Blocks

Custom blocks use a small JSON rule format instead of arbitrary JavaScript so uploaded blocks are safe for other players.

```http
GET /api/blocks
GET /api/blocks?q=gate&creator=maker&tag=logic
GET /api/me/blocks
POST /api/blocks
PUT /api/blocks/:id
DELETE /api/blocks/:id
POST /api/blocks/:id/download
```

`POST /api/blocks` body:

```json
{
  "name": "One Way Gate",
  "tile": "C",
  "color": "#38bdf8",
  "effect": "oneway",
  "tags": ["gate", "logic"],
  "moveCost": 1,
  "outDirection": "up",
  "description": "이 블록 위에 서 있으면 위쪽으로만 빠져나갈 수 있습니다.",
  "requires": {
    "direction": "right",
    "movesRemainingAtLeast": 1
  },
  "failMessage": "오른쪽으로 들어와야 통과할 수 있습니다.",
  "exitFailMessage": "위쪽 출구가 막혀 있습니다.",
  "message": "위쪽으로 빠져나갑니다.",
  "if": [
    {
      "when": {
        "hasKey": true
      },
      "effect": "goal",
      "message": "열쇠 조건으로 비밀 목표가 열렸습니다."
    }
  ],
  "isPublic": true
}
```

Supported effects:

```text
wall, goal, key, lock, slow, bounce, floor, force, oneway, gameover
```

Supported directions:

```text
up, down, left, right
```

Supported conditions:

```text
hasKey
direction
movesUsedAtLeast / movesUsedAtMost
movesRemainingAtLeast / movesRemainingAtMost
elapsedSeconds with comparison operators >, >=, <, <=
```

Time condition example:

```json
{
  "requires": {
    "elapsedSeconds": { "<=": 5 }
  }
}
```

Block transform commands:

```json
{
  "change": [
    {
      "targetTile": "S",
      "tile": "X",
      "afterSeconds": 4
    }
  ]
}
```

`spawn` and `change` mean the same thing. Without `afterSeconds`, the tile changes immediately. With `afterSeconds`, it changes after that many seconds.

`description` is shown under the game board while the player is standing on that custom block. `message` is shown as the short game log text when the block is stepped on.

Custom block images are stored as small data URLs in the `image` field. The app accepts png, jpg, webp, and gif images up to the server limit.

### Records and Rankings

```http
POST /api/records
GET /api/rankings
GET /api/rankings?stageId=1&limit=10
GET /api/users/:nickname/best
```

Only one ranking record is kept per player per stage. A new clear updates the existing row only when it is better by score, then time, then move count.

`POST /api/records` body:

```json
{
  "nickname": "player1",
  "stageId": 1,
  "clearTime": 12,
  "moveUsed": 3
}
```

### Admin API

Send the admin token with the `x-admin-token` header.

```http
POST /api/admin/stages
PUT /api/admin/stages/:id
DELETE /api/admin/stages/:id
POST /api/admin/login
```

Temporary local fallback only:

```text
ALLOW_LOCAL_ADMIN123=true
```

Without that explicit local flag, `admin123` is rejected.

## Deployment

### Frontend: GitHub Pages

The workflow in `.github/workflows/pages.yml` builds `client/` and deploys it to GitHub Pages. In the repository settings, enable GitHub Pages with GitHub Actions as the source.

Frontend URL format:

```text
https://habang2222.github.io/Puzzle_Tower/
```

The frontend falls back to `https://puzzletower-production.up.railway.app` on deployed pages. You can override it with the GitHub Pages build variable `VITE_API_URL`.

### Backend: Render

Use `render.yaml` as a starting point, or create a Render Web Service manually:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `ADMIN_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `CLIENT_ORIGIN`, `CLIENT_URL`
- Password reset email variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Optional data directory: `PUZZLE_TOWER_DATA_DIR=/var/data`
- Optional classroom reset demo: `PASSWORD_RESET_EXPOSE_CODE=true`

Important persistence note:

- Render Free web services do not provide persistent disks. Local SQLite data can disappear after redeploys, restarts, or spin-downs.
- To preserve users, login records, maps, blocks, and rankings on Render, attach a Render Persistent Disk and set `PUZZLE_TOWER_DATA_DIR` to the disk mount path, for example `/var/data`.
- If you deploy on Railway with SQLite, attach a Railway Volume and set `PUZZLE_TOWER_DATA_DIR` to the mounted folder. A Railway project dashboard URL is not a database connection string and should not be committed to git.
- If you use a Railway Postgres database, copy its private connection variable in the Railway dashboard. Do not paste database passwords into source files.
- If you must stay fully free, use a hosted database such as Supabase/Postgres instead of local SQLite.

Backend API URL format:

```text
https://puzzletower-production.up.railway.app/api/health
```

### Backend: Railway

The repository includes `railway.json` so Railway can deploy the Express backend from this monorepo.

Recommended Railway service settings:

- Build command: `npm install --prefix server`
- Start command: `npm start --prefix server`
- Healthcheck path: `/api/health`

Required Railway variables:

```env
NODE_ENV=production
JWT_SECRET=replace-this-with-a-long-random-value
JWT_EXPIRES_IN=12h
ADMIN_TOKEN=change-this-token
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-this-admin-password
CLIENT_ORIGIN=https://habang2222.github.io
CLIENT_URL=https://habang2222.github.io/Puzzle_Tower/
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM=Puzzle Tower <onboarding@your-verified-domain.com>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
SMTP_FROM=Puzzle Tower <your-email@gmail.com>
```

Use new random values for `JWT_SECRET` and `ADMIN_TOKEN` if either value was ever shown in chat, browser screenshots, logs, or a public repository. Production startup rejects missing or weak `JWT_SECRET` values.

Railway Postgres mode:

- If `DATABASE_URL` is present, the backend automatically uses Railway Postgres.
- If `DATABASE_URL` is absent but Railway provides `PGHOST`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`, the backend also uses Railway Postgres.
- Users, passwords, maps, custom blocks, and rankings are saved in Postgres and remain after redeploys.
- Keep `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`, and related variables inside Railway variables only. Do not commit them.

SQLite fallback mode:

- If `DATABASE_URL` is not present, the backend uses SQLite.
- To preserve SQLite data on Railway, attach a Volume to the `Puzzle_Tower` web service. The server will automatically use `RAILWAY_VOLUME_MOUNT_PATH` when Railway provides it. You can also set:

```env
PUZZLE_TOWER_DATA_DIR=${{RAILWAY_VOLUME_MOUNT_PATH}}
```

After deploy, check:

```text
https://YOUR-RAILWAY-BACKEND-DOMAIN/api/health
https://YOUR-RAILWAY-BACKEND-DOMAIN/api/storage/status
```

`/api/storage/status` should show `"driver": "postgres"` when Railway Postgres is active.

## Notes

GitHub Pages can host the frontend only. Email login, ranking save, community map upload, custom block sharing, and admin APIs need the Express backend deployed separately.

The local SQLite file is created under `server/data/` unless `PUZZLE_TOWER_DATA_DIR` is set.

Bug reports can be sent to `victor6580a@gmail.com`; the frontend shows this address near the bottom of the page.

Nicknames are validated on the server. `admin`, case variants, admin-like one-character variants, unicode homoglyph attempts, invisible/control characters, combining zalgo characters, and UI-breaking names are rejected for normal users. The reserved display name `Admin` is created internally for official Admin-authored content.

AdSense may render a blank area until the site and ad slot are approved by Google AdSense. `client/public/ads.txt` is included in the deployed frontend, but AdSense may still require ads.txt at the root domain or a custom domain.
