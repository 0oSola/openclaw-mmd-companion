const pw = require("playwright");
console.log("executablePath:", pw.chromium.executablePath());
console.log("version:", require("playwright/package.json").version);
