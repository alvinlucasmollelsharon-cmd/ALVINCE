# ALVINCE

ALVINCE is a responsive community app for sharing videos, pictures, ideas, stories, and private messages. It includes member accounts, shareable profiles with editable profile photos, friend requests, friend-only chats, comments, search, owner moderation, a persistent SQLite database, and media stored on disk. Stories expire after 24 hours. Member profiles open from post usernames or profile search, show the member’s posts in a picture/video/idea gallery, and do not use follower counts.

## Requirements

- Node.js 22.9 or later (Node 24 LTS is recommended).
- No third-party application dependencies or build step are required.

The server uses Node’s built-in HTTP, crypto, and SQLite modules. Passwords are hashed with scrypt; sign-in uses an HTTP-only, same-site cookie that remains valid for 30 days. Friend requests, conversations, and profile details are saved in SQLite, and chat access is limited to accepted friends. All write requests are same-origin checked and session writes use a CSRF token. Uploads are size-limited and checked against their file signatures before being saved. The browser never sees the database or password hashes.

## Run locally

From this folder, copy `.env.example` to `.env` and leave the local paths and cookie setting as shown. In Windows PowerShell, run:

```powershell
Copy-Item .env.example .env
node --env-file-if-exists=.env server/index.js
```

On macOS or Linux, use `cp .env.example .env`, then run the same Node command:

```sh
node --env-file-if-exists=.env server/index.js
```

Open [http://localhost:3000](http://localhost:3000). You can also use `npm start` if npm is installed. The app creates its local database and media folder the first time it starts.

## Database and media

The default local files are:

- `./data/alvince.sqlite` — SQLite database, with foreign keys and write-ahead logging enabled.
- `./data/uploads/` — uploaded pictures, videos, profile photos, and stories.

Configure `DATABASE_PATH` and `UPLOAD_DIR` in `.env` to store them elsewhere. Back up the database and uploads folder together. Keep both folders on persistent storage: the app does not copy uploads to a temporary cache. Videos and video stories may be MP4, WebM, or QuickTime MOV (50 MB maximum). Pictures, profile photos, and picture stories may be JPG, PNG, WebP, GIF, or AVIF (12 MB maximum). SVG and HTML uploads are not accepted.

For a single-server deployment, a persistent disk for both folders is enough. If you later run more than one server instance, use a shared media store and a database service that supports your deployment topology; local SQLite and a single disk are designed for one app instance.

## Create the owner account

The regular sign-up page only creates member accounts. To create the first owner, stop the app, set `ADMIN_BOOTSTRAP_ENABLED=true` in `.env`, and run:

```sh
node --env-file-if-exists=.env scripts/create-admin.js YOUR_USERNAME you@example.com 'a-long-unique-password'
```

This command also works in Windows PowerShell from the ALVINCE folder.

Choose a password of at least 10 characters. The command creates the first admin only; it refuses to create another one when an admin already exists. Remove `ADMIN_BOOTSTRAP_ENABLED=true` from `.env` after the command succeeds, then start the app and sign in through the website. Protect your terminal history when entering the password.

The admin dashboard is only shown to admins. It can pause or restore member accounts and remove posts (including their media and comments). Admins can remove comments in the feed as well.

## Deploy ALVINCE with one click

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alvinlucasmollelsharon-cmd/ALVINCE)

This creates a free hosted copy. Render’s free service may sleep when idle, and its temporary storage can erase accounts, posts, chats, and uploads after a restart, spin-down, or redeploy. Your public app link appears after deployment finishes.

## Deploy with Docker

Build the image from this folder and mount a persistent volume at `/data`:

```sh
docker build -t alvince .
docker volume create alvince-data
docker run -d --name alvince --restart unless-stopped \
  -p 3000:3000 -v alvince-data:/data \
  -e NODE_ENV=production -e COOKIE_SECURE=true \
  -e DATABASE_PATH=/data/alvince.sqlite \
  -e UPLOAD_DIR=/data/uploads alvince
```

Put an HTTPS reverse proxy or your hosting platform’s HTTPS endpoint in front of the app. Keep `COOKIE_SECURE=true` in production. The deployment must retain `/data` across restarts and upgrades. Create the first owner against the same persistent volume before opening registration to the public; for example, run the admin command inside the container with `ADMIN_BOOTSTRAP_ENABLED=true` and the same database path.

For managed container hosting, use a service that offers a persistent mounted volume, set the environment variables above in its secret/configuration settings, and attach that volume at `/data`. Do not commit `.env` or put passwords in frontend files.

## Main structure

```text
public/       Responsive app UI and browser code
server/       HTTP API, authentication, SQLite and media handling
scripts/      First-owner setup command
data/         Local database and uploads (created on first run, ignored by Git)
```

