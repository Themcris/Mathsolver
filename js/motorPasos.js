// motorPasos.js — Motor de pasos propio (sin dependencias).
// Parser de expresiones -> AST, impresión ASCII/LaTeX, evaluador numérico,
// derivación con reglas explícitas y verificación numérica independiente.

// ───────────── Constantes ─────────────
const ALIAS = { sen: 'sin', tg: 'tan', arcsin: 'asin', arccos: 'acos', arctan: 'atan', raiz: 'sqrt', log: 'ln' };
export const FUNCIONES = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'ln', 'exp', 'sqrt']);
export const CONSTANTES = new Set(['e', 'pi', 'inf', 'infinity']);
export class ErrorExpresion extends Error {}

// ───────────── Constructores ─────────────
const N = (v) => ({ t: 'num', v });
const S = (n) => ({ t: 'sym', n });
const esN = (a, v) => a.t === 'num' && a.v === v;
const Neg = (a) => (a.t === 'neg' ? a.a : a.t === 'num' ? N(-a.v) : { t: 'neg', a });
const Add = (a, b) => (esN(a, 0) ? b : esN(b, 0) ? a : b.t === 'neg' ? Sub(a, b.a) : { t: 'add', a, b });
const Sub = (a, b) => (esN(b, 0) ? a : esN(a, 0) ? Neg(b) : b.t === 'neg' ? Add(a, b.a) : { t: 'sub', a, b });
const Mul = (a, b) => (esN(a, 0) || esN(b, 0) ? N(0) : esN(a, 1) ? b : esN(b, 1) ? a
  : b.t === 'div' ? Div(Mul(a, b.a), b.b) : a.t === 'div' ? Div(Mul(a.a, b), a.b) : { t: 'mul', a, b });
const Div = (a, b) => (esN(a, 0) ? N(0) : esN(b, 1) ? a : { t: 'div', a, b });
const Pow = (a, b) => (esN(b, 1) ? a : esN(b, 0) ? N(1) : { t: 'pow', a, b });
const Fn = (name, a) => ({ t: 'fn', name, a });

// ───────────── Parser ─────────────
function tokenizar(src) {
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_]\w*)|(\S))/y;
  const out = [];
  src = src.trim();
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) out.push({ k: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else out.push({ k: 'op', v: m[3] });
  }
  return out;
}

export function parsear(src) {
  const T = tokenizar(String(src));
  if (!T.length) throw new ErrorExpresion('Expresión vacía.');
  let i = 0;
  const esOp = (v) => T[i] && T[i].k === 'op' && T[i].v === v;
  const empiezaAtomo = () => T[i] && (T[i].k === 'num' || T[i].k === 'id' || (T[i].k === 'op' && T[i].v === '('));

  function expr() {
    let a = term();
    while (esOp('+') || esOp('-')) {
      const o = T[i++].v;
      const b = term();
      a = { t: o === '+' ? 'add' : 'sub', a, b };
    }
    return a;
  }
  function term() {
    let a = unario();
    for (;;) {
      if (esOp('*')) { i++; a = { t: 'mul', a, b: unario() }; }
      else if (esOp('/')) { i++; a = { t: 'div', a, b: unario() }; }
      else if (empiezaAtomo()) a = { t: 'mul', a, b: potencia() }; // multiplicación implícita: 2x, x(x+1)
      else return a;
    }
  }
  function unario() {
    if (esOp('-')) { i++; return { t: 'neg', a: unario() }; }
    if (esOp('+')) { i++; return unario(); }
    return potencia();
  }
  function potencia() {
    const b = atomo();
    if (esOp('^')) { i++; return { t: 'pow', a: b, b: unario() }; }
    return b;
  }
  function atomo() {
    const tk = T[i++];
    if (!tk) throw new ErrorExpresion('La expresión termina de forma inesperada.');
    if (tk.k === 'num') return N(tk.v);
    if (tk.k === 'id') {
      const nombre = ALIAS[tk.v.toLowerCase()] ?? tk.v.toLowerCase();
      if (FUNCIONES.has(nombre) && esOp('(')) {
        i++;
        const a = expr();
        if (!esOp(')')) throw new ErrorExpresion(`Falta cerrar el paréntesis de ${nombre}(…). Solo se admite un argumento.`);
        i++;
        return Fn(nombre, a);
      }
      if (FUNCIONES.has(nombre)) throw new ErrorExpresion(`Escribe ${nombre} con paréntesis: ${nombre}(…).`);
      return S(tk.v === 'Infinity' ? 'infinity' : tk.v);
    }
    if (tk.v === '(') {
      const a = expr();
      if (!esOp(')')) throw new ErrorExpresion('Falta cerrar un paréntesis.');
      i++;
      return a;
    }
    throw new ErrorExpresion(`Símbolo no válido: “${tk.v}”.`);
  }

  const raiz = expr();
  if (i < T.length) throw new ErrorExpresion(`Símbolo inesperado: “${T[i].v}”.`);
  return raiz;
}

// ───────────── Utilidades de AST ─────────────
export const tieneVar = (n, v) => {
  switch (n.t) {
    case 'num': return false;
    case 'sym': return n.n === v;
    case 'neg': case 'fn': return tieneVar(n.a, v);
    default: return tieneVar(n.a, v) || tieneVar(n.b, v);
  }
};
export function simbolos(n, set = new Set()) {
  if (n.t === 'sym') { if (!CONSTANTES.has(n.n)) set.add(n.n); }
  else if (n.t === 'neg' || n.t === 'fn') simbolos(n.a, set);
  else if (n.t !== 'num') { simbolos(n.a, set); simbolos(n.b, set); }
  return set;
}

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(12)));

export function str(n, p = 0) {
  const w = (s, q) => (q < p ? `(${s})` : s);
  switch (n.t) {
    case 'num': return n.v < 0 && p > 0 ? `(${fmtNum(n.v)})` : fmtNum(n.v);
    case 'sym': return n.n;
    case 'add': return w(`${str(n.a, 1)} + ${str(n.b, 1)}`, 1);
    case 'sub': return w(`${str(n.a, 1)} - ${str(n.b, 2)}`, 1);
    case 'mul': return w(`${str(n.a, 2)}*${str(n.b, n.b.t === 'neg' ? 9 : 2)}`, 2);
    case 'div': return w(`${str(n.a, 2)}/${str(n.b, 4)}`, 2);
    case 'neg': return w(`-${str(n.a, 2)}`, 3);
    case 'pow': return w(`${str(n.a, 5)}^${str(n.b, 5)}`, 4);
    case 'fn': return `${n.name}(${str(n.a)})`;
  }
}

const TEX_FN = { sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc', asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', ln: '\\ln' };

export function tex(n, p = 0) {
  const w = (s, q) => (q < p ? `\\left(${s}\\right)` : s);
  switch (n.t) {
    case 'num': return n.v < 0 && p > 0 ? `\\left(${fmtNum(n.v)}\\right)` : fmtNum(n.v);
    case 'sym': return n.n === 'pi' ? '\\pi' : n.n;
    case 'add': return w(`${tex(n.a, 1)} + ${tex(n.b, 1)}`, 1);
    case 'sub': return w(`${tex(n.a, 1)} - ${tex(n.b, 2)}`, 1);
    case 'mul': return w(`${tex(n.a, 2)} \\cdot ${tex(n.b, n.b.t === 'neg' ? 9 : 2)}`, 2);
    case 'div': return w(`\\frac{${tex(n.a)}}{${tex(n.b)}}`, 2);
    case 'neg': return w(`-${tex(n.a, 2)}`, 3);
    case 'pow': return w(`${tex(n.a, 5)}^{${tex(n.b)}}`, 4);
    case 'fn':
      if (n.name === 'sqrt') return `\\sqrt{${tex(n.a)}}`;
      if (n.name === 'exp') return w(`e^{${tex(n.a)}}`, 4);
      return `${TEX_FN[n.name]}\\left(${tex(n.a)}\\right)`;
  }
}

// ───────────── Evaluador numérico (radianes) ─────────────
const F_NUM = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: (x) => 1 / Math.tan(x), sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: Math.log, exp: Math.exp, sqrt: Math.sqrt,
};
export function evalAST(n, env = {}) {
  switch (n.t) {
    case 'num': return n.v;
    case 'sym':
      if (n.n in env) return env[n.n];
      if (n.n === 'e') return Math.E;
      if (n.n === 'pi') return Math.PI;
      if (n.n === 'inf' || n.n === 'infinity') return Infinity;
      throw new ErrorExpresion(`Variable sin valor: ${n.n}`);
    case 'add': return evalAST(n.a, env) + evalAST(n.b, env);
    case 'sub': return evalAST(n.a, env) - evalAST(n.b, env);
    case 'mul': return evalAST(n.a, env) * evalAST(n.b, env);
    case 'div': return evalAST(n.a, env) / evalAST(n.b, env);
    case 'neg': return -evalAST(n.a, env);
    case 'pow': return Math.pow(evalAST(n.a, env), evalAST(n.b, env));
    case 'fn': return F_NUM[n.name](evalAST(n.a, env));
  }
}

/** Compara g con la derivada numérica (diferencias centrales) de f. true | false | null (no concluyente). */
export function verificarDerivada(f, g, v) {
  let ok = 0, mal = 0;
  for (const x of [0.7, 1.3, 2.1, -0.9, 0.35, 1.9, 3.3]) {
    try {
      const h = 1e-5 * Math.max(1, Math.abs(x));
      const num = (evalAST(f, { [v]: x + h }) - evalAST(f, { [v]: x - h })) / (2 * h);
      const val = evalAST(g, { [v]: x });
      if (!Number.isFinite(num) || !Number.isFinite(val)) continue;
      if (Math.abs(num - val) <= 1e-4 * (1 + Math.abs(val))) ok++; else mal++;
    } catch { /* punto fuera del dominio */ }
  }
  return mal > 0 ? false : ok >= 2 ? true : null;
}

// ───────────── Derivación con pasos ─────────────
const DER_FN = {
  sin: (u) => Fn('cos', u),
  cos: (u) => Neg(Fn('sin', u)),
  tan: (u) => Div(N(1), Pow(Fn('cos', u), N(2))),
  cot: (u) => Neg(Div(N(1), Pow(Fn('sin', u), N(2)))),
  sec: (u) => Mul(Fn('sec', u), Fn('tan', u)),
  csc: (u) => Neg(Mul(Fn('csc', u), Fn('cot', u))),
  asin: (u) => Div(N(1), Fn('sqrt', Sub(N(1), Pow(u, N(2))))),
  acos: (u) => Neg(Div(N(1), Fn('sqrt', Sub(N(1), Pow(u, N(2)))))),
  atan: (u) => Div(N(1), Add(N(1), Pow(u, N(2)))),
  sinh: (u) => Fn('cosh', u),
  cosh: (u) => Fn('sinh', u),
  tanh: (u) => Div(N(1), Pow(Fn('cosh', u), N(2))),
  ln: (u) => Div(N(1), u),
  exp: (u) => Fn('exp', u),
  sqrt: (u) => Div(N(1), Mul(N(2), Fn('sqrt', u))),
};

/** Devuelve { raw: AST sin simplificar, pasos: [{descripcion, ecuacion, latex, profundidad}] } */
export function derivarConPasos(raiz, v) {
  const pasos = [];
  const push = (prof, descripcion, ecuacion, latex) => pasos.push({ descripcion, ecuacion, latex, profundidad: prof });
  const Da = (n) => `d/d${v}[${str(n)}]`;
  const Dt = (n) => `\\frac{d}{d${v}}\\left[${tex(n)}\\right]`;
  const k = (n) => !tieneVar(n, v);
  const regla = (p, desc, n, rhsA, rhsT) => push(p, desc, `${Da(n)} = ${rhsA}`, `${Dt(n)} = ${rhsT}`);
  const cerrar = (p, n, r) => { push(p, 'Reunir los resultados', `${Da(n)} = ${str(r)}`, `${Dt(n)} = ${tex(r)}`); return r; };
  const menos1 = (e) => (e.t === 'num' ? N(e.v - 1) : Sub(e, N(1)));

  function d(n, p) {
    if (k(n)) return N(0);
    if (n.t === 'sym') return N(1);
    switch (n.t) {
      case 'neg': {
        regla(p, 'Derivada del opuesto: (−f)′ = −f′', n, `-${Da(n.a)}`, `-${Dt(n.a)}`);
        return cerrar(p, n, Neg(d(n.a, p + 1)));
      }
      case 'add': case 'sub': {
        const sg = n.t === 'add' ? '+' : '-';
        regla(p, `Regla de la ${n.t === 'add' ? 'suma' : 'resta'}: se deriva cada término por separado`, n,
          `${Da(n.a)} ${sg} ${Da(n.b)}`, `${Dt(n.a)} ${sg} ${Dt(n.b)}`);
        const da = d(n.a, p + 1), db = d(n.b, p + 1);
        return cerrar(p, n, n.t === 'add' ? Add(da, db) : Sub(da, db));
      }
      case 'mul': {
        if (k(n.a) || k(n.b)) {
          const [c, f] = k(n.a) ? [n.a, n.b] : [n.b, n.a];
          regla(p, 'Regla del múltiplo constante: (c·f)′ = c·f′', n, `${str(c, 3)}*${Da(f)}`, `${tex(c, 3)} \\cdot ${Dt(f)}`);
          return cerrar(p, n, Mul(c, d(f, p + 1)));
        }
        regla(p, `Regla del producto con u = ${str(n.a)} y v = ${str(n.b)}: (u·v)′ = u′·v + u·v′`, n,
          `${Da(n.a)}*${str(n.b, 3)} + ${str(n.a, 3)}*${Da(n.b)}`,
          `${Dt(n.a)} \\cdot ${tex(n.b, 3)} + ${tex(n.a, 3)} \\cdot ${Dt(n.b)}`);
        const du = d(n.a, p + 1), dv = d(n.b, p + 1);
        return cerrar(p, n, Add(Mul(du, n.b), Mul(n.a, dv)));
      }
      case 'div': {
        if (k(n.b)) {
          regla(p, 'Regla del múltiplo constante (denominador constante)', n, `${Da(n.a)}/${str(n.b, 4)}`, `\\frac{${Dt(n.a)}}{${tex(n.b)}}`);
          return cerrar(p, n, Div(d(n.a, p + 1), n.b));
        }
        regla(p, `Regla del cociente con u = ${str(n.a)} y v = ${str(n.b)}: (u/v)′ = (u′·v − u·v′)/v²`, n,
          `(${Da(n.a)}*${str(n.b, 3)} - ${str(n.a, 3)}*${Da(n.b)})/(${str(n.b)})^2`,
          `\\frac{${Dt(n.a)} \\cdot ${tex(n.b, 3)} - ${tex(n.a, 3)} \\cdot ${Dt(n.b)}}{\\left(${tex(n.b)}\\right)^{2}}`);
        const du = d(n.a, p + 1), dv = d(n.b, p + 1);
        return cerrar(p, n, Div(Sub(Mul(du, n.b), Mul(n.a, dv)), Pow(n.b, N(2))));
      }
      case 'pow': {
        const b = n.a, e = n.b;
        if (k(e)) {
          const base = Mul(e, Pow(b, menos1(e)));
          if (b.t === 'sym') {
            const r = base;
            regla(p, 'Regla de la potencia: (xⁿ)′ = n·xⁿ⁻¹', n, str(r), tex(r));
            return r;
          }
          regla(p, `Regla de la potencia con regla de la cadena (u = ${str(b)}): (uⁿ)′ = n·uⁿ⁻¹·u′`, n,
            `${str(base)}*${Da(b)}`, `${tex(base, 2)} \\cdot ${Dt(b)}`);
          return cerrar(p, n, Mul(base, d(b, p + 1)));
        }
        if (k(b)) {
          const esE = b.t === 'sym' && b.n === 'e';
          regla(p, esE ? 'Exponencial: (e^u)′ = e^u·u′' : `Exponencial de base constante: (a^u)′ = a^u·ln(a)·u′, con a = ${str(b)}`, n,
            esE ? `${str(n)}*${Da(e)}` : `${str(n, 3)}*ln(${str(b)})*${Da(e)}`,
            esE ? `${tex(n, 2)} \\cdot ${Dt(e)}` : `${tex(n, 2)} \\cdot \\ln\\left(${tex(b)}\\right) \\cdot ${Dt(e)}`);
          const de = d(e, p + 1);
          return cerrar(p, n, Mul(esE ? n : Mul(n, Fn('ln', b)), de));
        }
        regla(p, 'Derivación logarítmica: (uᵛ)′ = uᵛ·(v′·ln u + v·u′/u)', n,
          `${str(n, 3)}*(${Da(e)}*ln(${str(b)}) + ${str(e, 3)}*${Da(b)}/${str(b, 4)})`,
          `${tex(n, 2)} \\cdot \\left(${Dt(e)} \\cdot \\ln\\left(${tex(b)}\\right) + \\frac{${tex(e, 3)} \\cdot ${Dt(b)}}{${tex(b)}}\\right)`);
        const db = d(b, p + 1), de = d(e, p + 1);
        return cerrar(p, n, Mul(n, Add(Mul(de, Fn('ln', b)), Div(Mul(e, db), b))));
      }
      case 'fn': {
        const u = n.a;
        const exterior = DER_FN[n.name](u);
        if (u.t === 'sym') {
          regla(p, `Derivada de ${n.name}(${v})`, n, str(exterior), tex(exterior));
          return exterior;
        }
        regla(p, `Regla de la cadena con u = ${str(u)}: (f(u))′ = f′(u)·u′`, n,
          `${str(exterior, 3)}*${Da(u)}`, `${tex(exterior, 3)} \\cdot ${Dt(u)}`);
        return cerrar(p, n, Mul(exterior, d(u, p + 1)));
      }
    }
    throw new ErrorExpresion('Nodo no soportado en la derivación.');
  }

  const raw = d(raiz, 0);
  return { raw, pasos };
}
