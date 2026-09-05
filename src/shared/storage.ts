import type { CandidateProfile } from "./types";
export const MAX_PROFILES = 20;
export type ProfileVersion = {
  id: string; name: string; createdAt: string; updatedAt: string;
  profile: CandidateProfile; configured: boolean; revision: number;
};
export type ProfileStore = { version: 2; activeId: string; profiles: ProfileVersion[] };
export type ProfileSummary = Pick<ProfileVersion, "id" | "name" | "updatedAt" | "configured" | "revision"> & { active: boolean };
export type StoreOperation =
  | { action: "get" | "raw" }
  | { action: "restore"; store: unknown }
  | { action: "activate" | "duplicate" | "delete" | "reset"; id: string }
  | { action: "create"; name: string; profile?: CandidateProfile }
  | { action: "rename"; id: string; name: string }
  | { action: "update"; id: string; profile: CandidateProfile; expectedRevision?: number; confirmReady?: boolean };

// First-run migration and all mutations are serialized in the service worker.
async function request<T>(operation: StoreOperation): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: "EAM_STORE", operation });
  if (!response?.ok) throw new Error(response?.error ?? "Profile storage is unavailable. Reload the extension and try again.");
  return response.value as T;
}
export const getStore = () => request<ProfileStore>({ action: "get" });
export const exportRawStore = () => request<unknown>({ action: "raw" });
export const restoreProfileStore = (store: unknown) => request<void>({ action: "restore", store });
export async function getActiveVersion(): Promise<ProfileVersion> {
  const store = await getStore();
  return store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0];
}
export async function getActiveProfile(): Promise<CandidateProfile> { return (await getActiveVersion()).profile; }
export async function getActiveProfileName(): Promise<string> { return (await getActiveVersion()).name; }
export async function listProfiles(): Promise<ProfileSummary[]> {
  const store = await getStore();
  return store.profiles.map(({ id, name, updatedAt, configured, revision }) => ({ id, name, updatedAt, configured, revision, active: id === store.activeId }));
}
export async function getProfileVersion(id: string): Promise<ProfileVersion | null> { return (await getStore()).profiles.find((p) => p.id === id) ?? null; }
export const setActiveProfile = (id: string) => request<void>({ action: "activate", id });
export const createProfile = (name: string, profile?: CandidateProfile) => request<ProfileVersion>({ action: "create", name, profile });
export const duplicateProfile = (id: string) => request<ProfileVersion>({ action: "duplicate", id });
export const renameProfile = (id: string, name: string) => request<void>({ action: "rename", id, name });
export const deleteProfile = (id: string) => request<void>({ action: "delete", id });
export const resetProfile = (id: string) => request<CandidateProfile>({ action: "reset", id });
export const updateProfile = (id: string, profile: CandidateProfile, expectedRevision?: number, confirmReady?: boolean) =>
  request<void>({ action: "update", id, profile, expectedRevision, confirmReady });
