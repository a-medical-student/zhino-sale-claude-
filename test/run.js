'use strict';
// npm test                      server + browser tests (browser tests are skipped if playwright is missing)
// node test/run.js --server     server tests only
// node test/run.js --browser    browser tests only
// node test/run.js <text>       tests whose name contains <text>
// FH_CODE=… / FH_INDEX=…        run against another Code.gs / Index.html (e.g. the previous draft)
const args = process.argv.slice(2);
const only = args.includes('--server') ? 'server' : args.includes('--browser') ? 'browser' : null;
const filter = args.filter(a => !a.startsWith('--'))[0];
const { run } = require('./lib');
if (only !== 'browser') { require('./core.test'); require('./plan-demo.test'); }
if (only !== 'server') require('./e2e.test');
run(filter).then(fail => process.exit(fail ? 1 : 0));
