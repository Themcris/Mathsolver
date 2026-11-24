// fracciones.js — Operaciones con fracciones, con el método desarrollado paso a paso.
// Sin dependencias del DOM; usa BigInt (sin errores de coma flotante). Cada resultado se
// contrasta con una evaluación independiente (frac.js) antes de devolverse.
//
//   esExpresionFraccionaria('3/4+2/3')  -> true
//   resolverFracciones('3/4+2/3')       -> { ok, resultado, latex, pasos, nivel: 'completo', verificado, metodo }
//
// Soporta números enteros, fracciones a/b, números mixtos ("1 1/2": entero, espacio, fracción),
// + − × ÷, signos y paréntesis. Convención de la barra:
//   · "a/b" justo después de un inicio de factor, de un × o de un ÷ es UNA fracción:  3/4*2/3 = (3/4)·(2/3),  3/4÷5/6 = (3/4)÷(5/6)
//   · una "/" que sigue a un factor ya completo es una división:                     3/4/5 = (3/4) ÷ 5
// Los decimales, las potencias y las variables no son de este módulo (los resuelve el motor numérico).
//
// Cada paso: { numero, descripcion, ecuacion, latex, profundidad }

import { Frac } from './frac.js';
import { esAritmeticaSimple } from './aritmetica.js';

const MAX_CIFRAS = 12;  // cifras máximas por número
const MAX_TOKENS = 60;
const MAX_ITERACIONES = 100;

class ErrorFracciones extends Error {}

// ───────────── Aritmética entera ─────────────
const abs = (a) => (a < 0n ? -a : a);
const mcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };
const mcm = (a, b) => (a / mcd(a, b)) * b;
const atomo = (n, d) => ({ k: 'atom', n, d });
const par = (n) => (n < 0n ? `(${n})` : `${n}`);
const veces = (q) => (q === 1n ? 'vez' : 'veces');
const unicos = (xs) => [...new Set(xs.map(String))];
const listaTxt = (xs) => {
  const u = unicos(xs);
  return u.length === 1 ? u[0] : `${u.slice(0, -1).join(', ')} y ${u[u.length - 1]}`;
};
const fracTxt = (a) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

// ───────────── Lectura ─────────────
/** Texto -> lista de tokens, o null si contiene algo que este módulo no resuelve. */
function tokenizar(texto) {
  let t = String(texto).trim().replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/:/g, '÷');
  t = t.replace(/(\d+)[ \t]+(\d+)\/(\d+)/g, '$1~$2~$3'); // número mixto "1 1/2" -> un solo token "1~1~2"
  t = t.replace(/\s+/g, '');
  if (!t || !/^[\d+\-*/÷()~]+$/.test(t)) return null;
  const tokens = t.match(/\d+~\d+~\d+|\d+|[+\-*/÷()]/g);
  if (tokens.length > MAX_TOKENS || tokens.some((k) => k.split('~').some((c) => c.length > MAX_CIFRAS))) return null;
  return tokens;
}

/** tokens -> árbol: atom{n,d} | paren{node} | sum{terms:[{sg,node}]} | prod{first, ops:[{op,node}]}. Lanza si no es válido. */
function parsear(tokens) {
  let i = 0;
  const ver = () => tokens[i];
  const esNum = (k) => k !== undefined && /^\d/.test(k);
  const falla = () => { throw new SyntaxError('expresión no soportada'); };

  function suma() {
    const terms = [];
    do {
      let sg = 1;
      while (ver() === '+' || ver() === '-') if (tokens[i++] === '-') sg = -sg;
      terms.push({ sg, node: producto() });
    } while (ver() === '+' || ver() === '-');
    if (terms.length === 1) { // sin suma: solo un signo delante (el menos de una fracción pasa a su numerador)
      const { sg, node } = terms[0];
      if (sg === 1) return node;
      if (node.k === 'atom') return atomo(-node.n, node.d);
    }
    return { k: 'sum', terms };
  }
  function producto() {
    const first = factor(true);
    const ops = [];
    while (ver() === '*' || ver() === '/' || ver() === '÷') {
      const op = tokens[i++];
      ops.push({ op, node: factor(op !== '/') });
    }
    return ops.length ? { k: 'prod', first, ops } : first;
  }
  function factor(permiteFraccion) {
    let neg = false;
    while (ver() === '-' || ver() === '+') if (tokens[i++] === '-') neg = !neg;
    if (ver() === '(') {
      i++;
      const interior = suma();
      if (ver() !== ')' || neg) falla();
      i++;
      return { k: 'paren', node: interior };
    }
    if (!esNum(ver())) falla();
    const tk = tokens[i++];
    if (tk.includes('~')) { // número mixto: entero + fracción
      const [w, r, den] = tk.split('~').map(BigInt);
      if (den === 0n) throw new ErrorFracciones('No se puede dividir entre cero.');
      const total = w * den + r;
      return { ...atomo(neg ? -total : total, den), mixto: w };
    }
    const n = BigInt(tk);
    let d = 1n;
    if (permiteFraccion && ver() === '/' && esNum(tokens[i + 1])) {
      i++;
      d = BigInt(tokens[i++]);
      if (d === 0n) throw new ErrorFracciones('No se puede dividir entre cero.');
    }
    return atomo(neg ? -n : n, d);
  }

  const arbol = suma();
  if (i !== tokens.length) falla();
  return arbol;
}

/** ¿Es una expresión con fracciones que este módulo sabe desarrollar? (las operaciones simples de dos números siguen en aritmetica.js) */
export function esExpresionFraccionaria(expr) {
  const tokens = tokenizar(expr);
  if (!tokens) return false;
  const hayMixto = tokens.some((k) => k.includes('~'));
  const hayDiv = tokens.some((k) => k === '/' || k === '÷');
  const nOps = tokens.filter((k) => k === '+' || k === '-' || k === '*' || k === '×' || k === '·').length;
  const hayParen = tokens.some((k) => k === '(');
  // Con fracciones, o enteros con varias operaciones / paréntesis (jerarquía de operaciones); lo simple sigue en aritmetica.js
  if (!hayMixto && ((!hayDiv && nOps < 2 && !hayParen) || esAritmeticaSimple(expr))) return false;
  try { parsear(tokens); return true; } catch { return false; }
}

/** Valor exacto del árbol, con frac.js (independiente del desarrollo paso a paso). */
function valor(n) {
  switch (n.k) {
    case 'atom': return new Frac(n.n, n.d);
    case 'paren': return valor(n.node);
    case 'sum': return n.terms.reduce((s, t) => (t.sg < 0 ? s.sub(valor(t.node)) : s.add(valor(t.node))), new Frac(0));
    case 'prod': return n.ops.reduce((acc, o) => (o.op === '*' ? acc.mul(valor(o.node)) : acc.div(valor(o.node))), valor(n.first));
    default: throw new Error('nodo desconocido');
  }
}

// ───────────── LaTeX ─────────────
const texAtomo = (a) => {
  if (a.mixto !== undefined) return `${a.n < 0n ? '-' : ''}${a.mixto}\\frac{${abs(a.n) - a.mixto * a.d}}{${a.d}}`; // número mixto tal como se escribió
  return a.d === 1n ? `${a.n}` : `${a.n < 0n ? '-' : ''}\\frac{${abs(a.n)}}{${a.d}}`;
};
/** Un átomo negativo va entre paréntesis salvo al principio. */
const texHijo = (n, conParentesis) => (n.k === 'atom' && n.n < 0n && conParentesis ? `\\left(${texAtomo(n)}\\right)` : tex(n));

function tex(n) {
  switch (n.k) {
    case 'atom': return texAtomo(n);
    case 'paren': return `\\left(${tex(n.node)}\\right)`;
    case 'sum': return n.terms.map((t, i) => {
      const c = texHijo(t.node, !(i === 0 && t.sg > 0));
      return i === 0 ? (t.sg < 0 ? `-${c}` : c) : `${t.sg < 0 ? '-' : '+'} ${c}`;
    }).join(' ');
    case 'prod': return [texHijo(n.first, false), ...n.ops.map((o) => `${o.op === '*' ? '\\cdot' : '\\div'} ${texHijo(o.node, true)}`)].join(' ');
    default: return '';
  }
}

/** LaTeX de este módulo -> texto plano (para el modo "copiar" y para cuando KaTeX no está disponible). */
export const texAAscii = (s) => s
  .replace(/(\d)\\frac/g, '$1 \\frac')
  .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => {
    const compuesto = (x) => /[+\-·*÷]|\\cdot|\\div/.test(x.replace(/^-/, ''));
    return `${compuesto(a) ? `(${a})` : a}/${compuesto(b) ? `(${b})` : b}`;
  })
  .replace(/\\cdot\s*/g, '· ').replace(/\\div\s*/g, '÷ ')
  .replace(/\\left\(/g, '(').replace(/\\right\)/g, ')')
  .replace(/\\operatorname\{([^}]*)\}/g, '$1').replace(/\\,/g, ' ')
  .replace(/\^\{([^{}]*)\}/g, '^$1').replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\(quad|qquad|;|:|!)/g, ' ').replace(/\\times/g, '·')
  .replace(/\s+/g, ' ').trim();

const paso = (descripcion, latex) => ({ descripcion, latex, ecuacion: texAAscii(latex), profundidad: 0 });

// ───────────── Pasos de cada operación ─────────────
/** Divide numerador y denominador entre su MCD (solo escribe un paso si hay algo que simplificar). */
function simplificarAtomo(a, pasos) {
  const g = mcd(a.n, a.d);
  if (g <= 1n) return a;
  const r = atomo(a.n / g, a.d / g);
  pasos.push(paso(
    `Simplificamos: dividimos numerador y denominador entre su máximo común divisor, ${g}`,
    `${texAtomo(a)} = ${a.n < 0n ? '-' : ''}\\frac{${abs(a.n)} \\div ${g}}{${a.d} \\div ${g}} = ${texAtomo(r)}`));
  return r;
}

/** Suma/resta de átomos: denominador común (MCM), conversión de cada fracción y operación de los numeradores. */
function sumar(nodo, pasos) {
  let terms = nodo.terms;

  if (terms.length === 1) { // solo puede ser un signo menos delante de un paréntesis: -(…)
    const { node } = terms[0];
    const r = atomo(-node.n, node.d);
    pasos.push(paso('Aplicamos el signo menos al numerador', `-${texHijo(node, true)} = ${texAtomo(r)}`));
    return r;
  }

  const dens = terms.map((t) => t.node.d);
  let D = dens[0];
  if (dens.some((d) => d !== D)) {
    D = dens.reduce((a, b) => mcm(a, b));
    pasos.push(paso(
      `Buscamos un denominador común: el mínimo común múltiplo (MCM) de ${listaTxt(dens)} es ${D}`,
      `\\operatorname{MCM}(${unicos(dens).join(',\\,')}) = ${D}`));
    terms = terms.map((t) => {
      const a = t.node;
      if (a.d === D) return t;
      const k = D / a.d;
      const nuevo = atomo(a.n * k, D);
      pasos.push(paso(
        `Convertimos ${fracTxt(a)} a denominador ${D}: multiplicamos numerador y denominador por ${k}`,
        `${texAtomo(a)} = ${a.n < 0n ? '-' : ''}\\frac{${abs(a.n)} \\cdot ${k}}{${a.d} \\cdot ${k}} = ${texAtomo(nuevo)}`));
      return { sg: t.sg, node: nuevo };
    });
  }

  const S = terms.reduce((s, t) => s + BigInt(t.sg) * t.node.n, 0n);
  const antes = tex({ k: 'sum', terms });
  const numeradores = terms.map((t, i) => {
    if (i === 0) return t.sg < 0 ? `-${par(t.node.n)}` : `${t.node.n}`;
    return `${t.sg < 0 ? '-' : '+'} ${par(t.node.n)}`;
  }).join(' ');
  const hayResta = terms.some((t) => t.sg < 0 || t.node.n < 0n);

  if (D === 1n) {
    pasos.push(paso('Operamos los números enteros', `${antes} = ${S}`));
  } else {
    pasos.push(paso(
      hayResta ? 'Sumamos y restamos los numeradores y mantenemos el denominador' : 'Sumamos los numeradores y mantenemos el denominador',
      `${antes} = \\frac{${numeradores}}{${D}} = \\frac{${S}}{${D}}`));
  }
  return atomo(S, D);
}

/** Producto o cociente de los dos primeros operandos (ya átomos). */
function combinarProducto(nodo, pasos) {
  const a = nodo.first;
  const { op, node } = nodo.ops[0];
  let b = node;

  if (op !== '*') {
    if (b.n === 0n) throw new ErrorFracciones('No se puede dividir entre cero.');
    const inverso = atomo(b.n < 0n ? -b.d : b.d, abs(b.n));
    pasos.push(paso(
      'Una división de fracciones se convierte en multiplicación por el recíproco (se invierte la segunda fracción)',
      `${texHijo(a, false)} \\div ${texHijo(b, true)} = ${texHijo(a, false)} \\cdot ${texHijo(inverso, true)}`));
    b = inverso;
  }

  const r = atomo(a.n * b.n, a.d * b.d);
  const antes = `${texHijo(a, false)} \\cdot ${texHijo(b, true)}`;
  if (a.d === 1n && b.d === 1n) {
    pasos.push(paso('Multiplicamos los números', `${antes} = ${r.n}`));
  } else {
    const dens = [a.d, b.d].filter((x) => x !== 1n);
    pasos.push(paso(
      'Multiplicamos los numeradores entre sí y los denominadores entre sí',
      `${antes} = \\frac{${par(a.n)} \\cdot ${par(b.n)}}{${dens.join(' \\cdot ')}} = ${texAtomo(r)}`));
  }
  return r;
}

// ───────────── Motor de reducción ─────────────
/** Quita los paréntesis que ya solo rodean a una fracción. */
function colapsar(n) {
  switch (n.k) {
    case 'paren': { const c = colapsar(n.node); return c.k === 'atom' ? c : { k: 'paren', node: c }; }
    case 'sum': return { k: 'sum', terms: n.terms.map((t) => ({ sg: t.sg, node: colapsar(t.node) })) };
    case 'prod': return { k: 'prod', first: colapsar(n.first), ops: n.ops.map((o) => ({ op: o.op, node: colapsar(o.node) })) };
    default: return n;
  }
}

/** Los números mixtos se pasan a fracciones impropias (un solo paso que los lista todos). */
function convertirMixtos(arbol, pasos) {
  const lista = [];
  const recorrer = (n) => {
    if (n.k === 'atom') { if (n.mixto !== undefined) lista.push(n); }
    else if (n.k === 'paren') recorrer(n.node);
    else if (n.k === 'sum') n.terms.forEach((t) => recorrer(t.node));
    else if (n.k === 'prod') { recorrer(n.first); n.ops.forEach((o) => recorrer(o.node)); }
  };
  recorrer(arbol);
  if (!lista.length) return arbol;
  pasos.push(paso(
    `Convertimos ${lista.length === 1 ? 'el número mixto' : 'los números mixtos'} a ${lista.length === 1 ? 'fracción impropia' : 'fracciones impropias'}: entero × denominador + numerador, sobre el mismo denominador`,
    lista.map((a) => {
      const sg = a.n < 0n ? '-' : '';
      const r = abs(a.n) - a.mixto * a.d;
      return `${texAtomo(a)} = ${sg}\\frac{${a.mixto} \\cdot ${a.d} + ${r}}{${a.d}} = ${texAtomo(atomo(a.n, a.d))}`;
    }).join(';\\; ')));
  const limpiar = (n) => {
    switch (n.k) {
      case 'atom': return atomo(n.n, n.d);
      case 'paren': return { k: 'paren', node: limpiar(n.node) };
      case 'sum': return { k: 'sum', terms: n.terms.map((t) => ({ sg: t.sg, node: limpiar(t.node) })) };
      default: return { k: 'prod', first: limpiar(n.first), ops: n.ops.map((o) => ({ op: o.op, node: limpiar(o.node) })) };
    }
  };
  const nuevo = colapsar(limpiar(arbol));
  if (nuevo.k !== 'atom') pasos.push(paso('Reescribimos la expresión con las fracciones impropias', tex(nuevo)));
  return nuevo;
}

/** Un resultado intermedio se simplifica enseguida; el final lo simplifica `finalizar`. */
const cerrar = (a, pasos, esFinal) => (esFinal ? a : simplificarAtomo(a, pasos));

/** Aplica UNA operación (paréntesis primero, luego de izquierda a derecha) y devuelve el árbol resultante. */
function reducir(n, pasos, esFinal) {
  switch (n.k) {
    case 'paren': return { k: 'paren', node: reducir(n.node, pasos, esFinal) };
    case 'sum': {
      const i = n.terms.findIndex((t) => t.node.k !== 'atom');
      if (i >= 0) return { k: 'sum', terms: n.terms.map((t, j) => (j === i ? { sg: t.sg, node: reducir(t.node, pasos, false) } : t)) };
      return cerrar(sumar(n, pasos), pasos, esFinal);
    }
    case 'prod': {
      if (n.first.k !== 'atom') return { ...n, first: reducir(n.first, pasos, false) };
      const j = n.ops.findIndex((o) => o.node.k !== 'atom');
      if (j >= 0) return { ...n, ops: n.ops.map((o, idx) => (idx === j ? { op: o.op, node: reducir(o.node, pasos, false) } : o)) };
      const r = combinarProducto(n, pasos);
      const resto = n.ops.slice(1);
      return resto.length ? { k: 'prod', first: cerrar(r, pasos, false), ops: resto } : cerrar(r, pasos, esFinal);
    }
    default: return n;
  }
}

/** Último paso sobre el resultado: simplificar, o dejar constancia de que ya está simplificado. */
function finalizar(a, pasos) {
  const g = mcd(a.n, a.d);
  if (g > 1n) return simplificarAtomo(a, pasos);
  if (a.d > 1n) {
    pasos.push(paso(
      `La fracción ${fracTxt(a)} ya está en su mínima expresión: el MCD de ${abs(a.n)} y ${a.d} es 1, no hay divisores comunes`,
      `\\operatorname{MCD}(${abs(a.n)},\\,${a.d}) = 1`));
  }
  return a;
}

// ───────────── Punto de entrada ─────────────
export function resolverFracciones(expr) {
  const tokens = tokenizar(expr);
  if (!tokens) return { ok: false, mensaje: 'Solo se resuelven fracciones con números enteros, + − × ÷ y paréntesis.' };
  try {
    const referencia = valor(parsear(tokens)); // lanza RangeError si hay una división entre cero
    let arbol = colapsar(parsear(tokens));
    const pasos = [paso('Expresión original', tex(arbol))];
    arbol = convertirMixtos(arbol, pasos);

    for (let vueltas = 0; arbol.k !== 'atom'; vueltas++) {
      if (vueltas >= MAX_ITERACIONES) throw new ErrorFracciones('La expresión es demasiado larga.');
      arbol = colapsar(reducir(arbol, pasos, true));
      if (arbol.k !== 'atom') pasos.push(paso('Reescribimos la expresión con el resultado', tex(arbol)));
    }

    const r = finalizar(arbol, pasos);
    const neg = r.n < 0n;
    let latex = texAtomo(r);
    if (r.d > 1n && abs(r.n) > r.d) {
      const q = abs(r.n) / r.d, resto = abs(r.n) % r.d;
      const mixto = `${neg ? '-' : ''}${q}\\frac{${resto}}{${r.d}}`;
      pasos.push(paso(
        `Expresamos como número mixto: dividimos ${abs(r.n)} entre ${r.d}; cabe ${q} ${veces(q)} y sobran ${resto}`,
        `${texAtomo(r)} = ${mixto}`));
      latex = `${texAtomo(r)} = ${mixto}`;
    }

    if (!valor(r).eq(referencia)) return { ok: false, mensaje: 'El desarrollo con fracciones no superó la verificación interna.' };
    return {
      ok: true,
      resultado: texAAscii(latex),
      latex,
      pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })),
      nivel: 'completo',
      verificado: true,
      metodo: 'fracciones',
    };
  } catch (e) {
    if (e instanceof ErrorFracciones) return { ok: false, mensaje: e.message };
    if (e instanceof RangeError) return { ok: false, mensaje: 'No se puede dividir entre cero.' };
    return { ok: false, mensaje: 'No se pudo desarrollar esta expresión con fracciones.' };
  }
}
