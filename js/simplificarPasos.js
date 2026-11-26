// simplificarPasos.js — Pasos para simplificar, expandir y factorizar polinomios (sin dependencias).
//
//   resolverAlgebraico('simplificar' | 'expandir' | 'factorizar', 'texto') -> respuesta | null
//
// Devuelve null cuando la expresión no es un polinomio ni un cociente de polinomios (trigonometría,
// exponentes no enteros…) o si la verificación falla: el llamador cae entonces a nerdamer.
// 'simplificar' también acepta un cociente de polinomios: factoriza, cancela y muestra las restricciones del dominio.
// Nunca muestra pasos sin comprobar el resultado: numéricamente y, al factorizar, también de forma
// exacta (multiplicando los factores con fracciones racionales).

import { parsear, str, tex, evalAST, simbolos } from './motorPasos.js';
import { Frac } from './frac.js';

class NoPoly extends Error {}
const MAX_GRADO = 24;
const MAX_TERM = 120;

// ───────────── AST ─────────────
const N = (v) => ({ t: 'num', v });
const S = (n) => ({ t: 'sym', n });
const Neg = (a) => ({ t: 'neg', a });
const Add = (a, b) => ({ t: 'add', a, b });
const Sub = (a, b) => ({ t: 'sub', a, b });
const Mul = (a, b) => ({ t: 'mul', a, b });
const Div = (a, b) => ({ t: 'div', a, b });
const Pow = (a, b) => ({ t: 'pow', a, b });

// ───────────── BigInt / Frac ─────────────
const babs = (a) => (a < 0n ? -a : a);
const gcdB = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
const lcmB = (a, b) => (a / gcdB(a, b)) * b;
function isqrtB(n) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}
function sqrtFrac(f) {
  if (f.isNeg()) return null;
  const rn = isqrtB(f.n), rd = isqrtB(f.d);
  return rn * rn === f.n && rd * rd === f.d ? new Frac(rn, rd) : null;
}
const fs = (f) => (f.isInt() ? String(f.n) : `${f.n}/${f.d}`);
const ftex = (f) => (f.isInt() ? String(f.n) : `${f.isNeg() ? '-' : ''}\\frac{${babs(f.n)}}{${f.d}}`);
const fAst = (f) => (f.isInt() ? N(Number(f.n)) : Div(N(Number(f.n)), N(Number(f.d))));
const fmtN = (v) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(12)));

// ───────────── Polinomios: Map<clave, Frac>; clave = "x:2,y:1" ('' = término independiente) ─────────────
const key = (e) => Object.keys(e).filter((k) => e[k] > 0).sort().map((k) => `${k}:${e[k]}`).join(',');
const unkey = (k) => (k === '' ? {} : Object.fromEntries(k.split(',').map((p) => { const [v, x] = p.split(':'); return [v, +x]; })));
const grado = (e) => Object.values(e).reduce((a, b) => a + b, 0);

function pAddTerm(p, k, c) {
  const o = p.get(k);
  const s = o ? o.add(c) : c;
  if (s.isZero()) p.delete(k); else p.set(k, s);
}
const pConst = (c) => { const p = new Map(); const f = Frac.of(c); if (!f.isZero()) p.set('', f); return p; };
function pAdd(a, b, signo = 1) {
  const r = new Map(a);
  for (const [k, c] of b) pAddTerm(r, k, signo === 1 ? c : c.neg());
  return r;
}
function pMul(a, b) {
  const r = new Map();
  for (const [ka, ca] of a) {
    for (const [kb, cb] of b) {
      const e = { ...unkey(ka) };
      for (const [v, x] of Object.entries(unkey(kb))) e[v] = (e[v] || 0) + x;
      if (grado(e) > MAX_GRADO) throw new NoPoly('grado');
      pAddTerm(r, key(e), ca.mul(cb));
    }
    if (r.size > MAX_TERM) throw new NoPoly('términos');
  }
  return r;
}
function pPow(a, k) {
  let r = pConst(1);
  for (let i = 0; i < k; i++) r = pMul(r, a);
  return r;
}
const pIgual = (a, b) => a.size === b.size && [...a].every(([k, c]) => b.has(k) && b.get(k).eq(c));
const cte = (p) => (p.size === 0 ? new Frac(0) : p.size === 1 && p.has('') ? p.get('') : null);

function aPoly(n) {
  switch (n.t) {
    case 'num': { const f = Frac.parse(String(n.v)); if (!f) throw new NoPoly('número'); return pConst(f); }
    case 'sym': if (['e', 'pi', 'inf', 'infinity'].includes(n.n)) throw new NoPoly('constante'); return new Map([[`${n.n}:1`, new Frac(1)]]);
    case 'neg': return pAdd(new Map(), aPoly(n.a), -1);
    case 'add': return pAdd(aPoly(n.a), aPoly(n.b));
    case 'sub': return pAdd(aPoly(n.a), aPoly(n.b), -1);
    case 'mul': return pMul(aPoly(n.a), aPoly(n.b));
    case 'div': {
      const d = cte(aPoly(n.b));
      if (!d || d.isZero()) throw new NoPoly('división');
      return pMul(aPoly(n.a), pConst(new Frac(1).div(d)));
    }
    case 'pow': {
      const c = cte(aPoly(n.b));
      if (!c || !c.isInt() || c.isNeg() || c.n > BigInt(MAX_GRADO)) throw new NoPoly('exponente');
      return pPow(aPoly(n.a), Number(c.n));
    }
    default: throw new NoPoly('función');
  }
}

function ordenar(p) {
  const T = [...p].map(([k, c]) => ({ k, c, e: unkey(k) }));
  T.sort((a, b) => {
    const d = grado(b.e) - grado(a.e);
    if (d) return d;
    for (const v of [...new Set([...Object.keys(a.e), ...Object.keys(b.e)])].sort()) {
      const x = (b.e[v] || 0) - (a.e[v] || 0);
      if (x) return x;
    }
    return 0;
  });
  return T;
}

// ───────────── Polinomio -> AST ─────────────
function monoAst(c, e) {
  const partes = [];
  const a = c.abs();
  const vars = Object.keys(e).filter((v) => e[v] > 0).sort();
  if (!a.eq(1) || !vars.length) partes.push(fAst(a));
  for (const v of vars) partes.push(e[v] === 1 ? S(v) : Pow(S(v), N(e[v])));
  return partes.reduce((x, y) => Mul(x, y));
}
function sumaAst(items) {
  if (!items.length) return N(0);
  let r = items[0].signo < 0 ? Neg(items[0].ast) : items[0].ast;
  for (const it of items.slice(1)) r = it.signo < 0 ? Sub(r, it.ast) : Add(r, it.ast);
  return r;
}
const polyAst = (p) => sumaAst(ordenar(p).map((t) => ({ signo: t.c.isNeg() ? -1 : 1, ast: monoAst(t.c, t.e) })));

function productoAst(c, m, factores) {
  const partes = [];
  if (!c.abs().eq(1)) partes.push(fAst(c.abs()));
  for (const v of Object.keys(m).sort()) partes.push(m[v] === 1 ? S(v) : Pow(S(v), N(m[v])));
  for (const f of factores) partes.push(f.mult === 1 ? polyAst(f.p) : Pow(polyAst(f.p), N(f.mult)));
  const r = partes.length ? partes.reduce(Mul) : N(1);
  return c.isNeg() ? Neg(r) : r;
}

// ───────────── Salida ─────────────
const paso = (descripcion, ecuacion, latex) => ({ descripcion, ecuacion, latex, profundidad: 0 });
const pasoAst = (desc, ...asts) => {
  const lista = asts.filter((x, i) => i === 0 || str(x) !== str(asts[i - 1])); // sin igualdades repetidas
  return paso(desc, lista.map(str).join(' = '), lista.map(tex).join(' = '));
};
/** ¿El último paso ya termina en esta misma expresión? (evita pasos que repiten el anterior) */
const yaTermina = (pasos, expr) => pasos.length > 0 && String(pasos[pasos.length - 1].ecuacion ?? '').split(' = ').pop() === expr;
const numerar = (l) => l.map((p, i) => ({ numero: i + 1, ...p }));

function unirPiezas(piezas) {
  let a = '', t = '';
  piezas.forEach((p, i) => {
    if (i === 0) { a = (p.neg ? '-' : '') + p.a; t = (p.neg ? '-' : '') + p.t; }
    else { a += ` ${p.neg ? '-' : '+'} ${p.a}`; t += ` ${p.neg ? '-' : '+'} ${p.t}`; }
  });
  return { a: a || '0', t: t || '0' };
}
const piezaMono = (c, e) => { const m = monoAst(c, e); return { neg: c.isNeg(), a: str(m), t: tex(m) }; };

// ───────────── Términos de la expresión ─────────────
function quitarSigno(n) {
  if (n.t === 'neg') { const r = quitarSigno(n.a); return { s: -r.s, nodo: r.nodo }; }
  if (n.t === 'mul') {
    const a = quitarSigno(n.a), b = quitarSigno(n.b);
    return { s: a.s * b.s, nodo: a.nodo !== n.a || b.nodo !== n.b ? Mul(a.nodo, b.nodo) : n };
  }
  return { s: 1, nodo: n };
}
function terminos(n, s = 1, out = []) {
  if (n.t === 'add') { terminos(n.a, s, out); terminos(n.b, s, out); }
  else if (n.t === 'sub') { terminos(n.a, s, out); terminos(n.b, -s, out); }
  else if (n.t === 'neg') terminos(n.a, -s, out);
  else { const q = quitarSigno(n); out.push({ signo: s * q.s, nodo: q.nodo }); }
  return out;
}
const factoresPlanos = (n, out = []) => { if (n.t === 'mul') { factoresPlanos(n.a, out); factoresPlanos(n.b, out); } else out.push(n); return out; };
const esFactorSimple = (f) => f.t === 'num' || f.t === 'sym' || (f.t === 'pow' && f.a.t === 'sym' && f.b.t === 'num' && Number.isInteger(f.b.v) && f.b.v >= 0);

/** Paso que explica cómo se reescribe un término hasta su forma canónica; null si ya lo está. */
function describirTermino(nodo, p, canon, signo) {
  if (str(nodo) === str(canon)) return null;
  const L = signo < 0 ? Neg(nodo) : nodo;
  const R = p.size === 0 ? N(0) : signo < 0 ? Neg(canon) : canon;
  const pref = signo < 0 ? '-' : '';
  const fl = factoresPlanos(nodo);
  let desc, inter = null; // inter = { a, t } texto intermedio

  if (p.size === 0) {
    desc = 'Un término que se anula vale 0';
  } else if (p.size === 1 && fl.every(esFactorSimple)) {
    const nums = fl.filter((f) => f.t === 'num').map((f) => f.v);
    const grupos = new Map();
    const alta = (v, x) => { if (!grupos.has(v)) grupos.set(v, []); grupos.get(v).push(x); };
    for (const f of fl) { if (f.t === 'sym') alta(f.n, 1); else if (f.t === 'pow') alta(f.a.n, f.b.v); }
    const repite = [...grupos.values()].some((g) => g.length > 1);
    const varios = nums.length > 1;
    const todosPos = [...grupos.values()].every((g) => g.every((x) => x > 0));
    const desc_ = [];
    if (repite) desc_.push('Multiplicar potencias de igual base: se suman los exponentes (aᵐ · aⁿ = aᵐ⁺ⁿ)');
    if (varios) desc_.push('Multiplicar los coeficientes');
    if (!repite && !varios) desc_.push('Escribir el término con el coeficiente delante');
    desc = desc_.join('; ');
    if ((repite || varios) && todosPos) {
      const pa = [], pt = [];
      if (nums.length) { pa.push(nums.map(fmtN).join('*')); pt.push(nums.map(fmtN).join(' \\cdot ')); }
      for (const [v, ex] of grupos) {
        if (ex.length > 1) { pa.push(`${v}^(${ex.join('+')})`); pt.push(`${v}^{${ex.join('+')}}`); }
        else if (ex[0] === 1) { pa.push(v); pt.push(v); }
        else { pa.push(`${v}^${ex[0]}`); pt.push(`${v}^{${ex[0]}}`); }
      }
      inter = { a: pref + pa.join('*'), t: pref + pt.join(' \\cdot ') };
    }
  } else {
    let ia = null;
    if (nodo.t === 'pow' && nodo.b.t === 'num' && nodo.b.v === 2 && (nodo.a.t === 'add' || nodo.a.t === 'sub')) {
      const A = nodo.a.a, B = nodo.a.b, mas = nodo.a.t === 'add';
      const doble = Mul(Mul(N(2), A), B);
      ia = mas ? Add(Add(Pow(A, N(2)), doble), Pow(B, N(2))) : Add(Sub(Pow(A, N(2)), doble), Pow(B, N(2)));
      desc = mas ? 'Cuadrado de una suma: (a + b)² = a² + 2ab + b²' : 'Cuadrado de una resta: (a − b)² = a² − 2ab + b²';
    } else if (nodo.t === 'mul') {
      const A = terminos(nodo.a), B = terminos(nodo.b);
      if ((A.length > 1 || B.length > 1) && A.length * B.length <= 12) {
        ia = sumaAst(A.flatMap((a) => B.map((b) => ({ signo: a.signo * b.signo, ast: Mul(a.nodo, b.nodo) }))));
        desc = 'Propiedad distributiva: cada término de un factor multiplica a cada término del otro';
      }
    } else if (nodo.t === 'pow' && nodo.b.t === 'num' && nodo.b.v >= 2 && nodo.b.v <= 4 && (nodo.a.t === 'add' || nodo.a.t === 'sub')) {
      ia = Array.from({ length: nodo.b.v - 1 }, () => nodo.a).reduce((x, y) => Mul(x, y), nodo.a);
      desc = 'Una potencia es un producto repetido: se multiplica la base por sí misma';
    }
    desc ??= 'Desarrollar y simplificar el término';
    if (ia) { const I = signo < 0 ? Neg(ia) : ia; inter = { a: str(I), t: tex(I) }; }
    if (signo < 0 && p.size > 1) desc += '. El signo − afecta a todos los términos del resultado';
  }

  const partesA = [str(L)], partesT = [tex(L)];
  if (inter && inter.a !== str(L) && inter.a !== str(R)) { partesA.push(inter.a); partesT.push(inter.t); }
  partesA.push(str(R)); partesT.push(tex(R));
  return paso(desc, partesA.join(' = '), partesT.join(' = '));
}

// ───────────── Reducción: términos -> forma canónica ─────────────
function reducir(ast) {
  const pasos = [];
  const lista = terminos(ast);
  const contrib = [];
  let reescrito = false;

  for (const { signo, nodo } of lista) {
    const p = aPoly(nodo);
    const info = describirTermino(nodo, p, polyAst(p), signo);
    if (info) { pasos.push(info); reescrito = true; }
    for (const t of ordenar(p)) contrib.push({ k: t.k, e: t.e, c: signo < 0 ? t.c.neg() : t.c });
  }

  if (reescrito && lista.length > 1 && contrib.length) {
    const u = unirPiezas(contrib.map((m) => piezaMono(m.c, m.e)));
    pasos.push(paso('Con cada término ya resuelto, la expresión queda', u.a, u.t));
  }

  const grupos = new Map();
  for (const m of contrib) { if (!grupos.has(m.k)) grupos.set(m.k, []); grupos.get(m.k).push(m); }
  const poly = new Map();
  contrib.forEach((m) => pAddTerm(poly, m.k, m.c));

  const combinadas = []; // piezas tras sumar cada grupo, en orden de aparición
  for (const [k, g] of grupos) {
    const c = g.reduce((s, m) => s.add(m.c), new Frac(0));
    if (!c.isZero()) combinadas.push(piezaMono(c, g[0].e));
    void k;
  }

  if ([...grupos.values()].some((g) => g.length > 1)) {
    const agrup = [...grupos.values()].map((g) => {
      if (g.length === 1) return piezaMono(g[0].c, g[0].e);
      const u = unirPiezas(g.map((m) => piezaMono(m.c, m.e)));
      return { neg: false, a: `(${u.a})`, t: `\\left(${u.t}\\right)` };
    });
    const A = unirPiezas(agrup), C = unirPiezas(combinadas);
    pasos.push(paso('Reunir términos semejantes (mismo literal): se suman sus coeficientes', `${A.a} = ${C.a}`, `${A.t} = ${C.t}`));
  }

  const actual = unirPiezas(combinadas);
  const res = polyAst(poly);
  if (actual.a !== str(res)) {
    pasos.push(paso('Ordenar de mayor a menor grado', `${actual.a} = ${str(res)}`, `${actual.t} = ${tex(res)}`));
  }
  return { pasos, poly };
}

// ───────────── Factor común y factorización ─────────────
function contenido(P) {
  const T = ordenar(P);
  let gn = 0n, ld = 1n;
  for (const t of T) { gn = gcdB(gn, t.c.n); ld = lcmB(ld, t.c.d); }
  const g = new Frac(gn, ld);
  return T[0].c.isNeg() ? g.neg() : g; // el signo sigue al término de mayor grado
}
const dividirPor = (P, c) => { const r = new Map(); for (const [k, v] of P) r.set(k, v.div(c)); return r; };
const normalizar = (P) => { const c = contenido(P); return { c, prim: dividirPor(P, c) }; };

function factorComun(P) {
  const T = ordenar(P);
  if (T.length < 2) return { trivial: true, c: new Frac(1), g: new Frac(1), m: {}, Q: P };
  const c = contenido(P);
  const vars = new Set(T.flatMap((t) => Object.keys(t.e)));
  const m = {};
  for (const v of vars) { const mn = Math.min(...T.map((t) => t.e[v] || 0)); if (mn > 0) m[v] = mn; }
  const Q = new Map();
  for (const t of T) { const e = { ...t.e }; for (const v of Object.keys(m)) e[v] -= m[v]; pAddTerm(Q, key(e), t.c.div(c)); }
  return { trivial: c.eq(1) && !Object.keys(m).length, c, g: c.abs(), m, Q };
}
function textoFactorComun(fc) {
  const partes = [];
  if (!fc.g.eq(1)) partes.push(`el mayor divisor común de los coeficientes es ${fs(fc.g)}`);
  const vs = Object.keys(fc.m).sort();
  if (vs.length) partes.push(`se saca la menor potencia de cada variable común (${vs.map((v) => v + (fc.m[v] > 1 ? `^${fc.m[v]}` : '')).join(', ')})`);
  if (fc.c.isNeg()) partes.push('como el término de mayor grado es negativo, se saca también el signo −');
  return `Factor común: ${partes.join('; ')}`;
}

function univ(P) {
  const vars = new Set([...P.keys()].flatMap((k) => Object.keys(unkey(k))));
  if (vars.size !== 1) return null;
  const [v] = vars;
  const n = Math.max(...[...P.keys()].map((k) => unkey(k)[v] || 0));
  const coefs = Array.from({ length: n + 1 }, () => new Frac(0));
  for (const [k, c] of P) coefs[unkey(k)[v] || 0] = c;
  return { v, n, coefs };
}
const lineal = (v, q, p) => { const m = new Map(); pAddTerm(m, `${v}:1`, new Frac(q)); pAddTerm(m, '', new Frac(-p)); return m; };
const desdeCoefs = (v, cs) => { const m = new Map(); cs.forEach((c, i) => { if (!c.isZero()) pAddTerm(m, i === 0 ? '' : `${v}:${i}`, c); }); return m; };
const divisores = (x) => { const r = []; for (let d = 1n; d * d <= x; d++) if (x % d === 0n) { r.push(d); if (d * d !== x) r.push(x / d); } return r.sort((a, b) => (a < b ? -1 : 1)); };

function factorizarRec(P, ctx, pasos, prof = 0) {
  const T = ordenar(P);
  if (T.length <= 1 || prof > 8) return [P];

  // 1) Diferencia de cuadrados
  if (T.length === 2) {
    const pos = T.find((t) => !t.c.isNeg()), neg = T.find((t) => t.c.isNeg());
    if (pos && neg) {
      const sp = sqrtFrac(pos.c), sn = sqrtFrac(neg.c.abs());
      const par = (e) => Object.values(e).every((x) => x % 2 === 0);
      if (sp && sn && par(pos.e) && par(neg.e)) {
        const mitad = (e) => Object.fromEntries(Object.entries(e).map(([v, x]) => [v, x / 2]));
        const ra = monoAst(sp, mitad(pos.e)), rb = monoAst(sn, mitad(neg.e));
        const mk = (sg) => { const m = new Map(); pAddTerm(m, key(mitad(pos.e)), sp); pAddTerm(m, key(mitad(neg.e)), sg < 0 ? sn.neg() : sn); return m; };
        const F1 = mk(-1), F2 = mk(1);
        pasos.push(pasoAst('Diferencia de cuadrados: a² − b² = (a − b)(a + b)',
          polyAst(P), Sub(Pow(ra, N(2)), Pow(rb, N(2))), Mul(polyAst(F1), polyAst(F2))));
        const out = [];
        for (const F of [F1, F2]) {
          const nz = normalizar(F);
          ctx.c = ctx.c.mul(nz.c);
          out.push(...factorizarRec(nz.prim, ctx, pasos, prof + 1));
        }
        return out;
      }
    }
  }

  const U = univ(P);
  if (!U || U.n < 2) return [P];
  const { v, n, coefs } = U;

  // 2) Trinomio de segundo grado
  if (n === 2) {
    const [c, b, a] = coefs;
    const D = b.mul(b).sub(a.mul(c).mul(4));
    const sD = sqrtFrac(D);
    const dAst = Sub(Pow(fAst(b), N(2)), Mul(Mul(N(4), fAst(a)), fAst(c)));
    pasos.push(paso(`Trinomio de 2.º grado (a = ${fs(a)}, b = ${fs(b)}, c = ${fs(c)}): se calcula el discriminante Δ = b² − 4ac`,
      `Δ = b^2 - 4*a*c = ${str(dAst)} = ${fs(D)}`, `\\Delta = b^{2} - 4ac = ${tex(dAst)} = ${ftex(D)}`));
    if (!sD) {
      pasos.push(paso(D.isNeg() ? 'Δ es negativo: no hay raíces reales, el trinomio no se factoriza más' : 'Δ no es un cuadrado perfecto: las raíces no son racionales, el trinomio no se factoriza más', str(polyAst(P)), tex(polyAst(P))));
      return [P];
    }
    const r1 = b.neg().sub(sD).div(a.mul(2)), r2 = b.neg().add(sD).div(a.mul(2));
    pasos.push(paso('Fórmula general: x = (−b ± √Δ) / (2a)',
      `${v} = (-b ± sqrt(Δ)) / (2a) = (${fs(b.neg())} ± ${fs(sD)}) / ${fs(a.mul(2))}  →  ${v}1 = ${fs(r1)},  ${v}2 = ${fs(r2)}`,
      `${v} = \\frac{-b \\pm \\sqrt{\\Delta}}{2a} = \\frac{${ftex(b.neg())} \\pm ${ftex(sD)}}{${ftex(a.mul(2))}} \\;\\Rightarrow\\; ${v}_1 = ${ftex(r1)},\\; ${v}_2 = ${ftex(r2)}`));
    const l1 = lineal(v, r1.d, r1.n), l2 = lineal(v, r2.d, r2.n);
    const k = a.div(new Frac(r1.d * r2.d));
    ctx.c = ctx.c.mul(k);
    const fac = r1.eq(r2) ? [{ p: l1, mult: 2 }] : [{ p: l1, mult: 1 }, { p: l2, mult: 1 }];
    pasos.push(pasoAst('Cada raíz r da un factor (x − r); el coeficiente principal queda delante', polyAst(P), productoAst(k, {}, fac)));
    return r1.eq(r2) ? [l1, l1] : [l1, l2];
  }

  // 3) Grado ≥ 3: teorema de la raíz racional
  const a0 = coefs[0], an = coefs[n];
  if (!a0.isInt() || !an.isInt() || a0.isZero()) return [P];
  if (babs(a0.n) > 1000000n || babs(an.n) > 1000000n) return [P];
  const dp = divisores(babs(a0.n)), dq = divisores(babs(an.n));
  const cands = [];
  for (const p of dp) for (const q of dq) if (gcdB(p, q) === 1n) cands.push(new Frac(p, q));
  cands.sort((x, y) => { const d = x.sub(y); return d.isZero() ? 0 : d.isNeg() ? -1 : 1; });
  const horner = (r) => coefs.reduceRight((acc, c) => acc.mul(r).add(c), new Frac(0));
  let raiz = null;
  for (const c of cands) {
    if (horner(c).isZero()) { raiz = c; break; }
    if (horner(c.neg()).isZero()) { raiz = c.neg(); break; }
  }
  if (!raiz) {
    pasos.push(paso(`Grado ${n}: se buscan raíces racionales ±(divisor de ${fs(a0.abs())}) / (divisor de ${fs(an.abs())}) y ninguna anula el polinomio`, str(polyAst(P)), tex(polyAst(P))));
    return [P];
  }
  const piezas = [];
  for (let k = n; k >= 0; k--) {
    const val = coefs[k].mul(raiz.pow(k));
    if (!val.isZero()) piezas.push({ neg: val.isNeg(), a: fs(val.abs()), t: ftex(val.abs()) });
  }
  const ev = unirPiezas(piezas);
  pasos.push(paso(`Teorema de la raíz racional: se prueban ±(divisor de ${fs(a0.abs())}) / (divisor de ${fs(an.abs())}). Con ${v} = ${fs(raiz)} el polinomio vale 0`,
    `P(${fs(raiz)}) = ${ev.a} = 0`, `P(${ftex(raiz)}) = ${ev.t} = 0`));
  // Ruffini
  const q = new Array(n);
  q[n - 1] = coefs[n];
  for (let i = n - 1; i >= 1; i--) q[i - 1] = coefs[i].add(raiz.mul(q[i]));
  const lin = lineal(v, raiz.d, raiz.n);
  const Q2 = dividirPor(desdeCoefs(v, q), new Frac(raiz.d));
  const nz = normalizar(Q2);
  ctx.c = ctx.c.mul(nz.c);
  pasos.push(pasoAst(`Se divide entre (${v} − ${fs(raiz)}) con la regla de Ruffini; el cociente es de grado ${n - 1}`,
    polyAst(P), productoAst(nz.c, {}, [{ p: lin, mult: 1 }, { p: nz.prim, mult: 1 }])));
  return [lin, ...factorizarRec(nz.prim, ctx, pasos, prof + 1)];
}

function fusionar(facts) {
  const out = [];
  for (const f of facts) {
    if (cte(f)) continue;
    const k = str(polyAst(f));
    const x = out.find((o) => o.k === k);
    if (x) x.mult++; else out.push({ k, p: f, mult: 1 });
  }
  return out;
}

/** true si P (sin factor común) se descompone en al menos dos factores no constantes (o un factor repetido). */
function factorizarParaSugerencia(P) {
  try {
    const ctx = { c: new Frac(1) };
    const facts = fusionar(factorizarRec(P, ctx, []));
    const total = facts.reduce((n, f) => n + f.mult, 0);
    return total >= 2 && pIgual(prodPoly(ctx.c, {}, facts), P);
  } catch { return false; }
}

// ───────────── Verificación numérica ─────────────
function verificar(a, b) {
  const vars = [...simbolos(a)];
  const pts = [0.7, -1.3, 2.1, 0.35, -0.9, 1.6, 3.2];
  let ok = 0;
  for (let i = 0; i < 6; i++) {
    const env = Object.fromEntries(vars.map((v, j) => [v, pts[(i + 2 * j) % pts.length]]));
    const x = evalAST(a, env), y = evalAST(b, env);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x - y) > 1e-9 * (1 + Math.abs(x) + Math.abs(y))) return false;
    ok++;
  }
  return ok >= 2;
}

// ───────────── Fracciones algebraicas ─────────────
const prodPoly = (c, m, facts) => {
  let p = pMul(pConst(c), new Map([[key(m), new Frac(1)]]));
  for (const f of facts) p = pMul(p, pPow(f.p, f.mult));
  return p;
};

/** Factoriza P (numerador o denominador) y devuelve { c, m, facts, pasos } o null si no se puede comprobar. */
function factorizarParte(P, nombre) {
  const T = ordenar(P);
  const pasos = [];
  let c, m, facts;
  if (T.length === 1) {
    c = T[0].c; m = { ...T[0].e }; facts = [];
    pasos.push(pasoAst(`El ${nombre} es un monomio: ya está factorizado`, polyAst(P)));
  } else {
    const fc = factorComun(P);
    const ctx = { c: fc.c };
    const sub = [];
    if (!fc.trivial) sub.push(pasoAst(`${nombre[0].toUpperCase()}${nombre.slice(1)} — ${textoFactorComun(fc)}`, polyAst(P), productoAst(fc.c, fc.m, [{ p: fc.Q, mult: 1 }])));
    facts = fusionar(factorizarRec(fc.Q, ctx, sub));
    c = ctx.c; m = fc.m;
    if (!sub.length || (fc.trivial && facts.length === 1 && facts[0].mult === 1 && pIgual(facts[0].p, P))) {
      pasos.push(pasoAst(`El ${nombre} no se puede factorizar más con coeficientes racionales`, polyAst(P)));
    } else {
      pasos.push(...sub);
    }
  }
  if (!pIgual(prodPoly(c, m, facts), P)) return null; // comprobación exacta
  const ast = productoAst(c, m, facts);
  if (str(ast) !== str(polyAst(P)) && !yaTermina(pasos, str(ast))) pasos.push(pasoAst(`${nombre[0].toUpperCase()}${nombre.slice(1)} factorizado`, polyAst(P), ast));
  return { c, m, facts, pasos, ast };
}

/** Restricciones del dominio: valores que anulan el denominador original. */
function restricciones(D) {
  const items = [];
  for (const v of Object.keys(D.m).sort()) items.push({ a: `${v} ≠ 0`, t: `${v} \\neq 0` });
  for (const f of D.facts) {
    const U = univ(f.p);
    if (U && U.n === 1) {
      const r = U.coefs[0].neg().div(U.coefs[1]);
      items.push({ a: `${U.v} ≠ ${fs(r)}`, t: `${U.v} \\neq ${ftex(r)}` });
    } else {
      if (U && U.n === 2) { // sin raíces reales: no restringe nada
        const [c, b, a] = U.coefs;
        if (b.mul(b).sub(a.mul(c).mul(4)).isNeg()) continue;
      }
      items.push({ a: `${str(polyAst(f.p))} ≠ 0`, t: `${tex(polyAst(f.p))} \\neq 0` });
    }
  }
  return items;
}

function resolverRacional(ast) {
  // Forma admitida: [−] numerador / denominador, ambos polinomios con coeficientes racionales.
  let nodo = ast, signo = 1;
  while (nodo.t === 'neg') { nodo = nodo.a; signo = -signo; }
  if (nodo.t !== 'div') return null;
  const PN = aPoly(nodo.a), PD = aPoly(nodo.b); // lanzan NoPoly si no son polinomios
  if (!PN.size || !PD.size) return null;
  if (cte(PD)) return null; // denominador constante: ya lo cubre el camino polinómico
  const pasos = [paso('Expresión original: cociente de dos polinomios. Para simplificarlo se factorizan numerador y denominador y se buscan factores comunes', str(ast), tex(ast))];
  if (signo < 0) PN.forEach((v, k) => PN.set(k, v.neg()));

  const Nf = factorizarParte(PN, 'numerador');
  const Df = factorizarParte(PD, 'denominador');
  if (!Nf || !Df) return null;
  pasos.push(...Nf.pasos, ...Df.pasos);
  const sinCambio = str(Nf.ast) === str(polyAst(PN)) && str(Df.ast) === str(polyAst(PD));
  if (!sinCambio) pasos.push(pasoAst('Reescribimos la fracción con ambos términos factorizados', Div(Nf.ast, Df.ast)));

  // Factores comunes
  const comunM = {};
  for (const v of Object.keys(Nf.m)) if (Df.m[v]) comunM[v] = Math.min(Nf.m[v], Df.m[v]);
  const resta = (m, c) => { const r = { ...m }; for (const v of Object.keys(c)) { r[v] -= c[v]; if (!r[v]) delete r[v]; } return r; };
  const comunF = [];
  const restoN = Nf.facts.map((f) => ({ ...f })), restoD = Df.facts.map((f) => ({ ...f }));
  for (const fn of restoN) {
    const fd = restoD.find((g) => g.k === fn.k);
    if (!fd) continue;
    const mult = Math.min(fn.mult, fd.mult);
    comunF.push({ k: fn.k, p: fn.p, mult });
    fn.mult -= mult; fd.mult -= mult;
  }
  const rN = restoN.filter((f) => f.mult > 0), rD = restoD.filter((f) => f.mult > 0);
  const mN = resta(Nf.m, comunM), mD = resta(Df.m, comunM);
  const r = Nf.c.div(Df.c);
  const gEnt = Nf.c.isInt() && Df.c.isInt() ? gcdB(Nf.c.n, Df.c.n) : 1n;
  const coefCambia = !(Nf.c.isInt() && Df.c.isInt() && gEnt === 1n && !Df.c.isNeg());

  const hayComun = comunF.length > 0 || Object.keys(comunM).length > 0;
  const numFin = productoAst(new Frac(r.n), mN, rN);
  const denFin = productoAst(new Frac(r.d), mD, rD);
  const denTrivial = r.d === 1n && !Object.keys(mD).length && !rD.length;
  const resAst = denTrivial ? numFin : Div(numFin, denFin);

  if (!hayComun && !coefCambia) {
    pasos.push(pasoAst('Numerador y denominador no tienen factores comunes: la fracción ya está simplificada', Div(polyAst(PN), polyAst(PD))));
  } else {
    const partes = [];
    if (hayComun) partes.push(str(productoAst(new Frac(1), comunM, comunF)));
    if (gEnt > 1n) partes.push(String(gEnt));
    const antes = Div(Nf.ast, Df.ast);
    let desc = partes.length
      ? `Cancelamos los factores comunes de numerador y denominador: ${partes.join(' · ')}`
      : 'Pasamos el signo al numerador y reducimos los coeficientes';
    if (Df.c.isNeg() && partes.length) desc += '; el signo del denominador pasa al numerador';
    pasos.push(pasoAst(desc, antes, resAst));
  }

  // Restricciones: el resultado vale igual que la fracción original solo donde el denominador original no se anula
  const rest = restricciones(Df);
  const base = str(resAst), baseT = tex(resAst);
  if (rest.length) {
    pasos.push(paso('Restricciones del dominio: el denominador original no puede valer 0, así que se excluyen estos valores',
      rest.map((x) => x.a).join(',  '), rest.map((x) => x.t).join(',\\; ')));
    pasos.push(paso('Resultado (válido para los valores permitidos del dominio)', `${base},  con ${rest.map((x) => x.a).join(', ')}`, `${baseT},\\quad ${rest.map((x) => x.t).join(',\\; ')}`));
  }

  // Comprobación exacta: N·D' = N'·D (productos cruzados) y numérica
  const Np = prodPoly(new Frac(r.n), mN, rN), Dp = prodPoly(new Frac(r.d), mD, rD);
  if (!pIgual(pMul(PN, Dp), pMul(Np, PD))) return null;
  if (!verificar(ast, resAst)) return null;

  return {
    ok: true, resultado: base, latex: baseT, pasos: numerar(pasos),
    nivel: 'completo', verificado: true, metodo: 'Reglas algebraicas',
    restricciones: rest.map((x) => x.a),
  };
}

// ───────────── Punto de entrada ─────────────
export function resolverAlgebraico(modo, expr, { debug = false } = {}) {
  try {
    const ast = parsear(expr);
    if (!simbolos(ast).size) return null;
    try {
      aPoly(ast); // lanza NoPoly si no es un polinomio
    } catch (e) {
      if (e instanceof NoPoly && modo === 'simplificar') return resolverRacional(ast); // cociente de polinomios
      throw e;
    }

    const pasos = [paso('Expresión original (con las multiplicaciones explícitas)', str(ast), tex(ast))];
    const red = reducir(ast);
    const P = red.poly;
    const T = ordenar(P);
    let resAst;

    if (modo === 'factorizar') {
      pasos.push(...red.pasos);
      if (T.length === 0) { resAst = N(0); }
      else if (T.length === 1) {
        resAst = polyAst(P);
        pasos.push(paso('Es un monomio: ya está factorizado', str(resAst), tex(resAst)));
      } else {
        const fc = factorComun(P);
        const ctx = { c: fc.c };
        const sub = [];
        if (!fc.trivial) sub.push(pasoAst(textoFactorComun(fc), polyAst(P), productoAst(fc.c, fc.m, [{ p: fc.Q, mult: 1 }])));
        const facts = fusionar(factorizarRec(fc.Q, ctx, sub));
        resAst = productoAst(ctx.c, fc.m, facts);
        let prod = pMul(pConst(ctx.c), new Map([[key(fc.m), new Frac(1)]]));
        for (const f of facts) prod = pMul(prod, pPow(f.p, f.mult));
        if (!pIgual(prod, P)) return null; // comprobación exacta
        pasos.push(...sub);
        if (!sub.length || (fc.trivial && facts.length === 1 && facts[0].mult === 1 && pIgual(facts[0].p, P))) {
          if (!sub.length || !yaTermina(pasos, str(polyAst(P)))) pasos.push(paso('No se puede factorizar más con coeficientes racionales', str(polyAst(P)), tex(polyAst(P))));
        } else if (sub.length >= 2 && !yaTermina(pasos, str(resAst))) {
          pasos.push(pasoAst('Forma factorizada final', polyAst(P), resAst));
        }
      }
    } else {
      pasos.push(...red.pasos);
      resAst = polyAst(P);
      if (!red.pasos.length) {
        pasos.pop(); // el paso «original» sería idéntico al siguiente: se deja uno solo
        pasos.push(paso(modo === 'expandir' ? 'La expresión ya está desarrollada y ordenada' : 'La expresión ya está simplificada', str(resAst), tex(resAst)));
      }
      if (modo === 'simplificar' && T.length >= 2) {
        const fc = factorComun(P);
        if (!fc.trivial) {
          pasos.push(pasoAst('Opcional — forma factorizada: se saca el factor común (usa factorizar(…) para ver el desarrollo completo)',
            resAst, productoAst(fc.c, fc.m, [{ p: fc.Q, mult: 1 }])));
        } else {
          // Sin factor común: si el polinomio sí se factoriza, se orienta al usuario (la factorización solo se hace si se pide).
          const tf = factorizarParaSugerencia(P);
          if (tf) {
            const pedido = `factor(${str(resAst)})`;
            pasos.push(paso('Sugerencia: simplificar no factoriza. Este polinomio sí se puede factorizar; para ver el desarrollo escribe', pedido, `\\mathrm{factor}\\left(${tex(resAst)}\\right)`));
          }
        }
      }
    }

    if (!verificar(ast, resAst)) return null;
    return {
      ok: true, resultado: str(resAst), latex: tex(resAst), pasos: numerar(pasos),
      nivel: 'completo', verificado: true, metodo: 'Reglas algebraicas',
    };
  } catch (e) {
    if (debug) throw e;
    return null; // NoPoly, errores de sintaxis o cualquier fallo: el llamador usa nerdamer
  }
}

// ───────────── Ecuaciones polinómicas de grado ≥ 3 ─────────────
// Se pasa todo a un lado, se factoriza (con el mismo motor de factorizar) y se iguala a 0 cada factor.
// Devuelve null si no es una ecuación polinómica de una variable con coeficientes racionales, si el grado es < 3
// o si queda un factor irreducible de grado ≥ 3 (entonces el router usa el motor simbólico).
const extraerCuadrado = (n) => { // n entero > 0 → [k, m] con n = k²·m, m sin cuadrados
  if (!Number.isSafeInteger(n) || n > 1e12) return null;
  let k = 1, m = n;
  for (let p = 2; p * p <= m; p++) while (m % (p * p) === 0) { m /= p * p; k *= p; }
  return [k, m];
};
const gcdN = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

/** Raíces de a·x² + b·x + c (enteros, a ≠ 0, Δ no cuadrado perfecto) como texto: { textos, valores (reales) | null, complejas } */
function raicesCuadraticaTxt(a, b, D, v) {
  const sig = a < 0 ? -1 : 1; a *= sig; b *= sig; // (−b ± k√m)/(2a) con 2a > 0 (el conjunto de raíces es el mismo)
  const imag = D < 0;
  const dos = extraerCuadrado(Math.abs(D));
  if (!dos) return null;
  const [k, m] = dos;
  const g = gcdN(gcdN(b, k), 2 * a);
  const bb = -b / g, kk = k / g, den = (2 * a) / g;
  const raiz = (m === 1 ? '' : `sqrt(${m})`) + (imag ? (m === 1 ? 'i' : '*i') : '');
  const radical = (kk === 1 ? '' : `${kk}${m === 1 && !imag ? '' : '*'}`) + raiz;
  const num = (s) => (bb === 0 ? (s > 0 ? '' : '-') + radical : `${bb} ${s > 0 ? '+' : '-'} ${radical}`);
  const forma = (s) => (den === 1 ? num(s) : `(${num(s)})/${den}`);
  const textos = [1, -1].map((s) => `${v} = ${forma(s)}`);
  const vals = imag ? null : [1, -1].map((s) => (-b + s * Math.sqrt(D)) / (2 * a));
  return { textos, vals, imag };
}

export function resolverEcuacionPolinomica(lhsTxt, rhsTxt) {
  try {
    const L = parsear(lhsTxt), R = parsear(rhsTxt);
    const ast = Sub(L, R);
    const sims = simbolos(ast);
    if (sims.size !== 1) return null;
    let P;
    try { P = aPoly(ast); } catch (e) { if (e instanceof NoPoly) return null; throw e; }
    const U = univ(P);
    if (!U || U.n < 3) return null;
    const v = U.v;

    const pasos = [paso('Ecuación a resolver', `${str(L)} = ${str(R)}`, `${tex(L)} = ${tex(R)}`)];
    const ceroDer = R.t === 'num' && R.v === 0;
    if (!(ceroDer && str(L) === str(polyAst(P)))) pasos.push(paso('Pasar todo a un lado e igualar a 0', `${str(polyAst(P))} = 0`, `${tex(polyAst(P))} = 0`));

    const F = factorizarParte(P, 'polinomio');
    if (!F) return null;
    const hayVar = Object.keys(F.m).length > 0;
    const irreduciblePuro = !hayVar && F.facts.length === 1 && F.facts[0].mult === 1 && F.facts[0].p.size === P.size && pIgual(F.facts[0].p, P);
    if (irreduciblePuro) return null; // sin factores racionales: lo resuelve el motor simbólico
    if (F.facts.some((f) => { const u = univ(f.p); return !u || u.n >= 3; })) return null;
    pasos.push(...F.pasos);

    pasos.push(paso('Un producto vale 0 solo cuando algún factor vale 0: igualamos a 0 cada factor', `${str(F.ast)} = 0`, `${tex(F.ast)} = 0`));

    const sols = []; // { txt, val (número real) | null, orden }
    let verificado = true;
    const evalExacto = (r) => U.coefs.reduceRight((s, c) => s.mul(r).add(c), new Frac(0));
    const anadir = (txt, val, exacto) => { if (!sols.some((s) => s.txt === txt)) sols.push({ txt, val, exacto }); };

    if (hayVar) {
      for (const [x, e] of Object.entries(F.m)) {
        pasos.push(paso(`Resolvemos el factor ${e > 1 ? `${x}^${e}` : x} = 0${e > 1 ? ` (aparece ${e} veces: raíz de multiplicidad ${e})` : ''}`, `${x} = 0`, `${x} = 0`));
        anadir(`${x} = 0`, 0, new Frac(0));
      }
    }
    for (const f of F.facts) {
      const u = univ(f.p);
      const fTxt = str(polyAst(f.p));
      const mult = f.mult > 1 ? ` (aparece ${f.mult} veces: raíz de multiplicidad ${f.mult})` : '';
      if (u.n === 1) {
        const r = u.coefs[0].neg().div(u.coefs[1]);
        pasos.push(paso(`Resolvemos el factor ${fTxt} = 0${mult}`, `${v} = ${fs(r)}`, `${v} = ${ftex(r)}`));
        if (!evalExacto(r).isZero()) return null;
        anadir(`${v} = ${fs(r)}`, r.toNumber(), r);
      } else { // grado 2 irreducible en Q (Δ no cuadrado perfecto, o negativo)
        const [c, b, a] = u.coefs;
        if (![a, b, c].every((q) => q.isInt())) return null;
        const A = Number(a.n), B = Number(b.n), C = Number(c.n);
        const D = B * B - 4 * A * C;
        if (!Number.isSafeInteger(D)) return null;
        const raices = raicesCuadraticaTxt(A, B, D, v);
        if (!raices) return null;
        pasos.push(paso(`Aplicamos la fórmula general al factor ${fTxt} = 0 (Δ = ${D}${D < 0 ? ', negativo: las raíces son complejas' : ''})${mult}`, raices.textos.join(',  '), null));
        raices.textos.forEach((t, i) => {
          const val = raices.vals ? raices.vals[i] : null;
          if (val !== null) { // comprobación numérica de la raíz real
            const y = U.coefs.reduceRight((s, q) => s * val + q.toNumber(), 0);
            const escala = U.coefs.reduce((s, q, j) => s + Math.abs(q.toNumber()) * Math.abs(val) ** j, 0);
            if (!(Math.abs(y) <= 1e-9 * (1 + escala))) verificado = false;
          }
          anadir(t, val, null);
        });
      }
    }
    if (!verificado) return null;
    sols.sort((p, q) => (p.val === null) - (q.val === null) || (p.val ?? 0) - (q.val ?? 0));
    const resultado = sols.map((s) => s.txt).join(',  ');
    pasos.push(paso('Soluciones de la ecuación (se reúnen las de todos los factores)', resultado, null));
    return { ok: true, resultado, pasos: numerar(pasos), nivel: 'completo', verificado: true, metodo: 'Factorización' };
  } catch (e) {
    return null;
  }
}
