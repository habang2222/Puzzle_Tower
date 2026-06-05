# Puzzle Tower

Puzzle Tower is a full-stack web puzzle game. Players clear tile stages with a move limit, save records, log in, build maps, upload community maps, and compare rankings by stage.

## Features

- React + Vite frontend
- Express backend API
- SQLite database powered by `sql.js`
- 15 built-in stages
- Increasing difficulty with walls, move limits, teleport tiles, keys, and locks
- Local best record fallback
- Email/password signup and login
- Player-made map builder and upload flow
- Custom block editor with safe JSON block rules
- Public custom block library and download API
- Public community map list
- Community map tags, search, and creator filters
- Public custom block tags, search, and creator filters
- Creator must clear a custom map once before upload
- Ranking save and lookup API
- Admin stage CRUD API
- Reserved Admin nickname protection with unicode/control-character filtering
- Configurable SQLite data directory for persistent storage
- Responsive sticky game controls
- AdSense slot integration
- GitHub Pages deployment workflow for the frontend
- Render-ready backend configuration

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
VITE_API_URL=https://puzzle-tower.onrender.com
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
PUZZLE_TOWER_DATA_DIR=./data
```

`PUZZLE_TOWER_DATA_DIR` controls where `puzzle-tower.sqlite` is stored. Locally, the default is `server/data/`.
`ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional. When set, the server connects those login credentials to the reserved internal `Admin` account on startup. Do not commit real admin credentials to git.
If environment variables are not available, open the in-app Admin screen, enter the admin setup token, Admin email, and Admin password, then press "Admin 로그인 설정".
The admin setup token is `ADMIN_TOKEN`, not the Admin login password. If `ADMIN_TOKEN` is not set on the server, the current fallback token is `admin123`.

## API List

### Health

```http
GET /api/health
```

### Stages

```http
GET /api/stages
GET /api/stages?q=logic&creator=Admin&tag=extreme
GET /api/stages/:level
```

### Auth

```http
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
```

`POST /api/auth/register` body:

```json
{
  "nickname": "maker",
  "email": "maker@example.com",
  "password": "secret123"
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

Custom block images are stored as small data URLs in the `image` field. The app accepts png, jpg, webp, and gif images up to the server limit.

### Records and Rankings

```http
POST /api/records
GET /api/rankings
GET /api/rankings?stageId=1&limit=10
GET /api/users/:nickname/best
```

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

Default local admin token:

```text
admin123
```

## Deployment

### Frontend: GitHub Pages

The workflow in `.github/workflows/pages.yml` builds `client/` and deploys it to GitHub Pages. In the repository settings, enable GitHub Pages with GitHub Actions as the source.

Frontend URL format:

```text
https://habang2222.github.io/Puzzle_Tower/
```

The frontend falls back to `https://puzzle-tower.onrender.com` on deployed pages. You can still override it with a repository variable or secret named `VITE_API_URL`.

### Backend: Render

Use `render.yaml` as a starting point, or create a Render Web Service manually:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `ADMIN_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `CLIENT_ORIGIN`, `CLIENT_URL`
- Optional data directory: `PUZZLE_TOWER_DATA_DIR=/var/data`

Important persistence note:

- Render Free web services do not provide persistent disks. Local SQLite data can disappear after redeploys, restarts, or spin-downs.
- To preserve users, login records, maps, blocks, and rankings on Render, attach a Render Persistent Disk and set `PUZZLE_TOWER_DATA_DIR` to the disk mount path, for example `/var/data`.
- If you must stay fully free, use a hosted database such as Supabase/Postgres instead of local SQLite.

Backend API URL format:

```text
https://puzzle-tower.onrender.com/api/health
```

## Notes

GitHub Pages can host the frontend only. Email login, ranking save, community map upload, custom block sharing, and admin APIs need the Express backend deployed separately.

The local SQLite file is created under `server/data/` unless `PUZZLE_TOWER_DATA_DIR` is set.

Nicknames are validated on the server. `admin`, case variants, admin-like one-character variants, unicode homoglyph attempts, invisible/control characters, combining zalgo characters, and UI-breaking names are rejected for normal users. The reserved display name `Admin` is created internally for official Admin-authored content.

AdSense may render a blank area until the site and ad slot are approved by Google AdSense.
