// Canvas re-render of the on-chain parcel animation.
//
// The on-chain HTML drives the visual via two independent loops:
//
//   1. CSS keyframe color cycling — a subset of the a–j classes (typically
//      b, f, g, h) animate their color via @keyframes x with staggered delays
//      and `alternate` direction. The other classes hold their static color.
//
//   2. JS terraLoop character cycling — every animation frame, the displayed
//      character per cell is recomputed. For non-zero-height cells:
//        charIndex = floor(airship * 0.15 - h) % charSet.length
//      For zero-height cells the index depends on cell position + airship.
//      charSet = BIOMECODE.concat(patternBlade); patternBlade is a Unicode
//      block-character pattern picked from bladeRailSequencer by (BIOME+SEED).
//      Both fonts (MathcastlesRemix-Regular and -Extra) shape the block chars
//      into full-cell colored rectangles — that's where the big bars come from.
//
// `prepareRenderer(html)` parses everything from the on-chain HTML and loads
// both fonts via the FontFace API. `renderFrame(ctx, state, heightmap, t)`
// paints one frame at simulated page-time `t` (ms since "page load").

const HEIGHT_TO_CLASS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'i'];

// HTML entity decoder for the chars dict (handles &#160; and &#xNN;).
function decodeEntity(raw) {
  if (raw == null) return ' ';
  if (raw === '&#160;' || raw === '&nbsp;') return ' ';
  const dec = String(raw).match(/^&#(\d+);$/);
  if (dec) return String.fromCharCode(Number(dec[1]));
  const hex = String(raw).match(/^&#x([0-9a-fA-F]+);$/i);
  if (hex) return String.fromCharCode(parseInt(hex[1], 16));
  return String(raw);
}

// Pull every @font-face url(data:...) out of the HTML so we can load them all.
// The on-chain doc declares two: 'MathcastlesRemix-Regular' (in the static
// <style>) and 'MathcastlesRemix-Extra' (injected by the script via extraFont).
function extractFontFaces(html) {
  if (!html) return [];
  const faces = [];
  const re = /@font-face\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    const famMatch = body.match(/font-family\s*:\s*['"]?([^'";]+)['"]?/);
    const urlMatch = body.match(/url\(\s*(data:[^)]+)\s*\)/);
    if (famMatch && urlMatch) {
      faces.push({ family: famMatch[1].trim(), dataUrl: urlMatch[1].trim() });
    }
  }
  // Some font URLs are injected via the script as a template literal — pick those up too.
  const extraRe = /font-family\s*:\s*['"]?([^'";]+)['"]?[^}]*url\(\s*(data:[^)]+)\s*\)/g;
  while ((m = extraRe.exec(html)) !== null) {
    const family = m[1].trim();
    if (!faces.some((f) => f.family === family)) {
      faces.push({ family, dataUrl: m[2].trim() });
    }
  }
  return faces;
}

async function loadFonts(faces) {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return [];
  const loaded = [];
  for (const f of faces) {
    let alreadyLoaded = false;
    for (const existing of document.fonts) {
      if (existing.family === f.family) { alreadyLoaded = true; break; }
    }
    if (alreadyLoaded) { loaded.push(f.family); continue; }
    try {
      const face = new FontFace(f.family, `url(${f.dataUrl})`);
      await face.load();
      document.fonts.add(face);
      loaded.push(f.family);
    } catch { /* keep going; canvas will fall back to monospace */ }
  }
  // Force the browser to actually resolve these fonts for canvas use. Without
  // this prime step, ctx.fillText can still hit the monospace fallback on the
  // first frame even though the FontFace is registered.
  if (document.fonts && document.fonts.load) {
    await Promise.all(loaded.map((fam) => document.fonts.load(`14px "${fam}"`).catch(() => {})));
  }
  return loaded;
}

function parseKeyframes(html) {
  // @keyframes x{ 0%{color:#xxx} 10%{...} ... } — nested braces, so regex
  // can't cleanly match the whole block. Find the opening, balance braces
  // forward to find the matching close, then scan the body for stops.
  const start = html.match(/@keyframes\s+x\s*\{/);
  if (!start) return [];
  let i = start.index + start[0].length;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  const body = html.slice(start.index + start[0].length, i);
  const stops = [];
  const re = /(\d+)%\s*\{\s*color\s*:\s*(#[0-9a-fA-F]+)/g;
  let s;
  while ((s = re.exec(body)) !== null) {
    stops.push({ pct: Number(s[1]), color: s[2] });
  }
  stops.sort((a, b) => a.pct - b.pct);
  return stops;
}

function parseClassAnimations(html) {
  // Matches .X{animation:x 8000ms 2000ms linear alternate both infinite;}
  // Some on-chain renderers also patch animation-timing-function: steps(1) via cssMod;
  // we apply the same patch below based on CHROMA/ZONE.
  const animClasses = {};
  const re = /\.([a-j])\s*\{\s*animation\s*:\s*x\s+(\d+)ms\s+(\d+)ms\s+(linear|steps\(\s*\d+\s*\))\s+(alternate|normal)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    animClasses[m[1]] = {
      dur: Number(m[2]),
      delay: Number(m[3]),
      timing: m[4].startsWith('steps') ? 'steps' : 'linear',
      direction: m[5],
    };
  }
  return animClasses;
}

function parseStaticColors(html) {
  // Matches .X{color:#xxx} but NOT the @keyframes block. Anchor on the leading dot
  // and an a–j class char with whitespace tolerance.
  const colors = {};
  const re = /\.([a-j])\s*\{\s*color\s*:\s*(#[0-9a-fA-F]+)\s*[;}]/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // skip if inside @keyframes — match prefix immediately before to be sure
    const idx = m.index;
    const prefix = html.slice(Math.max(0, idx - 30), idx);
    if (/@keyframes[^}]*$/.test(prefix)) continue;
    if (!(m[1] in colors)) colors[m[1]] = m[2];
  }
  return colors;
}

function parseBgColor(html) {
  const m = html.match(/\.r\s*\{[^}]*background-color\s*:\s*(#[0-9a-fA-F]+)/);
  return m ? m[1] : '#000';
}

function decodeScriptText(html) {
  // The <script> contents are HTML-encoded in the on-chain output.
  const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return '';
  return m[1]
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseScriptConstants(scriptText) {
  const num = (re) => {
    const m = scriptText.match(re);
    return m ? Number(m[1]) : null;
  };
  const str = (re) => {
    const m = scriptText.match(re);
    return m ? m[1] : null;
  };
  const constants = {
    SEED: num(/const\s+SEED\s*=\s*(\d+)/),
    BIOME: num(/let\s+BIOME\s*=\s*(\d+)/),
    DIRECTION: num(/let\s+DIRECTION\s*=\s*(\d+)/),
    RESOURCE: num(/let\s+RESOURCE\s*=\s*(\d+)/),
    ANTENNA: num(/let\s+ANTENNA\s*=\s*(\d+)/),
    MODE: num(/let\s+MODE\s*=\s*(\d+)/),
    CHROMA: str(/let\s+CHROMA\s*=\s*['"]([^'"]+)['"]/),
    ZONE: str(/let\s+ZONE\s*=\s*['"]([^'"]+)['"]/),
  };
  // BIOMECODE = ['0','.','.', ...]
  const bcMatch = scriptText.match(/let\s+BIOMECODE\s*=\s*(\[[^\]]+\])/);
  constants.BIOMECODE = bcMatch ? JSON.parse(bcMatch[1].replace(/'/g, '"')) : [];
  // bladeRailSequencer = [...]
  const blMatch = scriptText.match(/bladeRailSequencer\s*=\s*(\[[\s\S]*?\]);/);
  constants.bladeRailSequencer = blMatch ? JSON.parse(blMatch[1]) : [];
  return constants;
}

// Reproduce the on-chain `charSet` / `mainSet` construction. We treat MODE=1
// (Daydream) and ANTENNA=1 since the preview path forces both.
function buildCharSets(c) {
  const bCore = c.BIOMECODE.slice();
  // BIOME==0 && MODE>0 && ANTENNA==1 path pushes 5 spaces; doesn't apply for #1627.
  if (c.BIOME === 0) {
    for (let i = 0; i < 5; i++) bCore.push(' ');
  }

  const originalChars = bCore.slice();
  let patternBlade = [];
  if (c.bladeRailSequencer && c.bladeRailSequencer.length && c.BIOME != null && c.SEED != null) {
    const idx = (c.BIOME + c.SEED) % c.bladeRailSequencer.length;
    patternBlade = c.bladeRailSequencer[idx].split('').map((s) => (s === '▰' ? '░' : s));
  }

  // For SEED <= 9950 in non-Origin daydream, seedSet = [patternBlade] and
  // charSet = [originalChars, ...seedSet].flat(). We follow that case.
  const charSet = [...originalChars, ...patternBlade];
  const mainSet = originalChars.slice().reverse();

  // drive used by ANTENNA==0 h==0 path — kept for completeness even though
  // ANTENNA is forced to 1 in our preview.
  const drive = Math.max(0.1, Math.min(0.2, 0.1 + ((c.SEED || 0) / 10000) * 0.1));
  return { charSet, mainSet, drive, coreCharsetLength: bCore.length };
}

export async function prepareRenderer(html) {
  if (!html) throw new Error('canvasRenderer: no html supplied');
  const faces = extractFontFaces(html);
  const fontFamilies = await loadFonts(faces);

  const scriptText = decodeScriptText(html);
  const constants = parseScriptConstants(scriptText);
  // Preview path forces MODE=1, ANTENNA=1 — mirror that.
  constants.MODE = 1;
  constants.ANTENNA = 1;

  const keyframes = parseKeyframes(html);
  const animClasses = parseClassAnimations(html);
  const staticColors = parseStaticColors(html);
  const bg = parseBgColor(html);
  const { charSet, mainSet, drive, coreCharsetLength } = buildCharSets(constants);

  // Mirror the on-chain runtime timing-function patch: CHROMA="Flow" + certain
  // zones flip linear → steps(1). For #1627 (ZONE=Dhampir) the timing stays linear.
  if (
    constants.MODE > 0 &&
    constants.CHROMA === 'Flow' &&
    ['Alto', 'Holo', 'Radiant'].includes(constants.ZONE)
  ) {
    for (const k of Object.keys(animClasses)) animClasses[k].timing = 'steps';
  }

  return {
    fontFamilies,
    fontFamilyCss: fontFamilies.length
      ? fontFamilies.map((f) => `"${f}"`).join(', ') + ', monospace'
      : 'monospace',
    keyframes,
    animClasses,
    staticColors,
    bg,
    charSet,
    mainSet,
    drive,
    coreCharsetLength,
    constants,
  };
}

function parseHexColor(hex) {
  const s = hex.replace('#', '');
  if (s.length === 3) {
    return [
      parseInt(s[0] + s[0], 16),
      parseInt(s[1] + s[1], 16),
      parseInt(s[2] + s[2], 16),
    ];
  }
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

function lerpColor(c1, c2, t) {
  const a = parseHexColor(c1);
  const b = parseHexColor(c2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// Compute a class's current color at simulated page-time t (ms). Animated
// classes interpolate through the keyframe stops with respect to delay,
// duration, and `alternate` ping-pong; non-animated classes hold static color.
function colorAtTime(cls, t, state) {
  const anim = state.animClasses[cls];
  const staticColor = state.staticColors[cls] || '#fff';
  if (!anim || state.keyframes.length === 0) return staticColor;

  const localT = t - anim.delay;
  // animation-fill-mode: both → before delay, hold the 0% stop.
  if (localT < 0) return state.keyframes[0].color;

  const dur = anim.dur || 1;
  let phase; // 0..1 within the active half-cycle
  if (anim.direction === 'alternate') {
    const period = dur * 2;
    const localMod = localT % period;
    phase = localMod < dur ? localMod / dur : 1 - (localMod - dur) / dur;
  } else {
    phase = (localT % dur) / dur;
  }
  const pct = phase * 100;
  const stops = state.keyframes;
  if (pct <= stops[0].pct) return stops[0].color;
  if (pct >= stops[stops.length - 1].pct) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].pct <= pct && pct < stops[i + 1].pct) {
      if (anim.timing === 'steps') return stops[i].color;
      const span = stops[i + 1].pct - stops[i].pct;
      const frac = span > 0 ? (pct - stops[i].pct) / span : 0;
      return lerpColor(stops[i].color, stops[i + 1].color, frac);
    }
  }
  return stops[0].color;
}

// Paint one frame onto ctx. timeMs is the simulated time-since-page-load that
// drives CSS keyframe progress; airship grows from that (0.1 * ms per the
// on-chain terraLoop). caller sizes the canvas.
export function renderFrame(ctx, state, heightmap, timeMs, opts = {}) {
  const width = opts.width || ctx.canvas.width;
  const height = opts.height || ctx.canvas.height;
  const cellW = width / 32;
  const cellH = height / 32;
  // On-chain uses 14px in a 16px row; scale that ratio to whatever cell size we have.
  const fontPx = Math.max(6, Math.round(cellH * (14 / 16)));

  ctx.fillStyle = state.bg || '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.font = `${fontPx}px ${state.fontFamilyCss}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const airship = 0.1 * timeMs;
  const charSetLen = state.charSet.length;
  const mainSetLen = state.mainSet.length;
  const SEED = state.constants.SEED || 0;

  // Cache per-class color and per-height character so we don't recompute them 1024×.
  const classColors = {};
  for (const cls of HEIGHT_TO_CLASS) {
    if (classColors[cls] == null) classColors[cls] = colorAtTime(cls, timeMs, state);
  }
  classColors.j = state.staticColors.j || state.bg || '#000';
  const heightChars = new Array(10);
  for (let h = 1; h < 10; h++) {
    let idx = Math.floor(airship * 0.15 - h) % charSetLen;
    if (idx < 0) idx += charSetLen;
    heightChars[h] = decodeEntity(state.charSet[idx] ?? ' ');
  }

  for (let r = 0; r < 32; r++) {
    for (let c = 0; c < 32; c++) {
      const h = heightmap.charCodeAt(r * 32 + c) - 48;
      if (h < 0 || h > 9) continue;
      const cls = HEIGHT_TO_CLASS[h] || 'a';
      const color = classColors[cls] || '#fff';
      let ch;
      if (h === 0) {
        // ANTENNA>0 path: per-cell m1 depends on position + airship.
        const m1 = Math.hypot(r - c, c - 15.5) + airship * 0.05 * SEED * 0.00045;
        const idx = Math.abs(Math.floor(m1)) % Math.max(1, mainSetLen);
        ch = decodeEntity(state.mainSet[idx] ?? ' ');
      } else {
        ch = heightChars[h];
      }
      ctx.fillStyle = color;
      ctx.fillText(ch, c * cellW + cellW / 2, r * cellH + cellH / 2);
    }
  }
}
