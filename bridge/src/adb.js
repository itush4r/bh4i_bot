const { execFile } = require("child_process");

/**
 * Run an ADB shell command and return stdout.
 * @param {string} cmd - shell command to run on device
 * @returns {Promise<string>}
 */
function adbShell(cmd) {
  return new Promise((resolve, reject) => {
    execFile("adb", ["shell", cmd], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

/**
 * Run a raw ADB command (not shell).
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function adbRaw(args) {
  return new Promise((resolve, reject) => {
    execFile("adb", args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

module.exports = { adbShell, adbRaw };
