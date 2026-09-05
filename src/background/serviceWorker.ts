import { performStoreOperation } from "./profileStore";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type !== "EAM_STORE") return;
  if (sender.id !== chrome.runtime.id) { sendResponse({ ok: false, error: "Invalid sender." }); return; }
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(""));
  if (!extensionPage && request.operation?.action !== "get") { sendResponse({ ok: false, error: "Open Manage profiles to change profile data." }); return; }
  performStoreOperation(request.operation).then((value) => sendResponse({ ok: true, value }),
    (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ eliApplyMateInstalledAt: new Date().toISOString() });
});
