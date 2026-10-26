# Jeopardy

[Play or create a game](https://dfree951.github.io/jeopardy/)

Create a board and play with teams or individuals. Use a shared screen, or let players join a room on their phones to buzz in.

The host selects clues, reveals answers, and keeps score. My games loads the shared boards from the database on every device. Edits save automatically, with a device copy kept if the connection drops. Boards can also be exported as JSON.

During a game, Edit scores lets the host enter a total or add and subtract the most recent card’s value. Score corrections support Undo. Media controls appear inside the open clue.

Cards can optionally include a picture, video, or audio clip up to 50 MB. Uploads are stored in Vercel Blob. The host chooses when to show them and can pause or replay clips. Player screens may need one click to enable sound.

Attachments display when a clue opens unless “Display by default” is unchecked. Video and audio stay paused until the host presses Play.

Source MP3 searches YouTube or Internet Archive and trims audio to a clip of up to two minutes. It also accepts audio or video files from your device. The trimmed MP3 saves with the clue.

## Development

Run `npm install`, then `npm run dev` for the frontend. Use `vercel dev` to run the API too. Add a Postgres connection as `DATABASE_URL` in `.env.local`.

Connect a public Vercel Blob store and set `BLOB_READ_WRITE_TOKEN` for media uploads.

Set `SAVEAPI_KEY` for YouTube audio. The app only uses the free plan and stops after reserving 1,000 credits. Each new conversion attempt reserves 10 credits, including failures. Cached recordings use no credits. The database budget never resets, and the app cannot buy credits or upgrade the account.

`npm test` checks the game rules. `npm run build` builds the app.

The frontend deploys to GitHub Pages. The API runs on Vercel with Neon Postgres. Set `VITE_API_ORIGIN` when building the frontend for a separate API host.

Backend updates deploy with `vercel deploy --prod`. The GitHub workflow publishes frontend changes automatically.
