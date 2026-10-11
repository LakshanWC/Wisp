// scripts/bookmarkPrivacy.ts
//
// Secure private-bookmark vault.
//
// Design:
// - Private bookmarks are REMOVED from the real browser bookmark tree (not just filtered out
//   of the UI) so they don't show up in the native bookmarks manager, sync, or export.
// - The removed bookmarks are kept as a single JSON array, encrypted with AES-256-GCM, and
//   stored in chrome.storage.local. Nothing readable ever touches disk.
// - The vault is encrypted with a random AES-256-GCM "master key". That master key is itself
//   wrapped (encrypted) twice: under a key derived from the user's password and under a key
//   derived from a recovery key (both via PBKDF2 with their own random salts). The unwrapped
//   master key lives ONLY in memory for the duration of an unlocked session; it is never
//   persisted, and it is replaced with a fresh one whenever the password or recovery key is
//   reset.
// - Locking the vault just drops the in-memory key/decrypted array. There is nothing to
//   "re-encrypt" on lock because storage.local only ever holds ciphertext.

import browserApi from "./storage";

//#region ── Const Keys ──

const VAULT_CIPHERTEXT_KEY = "wisp_vault_ciphertext";
const VAULT_IV_KEY = "wisp_vault_iv";
const SALT_STORAGE_KEY = "wisp_private_salt";

// Legacy keys. These belonged to the retired SHA-256 password verifier, which was a
// cheap-to-brute-force password-equivalent sitting on disk next to the real wrapped-key
// material. We no longer write them, and we delete them on the next successful unlock.
// They are kept as constants so the cleanup code has something to reference. Backups made
// by older versions may still contain them; restoreEncryptedBackup ignores them (only the
// whitelisted vault keys in BACKUP_STORAGE_KEYS are ever written back).
const LEGACY_PASSWORD_STORAGE_KEY = "wisp_private_password";
const LEGACY_PASSWORD_SALT_STORAGE_KEY = "wisp_private_password_salt";

const PBKDF2_ITERATIONS = 300_000;
const AUTO_LOCK_ALARM_NAME = "wisp-vault-auto-lock";
const AUTO_LOCK_MINUTES = 5;

// Recovery key wrapping
const WRAPPED_KEY_PASSWORD_KEY = "wisp_vault_wrapped_key_password";
const WRAPPED_KEY_PASSWORD_IV_KEY = "wisp_vault_wrapped_key_password_iv";
const WRAPPED_KEY_RECOVERY_KEY = "wisp_vault_wrapped_key_recovery";
const WRAPPED_KEY_RECOVERY_IV_KEY = "wisp_vault_wrapped_key_recovery_iv";
const RECOVERY_SALT_STORAGE_KEY = "wisp_recovery_salt";

// Honeypot (plaintext decoy bookmarks, shown while locked — NOT a security boundary)
const HONEYPOT_STORAGE_KEY = "wisp_honeypot_bookmarks";

// Backup envelope version — bump if the shape of the exported JSON ever changes.
// Adding an OPTIONAL field (like `hint`) is backwards-compatible and does NOT require a bump.
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_FORMAT_TAG = "wisp-vault-backup";

// Export-side cap on the hint length. Enforced against the RAW string length (not the
// trimmed length) so a 200-space hint still fails. See exportEncryptedBackup below.
const HINT_MAX_LENGTH = 200;

const BACKUP_STORAGE_KEYS = [
  VAULT_CIPHERTEXT_KEY,
  VAULT_IV_KEY,
  SALT_STORAGE_KEY,
  WRAPPED_KEY_PASSWORD_KEY,
  WRAPPED_KEY_PASSWORD_IV_KEY,
  WRAPPED_KEY_RECOVERY_KEY,
  WRAPPED_KEY_RECOVERY_IV_KEY,
  RECOVERY_SALT_STORAGE_KEY,
] as const;

//#endregion

export interface PrivateBookmark {
  id: string; // original bookmark id at time of hiding (browser may reuse/reassign on restore)
  url: string;
  title: string;
  domain: string;
  dateAdded?: number;
  hiddenAt: number;
}

//#region ─── Pending hide queue ──────
//
// When the vault is LOCKED, hiding a bookmark can't encrypt (no key in memory).
// Instead, we remove the bookmark from the browser tree and stash it in this
// plaintext queue. On the next unlock, the queue is migrated into the encrypted
// vault and the plaintext copy is deleted.
//
// The plaintext window is bounded by "how long until the user next unlocks."
// This is a deliberate tradeoff to make hiding instantaneous without prompting
// for the password on every click.

const PENDING_HIDES_KEY = "recall_pending_hides";

export interface PendingHide {
  id: string;
  url: string;
  title: string;
  domain: string;
  dateAdded?: number;
  hiddenAt: number;
}

async function loadPendingHides(): Promise<PendingHide[]> {
  const result = await browserApi.storage.local.get([PENDING_HIDES_KEY]);
  return result[PENDING_HIDES_KEY] || [];
}

async function savePendingHides(hides: PendingHide[]): Promise<void> {
  if (hides.length === 0) {
    await browserApi.storage.local.remove([PENDING_HIDES_KEY]);
  } else {
    await browserApi.storage.local.set({ [PENDING_HIDES_KEY]: hides });
  }
}
//#endregion

//#region ─── In-memory session state (Non persistent) ──────────

let sessionKey: CryptoKey | null = null;

export function isVaultUnlocked(): boolean {
  return sessionKey !== null;
}
//#endregion

//#region ─── Vault lock (serialises every read-modify-write on the vault) ──────────
//
// hideBookmarkToVault, restoreBookmarkFromVault, the password-reset flows, etc. all work as
// "read the vault -> change it -> write it back". Two of them running at once (two quick
// clicks, a hide during a password change, two open tabs) would each start from the same
// snapshot, and the later write would silently erase the earlier one's change. Because a hide
// removes the bookmark from the real tree afterwards, that erasure is permanent data loss.
//
// So these operations run one at a time under a Web Lock. Web Locks are shared by every page
// and worker of this extension, so this covers multiple tabs, not just one JS context. If the
// API is missing we fall back to an in-process promise chain.
//
// The lock is NOT re-entrant: code that runs under it must never call another function that
// also takes it (it would wait on itself forever). That's why each locked operation is split
// into an exported wrapper (takes the lock) and a private *Impl function (does the work and
// assumes the lock is already held). Impl functions read `sessionKey` themselves, after the
// lock is acquired, so an operation that waited behind a password change uses the NEW key.

const VAULT_LOCK_NAME = "wisp-vault";
let fallbackLockTail: Promise<unknown> = Promise.resolve();

function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function") {
    return navigator.locks.request(VAULT_LOCK_NAME, fn) as Promise<T>;
  }
  const run = fallbackLockTail.then(() => fn());
  fallbackLockTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
//#endregion

//#region ─── Encoding helpers ───────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

function encodeUtf8(s: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(s);
  const out = new Uint8Array(new ArrayBuffer(encoded.length));
  out.set(encoded);
  return out;
}
//#endregion

//#region ─── Vault initialized / stale-verifier cleanup ───────
//
// There is no longer a separate password-verification hash. The password is verified
// by attempting to unwrap the master key: if the unwrap succeeds, the password was
// correct. This removes an unauthenticated SHA-256 oracle that used to sit in
// storage.local and let an attacker filter password guesses at GPU speed before
// paying the PBKDF2 cost.

/**
 * Best-effort removal of the retired SHA-256 verifier keys. Called on every successful
 * unlock (password or recovery path). Failures are non-fatal — worst case the stale
 * keys linger until the next unlock.
 *
 * We do this HERE, and not on extension update, because deleting the verifier before
 * we know the new unwrap path works for this user would leave them with no fallback if
 * the wrapped blob ever turned out to be corrupt.
 */
async function removeLegacyPasswordVerifier(): Promise<void> {
  try {
    await browserApi.storage.local.remove([
      LEGACY_PASSWORD_STORAGE_KEY,
      LEGACY_PASSWORD_SALT_STORAGE_KEY,
    ]);
  } catch (error) {
    console.warn("Could not remove legacy password verifier keys:", error);
  }
}

/**
 * Has the vault been initialized at all? True if either a wrapped password key or a
 * vault ciphertext blob exists. This replaces the old hasPrivatePassword(), which
 * read the now-retired SHA-256 verifier key.
 *
 * A legacy vault (pre-recovery-support) has ciphertext but no wrapped key, so the
 * ciphertext check keeps it working until it's migrated by a password change.
 */
export async function hasPrivatePassword(): Promise<boolean> {
  try {
    const result = await browserApi.storage.local.get([
      WRAPPED_KEY_PASSWORD_KEY,
      VAULT_CIPHERTEXT_KEY,
    ]);
    return !!(result[WRAPPED_KEY_PASSWORD_KEY] || result[VAULT_CIPHERTEXT_KEY]);
  } catch (error) {
    console.error("Failed to check vault initialization:", error);
    return false;
  }
}

/**
 * Remove the retired SHA-256 verifier keys. Kept exported for API compatibility with
 * callers that used to call this to "clear the password". Does NOT touch the vault
 * itself — use the reset/restore paths for that.
 */
export async function clearPrivatePassword(): Promise<void> {
  await removeLegacyPasswordVerifier();
}

//#endregion

//#region ─── Key derivation (PBKDF2 -> AES-256-GCM key) ───────

async function getOrCreateEncryptionSalt(): Promise<string> {
  const result = await browserApi.storage.local.get([SALT_STORAGE_KEY]);
  if (result[SALT_STORAGE_KEY]) return result[SALT_STORAGE_KEY];
  const salt = bytesToBase64(randomBytes(32));
  await browserApi.storage.local.set({ [SALT_STORAGE_KEY]: salt });
  return salt;
}

async function deriveKey(password: string, saltB64: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
//#endregion

//#region ─── Master key wrapping (enables recovery-key access without a second vault copy) ──
//
// The vault is encrypted with one random "master key". It is replaced with a fresh one
// whenever the password or recovery key is reset (see rotateMasterKey below).
// That master key is itself encrypted ("wrapped") twice — once under a key derived from
// the user's password, once under a key derived from a separately-generated recovery key.
// Either one, unwrapped, yields the same master key. Losing the password but keeping the
// recovery key (or vice versa) still gets you in.

function generateRecoveryKey(): string {
  const bytes = randomBytes(20);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
  let raw = "";
  for (const b of bytes) raw += alphabet[b % alphabet.length];
  return raw.match(/.{1,5}/g)!.join("-"); // e.g. "XJ4R2-9KLMN-..."
}

async function wrapKey(masterKey: CryptoKey, wrappingKey: CryptoKey): Promise<{ wrapped: string; iv: string }> {
  const iv = randomBytes(12);
  const rawMasterKey = await crypto.subtle.exportKey("raw", masterKey);
  const wrappedBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawMasterKey);
  return { wrapped: bytesToBase64(new Uint8Array(wrappedBuffer)), iv: bytesToBase64(iv) };
}

async function unwrapKey(wrappedB64: string, ivB64: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const wrapped = base64ToBytes(wrappedB64);
  const iv = base64ToBytes(ivB64);
  const rawMasterKeyBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrappingKey, wrapped);
  return crypto.subtle.importKey("raw", rawMasterKeyBuffer, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

// Call this ONCE, when the user first sets a vault password.
// Returns the recovery key string — show it to the user exactly once; it cannot be
// retrieved again after this call. Warn to save it somewhere safe.
//
// NOTE: no separate password-verification hash is written. Correctness of the password
// is established by the unwrap in unlockVault.
export async function initializeVaultWithRecovery(password: string): Promise<string> {
  const passwordSalt = await getOrCreateEncryptionSalt();
  const passwordKey = await deriveKey(password, passwordSalt);

  const recoverySalt = bytesToBase64(randomBytes(32));
  const recoveryKeyString = generateRecoveryKey();
  const recoveryDerivedKey = await deriveKey(recoveryKeyString, recoverySalt);

  const masterKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);

  const wrappedForPassword = await wrapKey(masterKey, passwordKey);
  const wrappedForRecovery = await wrapKey(masterKey, recoveryDerivedKey);

  await browserApi.storage.local.set({
    [RECOVERY_SALT_STORAGE_KEY]: recoverySalt,
    [WRAPPED_KEY_PASSWORD_KEY]: wrappedForPassword.wrapped,
    [WRAPPED_KEY_PASSWORD_IV_KEY]: wrappedForPassword.iv,
    [WRAPPED_KEY_RECOVERY_KEY]: wrappedForRecovery.wrapped,
    [WRAPPED_KEY_RECOVERY_IV_KEY]: wrappedForRecovery.iv,
  });

  // If a previous (retired) verifier was left behind by an older install, drop it now.
  await removeLegacyPasswordVerifier();

  return recoveryKeyString;
}

async function unlockWithWrappingKey(wrappingKey: CryptoKey, which: "password" | "recovery"): Promise<CryptoKey> {
  const wrappedKeyKey = which === "password" ? WRAPPED_KEY_PASSWORD_KEY : WRAPPED_KEY_RECOVERY_KEY;
  const wrappedIvKey = which === "password" ? WRAPPED_KEY_PASSWORD_IV_KEY : WRAPPED_KEY_RECOVERY_IV_KEY;
  const result = await browserApi.storage.local.get([wrappedKeyKey, wrappedIvKey]);
  const wrapped = result[wrappedKeyKey];
  const iv = result[wrappedIvKey];
  if (!wrapped || !iv) throw new Error("Vault has not been initialized with a recovery key");
  return unwrapKey(wrapped, iv, wrappingKey);
}

/**
 * Does a wrapped master key blob exist for the given wrapping mode? Used to tell a
 * "wrong password" apart from a "legacy vault that has no wrapped blob yet".
 */
async function wrappedKeyExists(which: "password" | "recovery"): Promise<boolean> {
  const wrappedKeyKey = which === "password" ? WRAPPED_KEY_PASSWORD_KEY : WRAPPED_KEY_RECOVERY_KEY;
  const wrappedIvKey = which === "password" ? WRAPPED_KEY_PASSWORD_IV_KEY : WRAPPED_KEY_RECOVERY_IV_KEY;
  const result = await browserApi.storage.local.get([wrappedKeyKey, wrappedIvKey]);
  return !!(result[wrappedKeyKey] && result[wrappedIvKey]);
}

// Unlock using the recovery key string instead of the password.
export async function unlockVaultWithRecoveryKey(recoveryKeyString: string): Promise<PrivateBookmark[]> {
  const recoverySaltResult = await browserApi.storage.local.get([RECOVERY_SALT_STORAGE_KEY]);
  const recoverySalt = recoverySaltResult[RECOVERY_SALT_STORAGE_KEY];
  if (!recoverySalt) throw new Error("No recovery key has been set up for this vault");

  const recoveryDerivedKey = await deriveKey(recoveryKeyString.trim().toUpperCase(), recoverySalt);

  try {
    sessionKey = await unwrapKey(
      (await browserApi.storage.local.get([WRAPPED_KEY_RECOVERY_KEY]))[WRAPPED_KEY_RECOVERY_KEY],
      (await browserApi.storage.local.get([WRAPPED_KEY_RECOVERY_IV_KEY]))[WRAPPED_KEY_RECOVERY_IV_KEY],
      recoveryDerivedKey
    );
  } catch (error) {
    throw new Error("Incorrect recovery key");
  }

  // Authenticated: clean up the retired SHA-256 verifier keys if they're still around.
  await removeLegacyPasswordVerifier();

  scheduleAutoLock();
  return decryptVaultData(sessionKey);
}
//#endregion

//#region ─── Vault encryption (AES-256-GCM, fresh IV every write) ──────────────────

async function encryptVaultData(data: PrivateBookmark[], key: CryptoKey): Promise<void> {
  const iv = randomBytes(12); // 96-bit IV, required size for AES-GCM, must be unique per encrypt
  const plaintext = encodeUtf8(JSON.stringify(data));
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  await browserApi.storage.local.set({
    [VAULT_CIPHERTEXT_KEY]: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    [VAULT_IV_KEY]: bytesToBase64(iv),
  });
}

async function decryptVaultData(key: CryptoKey): Promise<PrivateBookmark[]> {
  const result = await browserApi.storage.local.get([VAULT_CIPHERTEXT_KEY, VAULT_IV_KEY]);
  const ciphertextB64 = result[VAULT_CIPHERTEXT_KEY];
  const ivB64 = result[VAULT_IV_KEY];
  if (!ciphertextB64 || !ivB64) return []; // empty vault

  const ciphertext = base64ToBytes(ciphertextB64);
  const iv = base64ToBytes(ivB64);
  try {
    const plaintextBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintextBuffer));
  } catch (error) {
    // AES-GCM throws on ANY tampering or wrong key — this is the integrity check working,
    // not a bug.
    console.error("Vault decryption failed (wrong key or corrupted/tampered data):", error);
    throw new Error("Failed to decrypt vault");
  }
}
//#endregion

//#region ─── Session lifecycle ───────────

/**
 * Unlock the vault with a password.
 *
 * There is no separate password-verification hash anymore. The password is correct
 * iff it can unwrap the master key — that unwrap is authenticated by AES-GCM, so a
 * wrong password makes it throw, which is our "incorrect password" signal.
 *
 * Legacy vaults (created before recovery-key support existed) have no wrapped blob at
 * all; their password-derived key WAS the master key. We detect that case by checking
 * whether a wrapped blob exists, rather than by interpreting an unwrap failure — so a
 * genuinely wrong password on a modern vault doesn't silently get treated as a legacy
 * vault and then fail later with a confusing decrypt error.
 */
export async function unlockVault(password: string): Promise<PrivateBookmark[]> {
  // A vault that was never set up has no wrapped key and no ciphertext, so there is nothing
  // to check the password against. Without this guard the legacy branch below would "unlock"
  // it with ANY password and silently create a recovery-less vault under that password.
  if (!(await hasPrivatePassword())) throw new Error("Vault is not set up");

  const salt = await getOrCreateEncryptionSalt();
  const passwordDerivedKey = await deriveKey(password, salt);

  if (await wrappedKeyExists("password")) {
    // Modern vault: unwrap is the only verification. If it throws, the password is wrong.
    try {
      sessionKey = await unlockWithWrappingKey(passwordDerivedKey, "password");
    } catch {
      sessionKey = null;
      throw new Error("Incorrect password");
    }
  } else {
    // Legacy vault: no wrapped blob, so the password-derived key IS the master key.
    // There is nothing to unwrap, so we verify by attempting a decrypt. Wrong password
    // ⇒ AES-GCM auth failure ⇒ "Incorrect password".
    sessionKey = passwordDerivedKey;
    try {
      await decryptVaultData(sessionKey);
    } catch {
      sessionKey = null;
      throw new Error("Incorrect password");
    }
  }

  // Authenticated: clean up the retired SHA-256 verifier keys if they're still around.
  await removeLegacyPasswordVerifier();

  scheduleAutoLock();

  try {
    return await decryptVaultData(sessionKey);
  } catch (error) {
    sessionKey = null; // don't hold a key that doesn't actually work
    throw error;
  }
}

export function lockVault(): void {
  sessionKey = null;
  clearAutoLockAlarm();
  // Nothing to write back — storage.local already only ever contained ciphertext.
}

function requireUnlocked(): CryptoKey {
  if (!sessionKey) throw new Error("Vault is locked");
  return sessionKey;
}
//#endregion

//#region ─── Auto-lock (chrome.alarms survives MV3 service-worker restarts; setTimeout does not) ───

function scheduleAutoLock(): void {
  browserApi.alarms
    .create(AUTO_LOCK_ALARM_NAME, { delayInMinutes: AUTO_LOCK_MINUTES })
    .catch((e) => console.warn("Could not schedule vault auto-lock:", e));
}

function clearAutoLockAlarm(): void {
  browserApi.alarms
    .clear(AUTO_LOCK_ALARM_NAME)
    .catch((e) => console.warn("Could not clear vault auto-lock alarm:", e));
}

// Call this once from your background/service-worker entry point:
//   import { registerAutoLockListener } from "./bookmarkVault"
//   registerAutoLockListener()
export function registerAutoLockListener(): void {
  browserApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_LOCK_ALARM_NAME) lockVault();
  });
}

// Call this on any user interaction with the unlocked vault UI to push the auto-lock
// timer back out, e.g. onClick handlers in your vault panel component.
export function touchVaultSession(): void {
  if (sessionKey) scheduleAutoLock();
}
//#endregion

//#region ─── Reading the vault (requires unlocked session) ──────────────────

export async function getDecryptedVault(): Promise<PrivateBookmark[]> {
  const key = requireUnlocked();
  return decryptVaultData(key);
}
//#endregion

//#region ─── Hiding a bookmark: add to encrypted vault, THEN remove from real tree ──────
//
// ORDER MATTERS. The ciphertext write happens BEFORE the bookmark is removed from the
// browser tree. If the encrypt step fails, the bookmark is still there and the user can
// retry — a failed hide never destroys data.
//
// The reverse order (remove, then encrypt) has a silent data-loss failure mode: if the
// encrypt write fails after the removal succeeds, the bookmark is gone from the tree and
// was never captured in the vault, and there is nothing left to recover from.
//
// The cost of this ordering is that a crash between the two steps can leave an entry
// present BOTH in the vault and in the browser tree (a duplicate). That's recoverable —
// the user can delete the tree copy, and the vault copy is intact. Duplicates are
// strictly better than losses.
//
// Note on re-hiding a partially-failed entry: the "already hidden" check is by `id`, so
// a bookmark that's in the vault but still in the tree will be skipped on a later hide
// attempt (the vault copy already exists). The user has to remove the tree copy manually.
// We accept that: the alternative — removing the tree copy unconditionally — would
// re-introduce the data-loss window this change exists to eliminate.

type HideableBookmark = { id: string; url: string; title: string; dateAdded?: number };

export function hideBookmarkToVault(bookmark: HideableBookmark): Promise<void> {
  return withVaultLock(() => hideBookmarkToVaultImpl(bookmark));
}

async function hideBookmarkToVaultImpl(bookmark: HideableBookmark): Promise<void> {
  const key = requireUnlocked();
  const vault = await decryptVaultData(key);

  if (vault.some((b) => b.id === bookmark.id)) return; // already hidden

  let domain = "";
  try {
    domain = new URL(bookmark.url).hostname.replace("www.", "");
  } catch {
    // leave domain empty for malformed urls
  }

  // 1. Commit to the encrypted vault FIRST.
  vault.push({ ...bookmark, domain, hiddenAt: Date.now() });
  await encryptVaultData(vault, key);

  // 2. Only now remove from the real tree. If this throws, the vault already holds a
  //    copy and the bookmark is still in the tree — a duplicate, not a loss.
  await browserApi.bookmarks.remove(bookmark.id);
}

export function hideBookmarksToVault(bookmarks: HideableBookmark[]): Promise<void> {
  return withVaultLock(() => hideBookmarksToVaultImpl(bookmarks));
}

async function hideBookmarksToVaultImpl(bookmarks: HideableBookmark[]): Promise<void> {
  const key = requireUnlocked();
  const vault = await decryptVaultData(key);
  const existingIds = new Set(vault.map((b) => b.id));

  // 1. Work out what actually needs adding, and stage it in memory.
  const toAdd: PrivateBookmark[] = [];
  for (const bookmark of bookmarks) {
    if (existingIds.has(bookmark.id)) continue;
    let domain = "";
    try {
      domain = new URL(bookmark.url).hostname.replace("www.", "");
    } catch {}
    toAdd.push({ ...bookmark, domain, hiddenAt: Date.now() });
  }

  if (toAdd.length === 0) return;

  // 2. Commit the whole batch to the encrypted vault FIRST, in a single write.
  await encryptVaultData([...vault, ...toAdd], key);

  // 3. Only now remove from the real tree. If a removal throws part-way, the vault
  //    already holds every entry we intended to hide; the ones not yet removed remain
  //    in the tree as duplicates. No bookmark can be lost.
  for (const bookmark of bookmarks) {
    if (existingIds.has(bookmark.id)) continue;
    await browserApi.bookmarks.remove(bookmark.id);
  }
}
//#endregion

//#region ─── Restoring a bookmark: recreate real node, remove from vault ───────────
//
// Note: the browser assigns a NEW id on recreation — the original id from before hiding
// is gone and Any code referencing bookmarks by id needs to re-fetch after restore.

export function restoreBookmarkFromVault(
  vaultEntryId: string,
  parentFolderId?: string
): Promise<void> {
  return withVaultLock(() => restoreBookmarkFromVaultImpl(vaultEntryId, parentFolderId));
}

async function restoreBookmarkFromVaultImpl(
  vaultEntryId: string,
  parentFolderId?: string
): Promise<void> {
  const key = requireUnlocked();
  const vault = await decryptVaultData(key);
  const entry = vault.find((b) => b.id === vaultEntryId);
  if (!entry) return;

  await browserApi.bookmarks.create({
    parentId: parentFolderId,
    title: entry.title,
    url: entry.url,
  });

  const remaining = vault.filter((b) => b.id !== vaultEntryId);
  await encryptVaultData(remaining, key);
}

export function removeFromVaultPermanently(vaultEntryId: string): Promise<void> {
  return withVaultLock(() => removeFromVaultPermanentlyImpl(vaultEntryId));
}

async function removeFromVaultPermanentlyImpl(vaultEntryId: string): Promise<void> {
  const key = requireUnlocked();
  const vault = await decryptVaultData(key);
  const remaining = vault.filter((b) => b.id !== vaultEntryId);
  await encryptVaultData(remaining, key);
}
//#endregion

//#region ─── Honeypot (decoy bookmarks shown while locked) ───────────
//
// These are NOT encrypted and NOT a security boundary — they're ordinary bookmarks the
// user deliberately picks to display when the vault is locked, so the vault UI shows
// "some normal-looking bookmarks" instead of an empty/suspicious-looking screen. Anyone
// who can read storage.local can read these in plaintext.

export interface HoneypotBookmark {
  title: string;
  url: string;
}

export async function setHoneypotBookmarks(bookmarks: HoneypotBookmark[]): Promise<void> {
  await browserApi.storage.local.set({ [HONEYPOT_STORAGE_KEY]: bookmarks });
}

export async function getHoneypotBookmarks(): Promise<HoneypotBookmark[]> {
  try {
    const result = await browserApi.storage.local.get([HONEYPOT_STORAGE_KEY]);
    return result[HONEYPOT_STORAGE_KEY] || [];
  } catch (error) {
    console.error("Failed to get honeypot bookmarks:", error);
    return [];
  }
}

export async function clearHoneypotBookmarks(): Promise<void> {
  await browserApi.storage.local.remove([HONEYPOT_STORAGE_KEY]);
}
//#endregion

//#region ─── Convenience (VaultCount check)──────────────

export async function getVaultCount(): Promise<number> {
  // Doesn't require unlock — just checks whether an encrypted blob exists and its rough
  // size is not derivable without decrypting, so this only tells you "vault has data or not"
  // unless already unlocked, in which case it gives the real count.
  if (sessionKey) {
    const vault = await decryptVaultData(sessionKey);
    return vault.length;
  }
  const result = await browserApi.storage.local.get([VAULT_CIPHERTEXT_KEY]);
  return result[VAULT_CIPHERTEXT_KEY] ? -1 : 0; // -1 = "vault has entries, count unknown while locked"
}
//#endregion

// ─── Backup & restore ──────────────────────────────────────────────────────
//
// Two export modes:
//
//   1. "encrypted" — a JSON envelope containing every storage key needed to
//      reconstruct the vault on another machine/install. Contains ONLY
//      ciphertext, salts, and wrapped-key blobs. Safe to store on disk,
//      in cloud storage, in a git repo, whatever.
//
//   2. "plaintext" — the decrypted PrivateBookmark[] array as readable JSON.
//      Requires the vault to be unlocked. This is a deliberate escape hatch;
//      it defeats the entire point of the vault if it leaks. Callers should
//      warn the user loudly.
//
// Restoring from an encrypted backup replaces the current vault storage
// wholesale. Restoring from a plaintext backup re-encrypts the entries under
// the CURRENT session key (so it only works while unlocked) and appends.
//
// The optional `hint` field on both envelope types is a NON-SECRET reminder the
// user types at export time. It is stored in plain text — anyone who opens the
// backup file can read it. Its purpose is to jog the user's memory if they've
// forgotten the vault password for that specific backup. It must never be the
// password itself, or a trivially-reversible transformation of it.

export type BackupMode = "encrypted" | "plaintext";

export interface EncryptedBackupEnvelope {
  format: typeof BACKUP_FORMAT_TAG;
  version: number;
  exportedAt: number;
  /**
   * Optional, non-secret reminder for the user. Plain text. May contain leading
   * or trailing whitespace — we preserve the raw string, only using
   * `hint.trim().length > 0` to decide whether to write the field at all.
   * Omitted entirely when empty/whitespace-only.
   */
  hint?: string;
  data: Record<string, unknown>;
}

export interface PlaintextBackupEnvelope {
  format: typeof BACKUP_FORMAT_TAG;
  version: number;
  exportedAt: number;
  mode: "plaintext";
  /** Optional, non-secret reminder. Same rules as EncryptedBackupEnvelope.hint. */
  hint?: string;
  bookmarks: PrivateBookmark[];
}

//#region Export vaultBackup (encrypted or plain)
/**
 * Build the encrypted-backup envelope object.
 * Does NOT require the vault to be unlocked — the storage already only ever
 * holds ciphertext, so this is just a copy of the relevant storage keys.
 *
 * `hint` is optional. If provided (and non-empty after a whitespace-only check),
 * it is embedded in the envelope verbatim — whitespace preserved. It is capped
 * at HINT_MAX_LENGTH characters on the RAW string, so a 200-space hint still
 * fails. An over-length hint throws rather than being silently truncated: the
 * user should know their reminder got cut.
 */
export async function exportEncryptedBackup(hint?: string): Promise<EncryptedBackupEnvelope> {
  if (hint !== undefined && hint.length > HINT_MAX_LENGTH) {
    throw new Error(`Hint is too long — keep it to a short reminder (${HINT_MAX_LENGTH} chars max)`);
  }
  // Whitespace-only is treated as "no hint" so we don't write a visually-blank
  // field into the file. The stored value is the ORIGINAL string, not the trimmed one.
  const hasHint = hint !== undefined && hint.trim().length > 0;

  const result = await browserApi.storage.local.get(BACKUP_STORAGE_KEYS as unknown as string[]);
  const data: Record<string, unknown> = {};
  for (const key of BACKUP_STORAGE_KEYS) {
    if (result[key] !== undefined) data[key] = result[key];
  }
  if (!data[VAULT_CIPHERTEXT_KEY] && !data[WRAPPED_KEY_PASSWORD_KEY]) {
    throw new Error("Nothing to back up — vault is empty and uninitialised");
  }
  return {
    format: BACKUP_FORMAT_TAG,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    ...(hasHint ? { hint } : {}),
    data,
  };
}

/**
 * Build the plaintext-backup envelope. Requires an unlocked session.
 * `hint` follows the same rules as exportEncryptedBackup.
 */
export async function exportPlaintextBackup(hint?: string): Promise<PlaintextBackupEnvelope> {
  if (hint !== undefined && hint.length > HINT_MAX_LENGTH) {
    throw new Error(`Hint is too long — keep it to a short reminder (${HINT_MAX_LENGTH} chars max)`);
  }
  const hasHint = hint !== undefined && hint.trim().length > 0;

  const bookmarks = await getDecryptedVault();
  return {
    format: BACKUP_FORMAT_TAG,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: Date.now(),
    mode: "plaintext",
    ...(hasHint ? { hint } : {}),
    bookmarks,
  };
}
//#endregion

//#region Restore vault from (encrypted or plain backup file)
/**
 * Proof that the user can open the backup they're restoring: either the password the vault
 * had when the backup was made, or its recovery key.
 */
export type BackupCredential = { password: string } | { recoveryKey: string };

type BackupStorageKey = (typeof BACKUP_STORAGE_KEYS)[number];
type BackupData = Partial<Record<BackupStorageKey, string>>;

// Every value in a backup is base64. Only the ciphertext grows (with the number of
// bookmarks); salts, IVs and wrapped keys are tiny.
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BACKUP_CIPHERTEXT_CHARS = 32 * 1024 * 1024;
const MAX_BACKUP_SMALL_VALUE_CHARS = 512;

/**
 * Copy ONLY the known vault keys out of an untrusted backup file, checking each value.
 * Anything else the file contains (settings, honeypot, pending hides, any other
 * storage.local key) is ignored, so a crafted "backup" can't overwrite unrelated storage.
 * An empty string counts as absent (see restoreEncryptedBackup).
 */
function sanitizeBackupData(raw: Record<string, unknown>): BackupData {
  const clean: BackupData = {};
  for (const key of BACKUP_STORAGE_KEYS) {
    const value = raw[key];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string") {
      throw new Error(`Backup is invalid: "${key}" is not a string`);
    }
    const limit = key === VAULT_CIPHERTEXT_KEY ? MAX_BACKUP_CIPHERTEXT_CHARS : MAX_BACKUP_SMALL_VALUE_CHARS;
    if (value.length > limit) {
      throw new Error(`Backup is invalid: "${key}" is too large`);
    }
    if (!BASE64_PATTERN.test(value)) {
      throw new Error(`Backup is invalid: "${key}" is not valid base64`);
    }
    clean[key] = value;
  }
  if (!clean[VAULT_CIPHERTEXT_KEY] && !clean[WRAPPED_KEY_PASSWORD_KEY]) {
    throw new Error("Backup contains no vault data");
  }
  return clean;
}

/**
 * Check that `credential` really opens the backup, using ONLY the backup's own data.
 * Nothing is read from or written to storage. Throws a specific error if it doesn't.
 */
async function assertBackupOpensWith(data: BackupData, credential: BackupCredential): Promise<void> {
  let masterKey: CryptoKey;
  // Legacy vault (made before recovery keys existed): the password-derived key IS the
  // master key, and there is no wrapped blob to unwrap.
  let isLegacy = false;

  if ("recoveryKey" in credential) {
    const salt = data[RECOVERY_SALT_STORAGE_KEY];
    const wrapped = data[WRAPPED_KEY_RECOVERY_KEY];
    const wrappedIv = data[WRAPPED_KEY_RECOVERY_IV_KEY];
    if (!salt || !wrapped || !wrappedIv) throw new Error("This backup has no recovery key set up");
    const wrappingKey = await deriveKey(credential.recoveryKey.trim().toUpperCase(), salt);
    try {
      masterKey = await unwrapKey(wrapped, wrappedIv, wrappingKey);
    } catch {
      throw new Error("Incorrect recovery key for this backup");
    }
  } else {
    const salt = data[SALT_STORAGE_KEY];
    if (!salt) throw new Error("This backup is missing its password salt");
    const wrappingKey = await deriveKey(credential.password, salt);
    const wrapped = data[WRAPPED_KEY_PASSWORD_KEY];
    const wrappedIv = data[WRAPPED_KEY_PASSWORD_IV_KEY];
    if (wrapped && wrappedIv) {
      try {
        masterKey = await unwrapKey(wrapped, wrappedIv, wrappingKey);
      } catch {
        throw new Error("Incorrect password for this backup");
      }
    } else {
      isLegacy = true;
      masterKey = wrappingKey;
    }
  }

  // If the backup has vault data, the unwrapped key must actually decrypt it. (A modern
  // backup of a vault that has never had a bookmark hidden has no ciphertext; the successful
  // unwrap above is the proof there.)
  const vaultCiphertext = data[VAULT_CIPHERTEXT_KEY];
  const vaultIv = data[VAULT_IV_KEY];
  if (vaultCiphertext || vaultIv) {
    if (!vaultCiphertext || !vaultIv) throw new Error("Backup is corrupted: vault data is incomplete");
    try {
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(vaultIv) },
        masterKey,
        base64ToBytes(vaultCiphertext)
      );
    } catch {
      throw new Error(
        isLegacy
          ? "Incorrect password for this backup"
          : "Backup is corrupted: the vault data could not be decrypted"
      );
    }
  }
}

/**
 * Restore from an encrypted-backup envelope, replacing the current vault wholesale.
 *
 * `credential` (the backup's password, or its recovery key) is REQUIRED. It is checked
 * against the backup's own wrapped key and ciphertext BEFORE anything in storage is touched,
 * so a backup that can't be opened (forgotten password, corrupted file) can never replace a
 * working vault. Without this check, restoring a backup whose password was forgotten would
 * permanently lock the user out of both vaults.
 *
 * Only the keys in BACKUP_STORAGE_KEYS are ever read from the file, each value is checked
 * (string, base64, bounded size), and all of them are written in ONE storage.local.set. A
 * vault key the backup doesn't have is written as an empty string, which every reader in
 * this file treats as "absent". So there is no moment where old and new vault keys are
 * mixed, and no window where the old vault has been removed but the new one isn't written
 * yet. The empty placeholders are then removed on a best-effort basis.
 *
 * The in-memory session is invalidated afterwards (the master key has almost certainly
 * changed), so the user must unlock again. Any `hint` in the envelope is the caller's
 * responsibility; PrivateView persists it to storage.local separately so it can be shown on
 * the locked screen. The retired SHA-256 verifier keys are never restored, even from an
 * older backup that contains them.
 */
export async function restoreEncryptedBackup(
  envelope: unknown,
  credential: BackupCredential
): Promise<void> {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error("Not a valid encrypted vault backup file");
  }
  if (envelope.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup was created by a newer version of the extension (v${envelope.version})`
    );
  }

  // 1. Whitelist + validate, then prove the credential opens THIS backup. Nothing here
  //    touches storage, so a failure leaves the current vault exactly as it was.
  const clean = sanitizeBackupData(envelope.data);
  await assertBackupOpensWith(clean, credential);

  // 2. Swap the vault in, under the vault lock.
  await withVaultLock(async () => {
    const next: Record<string, string> = {};
    for (const key of BACKUP_STORAGE_KEYS) next[key] = clean[key] ?? "";

    await browserApi.storage.local.set(next);

    // The in-memory key belongs to the vault we just replaced.
    sessionKey = null;
    clearAutoLockAlarm();

    // Best-effort tidy: drop the empty placeholders, and any retired verifier keys an older
    // install left behind. Failure here is harmless (placeholders read as absent).
    const placeholders = BACKUP_STORAGE_KEYS.filter((key) => !clean[key]);
    try {
      await browserApi.storage.local.remove([
        ...placeholders,
        LEGACY_PASSWORD_STORAGE_KEY,
        LEGACY_PASSWORD_SALT_STORAGE_KEY,
      ]);
    } catch (error) {
      console.warn("Could not remove empty placeholder keys after restore:", error);
    }
  });
}

/**
 * Restore from a plaintext-backup envelope by re-encrypting under the CURRENT
 * session key. Requires the vault to be unlocked.
 *
 * By default this APPENDS to the existing vault (de-duplicating by URL, since
 * restored entries get new ids). Pass `replace: true` to wipe the vault first.
 */
export function restorePlaintextBackup(
  envelope: unknown,
  opts: { replace?: boolean } = {}
): Promise<{ added: number; skipped: number }> {
  return withVaultLock(() => restorePlaintextBackupImpl(envelope, opts));
}

async function restorePlaintextBackupImpl(
  envelope: unknown,
  opts: { replace?: boolean }
): Promise<{ added: number; skipped: number }> {
  const key = requireUnlocked();

  if (!isPlaintextBackupEnvelope(envelope)) {
    throw new Error("Not a valid plaintext vault backup file");
  }

  const existing = opts.replace ? [] : await decryptVaultData(key);
  const existingUrls = new Set(existing.map((b) => b.url));

  let added = 0;
  let skipped = 0;
  const now = Date.now();
  const merged = [...existing];

  for (const entry of envelope.bookmarks) {
    if (!entry || typeof entry.url !== "string") { skipped++; continue; }
    if (existingUrls.has(entry.url)) { skipped++; continue; }

    let domain = entry.domain;
    if (!domain) {
      try { domain = new URL(entry.url).hostname.replace("www.", ""); }
      catch { domain = ""; }
    }

    merged.push({
      id: entry.id || `restored-${now}-${added}`,
      url: entry.url,
      title: entry.title || "",
      domain,
      dateAdded: entry.dateAdded,
      hiddenAt: entry.hiddenAt || now,
    });
    existingUrls.add(entry.url);
    added++;
  }

  await encryptVaultData(merged, key);
  return { added, skipped };
}
//#endregion

//#region ─── Envelope type guards ───────
//
// `hint` is validated when present: it must be a string. `undefined` and
// absence are both fine (backwards compatible). Anything else — a number, an
// object, null — makes the envelope invalid, so malformed backups don't reach
// UI code that assumes `info.hint` is `string | undefined`.

function isEncryptedBackupEnvelope(x: unknown): x is EncryptedBackupEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  if (e.hint !== undefined && typeof e.hint !== "string") return false;
  return (
    e.format === BACKUP_FORMAT_TAG &&
    typeof e.version === "number" &&
    typeof e.data === "object" &&
    e.data !== null
  );
}

function isPlaintextBackupEnvelope(x: unknown): x is PlaintextBackupEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  if (e.hint !== undefined && typeof e.hint !== "string") return false;
  return (
    e.format === BACKUP_FORMAT_TAG &&
    typeof e.version === "number" &&
    e.mode === "plaintext" &&
    Array.isArray(e.bookmarks)
  );
}

/**
 * Peek at a parsed backup file and report what it is, without applying it.
 * Useful for showing the user a confirmation before they commit to a restore.
 *
 * `hint` is surfaced when present so the caller can show it to the user before
 * they're asked for a password. It is only ever a string when `kind !== "unknown"`.
 */
export function describeBackup(x: unknown):
  | { kind: "encrypted"; exportedAt: number; version: number; hint?: string }
  | { kind: "plaintext"; exportedAt: number; version: number; count: number; hint?: string }
  | { kind: "unknown" } {
  if (isEncryptedBackupEnvelope(x)) {
    return {
      kind: "encrypted",
      exportedAt: x.exportedAt,
      version: x.version,
      hint: typeof x.hint === "string" ? x.hint : undefined,
    };
  }
  if (isPlaintextBackupEnvelope(x)) {
    return {
      kind: "plaintext",
      exportedAt: x.exportedAt,
      version: x.version,
      count: x.bookmarks.length,
      hint: typeof x.hint === "string" ? x.hint : undefined,
    };
  }
  return { kind: "unknown" };
}

/** Filename suggestion for downloads. */
export function suggestedBackupFilename(mode: BackupMode): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `wisp-vault-${mode === "encrypted" ? "encrypted" : "PLAINTEXT"}-${stamp}.json`;
}
//#endregion

//#region ─── Master key rotation ───────────────────────────
//
// Used by both password-reset flows. Decrypts the vault under the OLD master key,
// generates a brand-new master key, re-encrypts the vault under it, wraps the new
// master key under the new password + recovery keys, and writes EVERYTHING
// (ciphertext, IV, salts, wrapped-key blobs) in a single storage.local.set.
//
// The single write matters: if the ciphertext and the wrapped-key blobs were written
// in separate set() calls and a crash landed between them, the wrapped key would point
// at a master key that no longer matches the ciphertext, bricking the vault. Batching
// them removes that window.
//
// The caller must pass the OLD master key it already unwrapped. Decrypting under that
// key is the integrity check: if it's wrong, decryptVaultData throws AES-GCM's auth
// failure BEFORE any storage write happens.
//
// Returns the NEW master key so the caller can update sessionKey.
async function rotateMasterKey(
  oldMasterKey: CryptoKey,
  newPasswordSalt: string,
  newPasswordKey: CryptoKey,
  newRecoverySalt: string,
  newRecoveryDerivedKey: CryptoKey
): Promise<CryptoKey> {
  // 1. Read + decrypt the vault under the OLD key. Throws (and writes nothing) if wrong.
  const vault = await decryptVaultData(oldMasterKey);

  // 2. Brand-new master key.
  const newMasterKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  // 3. Re-encrypt the vault under the new key. Inlined (instead of calling
  //    encryptVaultData) so the ciphertext can ride in the same storage.local.set
  //    as the wrapped keys below.
  const iv = randomBytes(12);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    newMasterKey,
    encodeUtf8(JSON.stringify(vault))
  );

  // 4. Wrap the NEW master key under the new password key and the new recovery key.
  const wrappedForPassword = await wrapKey(newMasterKey, newPasswordKey);
  const wrappedForRecovery = await wrapKey(newMasterKey, newRecoveryDerivedKey);

  // 5. One atomic-ish write covering ciphertext + IV + both salts + both wrapped keys.
  await browserApi.storage.local.set({
    [VAULT_CIPHERTEXT_KEY]: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    [VAULT_IV_KEY]: bytesToBase64(iv),
    [SALT_STORAGE_KEY]: newPasswordSalt,
    [RECOVERY_SALT_STORAGE_KEY]: newRecoverySalt,
    [WRAPPED_KEY_PASSWORD_KEY]: wrappedForPassword.wrapped,
    [WRAPPED_KEY_PASSWORD_IV_KEY]: wrappedForPassword.iv,
    [WRAPPED_KEY_RECOVERY_KEY]: wrappedForRecovery.wrapped,
    [WRAPPED_KEY_RECOVERY_IV_KEY]: wrappedForRecovery.iv,
  });

  return newMasterKey;
}
//#endregion

//#region password change
// ─── Password change (rotates the master key, re-wraps under new password + new recovery key) ──

// Used by the "Change Password" settings panel when the user authenticates with their
// CURRENT password. Regenerates the recovery wrapping, so the previous recovery key is
// invalidated — there is only ever one valid recovery key at a time.
//
// The master key is ROTATED: a fresh random master key is generated, the vault is
// re-encrypted under it, and the old master key is discarded. This means anyone who
// somehow captured the old master key can no longer decrypt the vault.
//
// Password correctness is established by the unwrap below — there is no separate
// verification hash to check first.
//
// Returns the new recovery key string — show it to the user exactly once.
export function resetPasswordWithCurrentPassword(
  currentPassword: string,
  newPassword: string
): Promise<string> {
  return withVaultLock(() => resetPasswordWithCurrentPasswordImpl(currentPassword, newPassword));
}

async function resetPasswordWithCurrentPasswordImpl(
  currentPassword: string,
  newPassword: string
): Promise<string> {
  // Same guard as unlockVault: refuse to "change the password" of a vault that doesn't exist.
  if (!(await hasPrivatePassword())) throw new Error("Vault is not set up");
  // 1. Derive the CURRENT wrapping key and unwrap the old master key. A wrong password
  //    makes this throw (AES-GCM auth failure), which is our "incorrect password" signal.
  const salt = await getOrCreateEncryptionSalt();
  const currentDerivedKey = await deriveKey(currentPassword, salt);

  const hasWrapped = await wrappedKeyExists("password");

  let oldMasterKey: CryptoKey;
  if (hasWrapped) {
    try {
      oldMasterKey = await unlockWithWrappingKey(currentDerivedKey, "password");
    } catch {
      throw new Error("Incorrect current password");
    }
  } else {
    // Legacy vault: password-derived key WAS the master key. Verify by decrypting.
    oldMasterKey = currentDerivedKey;
    try {
      await decryptVaultData(oldMasterKey);
    } catch {
      throw new Error("Incorrect current password");
    }
  }

  // 2. New password salt + wrapping key.
  const newPasswordSalt = bytesToBase64(randomBytes(32));
  const newPasswordKey = await deriveKey(newPassword, newPasswordSalt);

  // 3. Brand-new recovery key + its wrapping key.
  const newRecoverySalt = bytesToBase64(randomBytes(32));
  const newRecoveryKeyString = generateRecoveryKey();
  const newRecoveryDerivedKey = await deriveKey(newRecoveryKeyString, newRecoverySalt);

  // 4. Rotate: new master key, vault re-encrypted under it, everything written in one set.
  //    Update the live session to the new master key so the current unlocked session
  //    keeps working without forcing the user to re-enter the new password.
  sessionKey = await rotateMasterKey(
    oldMasterKey,
    newPasswordSalt,
    newPasswordKey,
    newRecoverySalt,
    newRecoveryDerivedKey
  );

  // 5. Clean up the retired SHA-256 verifier if an older install left it behind. The
  //    rotation above has already re-encrypted everything; there's no verifier to write.
  await removeLegacyPasswordVerifier();

  // 6. Keep the freshly-rotated session on the auto-lock timer.
  scheduleAutoLock();

  return newRecoveryKeyString; // show once to the user
}

// Used when the user authenticates with their RECOVERY KEY (instead of the current password).
// Also rotates the master key and regenerates the recovery wrapping, so the previous
// recovery key is invalidated.
//
// Returns the new recovery key string — show it to the user exactly once.
export function resetPasswordWithRecoveryKey(
  recoveryKeyString: string,
  newPassword: string
): Promise<string> {
  return withVaultLock(() => resetPasswordWithRecoveryKeyImpl(recoveryKeyString, newPassword));
}

async function resetPasswordWithRecoveryKeyImpl(
  recoveryKeyString: string,
  newPassword: string
): Promise<string> {
  const recoverySaltResult = await browserApi.storage.local.get([RECOVERY_SALT_STORAGE_KEY]);
  const recoverySalt = recoverySaltResult[RECOVERY_SALT_STORAGE_KEY];
  if (!recoverySalt) throw new Error("No recovery key has been set up for this vault");

  const recoveryDerivedKey = await deriveKey(recoveryKeyString.trim().toUpperCase(), recoverySalt);

  let oldMasterKey: CryptoKey;
  try {
    oldMasterKey = await unlockWithWrappingKey(recoveryDerivedKey, "recovery");
  } catch {
    throw new Error("Incorrect recovery key");
  }

  const newPasswordSalt = bytesToBase64(randomBytes(32));
  const newPasswordKey = await deriveKey(newPassword, newPasswordSalt);

  // Rotate the recovery key too, so the old one is no longer valid.
  const newRecoverySalt = bytesToBase64(randomBytes(32));
  const newRecoveryKeyString = generateRecoveryKey();
  const newRecoveryDerivedKey = await deriveKey(newRecoveryKeyString, newRecoverySalt);

  sessionKey = await rotateMasterKey(
    oldMasterKey,
    newPasswordSalt,
    newPasswordKey,
    newRecoverySalt,
    newRecoveryDerivedKey
  );

  await removeLegacyPasswordVerifier();
  scheduleAutoLock();

  return newRecoveryKeyString;
}
//#endregion