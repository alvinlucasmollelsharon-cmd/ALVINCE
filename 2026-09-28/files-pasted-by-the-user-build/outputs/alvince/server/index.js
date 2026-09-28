import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { extname, resolve, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getFeed, getPost, publicUser } from './db.js';
import { createSession, destroySession, expireCookie, hashPassword, newId, passwordPolicy, readSession, verifyPassword } from './auth.js';
import { deleteUpload, HttpInputError, parseMultipart, saveUpload, uploadDir } from './uploads.js';

const ROOT = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);
const MAX_JSON_BYTES = 24 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const rateBuckets = new Map();
const safeEqualText = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && (awaitlessTimingSafeEqual(a, b));
function awaitlessTimingSafeEqual(a, b) {
  // Values are public-token-length or user-supplied token text; equal lengths are checked before the constant-time comparison.
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
import { timingSafeEqual } from 'node:crypto';

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(req, limit = MAX_JSON_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw fail(413, 'That request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, 'Please check the information you entered.'); }
}

function requireText(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw fail(400, `${label} is required (up to ${max} characters).`);
  return value.trim();
}

function validateSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) throw fail(403, 'Please reload ALVINCE and try again.');
  let parsed;
  try { parsed = new URL(origin); } catch { throw fail(403, 'This request could not be verified.'); }
  if (parsed.host.toLowerCase() !== String(req.headers.host || '').toLowerCase() || !['https:', 'http:'].includes(parsed.protocol)) {
    throw fail(403, 'This request could not be verified.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'This request could not be verified.');
}

function requireCsrf(session, req) {
  if (!session) throw fail(401, 'Sign in to continue.');
  const token = req.headers['x-csrf-token'];
  if (!safeEqualText(session.csrfToken, token || '')) throw fail(403, 'Your session changed. Refresh the page and try again.');
}

function limited(req, key, maximum = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${ip}`;
  const bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.reset < now) rateBuckets.set(bucketKey, { count: 1, reset: now + windowMs });
  else if (++bucket.count > maximum) throw fail(429, 'Too many tries. Wait a little and try again.');
  if (rateBuckets.size > 2000) for (const [k, v] of rateBuckets) if (v.reset < now) rateBuckets.delete(k);
}

function requireUser(session) {
  if (!session?.user) throw fail(401, 'Sign in to continue.');
  return session.user;
}

function requireAdmin(session) {
  const user = requireUser(session);
  if (user.role !== 'admin') throw fail(403, 'You do not have permission to do that.');
  return user;
}

function patternPath(path, regex) {
  const match = path.match(regex);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function friendshipPair(a, b) { return a < b ? [a, b] : [b, a]; }
function areFriends(a, b) {
  if (!a || !b || a === b) return false;
  const [low, high] = friendshipPair(a, b);
  return Boolean(db.prepare('SELECT 1 FROM friendships WHERE user_low = ? AND user_high = ?').get(low, high));
}
async function deleteIfUnreferenced(name) {
  if (!name) return;
  const referenced = db.prepare(`SELECT 1 FROM posts WHERE media_name = ? UNION ALL SELECT 1 FROM stories WHERE media_name = ? UNION ALL SELECT 1 FROM users WHERE avatar_name = ? LIMIT 1`).get(name, name, name);
  if (!referenced) await deleteUpload(name);
}
async function purgeExpiredStories() {
  const now = new Date().toISOString();
  const expired = db.prepare('SELECT media_name FROM stories WHERE expires_at <= ?').all(now);
  db.prepare('DELETE FROM stories WHERE expires_at <= ?').run(now);
  for (const story of expired) await deleteIfUnreferenced(story.media_name);
}

async function handleApi(req, res, url, session) {
  const path = url.pathname;
  const method = req.method;

  if (method === 'GET' && path === '/api/session') {
    json(res, 200, { user: session?.user || null, csrfToken: session?.csrfToken || null }); return;
  }

  if (method === 'POST' && (path === '/api/auth/register' || path === '/api/auth/login')) {
    validateSameOrigin(req);
    limited(req, path, path.endsWith('login') ? 12 : 8);
    const input = await readJson(req);
    let user;
    if (path.endsWith('register')) {
      const username = requireText(input.username, 'Username', 20);
      const email = requireText(input.email, 'Email', 254).toLowerCase();
      const password = input.password;
      if (!/^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$/.test(username)) throw fail(400, 'Choose a username with 3–20 letters, numbers, dots or underscores.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, 'Enter a valid email address.');
      if (!passwordPolicy(password)) throw fail(400, 'Use a password with at least 10 characters.');
      const passwordHash = await hashPassword(password);
      user = { id: newId(), username, email, passwordHash };
      try {
        db.prepare('INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(user.id, user.username, user.email, user.passwordHash, new Date().toISOString());
      } catch (error) {
        if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw fail(409, 'That username or email is already in use.');
        throw error;
      }
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      const identity = requireText(input.identity, 'Username or email', 254);
      const password = typeof input.password === 'string' ? input.password : '';
      user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(identity, identity);
      if (!user || user.disabled || !(await verifyPassword(password, user.password_hash))) throw fail(401, 'That username or password did not match.');
    }
    const auth = createSession(user.id, SECURE_COOKIE);
    json(res, 200, { user: publicUser(user), csrfToken: auth.csrfToken }, { 'set-cookie': auth.cookie }); return;
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    validateSameOrigin(req); requireCsrf(session, req); destroySession(session);
    json(res, 200, { ok: true }, { 'set-cookie': expireCookie(SECURE_COOKIE) }); return;
  }

  if (method === 'GET' && path === '/api/feed') {
    const type = url.searchParams.get('type') || 'all';
    if (!['all', 'video', 'picture', 'idea'].includes(type)) throw fail(400, 'Choose a valid feed.');
    json(res, 200, { posts: getFeed({ type, viewerId: session?.user.id || null }) }); return;
  }

  if (method === 'GET' && path === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim().slice(0, 80);
    if (!query) { json(res, 200, { users: [], posts: [] }); return; }
    const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const users = db.prepare(`SELECT username, bio, avatar_name AS avatarName FROM users WHERE disabled = 0 AND (username LIKE ? ESCAPE '\\' OR bio LIKE ? ESCAPE '\\') ORDER BY username LIMIT 6`)
      .all(term, term).map((person) => ({ ...person, avatarUrl: person.avatarName ? `/media/${encodeURIComponent(person.avatarName)}` : null }));
    const posts = getFeed({ viewerId: session?.user.id || null, search: query, limit: 60 }).slice(0, 8);
    json(res, 200, { users, posts }); return;
  }

  if (method === 'GET' && path === '/api/profile') {
    const username = url.searchParams.get('username');
    if (!username) throw fail(400, 'Choose a profile to view.');
    const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND disabled = 0').get(username);
    if (!row) throw fail(404, 'That profile could not be found.');
    const viewerId = session?.user.id;
    const isYou = viewerId === row.id;
    const isFriend = areFriends(viewerId, row.id);
    const relationship = isYou ? 'self' : isFriend ? 'friends' : !viewerId ? 'none' : db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND recipient_id = ?').get(row.id, viewerId) ? 'incoming' : db.prepare('SELECT 1 FROM friend_requests WHERE sender_id = ? AND recipient_id = ?').get(viewerId, row.id) ? 'outgoing' : 'none';
    const profile = { username: row.username, bio: row.bio, createdAt: row.created_at, avatarUrl: row.avatar_name ? `/media/${encodeURIComponent(row.avatar_name)}` : null, postCount: db.prepare('SELECT count(*) AS n FROM posts WHERE user_id = ?').get(row.id).n, isYou, relationship, friendId: row.id };
    json(res, 200, { profile, posts: getFeed({ username: row.username, viewerId: session?.user.id || null }) }); return;
  }

  if (method === 'PATCH' && path === '/api/profile') {
    validateSameOrigin(req); requireCsrf(session, req);
    const input = await readJson(req);
    const username = requireText(input.username, 'Username', 20);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$/.test(username)) throw fail(400, 'Choose a username with 3–20 letters, numbers, dots or underscores.');
    if (typeof input.bio !== 'string' || input.bio.length > 240) throw fail(400, 'Your bio can be up to 240 characters.');
    try {
      db.prepare('UPDATE users SET username = ?, bio = ? WHERE id = ?').run(username, input.bio.trim(), session.user.id);
    } catch (error) {
      if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw fail(409, 'That username is already taken.');
      throw error;
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user.id);
    const updated = publicUser(row);
    json(res, 200, { user: updated }); return;
  }

  if (method === 'POST' && path === '/api/profile/avatar') {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    const { files } = await parseMultipart(req, 13 * 1024 * 1024);
    const saved = await saveUpload(files.avatar, 'picture');
    const previous = db.prepare('SELECT avatar_name FROM users WHERE id = ?').get(user.id)?.avatar_name;
    db.prepare('UPDATE users SET avatar_name = ? WHERE id = ?').run(saved.name, user.id);
    await deleteIfUnreferenced(previous);
    json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) }); return;
  }

  if (method === 'GET' && path === '/api/friends') {
    const user = requireUser(session);
    const friends = db.prepare(`SELECT u.id, u.username, u.bio, u.role, u.avatar_name, f.created_at AS friendsSince,
      (SELECT m.text FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id) ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
      (SELECT m.created_at FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id) ORDER BY m.created_at DESC LIMIT 1) AS lastMessageAt,
      (SELECT count(*) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
      FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
      WHERE f.user_low = ? OR f.user_high = ? ORDER BY COALESCE(lastMessageAt, f.created_at) DESC`).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id);
    const requests = db.prepare(`SELECT r.id, r.created_at AS createdAt, u.id AS userId, u.username, u.bio, u.avatar_name AS avatarName
      FROM friend_requests r JOIN users u ON u.id = r.sender_id WHERE r.recipient_id = ? ORDER BY r.created_at DESC`).all(user.id);
    const sent = db.prepare(`SELECT r.id, r.created_at AS createdAt, u.id AS userId, u.username, u.bio
      FROM friend_requests r JOIN users u ON u.id = r.recipient_id WHERE r.sender_id = ? ORDER BY r.created_at DESC`).all(user.id);
    json(res, 200, { friends: friends.map((f) => ({ ...f, avatarUrl: f.avatar_name ? `/media/${encodeURIComponent(f.avatar_name)}` : null, unread: Number(f.unread) })), incoming: requests.map((u) => ({ ...u, avatarUrl: u.avatarName ? `/media/${encodeURIComponent(u.avatarName)}` : null })), outgoing: sent }); return;
  }

  const friendRequestUserId = patternPath(path, /^\/api\/friends\/request\/([^/]+)$/);
  if (method === 'POST' && friendRequestUserId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    await readJson(req);
    if (friendRequestUserId === user.id) throw fail(400, 'You cannot add yourself as a friend.');
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND disabled = 0').get(friendRequestUserId);
    if (!target) throw fail(404, 'That person could not be found.');
    if (areFriends(user.id, target.id)) throw fail(409, 'You are already friends.');
    const reciprocal = db.prepare('SELECT id FROM friend_requests WHERE sender_id = ? AND recipient_id = ?').get(target.id, user.id);
    if (reciprocal) {
      const [low, high] = friendshipPair(user.id, target.id);
      db.prepare('INSERT OR IGNORE INTO friendships (user_low, user_high, created_at) VALUES (?, ?, ?)').run(low, high, new Date().toISOString());
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(reciprocal.id);
      json(res, 200, { relationship: 'friends' }); return;
    }
    try { db.prepare('INSERT INTO friend_requests (id, sender_id, recipient_id, created_at) VALUES (?, ?, ?, ?)').run(newId(), user.id, target.id, new Date().toISOString()); }
    catch (error) { if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') throw fail(409, 'You already sent a friend request.'); throw error; }
    json(res, 201, { relationship: 'outgoing' }); return;
  }

  const requestId = patternPath(path, /^\/api\/friends\/requests\/([^/]+)\/accept$/);
  if (method === 'POST' && requestId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    await readJson(req);
    const request = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND recipient_id = ?').get(requestId, user.id);
    if (!request) throw fail(404, 'That friend request is no longer available.');
    const [low, high] = friendshipPair(request.sender_id, request.recipient_id);
    db.prepare('INSERT OR IGNORE INTO friendships (user_low, user_high, created_at) VALUES (?, ?, ?)').run(low, high, new Date().toISOString());
    db.prepare('DELETE FROM friend_requests WHERE id = ?').run(requestId);
    json(res, 200, { relationship: 'friends' }); return;
  }

  const cancelRequestId = patternPath(path, /^\/api\/friends\/requests\/([^/]+)$/);
  if (method === 'DELETE' && cancelRequestId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    db.prepare('DELETE FROM friend_requests WHERE id = ? AND (sender_id = ? OR recipient_id = ?)').run(cancelRequestId, user.id, user.id);
    json(res, 200, { ok: true }); return;
  }

  const friendId = patternPath(path, /^\/api\/friends\/([^/]+)$/);
  if (method === 'DELETE' && friendId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    const [low, high] = friendshipPair(user.id, friendId);
    db.prepare('DELETE FROM friendships WHERE user_low = ? AND user_high = ?').run(low, high);
    json(res, 200, { ok: true }); return;
  }

  if (method === 'GET' && path === '/api/messages') {
    const user = requireUser(session);
    const friends = db.prepare(`SELECT u.id AS friendId, u.username, u.avatar_name, u.bio,
      (SELECT m.text FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id) ORDER BY m.created_at DESC LIMIT 1) AS lastMessage,
      (SELECT m.created_at FROM messages m WHERE (m.sender_id = u.id AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = u.id) ORDER BY m.created_at DESC LIMIT 1) AS lastMessageAt,
      (SELECT count(*) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ? AND m.read_at IS NULL) AS unread
      FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
      WHERE f.user_low = ? OR f.user_high = ? ORDER BY COALESCE(lastMessageAt, u.username) DESC`).all(user.id, user.id, user.id, user.id, user.id, user.id, user.id, user.id);
    json(res, 200, { friends: friends.map((f) => ({ ...f, avatarUrl: f.avatar_name ? `/media/${encodeURIComponent(f.avatar_name)}` : null, unread: Number(f.unread) })) }); return;
  }
  const conversationId = patternPath(path, /^\/api\/messages\/([^/]+)$/);
  if (conversationId && method === 'GET') {
    const user = requireUser(session);
    if (!areFriends(user.id, conversationId)) throw fail(403, 'You can message people after you become friends.');
    db.prepare('UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL').run(new Date().toISOString(), conversationId, user.id);
    const messages = db.prepare(`SELECT m.id, m.sender_id AS senderId, m.recipient_id AS recipientId, m.text, m.created_at AS createdAt, m.read_at AS readAt, u.username
      FROM messages m JOIN users u ON u.id = m.sender_id WHERE (m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?) ORDER BY m.created_at DESC LIMIT 200`).all(user.id, conversationId, conversationId, user.id).reverse();
    const friend = db.prepare('SELECT id, username, bio, avatar_name FROM users WHERE id = ? AND disabled = 0').get(conversationId);
    if (!friend) throw fail(404, 'That person could not be found.');
    json(res, 200, { friend: { id: friend.id, username: friend.username, bio: friend.bio, avatarUrl: friend.avatar_name ? `/media/${encodeURIComponent(friend.avatar_name)}` : null }, messages }); return;
  }
  if (conversationId && method === 'POST') {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    if (!areFriends(user.id, conversationId)) throw fail(403, 'You can message people after you become friends.');
    const friend = db.prepare('SELECT id FROM users WHERE id = ? AND disabled = 0').get(conversationId);
    if (!friend) throw fail(404, 'That person could not be found.');
    const input = await readJson(req); const text = requireText(input.text, 'Message', 2000);
    const id = newId(); const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO messages (id, sender_id, recipient_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(id, user.id, friend.id, text, createdAt);
    json(res, 201, { message: { id, senderId: user.id, recipientId: friend.id, text, createdAt, username: user.username } }); return;
  }

  if (method === 'GET' && path === '/api/stories') {
    await purgeExpiredStories();
    const stories = db.prepare(`SELECT s.id, s.user_id AS userId, s.media_name AS mediaName, s.media_type AS mediaType, s.caption, s.created_at AS createdAt, s.expires_at AS expiresAt,
      u.username, u.avatar_name AS avatarName FROM stories s JOIN users u ON u.id = s.user_id WHERE s.expires_at > ? AND u.disabled = 0 ORDER BY s.created_at DESC LIMIT 100`).all(new Date().toISOString());
    json(res, 200, { stories: stories.map((s) => ({ ...s, mediaUrl: `/media/${encodeURIComponent(s.mediaName)}`, avatarUrl: s.avatarName ? `/media/${encodeURIComponent(s.avatarName)}` : null, isYou: session?.user.id === s.userId })) }); return;
  }
  if (method === 'POST' && path === '/api/stories') {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    limited(req, 'story-create', 30, 60 * 60 * 1000);
    const { fields, files } = await parseMultipart(req, 51 * 1024 * 1024);
    const caption = (fields.caption || '').trim();
    if (caption.length > 200) throw fail(400, 'Story captions can be up to 200 characters.');
    const file = files.media;
    const kind = file?.mime?.startsWith('video/') || /\.(?:mp4|webm|mov)$/i.test(file?.name || '') ? 'video' : 'picture';
    const saved = await saveUpload(file, kind);
    const id = newId(); const createdAt = new Date(); const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);
    try { db.prepare('INSERT INTO stories (id, user_id, media_name, media_type, media_size, caption, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, user.id, saved.name, saved.mime, saved.size, caption, createdAt.toISOString(), expiresAt.toISOString()); }
    catch (error) { await deleteUpload(saved.name); throw error; }
    json(res, 201, { story: { id, mediaUrl: `/media/${encodeURIComponent(saved.name)}`, mediaType: saved.mime, caption, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), username: user.username, userId: user.id, isYou: true } }); return;
  }
  const storyId = patternPath(path, /^\/api\/stories\/([^/]+)$/);
  if (method === 'DELETE' && storyId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    const story = db.prepare('SELECT id, user_id, media_name FROM stories WHERE id = ?').get(storyId);
    if (!story) throw fail(404, 'That story has expired or was removed.');
    if (story.user_id !== user.id && user.role !== 'admin') throw fail(403, 'You can only remove your own story.');
    db.prepare('DELETE FROM stories WHERE id = ?').run(storyId); await deleteIfUnreferenced(story.media_name);
    json(res, 200, { ok: true }); return;
  }

  if (method === 'POST' && path === '/api/posts') {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    limited(req, 'post-create', 20, 60 * 60 * 1000);
    const { fields, files } = await parseMultipart(req);
    const type = fields.type;
    if (!['video', 'picture', 'idea'].includes(type)) throw fail(400, 'Choose a post type.');
    const title = (fields.title || '').trim();
    const caption = (fields.caption || '').trim();
    const body = (fields.body || '').trim();
    if (title.length > 100 || caption.length > 500 || body.length > 8000) throw fail(400, 'Your text is longer than the allowed limit.');
    let saved = null;
    if (type === 'idea') {
      if (!title) throw fail(400, 'Give your idea a title.');
      if (!body) throw fail(400, 'Write a little about your idea.');
    } else {
      saved = await saveUpload(files.media, type);
    }
    const id = newId();
    try {
      db.prepare(`INSERT INTO posts (id, user_id, type, title, body, caption, media_name, media_type, media_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.id, type, title, body, caption, saved?.name || null, saved?.mime || null, saved?.size || null, new Date().toISOString());
    } catch (error) {
      if (saved) await deleteUpload(saved.name);
      throw error;
    }
    json(res, 201, { post: getPost(id, user.id) }); return;
  }

  const postId = patternPath(path, /^\/api\/posts\/([^/]+)$/);
  if (method === 'DELETE' && postId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    const post = db.prepare('SELECT id, user_id, media_name FROM posts WHERE id = ?').get(postId);
    if (!post) throw fail(404, 'That post is no longer here.');
    if (post.user_id !== user.id && user.role !== 'admin') throw fail(403, 'You can only remove your own posts.');
    db.prepare('DELETE FROM posts WHERE id = ?').run(postId);
    await deleteUpload(post.media_name);
    json(res, 200, { ok: true }); return;
  }

  const commentPostId = patternPath(path, /^\/api\/posts\/([^/]+)\/comments$/);
  if (method === 'POST' && commentPostId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    limited(req, 'comment', 30, 60 * 60 * 1000);
    if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(commentPostId)) throw fail(404, 'That post is no longer here.');
    const input = await readJson(req);
    const text = requireText(input.text, 'Comment', 1000);
    const id = newId();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO comments (id, post_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)').run(id, commentPostId, user.id, text, createdAt);
    json(res, 201, { comment: { id, postId: commentPostId, userId: user.id, text, createdAt, username: user.username, canDelete: true } }); return;
  }

  const commentId = patternPath(path, /^\/api\/comments\/([^/]+)$/);
  if (method === 'DELETE' && commentId) {
    validateSameOrigin(req); requireCsrf(session, req); const user = requireUser(session);
    const comment = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(commentId);
    if (!comment) throw fail(404, 'That comment is no longer here.');
    if (comment.user_id !== user.id && user.role !== 'admin') throw fail(403, 'You can only remove your own comments.');
    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
    json(res, 200, { ok: true }); return;
  }

  if (method === 'GET' && path === '/api/admin/users') {
    requireAdmin(session);
    const users = db.prepare(`SELECT u.id, u.username, u.email, u.bio, u.role, u.disabled, u.created_at AS createdAt,
      (SELECT count(*) FROM posts p WHERE p.user_id = u.id) AS postCount
      FROM users u ORDER BY u.created_at DESC LIMIT 200`).all();
    json(res, 200, { users: users.map((row) => ({ ...row, disabled: Boolean(row.disabled) })) }); return;
  }

  if (method === 'GET' && path === '/api/admin/posts') {
    requireAdmin(session); json(res, 200, { posts: getFeed({ viewerId: session.user.id, limit: 100 }) }); return;
  }

  const adminUserId = patternPath(path, /^\/api\/admin\/users\/([^/]+)\/disable$/);
  if (method === 'POST' && adminUserId) {
    validateSameOrigin(req); requireCsrf(session, req); requireAdmin(session);
    if (adminUserId === session.user.id) throw fail(400, 'You cannot disable your own admin account.');
    const result = db.prepare(`UPDATE users SET disabled = CASE disabled WHEN 0 THEN 1 ELSE 0 END WHERE id = ? AND role != 'admin'`).run(adminUserId);
    if (!result.changes) throw fail(404, 'That member could not be found.');
    const row = db.prepare('SELECT disabled FROM users WHERE id = ?').get(adminUserId);
    if (row.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminUserId);
    json(res, 200, { disabled: Boolean(row.disabled) }); return;
  }

  json(res, 404, { error: 'That page could not be found.' });
}

async function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  let target;
  if (pathname.startsWith('/media/')) {
    const name = decodeURIComponent(pathname.slice('/media/'.length));
    if (basename(name) !== name || !/^[0-9a-f-]{36}\.(?:jpg|png|webp|gif|avif|mp4|webm|mov)$/.test(name)) throw fail(404, 'That media could not be found.');
    target = resolve(uploadDir, name);
  } else {
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    target = resolve(ROOT, relative);
    if (!target.startsWith(`${ROOT}${sep}`)) throw fail(404, 'That page could not be found.');
  }
  let info;
  try { info = await stat(target); } catch { throw fail(404, 'That page could not be found.'); }
  if (!info.isFile()) throw fail(404, 'That page could not be found.');
  const extension = extname(target).toLowerCase();
  const media = pathname.startsWith('/media/');
  const contentType = media ? ({ '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }[extension]) : MIME[extension];
  if (!contentType) throw fail(404, 'That page could not be found.');
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': info.size,
    'x-content-type-options': 'nosniff',
    'cache-control': media ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end(); else createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const session = readSession(req);
      await handleApi(req, res, url, session);
    } else if (['GET', 'HEAD'].includes(req.method)) {
      await serveStatic(req, res, url.pathname);
    } else {
      throw fail(405, 'This request method is not supported.');
    }
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (!error.status || error.status >= 500) console.error(error);
    json(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.' });
  }
});

await mkdir(uploadDir, { recursive: true });
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
server.listen(PORT, '0.0.0.0', () => console.log(`ALVINCE is ready on port ${PORT}`));

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
