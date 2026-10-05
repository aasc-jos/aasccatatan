import type { Config } from "@netlify/functions";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { folders, notes } from "../../db/schema.js";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const COLORS = ["teal", "amber", "coral", "violet", "cyan", "indigo", "lime", "pink"];
const BUILTIN_PREFIX = "builtin-folder-";

const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Each browser generates a random token and keeps it in localStorage. Only its
// hash is stored, so whoever created an item is the only one who can change it.
async function ownerOf(req: Request) {
  const token = req.headers.get("x-owner-token") || "";
  return token.length >= 16 && token.length <= 200 ? hashToken(token) : null;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function readBody(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function folderExists(folderId: string) {
  if (folderId.startsWith(BUILTIN_PREFIX)) return true;
  const [row] = await db.select({ id: folders.id }).from(folders).where(eq(folders.id, folderId));
  return Boolean(row);
}

async function getLibrary(owner: string | null) {
  const folderRows = await db.select().from(folders).orderBy(asc(folders.createdAt));
  const noteRows = await db
    .select({
      id: notes.id,
      folderId: notes.folderId,
      title: notes.title,
      code: notes.code,
      addedAt: notes.addedAt,
      ownerHash: notes.ownerHash,
      size: sql<number>`length(${notes.html})`.mapWith(Number),
    })
    .from(notes)
    .orderBy(asc(notes.addedAt));

  return {
    folders: folderRows.map(({ ownerHash, ...f }) => ({ ...f, mine: ownerHash === owner })),
    notes: noteRows.map(({ ownerHash, ...n }) => ({ ...n, mine: ownerHash === owner })),
  };
}

async function handleFolders(req: Request, id: string | undefined, owner: string | null) {
  if (!owner) return fail("Token pemilik tidak valid.", 401);

  if (req.method === "POST" && !id) {
    const body = await readBody(req);
    const name = clean(body?.name, 120);
    if (!name) return fail("Nama mata kuliah wajib diisi.");
    const code = clean(body?.code, 6).toUpperCase() || "MK";
    const color = COLORS.includes(String(body?.color)) ? String(body?.color) : "teal";
    const [row] = await db
      .insert(folders)
      .values({ id: crypto.randomUUID(), name, code, color, ownerHash: owner })
      .returning();
    const { ownerHash, ...folder } = row;
    return json({ ...folder, mine: true }, 201);
  }

  if (!id) return fail("Not found", 404);
  const [existing] = await db.select().from(folders).where(eq(folders.id, id));
  if (!existing) return fail("Folder tidak ditemukan.", 404);
  if (existing.ownerHash !== owner) return fail("Hanya pembuat folder yang bisa mengubahnya.", 403);

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const name = clean(body?.name, 120) || existing.name;
    const code = clean(body?.code, 6).toUpperCase() || existing.code;
    const color = COLORS.includes(String(body?.color)) ? String(body?.color) : existing.color;
    const [row] = await db.update(folders).set({ name, code, color }).where(eq(folders.id, id)).returning();
    const { ownerHash, ...folder } = row;
    return json({ ...folder, mine: true });
  }

  if (req.method === "DELETE") {
    const [others] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(notes)
      .where(and(eq(notes.folderId, id), ne(notes.ownerHash, owner)));
    if (others.count > 0) {
      return fail("Folder berisi catatan milik orang lain, jadi tidak bisa dihapus.", 409);
    }
    await db.delete(notes).where(eq(notes.folderId, id));
    await db.delete(folders).where(eq(folders.id, id));
    return json({ ok: true });
  }

  return fail("Method not allowed", 405);
}

async function handleNotes(req: Request, id: string | undefined, owner: string | null) {
  if (req.method === "GET" && id) {
    const [row] = await db.select({ html: notes.html }).from(notes).where(eq(notes.id, id));
    if (!row) return fail("Catatan tidak ditemukan.", 404);
    return json(row);
  }

  if (!owner) return fail("Token pemilik tidak valid.", 401);

  if (req.method === "POST" && !id) {
    const body = await readBody(req);
    const folderId = clean(body?.folderId, 200);
    const title = clean(body?.title, 200);
    const html = typeof body?.html === "string" ? body.html : "";
    if (!folderId || !(await folderExists(folderId))) return fail("Folder tidak ditemukan.", 404);
    if (!title) return fail("Judul catatan wajib diisi.");
    if (!html.trim()) return fail("Isi HTML wajib diisi.");
    if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) return fail("File HTML terlalu besar (maks. 5 MB).", 413);
    const [row] = await db
      .insert(notes)
      .values({ id: crypto.randomUUID(), folderId, title, code: clean(body?.code, 40), html, ownerHash: owner })
      .returning({ id: notes.id, folderId: notes.folderId, title: notes.title, code: notes.code, addedAt: notes.addedAt });
    return json({ ...row, size: html.length, mine: true }, 201);
  }

  if (!id) return fail("Not found", 404);
  const [existing] = await db
    .select({ ownerHash: notes.ownerHash })
    .from(notes)
    .where(eq(notes.id, id));
  if (!existing) return fail("Catatan tidak ditemukan.", 404);
  if (existing.ownerHash !== owner) return fail("Hanya pengunggah catatan yang bisa mengubahnya.", 403);

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const changes: Partial<typeof notes.$inferInsert> = {};
    const title = clean(body?.title, 200);
    if (title) changes.title = title;
    if (typeof body?.code === "string") changes.code = clean(body.code, 40);
    if (typeof body?.html === "string" && body.html.trim()) {
      if (new TextEncoder().encode(body.html).length > MAX_HTML_BYTES) return fail("File HTML terlalu besar (maks. 5 MB).", 413);
      changes.html = body.html;
    }
    const [row] = await db
      .update(notes)
      .set(changes)
      .where(eq(notes.id, id))
      .returning({
        id: notes.id,
        folderId: notes.folderId,
        title: notes.title,
        code: notes.code,
        addedAt: notes.addedAt,
        size: sql<number>`length(${notes.html})`.mapWith(Number),
      });
    return json({ ...row, mine: true });
  }

  if (req.method === "DELETE") {
    await db.delete(notes).where(eq(notes.id, id));
    return json({ ok: true });
  }

  return fail("Method not allowed", 405);
}

export default async (req: Request) => {
  const [, , resource, id] = new URL(req.url).pathname.split("/");
  const owner = await ownerOf(req);

  try {
    if (resource === "library" && req.method === "GET") return json(await getLibrary(owner));
    if (resource === "folders") return await handleFolders(req, id, owner);
    if (resource === "notes") return await handleNotes(req, id, owner);
    return fail("Not found", 404);
  } catch (e) {
    console.error(e);
    return fail("Terjadi kesalahan di server.", 500);
  }
};

export const config: Config = {
  path: ["/api/library", "/api/folders", "/api/folders/:id", "/api/notes", "/api/notes/:id"],
};
