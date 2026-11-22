/* =====================================================================
   VICE — scène 3D temps réel (WebGL, aucune bibliothèque)
   Ciel atmosphérique, soleil / lune, nuages, skyline avec fenêtres et
   néons, voitures, hélicoptère, mer animée avec reflets, grain film.
   API : World.init(canvas) · World.setNight(0..1, animé?) · World.set({scroll, dim, dimColor})
   ===================================================================== */
(() => {
  "use strict";

  const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

  const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime, uNight, uScroll, uDim, uAspect;
uniform vec2  uCam;
uniform vec3  uDimCol;

const float HOR = -0.12;

float h1(float n){ return fract(sin(n) * 43758.5453123); }
float h2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; }
  return v;
}
float fbm3(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 3; i++){ v += a * noise(p); p = p * 2.07 + vec2(11.3, 4.7); a *= .5; }
  return v;
}

/* ---------- éclairage selon l'heure : 0 = jour, .5 = coucher, 1 = nuit ---------- */
vec3 TOP, MID, HORC, SUNC; vec2 SUNP, MOONP; float SUNR, SUNVIS, NIGHT, DAY, DUSK;
void palette(float n){
  vec3 dT = vec3(.08,.30,.74), dM = vec3(.36,.62,.92), dH = vec3(.86,.90,.95), dS = vec3(1.,.97,.90);
  vec3 sT = vec3(.10,.07,.30), sM = vec3(.66,.22,.46), sH = vec3(1.,.48,.20), sS = vec3(1.,.55,.25);
  vec3 nT = vec3(.008,.007,.03), nM = vec3(.05,.028,.12), nH = vec3(.34,.10,.26), nS = vec3(.9,.35,.3);
  float a = smoothstep(0., .5, n), b = smoothstep(.5, 1., n);
  TOP = mix(mix(dT, sT, a), nT, b);  MID = mix(mix(dM, sM, a), nM, b);
  HORC = mix(mix(dH, sH, a), nH, b); SUNC = mix(mix(dS, sS, a), nS, b);
  float asp = min(uAspect, 1.8) * .5;
  SUNP  = vec2(mix(.42 * asp, 0., smoothstep(0., .5, n)), HOR - .16 + .58 * pow(1. - n, 1.6));   // le soleil descend en arc
  SUNR  = mix(.028, .052, smoothstep(0., .5, n));
  MOONP = vec2(-.55 * asp, HOR + .40);
  SUNVIS = smoothstep(-.06, .02, SUNP.y - HOR);
  NIGHT = smoothstep(.55, 1., n);
  DAY = 1. - smoothstep(0., .6, n);
  DUSK = smoothstep(.15, .5, n) * (1. - smoothstep(.5, .85, n));
}

/* ---------- ciel : 0 = sans nuages, 1 = nuages rapides, 2 = nuages complets ---------- */
vec3 sky(vec2 p, int q){
  float y = p.y - HOR;
  vec3 c = mix(HORC, MID, smoothstep(0., .22, y));
  c = mix(c, TOP, smoothstep(.14, .85, y));
  vec2 sd = (p - SUNP) * vec2(.8, 1.);
  float d = length(sd);
  c += SUNC * (exp(-d * 2.6) * .30 + exp(-d * 9.) * .45 + exp(-d * 40.) * .6) * (1. - NIGHT * .8);   // diffusion (Mie)
  c += HORC * exp(-max(y, 0.) * 14.) * .20;
  if (q > 0){
    vec2 cp = vec2(p.x * 1.25 * (1. + 1.6 * exp(-y * 9.)) + uTime * .006, y * 2.4);
    float cl, sh;
    if (q == 2){
      vec2 w = vec2(fbm3(cp * 1.4 + 3.1), fbm3(cp * 1.4 + 7.7));
      cl = fbm(cp * vec2(2.0, 2.8) + w * 1.1);
      sh = fbm(cp * vec2(2.0, 2.8) + w * 1.1 + normalize(SUNP - p + .0001) * vec2(.07, .10));   // auto-ombrage
    } else { cl = fbm3(cp * vec2(2.0, 2.8)); sh = cl; }
    float band = smoothstep(.0, .05, y) * smoothstep(.85, .30, y);
    float dens = smoothstep(.50, .70, cl) * band;
    float light = clamp(.55 + (cl - sh) * 7., 0., 1.);
    vec3 dayC  = mix(vec3(.58,.64,.76), vec3(1.02), light);
    vec3 duskC = mix(vec3(.32,.12,.30), SUNC * 1.25 + vec3(.15,.05,.1), light * (.6 + .6 * exp(-length(p - SUNP) * 1.6)));
    vec3 nightC = mix(vec3(.05,.03,.09), vec3(.20,.07,.18), light * .4) + HORC * .30 * smoothstep(.35, .02, y);
    vec3 cc = mix(mix(dayC, duskC, smoothstep(.05, .5, uNight)), nightC, NIGHT);
    c = mix(c, cc, dens * .92);
  }
  return c;
}

/* ---------- skyline : 3 plans (loin → près), volumes éclairés ---------- */
float profile(float x){
  float u = x / max(uAspect * .5, .3);
  float l = exp(-pow((u + .55) / .30, 2.)), r = exp(-pow((u - .60) / .26, 2.));
  return (.26 + 1.1 * l + .9 * r) * (1. - .7 * exp(-pow(u / .2, 2.)));
}
vec4 city(vec2 p, bool refl){
  vec4 res = vec4(0.);
  float y = p.y - HOR;
  if (y < 0. || y > .28) return res;
  for (int L = 0; L < 3; L++){
    float dep = float(L) / 2.;
    float sc = mix(34., 17., dep);
    float x = p.x * sc + dep * 13.7 + 5.;
    float id = floor(x), fx = fract(x);
    float r = h1(id * 1.31 + dep * 101.), r2 = h1(id * 2.77 + dep * 17.), r3 = h1(id * 4.13 + dep * 3.);
    float w = .74 + .26 * r3;
    float hb = (.010 + r * r * .115) * profile((id + .5 - dep * 13.7 - 5.) / sc) * mix(.6, 1., dep);
    float set = step(.55, r2);                                   // étage supérieur en retrait
    float wTop = w * mix(1., .62, set);
    float wHere = (y > hb * .72) ? wTop : w;
    float edge = abs(fx - .5) * 2.;
    float spire = step(.84, r) * .028;
    if (edge < wHere && y < hb){
      float haze = mix(.70, .10, dep);
      float u = (fx - .5) / wHere + .5;                          // 0..1 sur la largeur
      float split = .5 + (r3 - .5) * .5;
      float lit = (u < split) ? 1. : .58;                         // face au soleil / face à l'ombre
      if (SUNP.x < p.x) lit = (u < split) ? .58 : 1.;
      vec3 base = mix(vec3(.62,.68,.76), vec3(.86,.83,.78), r2);  // béton clair / verre bleuté
      base = mix(base, vec3(.42,.58,.72), step(.7, r3) * .6);
      float floors = .93 + .07 * step(.5, fract(y * mix(420., 230., dep)));
      vec3 dayCol = base * lit * floors * mix(vec3(1.), SUNC, .25);
      dayCol = mix(dayCol, HORC, haze * .85 + (1. - y / hb) * .08);
      vec3 duskCol = mix(vec3(.10,.06,.16), vec3(.30,.14,.22), haze) + SUNC * .25 * (lit - .58) * 2.;
      vec3 nightCol = vec3(.014,.012,.03) + HORC * .07 * haze;
      vec3 col = mix(mix(dayCol, duskCol, smoothstep(.1, .5, uNight)), nightCol, smoothstep(.5, .9, uNight));
      // fenêtres (fines, bords doux)
      float cols = floor(4. + h1(id * 5.1 + dep) * 7.) * (wHere / w);
      vec2 g = vec2(u * cols * 1.4, y * mix(760., 440., dep));
      vec2 cell = floor(g), f = fract(g);
      float win = smoothstep(.18, .30, f.x) * smoothstep(.82, .70, f.x) * smoothstep(.28, .40, f.y) * smoothstep(.80, .68, f.y);
      float rnd = h2(cell + id * 7.13 + dep * 31.);
      float on = step(rnd, smoothstep(.30, 1., uNight) * .58);
      float bright = .55 + .65 * h2(cell * 1.7 + id);
      vec3 wc = mix(vec3(1.,.78,.46), vec3(.70,.86,1.), step(.74, h2(cell + 3.7)));
      col += win * on * wc * bright * mix(.8, 1.3, dep) * (1. - haze * .6);
      // reflets du ciel dans les vitres (jour) et liseré de lumière sur l'arête éclairée
      col = mix(col, sky(vec2(p.x, HOR + .25 - y * .5), 0) * 1.05, win * DAY * .45 * step(.6, r3));
      col += SUNC * smoothstep(.012, .0, abs(u - (SUNP.x < p.x ? 1. : 0.)) * wHere / sc * 60.) * DUSK * .5;
      // néons sur les toits (plans proches)
      float neon = step(.70, h1(id * 3.1 + dep * 2.)) * step(.4, dep);
      vec3 nc = mix(vec3(1.,.16,.6), vec3(.08,.9,1.), step(.5, h1(id * 9.7)));
      float rim = smoothstep(.0035, .0, hb - y) * neon;
      col += rim * nc * 2.4 * smoothstep(.55, .9, uNight);
      res = vec4(col, 1.);
    } else if (y >= hb && y < hb + spire && edge < .05){
      res = vec4(mix(vec3(.45,.48,.55), vec3(.02), smoothstep(.3, .8, uNight)), 1.);
    } else if (res.a < 1.){
      float neon = step(.70, h1(id * 3.1 + dep * 2.)) * step(.4, dep);
      vec3 nc = mix(vec3(1.,.16,.6), vec3(.08,.9,1.), step(.5, h1(id * 9.7)));
      res.rgb += nc * neon * exp(-max(y - hb, 0.) * 80.) * step(edge, wTop) * .4 * smoothstep(.55, .9, uNight);
    }
    float bd = length(vec2((fx - .5) / sc, (y - hb - spire) * 1.));
    res.rgb += vec3(1., .12, .1) * step(.84, r) * smoothstep(.004, .0, bd) * step(.5, fract(uTime * .8 + r * 3.)) * 2.5 * smoothstep(.4, .8, uNight);
  }
  return res;
}

vec3 road(vec2 p){
  float y = p.y - HOR;
  float band = smoothstep(.0016, .0, abs(y - .0016));
  float n = smoothstep(.45, .9, uNight);
  float a = p.x * 80. + uTime * 1.6;  float ca = step(.55, h1(floor(a)))  * smoothstep(.25, .0, abs(fract(a) - .5));
  float b = p.x * 80. - uTime * 1.3;  float cb = step(.55, h1(floor(b) + 40.)) * smoothstep(.25, .0, abs(fract(b) - .5));
  return band * (ca * vec3(1., .95, .85) + cb * vec3(1., .15, .1) * .8) * n;
}

vec3 heli(vec2 p){
  float n = smoothstep(.55, 1., uNight);
  if (n <= 0.) return vec3(0.);
  vec2 hp = vec2((mod(uTime * .022, 3.2) - 1.6) * uAspect * .6, HOR + .25 + .012 * sin(uTime * .6));
  vec2 q = p - hp;
  vec3 c = vec3(1., .2, .15) * smoothstep(.003, .0, length(q)) * step(.5, fract(uTime * 1.1)) * 3.;
  c += vec3(1.) * smoothstep(.0022, .0, length(q - vec2(.006, 0.))) * step(.85, fract(uTime * .9)) * 3.;
  float along = -q.y;
  if (along > 0.){
    float sway = sin(uTime * .4) * .25 + .3;
    float width = along * .15 + .002;
    c += vec3(.85,.92,1.) * smoothstep(width, width * .15, abs(q.x + along * sway)) * exp(-along * 4.) * .14;
  }
  return c * n;
}

void main(){
  palette(uNight);
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  uv = uv / (1. + uScroll * .16) + vec2(0., mix(-.075, .02, smoothstep(.0, .65, uScroll)));   // caméra cadrée sur la ville, puis travelling
  vec2 ps = uv + uCam * vec2(.006, .004);
  vec2 pc = uv + uCam * vec2(.016, .004);
  vec3 col;

  if (uv.y > HOR){
    col = sky(ps, 2);
    vec2 sg = ps * 230.;
    float s = h2(floor(sg));
    float star = smoothstep(.18, .0, length(fract(sg) - .5)) * step(.9965, s);
    col += star * (.6 + .4 * sin(uTime * 2.3 + s * 90.)) * smoothstep(.05, .35, ps.y - HOR) * NIGHT * 1.4;
    float d = length(ps - SUNP);
    col = mix(col, SUNC * mix(2.6, 1.8, DUSK) + vec3(.2,.18,.1), smoothstep(SUNR, SUNR * .9, d) * SUNVIS);
    float md = length(ps - MOONP);
    vec3 mcol = vec3(.95,.93,.86) * (.80 + .20 * fbm((ps - MOONP) * 90.));
    col = mix(col, mcol, smoothstep(.030, .027, md) * NIGHT);
    col += vec3(.7,.75,.9) * (exp(-md * 14.) * .16 + exp(-md * 50.) * .2) * NIGHT;
    vec4 c = city(pc, false);
    col = mix(col, c.rgb, c.a) + (1. - c.a) * c.rgb;
    col += road(pc) + heli(ps);
  } else {
    float d = HOR - uv.y;
    float z = 1. / (d * 3.2 + .012);
    vec2 wp = vec2(uv.x * z * .8, z * 1.1);
    float w1 = fbm3(wp * vec2(1.2, 1.) + vec2(uTime * .05, uTime * .14));
    float rip = noise(vec2(uv.x * z * 2.5, z * 9. + uTime * .9));             // vaguelettes horizontales
    float rip2 = noise(vec2(uv.x * z * 6., z * 22. - uTime * 1.3));
    vec2 nrm = vec2(w1 - .5, (rip - .5) * .7 + (rip2 - .5) * .5);
    float k = min(d * 6., 1.);
    vec2 rp = vec2(uv.x + nrm.x * .045 * k + (rip2 - .5) * .012 * k, HOR + d * .7 + nrm.y * .045 * k);
    vec3 refl = sky(rp + uCam * vec2(.006, 0.), 1);
    vec4 rc = city(vec2(rp.x + uCam.x * .016, rp.y), true);
    refl = mix(refl, rc.rgb * .85, rc.a) + (1. - rc.a) * rc.rgb * .7;
    refl *= .82 + .3 * rip;                                                    // crêtes qui captent la lumière
    float fres = .10 + .90 * exp(-d * 7.5);
    vec3 deep = mix(mix(vec3(.0,.40,.50), vec3(.0,.16,.28), smoothstep(0., .5, d)), vec3(.004,.006,.02), smoothstep(.35, .95, uNight));
    deep = mix(deep, vec3(.16,.06,.16), DUSK * .6);
    col = mix(deep, refl, fres);
    float path = exp(-pow((uv.x - SUNP.x - nrm.x * .14) / (.025 + d * .5 + SUNR * .6), 2.));
    float sparkle = pow(noise(vec2(uv.x * z * 10., z * 8. + uTime * 1.6)), 5.) * 6.;
    col += SUNC * path * (.18 + sparkle) * SUNVIS * mix(1.2, .9, DUSK);
    float mpath = exp(-pow((uv.x - MOONP.x - nrm.x * .1) / (.01 + d * .22), 2.));
    col += vec3(.8,.85,1.) * mpath * pow(noise(vec2(uv.x * z * 10., z * 8. + uTime)), 4.) * 2.4 * NIGHT;
    col = mix(col, HORC, exp(-d * 70.) * .45);
  }

  col = 1. - exp(-col * 1.35);
  float v = length((gl_FragCoord.xy / uRes - .5) * vec2(1., .9));
  col *= 1. - .42 * smoothstep(.35, .95, v);
  col += (h2(gl_FragCoord.xy + fract(uTime * 7.3) * 371.) - .5) * .04;
  col = mix(col, uDimCol, uDim);
  gl_FragColor = vec4(col, 1.);
}`;

  const S = {
    gl: null, prog: null, u: {}, canvas: null,
    night: 1, from: 1, to: 1, t0: 0, dur: 2800,
    scroll: 0, dim: 0, dimTo: 0, dimCol: [0.047, 0.024, 0.078], dimColTo: [0.047, 0.024, 0.078],
    cam: [0, 0], camTo: [0, 0], scale: .85, frames: [], last: 0, still: false, running: false
  };

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function init(canvas, opts = {}) {
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    if (!gl) return false;
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ["uRes", "uTime", "uNight", "uScroll", "uDim", "uAspect", "uCam", "uDimCol"].forEach(n => S.u[n] = gl.getUniformLocation(prog, n));
      Object.assign(S, { gl, prog, canvas, still: !!opts.still });
    } catch (e) {
      console.warn("WebGL indisponible :", e.message);
      return false;
    }
    S.night = S.from = S.to = opts.night ?? 1;
    resize();
    addEventListener("resize", resize);
    S.running = true;
    requestAnimationFrame(frame);
    return true;
  }

  function resize() {
    const c = S.canvas;
    const w = innerWidth, h = innerHeight;
    const cap = Math.min(1, 1600 / Math.max(w, h));                    // limite la résolution sur grands écrans
    c.width = Math.max(2, Math.round(w * S.scale * cap));
    c.height = Math.max(2, Math.round(h * S.scale * cap));
    S.gl && S.gl.viewport(0, 0, c.width, c.height);
  }

  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function frame(now) {
    if (!S.running) return;
    requestAnimationFrame(frame);
    // quand la scène est très atténuée, 30 i/s suffisent
    if (S.dim > .6 && now - S.last < 30) return;
    const dt = now - S.last; S.last = now;

    const k = Math.min(1, (now - S.t0) / S.dur);
    S.night = S.from + (S.to - S.from) * ease(k);
    S.dim += (S.dimTo - S.dim) * .08;
    for (let i = 0; i < 3; i++) S.dimCol[i] += (S.dimColTo[i] - S.dimCol[i]) * .06;
    S.cam[0] += (S.camTo[0] - S.cam[0]) * .05;
    S.cam[1] += (S.camTo[1] - S.cam[1]) * .05;

    const gl = S.gl, u = S.u, c = S.canvas;
    gl.uniform2f(u.uRes, c.width, c.height);
    gl.uniform1f(u.uTime, S.still ? 20 : now / 1000);
    gl.uniform1f(u.uNight, S.night);
    gl.uniform1f(u.uScroll, S.scroll);
    gl.uniform1f(u.uDim, S.dim);
    gl.uniform1f(u.uAspect, c.width / c.height);
    gl.uniform2f(u.uCam, S.cam[0], S.cam[1]);
    gl.uniform3f(u.uDimCol, ...S.dimCol);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // résolution adaptative selon la fluidité réelle
    if (dt > 0 && dt < 200 && S.dim < .6) {
      S.frames.push(dt);
      if (S.frames.length >= 40) {
        const avg = S.frames.reduce((a, b) => a + b) / S.frames.length;
        S.frames = [];
        const prev = S.scale;
        if (avg > 24 && S.scale > .55) S.scale = Math.max(.55, S.scale - .1);
        else if (avg < 14 && S.scale < 1) S.scale = Math.min(1, S.scale + .05);
        if (prev !== S.scale) resize();
      }
    }
  }

  window.World = {
    init,
    setNight(v, animate = true) {
      S.from = S.night; S.to = v; S.t0 = performance.now(); S.dur = animate ? 2800 : 1;
      if (!animate) S.night = S.from = v;
    },
    set(o) {
      if ("scroll" in o) S.scroll = o.scroll;
      if ("dim" in o) S.dimTo = o.dim;
      if ("dimColor" in o) S.dimColTo = o.dimColor.slice();
      if ("cam" in o) S.camTo = o.cam.slice();
    },
    snapDim() { S.dim = S.dimTo; S.dimCol = S.dimColTo.slice(); }
  };
})();
