import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { hashPassword, passwordPolicy } from '../server/auth.js';

if (process.env.ADMIN_BOOTSTRAP_ENABLED !== 'true') {
  console.error('Set ADMIN_BOOTSTRAP_ENABLED=true in your environment before creating the first admin.');
  process.exit(1);
}
const [username, emailRaw, password] = process.argv.slice(2);
const email = emailRaw?.trim().toLowerCase();
if (!username || !/^[A-Za-z0-9][A-Za-z0-9_.]{1,18}[A-Za-z0-9]$/.test(username) ||
    !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !passwordPolicy(password)) {
  console.error('Usage: node scripts/create-admin.js <username> <email> <password>\nUsername: 3–20 letters, numbers, dots or underscores. Password: at least 10 characters.');
  process.exit(1);
}
const exists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
if (exists) {
  console.error('An admin account already exists. Use the ALVINCE app to create any additional accounts.');
  process.exit(1);
}
try {
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), username, email, passwordHash, 'admin', new Date().toISOString());
  console.log(`Admin account @${username} created. Sign in through the ALVINCE app.`);
} catch (error) {
  console.error(error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ? 'That username or email is already in use.' : error.message);
  process.exitCode = 1;
} finally {
  db.close();
}

