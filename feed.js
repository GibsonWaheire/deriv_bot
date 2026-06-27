/* ═══════════════════════════════════════════════════════
   feed.js — Deriv WebSocket: multi-symbol + history fetch
   Plain IIFE, no ES modules (file:// compatible)
═══════════════════════════════════════════════════════ */
(function () {
  const WS_URL = 'wss://ws.binaryws.com/websockets/v3';

  const NAMES = {
    R_10:'Volatility 10', R_25:'Volatility 25', R_50:'Volatility 50',
    R_75:'Volatility 75', R_100:'Volatility 100',
    '1HZ10V':'Vol 10 (1s)', '1HZ25V':'Vol 25 (1s)',
    '1HZ50V':'Vol 50 (1s)', '1HZ75V':'Vol 75 (1s)', '1HZ100V':'Vol 100 (1s)',
    JD10:'Jump 10', JD25:'Jump 25', JD50:'Jump 50', JD75:'Jump 75', JD100:'Jump 100',
    RDBEAR:'Bear Market', RDBULL:'Bull Market',
  };

  // Known pip sizes; also updated from live tick pip_size field
  const PIP = {
    R_10:3, R_25:3, R_50:2, R_75:4, R_100:2,
    '1HZ10V':3,'1HZ25V':3,'1HZ50V':2,'1HZ75V':4,'1HZ100V':2,
    JD10:2, JD25:2, JD50:2, JD75:2, JD100:2,
    RDBEAR:4, RDBULL:4,
  };

  let ws          = null;
  let appId       = '1089';
  let status      = 'offline';
  let wantedSyms  = [];
  let pipSizes    = {};         // override per symbol from live data
  let pendingHist = {};         // symbol → callback
  let pingT0      = 0;
  let pingTimer   = null;
  let reconnTimer = null;
  let rttSamples  = [];

  // Callbacks
  let onTick    = null;
  let onHistory = null;   // fn(symbol, prices[], times[])
  let onStatus  = null;
  let onRtt     = null;

  function pip(sym) { return pipSizes[sym] !== undefined ? pipSizes[sym] : (PIP[sym] || 2); }

  function lastDigit(price, sym) {
    return Math.round(price * Math.pow(10, pip(sym))) % 10;
  }

  function setStatus(s) { status = s; if (onStatus) onStatus(s); }
  function avgRtt()     { return rttSamples.length ? Math.round(rttSamples.reduce((a,b)=>a+b,0)/rttSamples.length) : null; }

  // ── CONNECT ─────────────────────────────────────────
  function connect(id, syms) {
    appId      = id || '1089';
    wantedSyms = syms || [];
    pipSizes   = {};
    pendingHist= {};
    rttSamples = [];
    _teardown();
    setStatus('connecting');

    try { ws = new WebSocket(WS_URL + '?app_id=' + encodeURIComponent(appId)); }
    catch(e) { setStatus('error'); return; }

    ws.onopen = function () {
      setStatus('live');
      // Subscribe to live ticks
      wantedSyms.forEach(sym => ws.send(JSON.stringify({ ticks: sym, subscribe: 1 })));
      // Immediately fetch history for each
      wantedSyms.forEach(sym => _fetchHistory(sym));
      // First ping
      _schedulePing(5000);
    };

    ws.onmessage = function (evt) {
      var msg; try { msg = JSON.parse(evt.data); } catch(e) { return; }
      if (msg.error) { console.warn('[Feed]', msg.error.message, msg.echo_req); return; }

      // Live tick
      if (msg.msg_type === 'tick' && msg.tick) {
        var t = msg.tick;
        if (t.pip_size != null) pipSizes[t.symbol] = t.pip_size;
        var digit = lastDigit(t.quote, t.symbol);
        if (onTick) onTick(t.symbol, digit, t.quote, t.epoch);
      }

      // History response
      if (msg.msg_type === 'history' && msg.history) {
        var sym = msg.echo_req.ticks_history;
        var prices = msg.history.prices;
        var times  = msg.history.times;
        // Infer pip size from prices if not yet known
        if (pipSizes[sym] === undefined) pipSizes[sym] = _inferPip(prices);
        if (onHistory) onHistory(sym, prices, times);
        delete pendingHist[sym];
      }

      // Ping response
      if (msg.msg_type === 'time' && pingT0) {
        var rtt = Date.now() - pingT0; pingT0 = 0;
        rttSamples.push(rtt); if (rttSamples.length > 5) rttSamples.shift();
        if (onRtt) onRtt(avgRtt());
        _schedulePing(20000);
      }
    };

    ws.onerror = function () { setStatus('error'); };
    ws.onclose = function (evt) {
      clearTimeout(pingTimer);
      if (status === 'live' && !evt.wasClean) {
        setStatus('error');
        reconnTimer = setTimeout(function() { if (status==='error') connect(appId, wantedSyms); }, 5000);
      } else { setStatus('offline'); }
    };
  }

  function _fetchHistory(sym, count) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    pendingHist[sym] = true;
    ws.send(JSON.stringify({
      ticks_history: sym,
      adjust_start_time: 1,
      count: count || 5000,
      end: 'latest',
      style: 'ticks',
    }));
  }

  function _inferPip(prices) {
    var max = 0;
    prices.slice(0, 30).forEach(p => {
      var s = p.toString(), d = s.indexOf('.');
      if (d >= 0) max = Math.max(max, s.length - d - 1);
    });
    return max;
  }

  function _schedulePing(delay) {
    clearTimeout(pingTimer);
    pingTimer = setTimeout(function() {
      if (ws && ws.readyState === WebSocket.OPEN) { pingT0 = Date.now(); ws.send(JSON.stringify({time:1})); }
    }, delay || 20000);
  }

  function _teardown() {
    clearTimeout(pingTimer); clearTimeout(reconnTimer);
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({forget_all:'ticks'})); } catch(e){} }
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close(); ws = null;
    }
  }

  function disconnect() { _teardown(); setStatus('offline'); }

  function pingNow() {
    if (ws && ws.readyState === WebSocket.OPEN) { clearTimeout(pingTimer); pingT0 = Date.now(); ws.send(JSON.stringify({time:1})); }
  }

  function getPip(sym) { return pip(sym); }

  window.Feed = {
    NAMES, connect, disconnect, pingNow, getPip,
    getStatus:  () => status,
    getAvgRtt:  () => avgRtt(),
    setOnTick:    f => { onTick    = f; },
    setOnHistory: f => { onHistory = f; },
    setOnStatus:  f => { onStatus  = f; },
    setOnRtt:     f => { onRtt     = f; },
  };

  window.addEventListener('beforeunload', disconnect);
})();
