(function () {
  'use strict';

  var countEl = document.getElementById('users-count');
  var labelEl = document.getElementById('users-label');
  var blockEl = document.getElementById('users-block');
  var versionEl = document.getElementById('app-version');

  var MAX_BACKOFF_MS = 15000;
  var backoff = 1000;
  var lastCount = null;

  function setState(state, label) {
    blockEl.setAttribute('data-state', state);
    labelEl.textContent = label;
  }

  function showCount(n) {
    countEl.textContent = String(n);
    labelEl.textContent = n === 1 ? 'Connected user' : 'Connected users';
    if (lastCount !== null && lastCount !== n) {
      countEl.classList.remove('bump');
      void countEl.offsetWidth;
      countEl.classList.add('bump');
    }
    lastCount = n;
  }

  function connect() {
    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(protocol + '//' + location.host + '/ws');

    ws.onopen = function () {
      backoff = 1000;
      setState('online', 'Connected users');
    };

    ws.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data);
        if (typeof data.users === 'number') showCount(data.users);
      } catch (e) {
        /* ignore malformed messages */
      }
    };

    ws.onclose = function () {
      setState('offline', 'Offline - reconnecting');
      setTimeout(connect, backoff * (0.5 + Math.random()));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  fetch('/api/version')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (data && data.version) versionEl.textContent = 'v' + data.version;
    })
    .catch(function () {});

  connect();
})();
