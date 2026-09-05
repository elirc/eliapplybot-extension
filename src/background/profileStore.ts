import { blankProfile, isPlaceholder } from "../shared/profileDefaults";
import { validateProfileDetailed } from "../shared/profileSchema";
import type { CandidateProfile } from "../shared/types";
import { MAX_PROFILES, type ProfileStore, type ProfileVersion, type StoreOperation } from "../shared/storage";

let queue: Promise<unknown> = Promise.resolve();
export function performStoreOperation(operation: StoreOperation): Promise<unknown> {
  const next = queue.then(() => execute(operation));
  queue = next.catch(() => undefined);
  return next;
}
const recoveryError = "Saved profiles need repair. Your original data has been preserved. Export the recovery backup from Manage profiles before repairing it.";
function normalizeStore(value: unknown): ProfileStore {
  const store = value as ProfileStore;
  if (!store || store.version !== 2 || !Array.isArray(store.profiles) || !store.profiles.length || store.profiles.length > MAX_PROFILES ||
      typeof store.activeId !== "string" || new Set(store.profiles.map((p) => p?.id)).size !== store.profiles.length ||
      !store.profiles.some((p) => p?.id === store.activeId) ||
      !store.profiles.every((p) => p && typeof p.id === "string" && !!p.id.trim() && typeof p.name === "string" && validateProfileDetailed(p.profile, true).valid)) throw new Error(recoveryError);
  return { version: 2, activeId: store.activeId, profiles: store.profiles.map((p) => ({ ...p, configured: p.configured === true && validateProfileDetailed(p.profile).valid && !isPlaceholder(p.profile), revision: Number.isSafeInteger(p.revision) && p.revision >= 0 ? p.revision : 0 })) };
}
async function readStore(): Promise<ProfileStore> {
  const raw = await chrome.storage.local.get(["profileStore", "candidateProfile"]);
  if (raw.profileStore !== undefined) {
    return normalizeStore(raw.profileStore);
  }
  if (raw.candidateProfile !== undefined && !validateProfileDetailed(raw.candidateProfile, true).valid) throw new Error(recoveryError);
  const initial = makeVersion("Default", raw.candidateProfile ?? blankProfile);
  const store: ProfileStore = { version: 2, activeId: initial.id, profiles: [initial] };
  await chrome.storage.local.set({ profileStore: store });
  // Retain the legacy backup after migration.
  return store;
}
async function execute(op: StoreOperation): Promise<unknown> {
  if (!op || typeof op !== "object") throw new Error("Invalid storage request.");
  if (op.action === "raw") return chrome.storage.local.get(["profileStore", "candidateProfile", "profileRecoveryBackup"]);
  if (op.action === "restore") {
    const restored = normalizeStore(op.store);
    const ids = new Map(restored.profiles.map((p) => [p.id, crypto.randomUUID()]));
    restored.activeId = ids.get(restored.activeId)!;
    restored.profiles = restored.profiles.map((p) => ({ ...p, id: ids.get(p.id)!, configured: false, revision: 0, updatedAt: new Date().toISOString() }));
    const data = await chrome.storage.local.get(["profileStore", "candidateProfile"]);
    // If backup storage fails, the original store remains untouched.
    await chrome.storage.local.set({ profileRecoveryBackup: { savedAt: new Date().toISOString(), data } });
    await chrome.storage.local.set({ profileStore: restored });
    return;
  }
  const store = await readStore();
  if (op.action === "get") return store;
  const target = "id" in op ? store.profiles.find((p) => p.id === op.id) : undefined;
  if ("id" in op && !target) throw new Error("That profile version no longer exists.");
  let result: unknown;
  switch (op.action) {
    case "create":
    case "duplicate": {
      if (store.profiles.length >= MAX_PROFILES) throw new Error(`Limit of ${MAX_PROFILES} profile versions reached. Delete one first.`);
      const profile = op.action === "create" ? op.profile ?? blankProfile : target!.profile;
      validate(profile, true);
      const name = op.action === "create" ? op.name : `${target!.name} copy`;
      const version = makeVersion(uniqueName(store, name), profile);
      store.profiles.push(version); store.activeId = version.id; result = version; break;
    }
    case "activate": store.activeId = target!.id; break;
    case "rename": {
      if (typeof op.name !== "string" || !op.name.trim()) throw new Error("Profile name cannot be empty.");
      target!.name = uniqueName(store, op.name, target!.id); break;
    }
    case "delete": {
      if (store.profiles.length === 1) throw new Error("Cannot delete the last profile version. Create another one first.");
      store.profiles = store.profiles.filter((p) => p.id !== op.id);
      if (store.activeId === op.id) store.activeId = store.profiles[0].id;
      break;
    }
    case "update": {
      if (op.expectedRevision !== undefined && op.expectedRevision !== target!.revision) throw new Error("This profile changed in another window. Export your draft, then reload the version before saving.");
      validate(op.profile);
      if (op.confirmReady && isPlaceholder(op.profile)) throw new Error("Replace the sample contact details before enabling autofill.");
      target!.profile = structuredClone(op.profile);
      target!.configured = op.confirmReady === true && !isPlaceholder(op.profile);
      break;
    }
    case "reset": target!.profile = structuredClone(blankProfile); target!.configured = false; result = target!.profile; break;
    default: throw new Error("Unknown storage operation.");
  }
  if (target && op.action !== "delete") { target.revision += 1; target.updatedAt = new Date().toISOString(); }
  await chrome.storage.local.set({ profileStore: store });
  return result;
}
function validate(profile: unknown, draft = false): asserts profile is CandidateProfile {
  const result = validateProfileDetailed(profile, draft);
  if (!result.valid) throw new Error(result.errors.join("\n"));
}
function makeVersion(name: string, profile: CandidateProfile): ProfileVersion {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now, profile: structuredClone(profile), configured: false, revision: 0 };
}
function uniqueName(store: ProfileStore, desired: string, ignoreId?: string): string {
  const base = typeof desired === "string" ? desired.trim().slice(0, 100) || "Untitled" : "Untitled";
  const taken = new Set(store.profiles.filter((p) => p.id !== ignoreId).map((p) => p.name.toLowerCase()));
  let name = base; let index = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${index++}`;
  return name;
}
