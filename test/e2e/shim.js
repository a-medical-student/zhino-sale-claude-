/*
 * Stand-in for google.script.run inside the test page. Calls are executed against Code.gs running on the
 * Apps Script emulator in a hidden same-origin iframe (/server.html), so client and server keep separate globals
 * (they share several function names). Arguments and results are JSON-cloned, as in the real bridge.
 *
 * window.__srv knobs for tests:
 *   latency  — ms per call (half before the server runs, half after)   fail[fn] = 'message' → that call fails
 *   calls    — names of calls made                                      win      — the server window
 */
(function () {
  var S = window.__srv = { win: null, queue: [], latency: 600, fail: {}, calls: [], pending: 0 };
  window.__srvReady = function (w) { S.win = w; var q = S.queue; S.queue = []; q.forEach(function (f) { f(); }); };

  function dispatch(fn, args, ok, fail) {
    var job = function () {
      S.calls.push(fn); S.pending++;
      var half = S.latency / 2, failMsg = S.fail[fn];
      setTimeout(function () {
        var res, err = null;
        if (failMsg) err = { message: failMsg };
        else {
          try { res = S.win[fn].apply(null, JSON.parse(JSON.stringify(args))); }
          catch (e) { err = { message: e && e.message ? e.message : String(e) }; }
        }
        setTimeout(function () { S.pending--; if (err) { if (fail) fail(err); } else if (ok) ok(res); }, half);
      }, half);
    };
    if (S.win) job(); else S.queue.push(job);
  }
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, k) {
        if (k === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (k === 'withFailureHandler') return function (f) { return runner(ok, f); };
        return function () { dispatch(k, Array.prototype.slice.call(arguments), ok, fail); };
      }
    });
  }
  window.google = { script: { get run() { return runner(null, null); } } };

  document.addEventListener('DOMContentLoaded', function () {
    var f = document.createElement('iframe');
    f.src = '/server.html'; f.style.display = 'none';
    document.body.appendChild(f);
  });
})();
