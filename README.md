# Jeopardy

[Play or create a game](https://dfree951.github.io/jeopardy/)

Create a board and play with teams or individuals. Use a shared screen, or let players join a room on their phones to buzz in.

The host selects clues, reveals answers, and keeps score. My games loads the shared boards from the database on every device. Edits save automatically, with a device copy kept if the connection drops. Boards can also be exported as JSON.

## Development

Run `npm install`, then `npm run dev` for the frontend. Use `vercel dev` to run the API too. Add a Postgres connection as `DATABASE_URL` in `.env.local`.

`npm test` checks the game rules. `npm run build` builds the app.

The frontend deploys to GitHub Pages. The API runs on Vercel with Neon Postgres. Set `VITE_API_ORIGIN` when building the frontend for a separate API host.

Backend updates deploy with `vercel deploy --prod`. The GitHub workflow publishes frontend changes automatically.
