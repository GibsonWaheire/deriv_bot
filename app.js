/* ═══════════════════════════════════════════════════════════
   app.js — Digit Strategy Terminal
   Auto-analyzes real historical ticks from Deriv API.
   Strategies: Digit Match · Even/Odd · Rise/Fall · Over/Under
═══════════════════════════════════════════════════════════ */

'use strict';

// ── CONSTANTS ────────────────────────────────────────────
const STRIP_LEN   = 30;     // mini cells per card
const LIVE_BUFFER = 500;    // max live digits kept per instrument
const JOURNAL_KEY = 'dst_v3';

// ── INSTRUMENT STATE ─────────────────────────────────────
// instruments[symbol] = { histDigits[], histPrices[], liveDigits[], livePrices[],
//                         analysis{}, tickCount, lastDigit, lastQuote, lastTickMs,
//                         rateWin[], tickRate, histLoaded }
const instruments = {};

// ── ACTIVE TRADE CONTEXT ─────────────────────────────────
let tradeCtx = null;   // { symbol, strategy, label, prob, signalTime, clickTime, rtt, ticksAfterClick }

// ── RAF-DEBOUNCED SIGNAL RENDER ───────────────────────────
// Ensures renderSignals() runs at most once per animation frame,
// no matter how many ticks arrive simultaneously.
let _rafPending = false;
function scheduleSignalRender() {
  if (_rafPending) return;
  _rafPending = true;
  requestAnimationFrame(() => {
    _rafPending = false;
    renderSignals();
  });
}

// ── AUDIO ────────────────────────────────────────────────
let audioCtx    = null;
let soundOn     = true;

function beep(f, dur, vol) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(vol||.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audioCtx.currentTime + dur);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch(e){}
}
function alertBeep() {
  beep(880,.12,.3); setTimeout(()=>beep(1100,.15,.35),140); setTimeout(()=>beep(1320,.25,.4),290);
}

/* ═══════════════════════════════════════════════════════
   ANALYSIS ENGINE
   All probabilities are computed from real historical data.
═══════════════════════════════════════════════════════ */

// Build digit transition matrix from a digit sequence.
// Returns 10×10 matrix where matrix[i][j] = count of j following i.
function buildTransitionMatrix(digits) {
  const m = Array.from({length:10}, ()=> new Array(10).fill(0));
  for (let i = 0; i < digits.length - 1; i++) m[digits[i]][digits[i+1]]++;
  return m;
}

// Normalize a row of counts to probabilities
function normalizeRow(row) {
  const total = row.reduce((a,b)=>a+b,0);
  return total === 0 ? row.map(()=>0.1) : row.map(c=>c/total);
}

// Given the last digit seen, return probability array for each next digit (0-9)
function markovNextProbs(matrix, lastDigit) {
  return normalizeRow(matrix[lastDigit]);
}

// Current gap: how many consecutive ticks the targetDigit has been missing
function currentGap(digits, target) {
  let g = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] === target) break;
    g++;
  }
  return g;
}

// Frequency of each digit in last N ticks
function digitFreqs(digits, n) {
  const freq = new Array(10).fill(0);
  const window = digits.slice(-n);
  window.forEach(d => freq[d]++);
  return freq.map(f => window.length ? f / window.length : 0.1);
}

// ── DIGIT MATCH ANALYSIS ──────────────────────────────────
// Returns for each digit 0-9: { markovP, freqP, gap, combinedScore }
function analyzeDigitMatch(digits) {
  if (digits.length < 30) return null;

  const matrix = buildTransitionMatrix(digits);
  const last   = digits[digits.length - 1];
  const markov = markovNextProbs(matrix, last);
  const freq50 = digitFreqs(digits, 50);
  const freq200= digitFreqs(digits, 200);

  return markov.map((mp, d) => {
    const gap   = currentGap(digits, d);
    // Combined score: weighted Markov + frequency deviation + gap pressure
    // More weight on Markov (learned transitions) than raw gap
    const freqDev = Math.max(0, 0.10 - freq50[d]);       // how far below 10%
    const gapP    = Math.min(gap / 15, 1) * 0.08;        // gap adds up to 8% pressure
    const combined = mp * 0.6 + freq200[d] * 0.2 + freqDev * 0.8 + gapP;
    return { digit: d, markovP: mp, freqP: freq50[d], freq200P: freq200[d], gap, combined };
  });
}

// ── EVEN / ODD ANALYSIS ───────────────────────────────────
function analyzeEvenOdd(digits) {
  if (digits.length < 30) return null;

  // Build transition matrix: 0=odd, 1=even
  const m = [[0,0],[0,0]];
  for (let i = 0; i < digits.length - 1; i++) {
    const a = digits[i]   % 2 === 0 ? 1 : 0;
    const b = digits[i+1] % 2 === 0 ? 1 : 0;
    m[a][b]++;
  }

  const last    = digits[digits.length - 1];
  const lastEven= last % 2 === 0 ? 1 : 0;
  const row     = m[lastEven];
  const total   = row[0] + row[1];
  const pEven   = total > 0 ? row[1] / total : 0.5;
  const pOdd    = 1 - pEven;

  // Historical even/odd rate in last 100 and 500
  const r100 = digits.slice(-100).filter(d=>d%2===0).length / Math.min(digits.length,100);
  const r500 = digits.slice(-500).filter(d=>d%2===0).length / Math.min(digits.length,500);

  // Current streak
  let streak = 0, streakType = last % 2 === 0 ? 'Even' : 'Odd';
  for (let i = digits.length-1; i>=0; i--) {
    if ((digits[i]%2===0) === (last%2===0)) streak++;
    else break;
  }

  return { pEven, pOdd, r100, r500, streak, streakType, lastEven: last%2===0, m };
}

// ── RISE / FALL ANALYSIS ──────────────────────────────────
function analyzeRiseFall(prices) {
  if (prices.length < 30) return null;

  // Build rise/fall sequence
  const rf = [];
  for (let i = 1; i < prices.length; i++) rf.push(prices[i] > prices[i-1] ? 1 : 0);
  if (rf.length < 10) return null;

  // Transition matrix: 0=fall, 1=rise
  const m = [[0,0],[0,0]];
  for (let i = 0; i < rf.length - 1; i++) m[rf[i]][rf[i+1]]++;

  const last  = rf[rf.length-1];
  const row   = m[last];
  const total = row[0]+row[1];
  const pRise = total > 0 ? row[1]/total : 0.5;
  const pFall = 1 - pRise;

  // Current streak
  let streak = 0;
  for (let i = rf.length-1; i>=0; i--) {
    if (rf[i] === last) streak++;
    else break;
  }

  // Historical probability after streak of current length
  // Scan history for streaks of this length and what followed
  let continueCount = 0, reverseCount = 0;
  for (let i = streak; i < rf.length; i++) {
    let match = true;
    for (let j = 0; j < streak && match; j++) {
      if (rf[i - streak + j] !== last) match = false;
    }
    if (i - streak > 0 && rf[i - streak - 1] === last) match = false; // must be exact streak start
    if (match && i < rf.length) {
      if (rf[i] === last) continueCount++;
      else reverseCount++;
    }
  }
  const streakTotal = continueCount + reverseCount;
  const pReverse = streakTotal >= 5 ? reverseCount / streakTotal : 0.5;

  // Overall rise/fall balance last 100
  const r100 = rf.slice(-100).filter(x=>x===1).length / Math.min(rf.length,100);

  return {
    pRise, pFall, streak, streakDir: last===1?'Rise':'Fall',
    pReverse, r100, rfLen: rf.length, m
  };
}

// ── OVER / UNDER ANALYSIS ────────────────────────────────
// Returns for thresholds 1-8: probability of digit > threshold (Over)
function analyzeOverUnder(digits) {
  if (digits.length < 30) return null;
  const win = digits.slice(-200);
  const total = win.length;
  return [1,2,3,4,5,6,7,8].map(thr => {
    const over  = win.filter(d=>d>thr).length / total;
    const under = 1 - over;
    return { thr, over, under, best: Math.max(over,under), bestDir: over >= under ? 'Over':'Under' };
  });
}

// ── RUN ALL ANALYSES ─────────────────────────────────────
function runAnalysis(symbol) {
  const inst = instruments[symbol];
  if (!inst) return;

  const allDigits = inst.histDigits.concat(inst.liveDigits);
  const allPrices = inst.histPrices.concat(inst.livePrices);

  if (allDigits.length < 30) return;

  inst.analysis = {
    digitMatch : analyzeDigitMatch(allDigits),
    evenOdd    : analyzeEvenOdd(allDigits),
    riseFall   : analyzeRiseFall(allPrices),
    overUnder  : analyzeOverUnder(allDigits),
    totalTicks : allDigits.length,
  };
}

/* ═══════════════════════════════════════════════════════
   SIGNAL SCORING
   Turns analysis into signals for the top-signals panel
═══════════════════════════════════════════════════════ */
function extractSignals(symbol) {
  const inst = instruments[symbol];
  if (!inst || !inst.analysis || !inst.histLoaded) return [];
  const a    = inst.analysis;
  const name = Feed.NAMES[symbol] || symbol;   // friendly name e.g. "Volatility 100"
  const signals = [];

  // ── Digit Match: top digit ──────────────────────────
  if (a.digitMatch) {
    const best = a.digitMatch.slice().sort((x,y)=>y.combined-x.combined)[0];
    const prob = Math.round(best.combined * 100);
    if (prob > 12) {
      signals.push({
        symbol, name, strategy:'match', strat:'DIGIT MATCH',
        label: `Digit ${best.digit} · Gap ${best.gap}t · Markov ${(best.markovP*100).toFixed(1)}%`,
        prob, probRaw: best.combined, digit: best.digit, gap: best.gap,
        grade: prob >= 20 ? 'strong' : prob >= 15 ? 'medium' : 'weak',
      });
    }
  }

  // ── Even / Odd ──────────────────────────────────────
  if (a.evenOdd) {
    const e      = a.evenOdd;
    const recPct = Math.round(Math.max(e.pEven, e.pOdd) * 100);
    if (recPct >= 54) {
      const recDir = e.pEven >= e.pOdd ? 'Even' : 'Odd';
      signals.push({
        symbol, name, strategy: recDir.toLowerCase(), strat: recDir.toUpperCase(),
        label: `${recDir} ${recPct}% · ${e.streak} ${e.streakType} streak · hist ${(e.r500*100).toFixed(1)}%`,
        prob: recPct, probRaw: Math.max(e.pEven, e.pOdd),
        grade: recPct >= 58 ? 'strong' : recPct >= 55 ? 'medium' : 'weak',
      });
    }
  }

  // ── Rise / Fall ─────────────────────────────────────
  if (a.riseFall) {
    const rf      = a.riseFall;
    const recDir  = rf.pRise >= rf.pFall ? 'Rise' : 'Fall';
    const recP    = Math.round(Math.max(rf.pRise, rf.pFall) * 100);
    const revP    = Math.round(rf.pReverse * 100);
    const useRev  = rf.streak >= 3 && revP >= 54;
    const finalDir= useRev ? (rf.streakDir === 'Rise' ? 'Fall' : 'Rise') : recDir;
    const finalP  = useRev ? revP : recP;
    if (finalP >= 53) {
      signals.push({
        symbol, name, strategy: finalDir.toLowerCase(), strat: finalDir.toUpperCase(),
        label: useRev
          ? `Reversal after ${rf.streak} ${rf.streakDir}s · historical ${revP}%`
          : `${finalDir} ${finalP}% · ${rf.streak} ${rf.streakDir} streak · hist ${(rf.r100*100).toFixed(1)}%`,
        prob: finalP, probRaw: finalP / 100,
        grade: finalP >= 58 ? 'strong' : finalP >= 55 ? 'medium' : 'weak',
      });
    }
  }

  // ── Over / Under ────────────────────────────────────
  if (a.overUnder) {
    const best = a.overUnder.slice().sort((x,y)=>y.best-x.best)[0];
    const prob = Math.round(best.best * 100);
    if (prob >= 55) {
      signals.push({
        symbol, name, strategy: best.bestDir.toLowerCase(),
        strat: `${best.bestDir.toUpperCase()} ${best.thr}`,
        label: `${best.bestDir} ${best.thr} → ${prob}% in last 200 ticks`,
        prob, probRaw: best.best,
        grade: prob >= 60 ? 'strong' : prob >= 57 ? 'medium' : 'weak',
      });
    }
  }

  return signals.sort((a,b) => b.probRaw - a.probRaw);
}

// ── RENDER TOP SIGNALS ───────────────────────────────────
function renderSignals() {
  const all = [];
  Object.keys(instruments).forEach(sym => {
    extractSignals(sym).forEach(s => all.push(s));
  });
  all.sort((a, b) => b.probRaw - a.probRaw);

  const list  = document.getElementById('spList');
  const hint  = document.getElementById('spHint');

  if (!all.length) {
    list.innerHTML = '<div class="sp-empty">No significant signals detected yet — still collecting data…</div>';
    hint.textContent = 'Auto-updates each tick';
    return;
  }

  hint.textContent = `${all.length} active signal${all.length > 1 ? 's' : ''} · live`;

  // Gauge fill % — map prob from realistic range [50–100] to [0–100%] for visual
  function gaugePct(prob, strat) {
    if (strat === 'match') return Math.min((prob - 10) / 15 * 100, 100); // 10% baseline
    return Math.min((prob - 50) / 20 * 100, 100); // 50% baseline for even/odd/rise/fall
  }

  // Readable detail lines per strategy
  function detailRows(s) {
    const rows = [];
    if (s.strategy === 'match') {
      const parts = s.label.split(' · ');
      rows.push(['Gap', parts.find(p=>p.includes('Gap'))?.replace('Gap ','') || '—']);
      rows.push(['Markov P', parts.find(p=>p.includes('Markov'))?.replace('Markov ','') || '—']);
    } else if (s.strategy === 'even' || s.strategy === 'odd') {
      const m = s.label.match(/(\d+) (Even|Odd) streak/);
      const h = s.label.match(/hist ([\d.]+%)/);
      if (m) rows.push(['Streak', m[1] + ' ' + m[2]]);
      if (h) rows.push(['Historical', h[1]]);
    } else if (s.strategy === 'rise' || s.strategy === 'fall') {
      const m = s.label.match(/(\d+) (Rise|Fall)/);
      const h = s.label.match(/hist ([\d.]+%)/);
      const r = s.label.match(/Reversal after (\d+)/);
      if (r) rows.push(['Streak', r[1] + ' ' + (s.strategy === 'rise' ? 'Falls' : 'Rises')]);
      else if (m) rows.push(['Streak', m[1] + ' ' + m[2]]);
      if (h) rows.push(['Historical', h[1]]);
    } else {
      rows.push(['Direction', s.strat]);
      const h = s.label.match(/(\d+)% in last/);
      if (h) rows.push(['Freq', h[1] + '%']);
    }
    return rows;
  }

  list.innerHTML = all.slice(0, 8).map(s => {
    const gfill = Math.max(0, gaugePct(s.prob, s.strategy)).toFixed(1);
    const details = detailRows(s);
    const tradeArgs = `'${s.symbol}','${s.strategy}','${s.strat}: ${s.label}',${s.prob}`;
    return `
      <div class="sigcard ${s.strategy} ${s.grade}">
        <div class="sc-top">
          <span class="sc-strat-label">${s.strat}</span>
          <span class="sc-sym">${s.symbol}</span>
        </div>
        <div class="sc-instrument-name">${s.name}</div>
        <div class="sc-prob-wrap">
          <span class="sc-prob-num">${s.prob}</span>
          <span class="sc-prob-unit">%</span>
        </div>
        <div class="sc-gauge-wrap">
          <div class="sc-gauge-track">
            <div class="sc-gauge-fill" style="width:${gfill}%"></div>
          </div>
          <span class="sc-grade ${s.grade}">${s.grade}</span>
        </div>
        <div class="sc-details">
          ${details.map(([k,v]) => `
            <div class="sc-detail-row"><span>${k}</span><b>${v}</b></div>`).join('')}
        </div>
        <button class="sc-trade-btn" onclick="openTrade(${tradeArgs})">Trade ${s.strat}</button>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   CARD RENDERING
═══════════════════════════════════════════════════════ */
function createCard(symbol) {
  const name = Feed.NAMES[symbol] || symbol;
  const div  = document.createElement('div');
  div.className = 'icard';
  div.id = 'card-' + symbol;
  div.innerHTML = `
    <div class="icard-head">
      <div class="ich-left">
        <div class="isym">${symbol}</div>
        <div class="iname">${name}</div>
      </div>
      <div class="ich-right">
        <span class="iprice" id="ipr-${symbol}">—</span>
        <span class="ibadge loading" id="ibadge-${symbol}">Loading…</span>
      </div>
    </div>
    <div class="icard-loading" id="iload-${symbol}">
      <div class="spinner"></div>
      <span>Fetching historical ticks…</span>
    </div>
    <div class="hidden" id="ibody-${symbol}">
      <div class="strat-grid">
        <div class="strat-cell">
          <div class="sc-label">Best Digit Match</div>
          <div class="sc-main green" id="sdm-${symbol}">—</div>
          <div class="sc-sub" id="sdmsub-${symbol}">—</div>
          <div class="sc-bar-wrap"><div class="sc-bar green" id="sdmbar-${symbol}" style="width:0%"></div></div>
        </div>
        <div class="strat-cell">
          <div class="sc-label">Even / Odd</div>
          <div class="sc-main blue" id="seo-${symbol}">—</div>
          <div class="sc-sub" id="seosub-${symbol}">—</div>
          <div class="sc-bar-wrap"><div class="sc-bar blue" id="seobar-${symbol}" style="width:0%"></div></div>
        </div>
        <div class="strat-cell">
          <div class="sc-label">Rise / Fall</div>
          <div class="sc-main green" id="srf-${symbol}">—</div>
          <div class="sc-sub" id="srfsub-${symbol}">—</div>
          <div class="sc-bar-wrap"><div class="sc-bar green" id="srfbar-${symbol}" style="width:0%"></div></div>
        </div>
      </div>
      <div class="strat-trade-row">
        <button class="strat-trade-btn" onclick="openTrade('${symbol}','match','Best Digit Match',0)" id="tbdm-${symbol}">Trade Match</button>
        <button class="strat-trade-btn" onclick="openTrade('${symbol}','even','Even/Odd',0)" id="tbeo-${symbol}">Trade Even/Odd</button>
        <button class="strat-trade-btn" onclick="openTrade('${symbol}','rise','Rise/Fall',0)" id="tbrf-${symbol}">Trade Rise/Fall</button>
      </div>
      <div class="ou-row" id="sourl-${symbol}"></div>
      <div class="icard-strip" id="strip-${symbol}"></div>
    </div>
    <div class="icard-foot">
      <span>Hist: <b id="ihist-${symbol}">—</b> ticks</span>
      <span>Live: <b id="ilive-${symbol}">0</b> ticks</span>
      <span>Rate: <b id="irate-${symbol}">—</b>/min</span>
      <span>Last: <b id="ilast-${symbol}">—</b></span>
    </div>`;
  document.getElementById('cardGrid').appendChild(div);
}

function updateCard(symbol) {
  const inst = instruments[symbol];
  if (!inst || !inst.histLoaded) return;
  const a = inst.analysis;
  if (!a) return;

  const el = id => document.getElementById(id + '-' + symbol);
  const allDigits = inst.histDigits.concat(inst.liveDigits);

  // Show body, hide loader
  el('iload').classList.add('hidden');
  el('ibody').classList.remove('hidden');
  el('ibadge').textContent = 'Ready';
  el('ibadge').className = 'ibadge ready';

  // Price
  if (inst.lastQuote) el('ipr').textContent = inst.lastQuote.toFixed(2);

  // ── Digit Match cell ─────────────────────────────
  if (a.digitMatch) {
    const best = a.digitMatch.slice().sort((x,y)=>y.combined-x.combined)[0];
    const pct  = Math.round(best.combined * 100);
    el('sdm').textContent  = 'Digit ' + best.digit;
    el('sdmsub').innerHTML = `<b>${pct}%</b> · Gap ${best.gap}t · Markov ${(best.markovP*100).toFixed(1)}%`;
    el('sdmbar').style.width = Math.min(pct*2, 100) + '%';
    // Update trade button with actual prob
    el('tbdm').onclick = () => openTrade(symbol, 'match',
      `Digit ${best.digit} · ${pct}% · gap ${best.gap}t`, pct);
  }

  // ── Even/Odd cell ────────────────────────────────
  if (a.evenOdd) {
    const e    = a.evenOdd;
    const dir  = e.pEven >= e.pOdd ? 'Even' : 'Odd';
    const pct  = Math.round(Math.max(e.pEven, e.pOdd) * 100);
    const col  = dir === 'Even' ? 'blue' : 'yel';
    el('seo').textContent  = dir + ' ' + pct + '%';
    el('seo').className    = 'sc-main ' + col;
    el('seosub').innerHTML = `<b>${e.streak} ${e.streakType}</b> streak · hist ${(e.r500*100).toFixed(1)}%`;
    el('seobar').style.width = Math.round((pct-50)*4) + '%';
    el('seobar').className   = 'sc-bar ' + col;
    el('tbeo').onclick = () => openTrade(symbol, dir.toLowerCase(),
      `${dir} ${pct}% · ${e.streak} ${e.streakType} streak`, pct);
  }

  // ── Rise/Fall cell ───────────────────────────────
  if (a.riseFall) {
    const rf  = a.riseFall;
    const dir = rf.pRise >= rf.pFall ? 'Rise' : 'Fall';
    const pct = Math.round(Math.max(rf.pRise, rf.pFall) * 100);
    const col = dir === 'Rise' ? 'green' : 'red';
    el('srf').textContent  = dir + ' ' + pct + '%';
    el('srf').className    = 'sc-main ' + col;
    el('srfsub').innerHTML = `<b>${rf.streak} ${rf.streakDir}</b> streak · hist ${(rf.r100*100).toFixed(1)}%`;
    el('srfbar').style.width = Math.round((pct-50)*4) + '%';
    el('srfbar').className   = 'sc-bar ' + col;
    el('tbrf').onclick = () => openTrade(symbol, dir.toLowerCase(),
      `${dir} ${pct}% · ${rf.streak} ${rf.streakDir} streak`, pct);
  }

  // ── Over/Under row ───────────────────────────────
  if (a.overUnder) {
    const maxP  = Math.max(...a.overUnder.map(o=>o.best));
    el('sourl').innerHTML = a.overUnder.map(o => {
      const isBest = o.best === maxP;
      const pct = Math.round(o.best * 100);
      return `<div class="ou-cell ${isBest?'best':''}" title="${o.bestDir} ${o.thr}: ${pct}%">
        <span class="ou-thr">${o.bestDir==='Over'?'▲':'▼'}${o.thr}</span>
        <span class="ou-pct">${pct}%</span>
      </div>`;
    }).join('');
  }

  // ── Footer ───────────────────────────────────────
  el('ihist').textContent = inst.histDigits.length;
  el('ilive').textContent = inst.liveDigits.length;
  el('irate').textContent = inst.tickRate || '—';
  if (inst.lastTickMs) {
    el('ilast').textContent = new Date(inst.lastTickMs).toLocaleTimeString();
  }

  // ── Mini strip ───────────────────────────────────
  // (strip updated incrementally on each tick via appendToStrip)
}

// Infer which digit is the "target" for strip coloring (use best digit match)
function stripTargetDigit(symbol) {
  const a = instruments[symbol]?.analysis;
  if (!a || !a.digitMatch) return -1; // no coloring
  return a.digitMatch.slice().sort((x,y)=>y.combined-x.combined)[0].digit;
}

function appendToStrip(symbol, digit) {
  const strip = document.getElementById('strip-' + symbol);
  if (!strip) return;
  const target  = stripTargetDigit(symbol);
  const isMatch = target >= 0 && digit === target;
  const isNear  = !isMatch && target >= 0 &&
    (digit === (target+1)%10 || digit === (target+9)%10);
  const cell = document.createElement('div');
  cell.className = 'mc new ' + (isMatch ? 'match' : isNear ? 'near' : 'miss');
  cell.textContent = digit;
  strip.appendChild(cell);
  setTimeout(() => cell.classList.remove('new'), 350);
  while (strip.children.length > STRIP_LEN) strip.removeChild(strip.firstChild);
}

/* ═══════════════════════════════════════════════════════
   FEED CALLBACKS
═══════════════════════════════════════════════════════ */

// History received from Deriv API (real historical data)
Feed.setOnHistory(function(symbol, prices, times) {
  if (!instruments[symbol]) return;
  const inst = instruments[symbol];
  const pip  = Feed.getPip(symbol);

  // Convert prices → digits
  inst.histPrices = prices;
  inst.histDigits = prices.map(p => Math.round(p * Math.pow(10, pip)) % 10);
  inst.histLoaded = true;

  runAnalysis(symbol);
  updateCard(symbol);
  scheduleSignalRender();
});

// Live tick received
Feed.setOnTick(function(symbol, digit, quote, epoch) {
  if (!instruments[symbol]) return;
  const inst = instruments[symbol];

  // Push live data
  inst.liveDigits.push(digit);
  inst.livePrices.push(quote);
  if (inst.liveDigits.length > LIVE_BUFFER) { inst.liveDigits.shift(); inst.livePrices.shift(); }

  inst.lastDigit  = digit;
  inst.lastQuote  = quote;
  inst.tickCount++;
  inst.lastTickMs = Date.now();

  // Tick rate
  inst.rateWin.push(Date.now());
  if (inst.rateWin.length > 20) inst.rateWin.shift();
  if (inst.rateWin.length >= 2) {
    const span = (Date.now() - inst.rateWin[0]) / 1000;
    inst.tickRate = Math.round((inst.rateWin.length-1)/span*60);
  }

  // Update price display
  const ipr = document.getElementById('ipr-' + symbol);
  if (ipr) ipr.textContent = quote.toFixed(2);

  // Append to strip
  appendToStrip(symbol, digit);

  if (inst.histLoaded) {
    // Re-analyze on every tick — fast enough for the signal engine
    runAnalysis(symbol);

    // Signals: RAF-debounced so the panel updates every screen frame
    // even when multiple instruments tick simultaneously
    scheduleSignalRender();

    // Full card DOM update every 5 ticks (heavier, not needed every tick)
    if (inst.tickCount % 5 === 0) updateCard(symbol);
  }

  // Update footer live count
  const il = document.getElementById('ilive-' + symbol);
  if (il) il.textContent = inst.liveDigits.length;
  const ilast = document.getElementById('ilast-' + symbol);
  if (ilast) ilast.textContent = new Date(inst.lastTickMs).toLocaleTimeString();

  // Update trade modal watch if this symbol is open
  if (tradeCtx && tradeCtx.symbol === symbol) {
    tradeCtx.ticksAfterClick++;
    const twCount = document.getElementById('twCount');
    if (twCount) twCount.textContent = tradeCtx.ticksAfterClick;
    appendTradeCell(digit, tradeCtx);
  }
});

// Status changes
Feed.setOnStatus(function(status) {
  const dot = document.getElementById('sdot');
  const txt = document.getElementById('statusVal');
  dot.className = 'sdot ' + status;
  txt.textContent = { offline:'Offline', connecting:'Connecting…', live:'Live', error:'Error – retrying' }[status] || status;

  const btnGo   = document.getElementById('btnConnect');
  const btnStop = document.getElementById('btnStop');
  if (status === 'live') {
    btnGo.disabled = true; btnStop.classList.remove('hidden');
  } else if (status === 'offline') {
    btnGo.disabled = false; btnStop.classList.add('hidden');
  } else if (status === 'connecting') {
    btnGo.disabled = true;
  } else if (status === 'error') {
    btnGo.disabled = false;
  }
});

// RTT ping
Feed.setOnRtt(function(ms) {
  document.getElementById('rttVal').textContent = ms + 'ms';
  if (tradeCtx) document.getElementById('ttRtt').textContent = ms + ' ms';
});

/* ═══════════════════════════════════════════════════════
   TRADE MODAL
═══════════════════════════════════════════════════════ */
function openTrade(symbol, strategy, label, prob) {
  const rtt = Feed.getAvgRtt() || 0;
  const now = Date.now();
  tradeCtx = { symbol, strategy, label, prob, signalTime: now, clickTime: now, rtt, ticksAfterClick: 0 };

  const fmtTime = t => new Date(t).toLocaleTimeString('en-GB', {hour12:false, fractionalSecondDigits:3});

  document.getElementById('tmTitle').textContent = label;
  document.getElementById('tmSub').textContent   = symbol + ' · ' + strategy.toUpperCase();
  document.getElementById('tmConf').textContent  = prob + '%';
  document.getElementById('ttSignal').textContent = fmtTime(now);
  document.getElementById('ttClick').textContent  = fmtTime(now);
  document.getElementById('ttRtt').textContent    = rtt ? rtt + ' ms' : 'measuring…';
  document.getElementById('ttEntry').textContent  = fmtTime(now + rtt);
  document.getElementById('twSym').textContent    = symbol;
  document.getElementById('twCells').innerHTML    = '';
  document.getElementById('twCount').textContent  = '0';

  document.getElementById('tradeOverlay').classList.remove('hidden');
  Feed.pingNow();
}

function appendTradeCell(digit, ctx) {
  const wrap = document.getElementById('twCells');
  if (!wrap) return;
  const isFirst = wrap.children.length === 0;
  const isMatch = checkStrategyMatch(digit, ctx);
  const cell = document.createElement('div');
  cell.className = 'tw-cell ' + (isFirst ? 'entry' : isMatch ? 'match' : 'miss');
  cell.textContent = digit;
  wrap.appendChild(cell);
  if (wrap.children.length > 12) wrap.removeChild(wrap.firstChild);
}

function checkStrategyMatch(digit, ctx) {
  if (!ctx) return false;
  if (ctx.strategy === 'even') return digit % 2 === 0;
  if (ctx.strategy === 'odd')  return digit % 2 !== 0;
  if (ctx.strategy === 'match') {
    const a = instruments[ctx.symbol]?.analysis;
    if (a && a.digitMatch) {
      const best = a.digitMatch.slice().sort((x,y)=>y.combined-x.combined)[0];
      return digit === best.digit;
    }
  }
  return false; // rise/fall and over/under can't be checked from digit alone
}

function closeTrade(result) {
  if (!tradeCtx) return;
  const { symbol, strategy, label, prob, clickTime, rtt } = tradeCtx;
  addJournalEntry({ id:Date.now(), time:new Date(clickTime).toLocaleTimeString(),
    symbol, strategy, label, prob, rtt, result });
  tradeCtx = null;
  document.getElementById('tradeOverlay').classList.add('hidden');
  document.getElementById('twCells').innerHTML = '';
}

document.getElementById('btnWin').addEventListener('click',  () => closeTrade('WIN'));
document.getElementById('btnLoss').addEventListener('click', () => closeTrade('LOSS'));
document.getElementById('btnSkip').addEventListener('click', () => closeTrade('SKIP'));

/* ═══════════════════════════════════════════════════════
   JOURNAL
═══════════════════════════════════════════════════════ */
function loadJournal() { try { return JSON.parse(localStorage.getItem(JOURNAL_KEY)||'[]'); } catch{return[];} }
function saveJournal(j){ localStorage.setItem(JOURNAL_KEY, JSON.stringify(j.slice(0,200))); }

function addJournalEntry(e) {
  const j = loadJournal(); j.unshift(e); saveJournal(j);
  renderJournal(); updateWinRate();
}

function renderJournal() {
  const j = loadJournal();
  document.getElementById('jList').innerHTML = j.slice(0,15).map(e=>`
    <div class="je">
      <div class="je-r ${e.result.toLowerCase()}">${e.result}</div>
      <div class="je-info">
        <div class="je-sym">${e.symbol} · ${e.strategy?.toUpperCase()}</div>
        <div class="je-meta">${e.time} · ${e.prob}%</div>
      </div>
    </div>`).join('');
}

function updateWinRate() {
  const j      = loadJournal();
  const played = j.filter(e=>e.result!=='SKIP');
  const wins   = played.filter(e=>e.result==='WIN').length;
  const total  = played.length;
  document.getElementById('tradeCountVal').textContent = total;
  const wr = document.getElementById('winRateVal');
  if (total > 0) {
    const pct = Math.round(wins/total*100);
    wr.textContent = pct + '%';
    wr.className   = 'pill-v ' + (pct>=60?'green': pct>=40?'':'red');
  } else {
    wr.textContent = '—';
  }
  const sum = document.getElementById('jSummary');
  sum.innerHTML = total === 0 ? 'No trades yet'
    : `<b>${wins} wins</b> / <span class="rl">${total-wins} losses</span> from ${total} trades`;
}

document.getElementById('btnClearJ').addEventListener('click', ()=>{
  if (confirm('Clear trade journal?')) { localStorage.removeItem(JOURNAL_KEY); renderJournal(); updateWinRate(); }
});

/* ═══════════════════════════════════════════════════════
   CONNECT / DISCONNECT
═══════════════════════════════════════════════════════ */
document.getElementById('btnConnect').addEventListener('click', () => {
  const appId   = document.getElementById('appId').value.trim() || '1089';
  const histN   = parseInt(document.getElementById('histCount').value, 10) || 4000;
  const syms    = Array.from(document.querySelectorAll('#instrChecks input:checked')).map(e=>e.value);
  if (!syms.length) { alert('Select at least one instrument.'); return; }

  // Clear state and DOM
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '';
  Object.keys(instruments).forEach(k => delete instruments[k]);

  syms.forEach(sym => {
    instruments[sym] = {
      histDigits:[], histPrices:[], liveDigits:[], livePrices:[],
      analysis:null, tickCount:0, lastDigit:null, lastQuote:null,
      lastTickMs:0, rateWin:[], tickRate:0, histLoaded:false,
    };
    createCard(sym);
  });

  document.getElementById('spList').innerHTML = '<div class="sp-empty">Fetching historical data…</div>';
  Feed.connect(appId, syms);
});

document.getElementById('btnStop').addEventListener('click', () => {
  Feed.disconnect();
  document.getElementById('signalsPanel').querySelector('.sp-hint').textContent = 'Disconnected';
});

/* ═══════════════════════════════════════════════════════
   SOUND TOGGLE
═══════════════════════════════════════════════════════ */
document.getElementById('btnSound').addEventListener('click', function() {
  soundOn = !soundOn;
  this.classList.toggle('active', soundOn);
  if (soundOn && !audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
});

// Make openTrade accessible from inline onclick
window.openTrade = openTrade;

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
renderJournal();
updateWinRate();
document.getElementById('btnSound').classList.add('active');
