/**
 * Bootstrap users and a first workspace (there is no public sign-up).
 *   node dist/cli/seed.js <email> <password> [displayName] [workspaceName]
 * Uses the owner DB URL because it creates the very first rows.
 */
import { randomUUID } from 'node:crypto';
import { createDb, createPool, memberships, users, workspaces } from '@scm/db';
import argon2 from 'argon2';

async function main() {
  const [email, password, displayName = 'ผู้ดูแล', wsName] = process.argv.slice(2);
  if (!email || !password || password.length < 12) {
    throw new Error('usage: seed <email> <password(min 12)> [displayName] [workspaceName]');
  }
  const pool = createPool(
    process.env.DATABASE_OWNER_URL ?? 'postgres://scm:scm@localhost:5433/scm',
    1,
  );
  const db = createDb(pool);
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        displayName,
        passwordHash: await argon2.hash(password),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { passwordHash: await argon2.hash(password) },
      })
      .returning();
    console.log(`user ${user!.email} (${user!.id})`);
    if (wsName) {
      const id = randomUUID();
      await db.insert(workspaces).values({ id, name: wsName });
      await db.insert(memberships).values({ workspaceId: id, userId: user!.id, role: 'owner' });
      console.log(`workspace "${wsName}" (${id}) — add a second owner (AUTH-06)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
