import { readFile, stat, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const checks = [];
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
function check(name, success, detail) {
  checks.push({ name, success, detail });
  if (!success) throw new Error(name);
}
check("Manifest version and permissions", manifest.manifest_version === 3 && manifest.version === packageJson.version && JSON.stringify(manifest.permissions) === JSON.stringify(["activeTab", "storage", "scripting"]), manifest);
for (const entry of [manifest.action.default_popup, manifest.options_page, manifest.background.service_worker, "contentScript.js"]) {
  check(`Packaged entry exists: ${entry}`, (await stat(resolve("dist", entry))).size > 0);
}
for (const page of ["popup.html", "options.html"]) {
  const html = await readFile(resolve("dist", page), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    check(`Local built resource: ${match[1]}`, !/^https?:/.test(match[1]) && (await stat(resolve("dist", match[1].replace(/^\//, "")))).size > 0);
  }
  check(`No inline executable script: ${page}`, !/<script(?![^>]*src=)[^>]*>\s*\S/.test(html));
}
new vm.Script(await readFile("dist/contentScript.js", "utf8"));
check("Content bundle parses as an injected classic script", true);
let onInstalled;
let installedMetadata;
vm.runInNewContext(await readFile("dist/serviceWorker.js", "utf8"), {
  chrome: {
    runtime: { onInstalled: { addListener(fn) { onInstalled = fn; } } },
    storage: { local: { set(value) { installedMetadata = value; } } }
  }
});
onInstalled();
check("Packaged service worker registers and handles installation", typeof installedMetadata.eliApplyMateInstalledAt === "string");
const files = await readdir("dist/assets");
check("Popup and options bundles produced", files.some((f) => /^popup-.+\.js$/.test(f)) && files.some((f) => /^options-.+\.js$/.test(f)));

// Local HTTP smoke test, not a browser or installed-extension test.
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "test-pages", "--host", "127.0.0.1", "--port", "5187", "--strictPort"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
try {
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error("Local fixture server startup timed out")), 30000);
    const finish = () => { clearTimeout(timeout); done(); };
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("127.0.0.1:5187")) finish(); });
    server.once("error", reject);
    server.once("exit", (code) => reject(new Error(`Fixture server exited: ${code}`)));
  });
  const response = await fetch("http://127.0.0.1:5187/fake-application.html");
  const html = await response.text();
  check("Local test page serves successfully over HTTP", response.ok && html.includes("Fake Product Engineer Application"), { status: response.status });
} finally {
  server.kill();
}
await writeFile("docs/app-review-2026-09-04/artifact-checks.json", JSON.stringify({ checks }, null, 2));
console.log(`${checks.length} artifact / HTTP checks passed.`);
