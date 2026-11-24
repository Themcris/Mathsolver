// especiales.js — Casos que el motor numérico (C) rechaza o resuelve sin explicar:
//   · logaritmo con base:      log(8,2) -> 3        (exacto cuando es posible, cambio de base si no)
//   · logaritmo con variable:  log(x,2) -> log₂(x) = ln(x)/ln(2)   (dominio y cambio de base)
//   · raíz de un negativo:     sqrt(-8) -> 2√2·i    (unidad imaginaria)
// Sin dependencias ni DOM. Cada respuesta: { ok, resultado, latex, pasos, nivel, verificado, metodo }.
import { Frac } from './frac.js';
import { parsear, str, tex, evalAST, simbolos } from './motorPasos.js';

const NUM = '(\\d+(?:[.,]\\d+)?(?:/\\d+)?)';
const RE_LOG = new RegExp(`^(?:log|log_?)\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)$`, 'i');
const RE_RAIZ = new RegExp(`^(?:sqrt|√)\\(\\s*[-−]\\s*(\\d+)\\s*\\)$`, 'i');
const LIMITE = 10n ** 12n;

const paso = (descripcion, latex, ecuacion, profundidad = 0) => ({ descripcion, latex, ecuacion, profundidad });

const texFrac = (f) => (f.d === 1n ? `${f.n}` : `${f.n < 0n ? '-' : ''}\\frac{${f.n < 0n ? -f.n : f.n}}{${f.d}}`);

/** Factores primos de n (BigInt) -> Map(primo -> exponente), o null si es demasiado grande. */
function primos(n) {
  if (n > LIMITE) return null;
  const m = new Map();
  let x = n;
  for (let p = 2n; p * p <= x; p += p === 2n ? 1n : 2n) {
    while (x % p === 0n) { m.set(p, (m.get(p) ?? 0) + 1); x /= p; }
  }
  if (x > 1n) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
const potencias = (m) => [...m].map(([p, e]) => (e > 1 ? `${p}^${e}` : `${p}`)).join(' · ') || '1';
const potenciasTex = (m) => [...m].map(([p, e]) => (e > 1 ? `${p}^{${e}}` : `${p}`)).join(' \\cdot ') || '1';

/** Vector de exponentes con signo de una fracción positiva: 1/8 -> {2: -3}. */
function exponentes(f) {
  const a = primos(f.n), b = primos(f.d);
  if (!a || !b) return null;
  const v = new Map(a);
  for (const [p, e] of b) v.set(p, (v.get(p) ?? 0) - e);
  return v;
}

const RE_BASE = /^(?:[-−]?\d+(?:[.,]\d+)?(?:\/\d+)?|e)$/;

/** log(argumento, base) con argumento algebraico (con variables) y base numérica o e. */
function detectarLogSimbolico(t) {
  const m = t.match(/^log\((.+)\)$/i);
  if (!m) return null;
  const cuerpo = m[1];
  let prof = 0, coma = -1;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '(') prof++;
    else if (c === ')') { prof--; if (prof < 0) return null; }
    else if (c === ',' && prof === 0) { if (coma >= 0) return null; coma = i; }
  }
  if (coma < 1 || prof !== 0) return null;
  const arg = cuerpo.slice(0, coma), base = cuerpo.slice(coma + 1);
  if (!RE_BASE.test(base)) return null;
  try {
    const ast = parsear(arg);
    if (!simbolos(ast).size) {
      const v = evalAST(ast, {});
      // Argumento numérico entero positivo con base numérica: lo resuelve el camino exacto.
      return Number.isInteger(v) && v > 0 && base !== 'e' ? { tipo: 'log_base', a: String(v), b: base.replace(',', '.') } : null;
    }
    return { tipo: 'log_simbolico', arg, base };
  } catch { return null; }
}

export function detectarEspecial(texto) {
  const t = String(texto ?? '').trim().replace(/\s+/g, '').replace(/−/g, '-');
  let m = t.match(RE_LOG);
  if (m) return { tipo: 'log_base', a: m[1], b: m[2] };
  const ls = detectarLogSimbolico(t);
  if (ls) return ls;
  m = t.match(RE_RAIZ);
  if (m) return { tipo: 'raiz_negativa', n: BigInt(m[1]) };
  return null;
}

// ───────────── log_b(a) ─────────────
function resolverLogBase(a, b) {
  const A = Frac.parse(a), B = Frac.parse(b);
  if (!A || !B) return { ok: false, mensaje: 'Los números del logaritmo no son válidos.' };
  if (A.n <= 0n) return { ok: false, mensaje: 'El logaritmo solo existe para números positivos (el argumento debe ser mayor que 0).' };
  if (B.n <= 0n || B.eq(1)) return { ok: false, mensaje: 'La base del logaritmo debe ser positiva y distinta de 1.' };

  const ta = A.toString(), tb = B.toString();
  const pasos = [paso('Expresión original', `\\log_{${tb}}\\left(${ta}\\right)`, `log(${ta}, ${tb})`)];
  pasos.push(paso('Significado: log_b(a) es el exponente x al que hay que elevar la base b para obtener a',
    `\\log_{${tb}}(${ta}) = x \\iff ${tb}^{x} = ${ta}`, `log_${tb}(${ta}) = x  <=>  ${tb}^x = ${ta}`));

  // ¿Es exacto? Las dos cantidades deben ser potencias del mismo conjunto de primos con exponentes proporcionales.
  let exacto = null;
  if (A.eq(1)) exacto = new Frac(0);
  else {
    const ea = exponentes(A), eb = exponentes(B);
    if (ea && eb && ea.size === eb.size) {
      let r = null, ok = true;
      for (const [p, e] of ea) {
        const f = eb.get(p);
        if (!f) { ok = false; break; }
        const q = new Frac(e, f);
        if (r === null) r = q; else if (!r.eq(q)) { ok = false; break; }
      }
      if (ok && r) exacto = r;
    }
  }

  if (exacto) {
    if (!A.eq(1)) {
      pasos.push(paso('Descomponemos en factores primos para ver cuántas veces cabe la base en el argumento',
        `${ta} = ${potenciasTex(exponentes(A))},\\qquad ${tb} = ${potenciasTex(exponentes(B))}`,
        `${ta} = ${potencias(exponentes(A))}, ${tb} = ${potencias(exponentes(B))}`));
    }
    pasos.push(paso(exacto.isInt() ? `Como ${tb}^${exacto} = ${ta}, el exponente buscado es ${exacto}` : `Como ${tb}^(${exacto}) = ${ta}, el exponente buscado es ${exacto}`,
      `${tb}^{${texFrac(exacto)}} = ${ta} \\;\\Rightarrow\\; x = ${texFrac(exacto)}`, `${tb}^(${exacto}) = ${ta}  =>  x = ${exacto}`));
    // Comprobación independiente: b^x = a con x entero (o con potencias enteras si x es racional).
    let verificado = true;
    if (exacto.isInt() && Math.abs(Number(exacto.n)) <= 200) {
      const k = Number(exacto.n);
      verificado = (k >= 0 ? B.pow(k) : new Frac(1).div(B.pow(-k))).eq(A);
    }
    return { ok: verificado, mensaje: verificado ? undefined : 'No se pudo verificar el logaritmo.', resultado: exacto.toString(), latex: texFrac(exacto), pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado, metodo: 'especiales' };
  }

  // No es una potencia exacta: fórmula de cambio de base.
  const va = A.toNumber(), vb = B.toNumber();
  const lnA = Math.log(va), lnB = Math.log(vb), val = lnA / lnB;
  const f = (x) => Number(x.toPrecision(10)).toString();
  pasos.push(paso('El argumento no es una potencia exacta de la base: usamos el cambio de base log_b(a) = ln(a) / ln(b)',
    `\\log_{${tb}}(${ta}) = \\dfrac{\\ln(${ta})}{\\ln(${tb})}`, `log_${tb}(${ta}) = ln(${ta}) / ln(${tb})`));
  pasos.push(paso('Calculamos cada logaritmo natural', `\\ln(${ta}) \\approx ${f(lnA)},\\qquad \\ln(${tb}) \\approx ${f(lnB)}`, `ln(${ta}) ≈ ${f(lnA)}, ln(${tb}) ≈ ${f(lnB)}`));
  pasos.push(paso('Dividimos', `\\dfrac{${f(lnA)}}{${f(lnB)}} \\approx ${f(val)}`, `${f(lnA)} / ${f(lnB)} ≈ ${f(val)}`));
  const verificado = Number.isFinite(val) && Math.abs(Math.pow(vb, val) - va) <= 1e-6 * Math.abs(va);
  return { ok: verificado, mensaje: verificado ? undefined : 'No se pudo verificar el logaritmo.', resultado: `≈ ${f(val)}`, latex: `\\approx ${f(val)}`, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado, metodo: 'especiales' };
}

// ───────────── √(−n) ─────────────
function resolverRaizNegativa(n) {
  if (n === 0n) return { ok: true, resultado: '0', latex: '0', pasos: [paso('Expresión original', '\\sqrt{0}', 'sqrt(0)'), paso('La raíz de 0 es 0', '\\sqrt{0} = 0', 'sqrt(0) = 0')].map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado: true, metodo: 'especiales' };
  const pr = primos(n);
  if (!pr) return { ok: false, mensaje: 'El número es demasiado grande para simplificar su raíz.' };
  let k = 1n, m = 1n;
  for (const [p, e] of pr) { k *= p ** BigInt(Math.floor(e / 2)); if (e % 2) m *= p; }
  const pasos = [paso('Expresión original', `\\sqrt{-${n}}`, `sqrt(-${n})`)];
  pasos.push(paso('Dentro de los números reales no existe la raíz de un negativo: se usa la unidad imaginaria i, con i² = −1',
    `\\sqrt{-${n}} = \\sqrt{${n}}\\cdot\\sqrt{-1} = \\sqrt{${n}}\\cdot i`, `sqrt(-${n}) = sqrt(${n}) · sqrt(-1) = sqrt(${n}) · i`));
  let tex, plano;
  if (m === 1n) {
    pasos.push(paso(`${n} es un cuadrado perfecto: √${n} = ${k}`, `\\sqrt{${n}} = ${k}`, `sqrt(${n}) = ${k}`));
    tex = `${k}i`; plano = `${k}i`;
  } else if (k === 1n) {
    tex = `\\sqrt{${m}}\\, i`; plano = `√${m}·i`;
    pasos.push(paso(`${n} no tiene factores cuadrados: √${n} ya está simplificada`, `\\sqrt{${n}}`, `sqrt(${n})`));
  } else {
    pasos.push(paso('Extraemos los factores cuadrados de la raíz', `\\sqrt{${n}} = \\sqrt{${potenciasTex(pr)}} = ${k}\\sqrt{${m}}`, `sqrt(${n}) = sqrt(${potencias(pr)}) = ${k}·sqrt(${m})`));
    tex = `${k}\\sqrt{${m}}\\, i`; plano = `${k}√${m}·i`;
  }
  pasos.push(paso('Resultado: número imaginario puro', `\\sqrt{-${n}} = ${tex}`, `sqrt(-${n}) = ${plano}`));
  const verificado = k * k * m === n;
  return { ok: verificado, mensaje: verificado ? undefined : 'No se pudo verificar la raíz.', resultado: plano, latex: tex, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado, metodo: 'especiales' };
}

// ───────────── log_b(u) con u algebraico ─────────────
function resolverLogSimbolico(argTxt, baseTxt) {
  const esE = baseTxt === 'e';
  const B = esE ? null : Frac.parse(baseTxt.replace('−', '-').replace(',', '.'));
  if (!esE && !B) return { ok: false, mensaje: 'La base del logaritmo no es un número válido.' };
  if (!esE && B.n <= 0n) return { ok: false, mensaje: 'La base de un logaritmo debe ser positiva (mayor que 0).' };
  if (!esE && B.eq(1)) return { ok: false, mensaje: 'La base de un logaritmo no puede ser 1: 1 elevado a cualquier número siempre da 1.' };
  const ast = parsear(argTxt);
  const u = str(ast), uT = tex(ast);
  const tb = esE ? 'e' : B.toString(), tbT = esE ? 'e' : texFrac(B);
  const simple = /^[a-z]$/i.test(u);
  const U = `(${u})`, UT = simple ? `(${uT})` : `\\left(${uT}\\right)`;
  const vb = esE ? Math.E : B.toNumber();
  const lnB = Math.log(vb);
  const f = (x) => Number(x.toPrecision(10)).toString();
  const pasos = [paso('Expresión original: logaritmo de una expresión con variable', `\\log_{${tbT}}${UT}`, `log(${u}, ${tb})`)];
  pasos.push(paso('Condiciones: la base debe ser positiva y distinta de 1, y el argumento debe ser positivo',
    `${tbT} > 0,\\; ${tbT} \\neq 1,\\; ${uT} > 0`, `${tb} > 0,  ${tb} ≠ 1,  ${u} > 0`));
  if (esE) {
    pasos.push(paso('Un logaritmo de base e es el logaritmo natural', `\\log_{e}${UT} = \\ln${UT}`, `log_e${U} = ln${U}`));
    pasos.push(paso('Resultado (válido donde ' + u + ' > 0)', `\\ln${UT},\\quad ${uT} > 0`, `ln${U},  ${u} > 0`));
    return fin(ast, vb, 'ln' + U, `\\ln${UT}`, pasos);
  }
  pasos.push(paso('Definición: log_b(u) = y significa b^y = u. Para obtener y con logaritmos naturales se aplica ln a ambos lados: y · ln(b) = ln(u)',
    `\\log_{${tbT}}${UT} = y \\iff ${tbT}^{y} = ${UT} \\Rightarrow y\\,\\ln(${tbT}) = \\ln${UT}`, `log_${tb}${U} = y  <=>  ${tb}^y = ${u}  =>  y·ln(${tb}) = ln${U}`));
  pasos.push(paso('Despejamos y: fórmula del cambio de base', `y = \\dfrac{\\ln${UT}}{\\ln(${tbT})}`, `y = ln${U} / ln(${tb})`));
  if (lnB !== 0) {
    pasos.push(paso(`Valor de ln(${tb}) (aproximado), útil para evaluar`, `\\ln(${tbT}) \\approx ${f(lnB)}\\;\\Rightarrow\\; \\dfrac{1}{\\ln(${tbT})} \\approx ${f(1 / lnB)}`, `ln(${tb}) ≈ ${f(lnB)}  =>  1/ln(${tb}) ≈ ${f(1 / lnB)}`));
  }
  pasos.push(paso(`Resultado (válido donde ${u} > 0)`, `\\log_{${tbT}}${UT} = \\dfrac{\\ln${UT}}{\\ln(${tbT})},\\quad ${uT} > 0`, `log_${tb}${U} = ln${U} / ln(${tb}),  ${u} > 0`));
  return fin(ast, vb, `ln${U}/ln(${tb})`, `\\dfrac{\\ln${UT}}{\\ln(${tbT})}`, pasos, `log_${tb}${U} = `, `\\log_{${tbT}}${UT} = `);

  function fin(a, b, txt, texto, ps, pre = '', preT = '') {
    // Comprobación independiente: con el valor y calculado, b^y debe devolver el argumento (en puntos donde u > 0).
    const vars = [...simbolos(a)];
    const pts = [0.7, 1.3, 2.1, 0.35, 3.9, 1.6, 5.2, 0.15];
    let ok = 0, malo = false;
    for (let i = 0; i < pts.length; i++) {
      const env = Object.fromEntries(vars.map((v, j) => [v, pts[(i + 2 * j) % pts.length]]));
      const uv = evalAST(a, env);
      if (!(uv > 0) || !Number.isFinite(uv)) continue;
      const y = Math.log(uv) / Math.log(b);
      if (Math.abs(Math.pow(b, y) - uv) > 1e-9 * (1 + uv)) malo = true;
      ok++;
    }
    const verificado = !malo && ok >= 2;
    return { ok: verificado, mensaje: verificado ? undefined : 'No se pudo verificar el logaritmo.', resultado: pre + txt, latex: preT + texto, pasos: ps.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado, metodo: 'especiales' };
  }
}

export function resolverEspecial(texto) {
  const d = detectarEspecial(texto);
  if (!d) return { ok: false, mensaje: 'No es un caso especial.' };
  try {
    if (d.tipo === 'log_base') return resolverLogBase(d.a, d.b);
    if (d.tipo === 'log_simbolico') return resolverLogSimbolico(d.arg, d.base);
    return resolverRaizNegativa(d.n);
  }
  catch (e) { return { ok: false, mensaje: `No se pudo resolver: ${e.message}` }; }
}
