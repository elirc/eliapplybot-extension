import { readFile, stat, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const checks = [];
function check(name, success, detail) {
  checks.push({ name, success, ...(detail === undefined ? {} : { detail }) });
  if (!success) throw new Error(`Package check failed: ${name}`);
}
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(resolve(root, "package-lock.json"), "utf8"));
check("Manifest, package and lockfile versions agree", manifest.manifest_version === 3 && manifest.version === pkg.version && lock.version === pkg.version && lock.packages[""].version === pkg.version);
check("Only on-demand page access is required", JSON.stringify(manifest.permissions) === JSON.stringify(["activeTab", "storage", "scripting"]) && !manifest.host_permissions && !manifest.content_scripts && !manifest.externally_connectable);
check("Tab audio permission is optional", JSON.stringify(manifest.optional_permissions) === JSON.stringify(["tabCapture"]));
const pages = [manifest.action.default_popup, manifest.options_page, "recorder.html"];
for (const entry of [...pages, manifest.background.service_worker, "contentScript.js"]) check(`Packaged entry exists: ${entry}`, (await stat(resolve(dist, entry))).size > 0);
for (const [size, path] of Object.entries(manifest.icons)) {
  const png = await readFile(resolve(dist, path));
  check(`Icon ${size} has the correct PNG dimensions`, png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) === Number(size) && png.readUInt32BE(20) === Number(size));
}
for (const page of pages) {
  const html = await readFile(resolve(dist, page), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) check(`Local built resource: ${page} → ${match[1]}`, !/^https?:/.test(match[1]) && (await stat(resolve(dist, match[1].replace(/^\//, "")))).size > 0);
  check(`No inline executable script: ${page}`, !/<script(?![^>]*src=)[^>]*>\s*\S/.test(html));
}
new vm.Script(await readFile(resolve(dist, "contentScript.js"), "utf8"));
check("Content bundle parses as an injected classic script", true);

let onInstalled, onMessage;
const storage = {};
vm.runInNewContext(await readFile(resolve(dist, "serviceWorker.js"), "utf8"), {
  crypto: webcrypto, structuredClone, URL,
  chrome: {
    runtime: { id: "package-test", getURL: (path) => `chrome-extension://package-test/${path}`, onInstalled: { addListener(fn) { onInstalled = fn; } }, onMessage: { addListener(fn) { onMessage = fn; } } },
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, structuredClone(storage[key])])); },
      async set(value) { Object.assign(storage, structuredClone(value)); }
    } }
  }
});
onInstalled();
check("Packaged service worker handles installation", typeof storage.eliApplyMateInstalledAt === "string");
function message(operation, sender) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error("Worker message timed out")), 5000);
    try { onMessage({ type: "EAM_STORE", operation }, sender, (value) => { clearTimeout(timer); resolveMessage(value); }); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
}
const pageSender = { id: "package-test", url: "https://example.org/application" };
const extensionSender = { id: "package-test", url: "chrome-extension://package-test/options.html" };
check("Worker rejects other extension senders", (await message({ action: "get" }, { id: "other", url: extensionSender.url })).ok === false);
check("Content scripts cannot mutate profiles", (await message({ action: "create", name: "Denied" }, pageSender)).ok === false);
check("Content scripts cannot export recovery data", (await message({ action: "raw" }, pageSender)).ok === false);
const first = await message({ action: "get" }, pageSender);
check("Worker initializes an unconfigured blank profile", first.ok && !first.value.profiles[0].configured && first.value.profiles[0].profile.personal.email === "");
const created = await message({ action: "create", name: "Package smoke test" }, extensionSender);
check("Extension page profile mutation succeeds", created.ok && created.value.name === "Package smoke test" && storage.profileStore.profiles.length === 2);
const files = await readdir(resolve(dist, "assets"));
check("All three UI bundles produced", ["popup", "options", "recorder"].every((name) => files.some((file) => file.startsWith(`${name}-`) && file.endsWith(".js"))));

// This verifies HTTP delivery of production assets. It is not a browser test.
const server = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "5187", "--strictPort"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
try {
  await new Promise((done, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Preview startup timed out: ${output}`)), 30000);
    const fail = (error) => { clearTimeout(timeout); reject(error); };
    server.stdout.on("data", (chunk) => { output += String(chunk); if (output.includes("127.0.0.1:5187")) { clearTimeout(timeout); done(); } });
    server.stderr.on("data", (chunk) => { output += String(chunk); });
    server.once("error", fail); server.once("exit", (code) => fail(new Error(`Preview exited ${code}: ${output}`)));
  });
  for (const page of pages) {
    const response = await fetch(`http://127.0.0.1:5187/${page}`);
    check(`Production page served over HTTP: ${page}`, response.ok && (await response.text()).includes('<div id="root">'));
  }
  const response = await fetch("http://127.0.0.1:5187/contentScript.js");
  check("Content script served as JavaScript", response.ok && /javascript/.test(response.headers.get("content-type")));
} finally { server.kill(); }
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);
if (reportPath) await writeFile(resolve(root, reportPath), JSON.stringify({ version: pkg.version, checks }, null, 2) + "\n");
console.log(`${checks.length} production package / HTTP checks passed.`);
