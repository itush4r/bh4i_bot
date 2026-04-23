const { adbShell } = require("./adb");

/**
 * List all installed user apps with package name and display label.
 * Returns [{ package, name }]
 */
async function getInstalledApps() {
  // Get list of third-party packages
  const raw = await adbShell("pm list packages -3");
  const packages = raw
    .split("\n")
    .map((l) => l.replace("package:", "").trim())
    .filter(Boolean);

  const apps = [];

  for (const pkg of packages) {
    try {
      // Attempt to get the app label via dumpsys
      const info = await adbShell(
        `dumpsys package ${pkg} | grep -i "versionName" | head -1`
      );
      // For label, use the aapt approach or fall back to package name
      let name = pkg;
      try {
        const label = await adbShell(
          `cmd package resolve-activity --brief ${pkg} | tail -1`
        );
        if (label && !label.includes("No activity")) {
          name = label.split("/").pop() || pkg;
        }
      } catch {
        // label lookup failed, keep package name
      }
      apps.push({ package: pkg, name });
    } catch {
      apps.push({ package: pkg, name: pkg });
    }
  }

  return apps;
}

/**
 * Get a simpler, faster app list (package names only, with best-effort labels).
 */
async function getAppListFast() {
  const raw = await adbShell("pm list packages -3");
  return raw
    .split("\n")
    .map((l) => l.replace("package:", "").trim())
    .filter(Boolean)
    .map((pkg) => ({
      package: pkg,
      name: pkg.split(".").pop() || pkg,
    }));
}

module.exports = { getInstalledApps, getAppListFast };
