import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const databasePath = resolve(process.env.DATABASE_PATH || './data/alvince.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath, { timeout: 5000 });
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('video', 'picture', 'idea')),
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    media_name TEXT,
    media_type TEXT,
    media_size INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS posts_user_idx ON posts(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);
  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    CHECK(sender_id != recipient_id),
    UNIQUE(sender_id, recipient_id)
  );
  CREATE INDEX IF NOT EXISTS friend_requests_incoming_idx ON friend_requests(recipient_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS friendships (
    user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_low, user_high),
    CHECK(user_low < user_high)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),
    created_at TEXT NOT NULL,
    read_at TEXT,
    CHECK(sender_id != recipient_id)
  );
  CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages(sender_id, recipient_id, created_at);
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    media_size INTEGER NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stories_expiry_idx ON stories(expires_at DESC);
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
if (!userColumns.has('avatar_name')) db.exec('ALTER TABLE users ADD COLUMN avatar_name TEXT');

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    bio: row.bio,
    role: row.role,
    createdAt: row.created_at,
    disabled: Boolean(row.disabled),
    avatarUrl: row.avatar_name ? `/media/${encodeURIComponent(row.avatar_name)}` : null,
  };
}

const POST_SELECT = `
  SELECT p.id, p.user_id AS userId, p.type, p.title, p.body, p.caption,
    p.media_name AS mediaName, p.media_type AS mediaType, p.media_size AS mediaSize,
    p.created_at AS createdAt, u.username, u.bio, u.role, u.avatar_name AS avatarName
  FROM posts p JOIN users u ON u.id = p.user_id
`;

function withComments(posts, viewerId = null) {
  const viewerIsAdmin = viewerId ? db.prepare("SELECT role FROM users WHERE id = ?").get(viewerId)?.role === 'admin' : false;
  const readComments = db.prepare(`
    SELECT c.id, c.post_id AS postId, c.user_id AS userId, c.text, c.created_at AS createdAt,
      u.username, u.role, u.avatar_name AS avatarName
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `);
  return posts.map((post) => ({
    ...post,
    mediaUrl: post.mediaName ? `/media/${encodeURIComponent(post.mediaName)}` : null,
    comments: readComments.all(post.id).map((comment) => ({
      ...comment,
      avatarUrl: comment.avatarName ? `/media/${encodeURIComponent(comment.avatarName)}` : null,
      canDelete: Boolean(viewerId && (viewerId === comment.userId || viewerIsAdmin)),
    })),
    canDelete: Boolean(viewerId && (viewerId === post.userId || viewerIsAdmin)),
  }));
}

export function getFeed({ type = 'all', username, viewerId, search, limit = 60 } = {}) {
  const conditions = [];
  const args = [];
  if (type !== 'all') { conditions.push('p.type = ?'); args.push(type); }
  if (username) { conditions.push('u.username = ? COLLATE NOCASE'); args.push(username); }
  if (search) {
    conditions.push(`(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR p.caption LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')`);
    const q = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(q, q, q, q);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const posts = db.prepare(`${POST_SELECT} ${where} ORDER BY p.created_at DESC LIMIT ?`).all(...args, limit);
  return withComments(posts, viewerId);
}

export function getPost(id, viewerId) {
  const post = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(id);
  return post ? withComments([post], viewerId)[0] : null;
}

export function removeMediaFile(mediaName) {
  if (typeof mediaName === 'string' && /^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|avif|mp4|webm|mov)$/.test(mediaName)) {
    return resolve(process.env.UPLOAD_DIR || './data/uploads', mediaName);
  }
  return null;
}


const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name));
if (!messageColumns.has('image_name')) db.exec('ALTER TABLE messages ADD COLUMN image_name TEXT');
if (!messageColumns.has('image_type')) db.exec('ALTER TABLE messages ADD COLUMN image_type TEXT');
