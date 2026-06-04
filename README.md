# Puzzle Tower

Puzzle Tower is a full-stack web puzzle game. Players clear tile stages with a move limit, save records with a nickname, and compare rankings by stage.

## Features

- React + Vite frontend
- Express backend API
- SQLite database powered by `sql.js`
- 15 built-in stages
- Increasing difficulty with walls, move limits, teleport tiles, keys, and locks
- Local best record fallback
- Ranking save and lookup API
- Admin stage CRUD API
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
VITE_API_URL=https://your-backend.onrender.com
```

Create `server/.env` if you want to change server settings:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173
ADMIN_TOKEN=change-this-token
```

## API List

### Health

```http
GET /api/health
```

### Stages

```http
GET /api/stages
GET /api/stages/:level
```

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

If your backend is deployed, add a repository variable or secret named `VITE_API_URL` with the backend URL.

### Backend: Render

Use `render.yaml` as a starting point, or create a Render Web Service manually:

- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `ADMIN_TOKEN`

Backend API URL format:

```text
https://puzzle-tower-api.onrender.com/api/health
```

## Notes

GitHub Pages can host the frontend only. The Express backend needs a separate server deployment such as Render.
