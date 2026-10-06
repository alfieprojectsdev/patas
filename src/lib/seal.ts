import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Group-key crypto for share links.
 *
 * K: 32 random bytes made in the organiser's browser, base64url, carried only
 * in the link's #fragment and in request bodies. Never stored or logged.
 * The server keeps sha256(K) to recognise it, and seals each member's H3 cell
 * with AES-256-GCM under HKDF(K, salt = group id). The AAD binds a sealed
 * cell to its group and member, so rows can't be swapped between members.
 *
 * Member tokens follow the same idea as washboard's account links: random,
 * stored only as a hash.
 */
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const VERSION = 1;

export const isGroupKey = (k: unknown): k is string => typeof k === "string" && B64URL_32.test(k);
export const isMemberToken = isGroupKey;

export const sha256hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const keyCheck = (k: string) => sha256hex(Buffer.from(k, "base64url"));
export const newMemberToken = () => randomBytes(32).toString("base64url");

/** Constant-time check of K against the stored sha256(K). */
export function keyMatches(k: string, stored: string | null): boolean {
  if (!stored || !isGroupKey(k)) return false;
  const a = Buffer.from(keyCheck(k), "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cellKey(k: string, groupId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(k, "base64url"), groupId, "patas sealed cell v1", 32));
}

const aad = (groupId: string, memberId: string) => Buffer.from(`${groupId}|${memberId}`);

/** Seal an H3 cell id. Output: version(1) | iv(12) | tag(16) | ciphertext. */
export function sealCell(k: string, groupId: string, memberId: string, cell: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cellKey(k, groupId), iv);
  c.setAAD(aad(groupId, memberId));
  const ct = Buffer.concat([c.update(cell, "utf8"), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, c.getAuthTag(), ct]);
}

/** Open a sealed cell; null if the key, group, member or bytes don't match. */
export function openCell(k: string, groupId: string, memberId: string, sealed: Uint8Array): string | null {
  const b = Buffer.from(sealed);
  if (b.length < 30 || b[0] !== VERSION) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", cellKey(k, groupId), b.subarray(1, 13));
    d.setAAD(aad(groupId, memberId));
    d.setAuthTag(b.subarray(13, 29));
    return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
