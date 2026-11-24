// identidades.js — Identidades notables con números y factorización de enteros, con el método paso a paso.
// Sin DOM, sin motores externos: BigInt + frac.js. Todo resultado se contrasta con la evaluación exacta de la
// expresión original; si no coincide, el módulo devuelve null y la solicitud sigue su camino normal.
//
//   detectarIdentidad('25^2-24^2')        -> { familia: 'dc', A: 25n, B: 24n, ... } | null
//   resolverIdentidad('25^2-24^2')        -> { ok, resultado: '49', pasos, nivel: 'completo', verificado, metodo: 'identidades' }
//   resolverFactorNumerico('100')         -> factorización en primos con pasos (nunca pasa por nerdamer)
//   resolverFactorNumerico('25^2-24^2')   -> (25-24)(25+24) = 49 = 7^2
//
// Familias: dc (a²−b²) · cubos (a³±b³) · tcp (a²±2ab+b²) · binomio ((a±b)² y (a±b)³) · sumadif ((a+b)(a−b)).

import { Frac } from './frac.js';
import { texAAscii } from './fracciones.js';

const MAX_TOKENS = 60;
const MAX_CIFRAS = 12;
const MAX_EXPONENTE = 64n;
const MAX_FACTORIZABLE = 10n ** 12n; // división por tentativa: ≤ 10⁶ iteraciones

// ───────────── Lectura de la expresión numérica ─────────────
function tokenizar(texto) {
  const t = String(texto).replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/²/g, '^2').replace(/³/g, '^3');
  if (!t || !/^[\d+\-*/^()]+$/.test(t)) return null;
  const tokens = t.match(/\d+|[+\-*/^()]/g);
  if (tokens.length > MAX_TOKENS || tokens.some((k) => /^\d/.test(k) && k.length > MAX_CIFRAS)) return null;
  return tokens;
}

/** Árbol: num{v} · neg{a} · bin{op, a, b}. Los paréntesis no dejan huella (solo agrupan). Lanza si no es válido. */
function parsear(tokens) {
  let i = 0;
  const ver = () => tokens[i];
  const falla = () => { throw new SyntaxError('expresión no válida'); };
  function suma() {
    let n = termino();
    while (ver() === '+' || ver() === '-') { const op = tokens[i++]; n = { t: 'bin', op, a: n, b: termino() }; }
    return n;
  }
  function termino() {
    let n = unario();
    while (ver() === '*' || ver() === '/') { const op = tokens[i++]; n = { t: 'bin', op, a: n, b: unario() }; }
    return n;
  }
  function unario() {
    if (ver() === '-') { i++; return { t: 'neg', a: unario() }; }
    if (ver() === '+') { i++; return unario(); }
    return potencia();
  }
  function potencia() {
    const base = atomo();
    if (ver() === '^') { i++; return { t: 'bin', op: '^', a: base, b: unario() }; }
    return base;
  }
  function atomo() {
    if (ver() === '(') { i++; const n = suma(); if (ver() !== ')') falla(); i++; return n; }
    if (ver() === undefined || !/^\d/.test(ver())) falla();
    return { t: 'num', v: BigInt(tokens[i++]) };
  }
  const n = suma();
  if (i !== tokens.length) falla();
  return n;
}

/** Valor exacto (Frac). Lanza RangeError ante división entre cero o exponentes fuera de rango. */
function evaluar(n) {
  switch (n.t) {
    case 'num': return new Frac(n.v);
    case 'neg': return evaluar(n.a).neg();
    default: {
      const a = evaluar(n.a), b = evaluar(n.b);
      switch (n.op) {
        case '+': return a.add(b);
        case '-': return a.sub(b);
        case '*': return a.mul(b);
        case '/': return a.div(b);
        default: {
          if (!b.isInt() || b.n > MAX_EXPONENTE || b.n < -MAX_EXPONENTE) throw new RangeError('exponente fuera de rango');
          const k = Number(b.n < 0n ? -b.n : b.n);
          const p = a.pow(k);
          return b.n < 0n ? new Frac(1).div(p) : p;
        }
      }
    }
  }
}

const enteroLiteral = (n) => (n.t === 'num' ? n.v : n.t === 'neg' && n.a.t === 'num' ? -n.a.v : null);

/** Términos de una suma con su signo: a - (b + c) no se aplana, solo - sobre términos simples. */
function terminos(n, s = 1, out = []) {
  if (n.t === 'bin' && n.op === '+') { terminos(n.a, s, out); terminos(n.b, s, out); }
  else if (n.t === 'bin' && n.op === '-') { terminos(n.a, s, out); terminos(n.b, -s, out); }
  else if (n.t === 'neg') terminos(n.a, -s, out);
  else out.push({ s, n });
  return out;
}

/** Base entera si el nodo es base^k con base literal y exponente exactamente k. */
function baseDePotencia(n, k) {
  if (n.t !== 'bin' || n.op !== '^') return null;
  const b = enteroLiteral(n.a);
  if (b === null) return null;
  try { return evaluar(n.b).eq(k) ? b : null; } catch { return null; }
}

// ───────────── Reconocimiento ─────────────
export function detectarIdentidad(texto) {
  const tokens = tokenizar(texto);
  if (!tokens || !tokens.includes('^') && !tokens.includes('*')) return null;
  let arbol, valor;
  try { arbol = parsear(tokens); valor = evaluar(arbol); } catch { return null; }
  if (!valor.isInt()) return null;
  const hallada = reconocer(arbol);
  if (!hallada) return null;
  hallada.valor = valor.n;
  hallada.arbol = arbol;
  return hallada;
}

function reconocer(arbol) {
  // (a+b)(a−b) o (a−b)(a+b)
  if (arbol.t === 'bin' && arbol.op === '*') {
    const l = terminos(arbol.a), r = terminos(arbol.b);
    if (l.length === 2 && r.length === 2 && arbol.a.t === 'bin' && arbol.b.t === 'bin') {
      const [l1, l2] = l.map((x) => enteroLiteral(x.n)), [r1, r2] = r.map((x) => enteroLiteral(x.n));
      if ([l1, l2, r1, r2].every((v) => v !== null) && l[0].s === 1 && r[0].s === 1 && l1 === r1 && l2 === r2 && l[1].s === -r[1].s) {
        return { familia: 'sumadif', A: l1, B: l2 };
      }
    }
  }
  // (a±b)² y (a±b)³
  if (arbol.t === 'bin' && arbol.op === '^' && (arbol.a.t === 'bin' && (arbol.a.op === '+' || arbol.a.op === '-'))) {
    let k = null;
    try { const e = evaluar(arbol.b); if (e.isInt() && (e.n === 2n || e.n === 3n)) k = Number(e.n); } catch { /* no es */ }
    const t = terminos(arbol.a);
    if (k && t.length === 2) {
      const a = enteroLiteral(t[0].n), b = enteroLiteral(t[1].n);
      if (a !== null && b !== null && t[0].s === 1) return { familia: 'binomio', k, A: a, B: b, signo: t[1].s };
    }
  }
  const t = terminos(arbol);
  // a² − b²
  if (t.length === 2) {
    const [p, q] = t;
    const a2 = baseDePotencia(p.n, new Frac(2)), b2 = baseDePotencia(q.n, new Frac(2));
    if (a2 !== null && b2 !== null && p.s === 1 && q.s === -1) return { familia: 'dc', A: a2, B: b2 };
    if (a2 !== null && b2 !== null && p.s === -1 && q.s === 1) return { familia: 'dc', A: b2, B: a2 };
    // a³ ± b³
    const a3 = baseDePotencia(p.n, new Frac(3)), b3 = baseDePotencia(q.n, new Frac(3));
    if (a3 !== null && b3 !== null) {
      if (p.s === 1) return { familia: 'cubos', A: a3, B: b3, signo: q.s };
      if (q.s === 1) return { familia: 'cubos', A: b3, B: a3, signo: p.s };
    }
  }
  // a² ± 2ab + b²
  if (t.length === 3) {
    for (let m = 0; m < 3; m++) {
      const [c1, c2] = t.filter((_, i) => i !== m);
      const medio = t[m];
      const a = baseDePotencia(c1.n, new Frac(2)), b = baseDePotencia(c2.n, new Frac(2));
      if (a === null || b === null || c1.s !== 1 || c2.s !== 1) continue;
      let v;
      try { v = evaluar(medio.n).mul(medio.s); } catch { continue; }
      const dos = new Frac(2n * a * b);
      if (v.eq(dos)) return { familia: 'tcp', A: a, B: b, signo: 1 };
      if (v.eq(dos.neg())) return { familia: 'tcp', A: a, B: b, signo: -1 };
    }
  }
  return null;
}

// ───────────── Pasos ─────────────
const pn = (x) => (x < 0n ? `\\left(${x}\\right)` : `${x}`);   // base o factor negativo entre paréntesis
const sg = (s) => (s < 0 ? '-' : '+');
const paso = (descripcion, latex) => ({ descripcion, latex, ecuacion: texAAscii(latex), profundidad: 0 });

function pasosFamilia(h) {
  const { A, B, valor } = h;
  const P = [];
  const pot = (x, k) => `${pn(x)}^{${k}}`;

  switch (h.familia) {
    case 'dc': {
      const f1 = A - B, f2 = A + B;
      P.push(
        paso('Expresión original', `${pot(A, 2)} - ${pot(B, 2)}`),
        paso('Reconocemos una diferencia de cuadrados: a² − b² = (a − b)(a + b)', `a^{2} - b^{2} = (a - b)(a + b), \\quad a = ${A},\\; b = ${B}`),
        paso('Aplicamos la identidad sustituyendo a y b', `${pot(A, 2)} - ${pot(B, 2)} = (${A} - ${pn(B)})(${A} + ${pn(B)})`),
        paso('Calculamos cada paréntesis', `(${A} - ${pn(B)})(${A} + ${pn(B)}) = ${pn(f1)} \\cdot ${pn(f2)}`),
        paso('Multiplicamos los dos factores', `${pn(f1)} \\cdot ${pn(f2)} = ${valor}`),
        paso('Comprobamos calculando las potencias por separado', `${pot(A, 2)} - ${pot(B, 2)} = ${A * A} - ${A === B ? A * A : B * B} = ${valor}`),
      );
      h.factorizado = { tex: `(${A} - ${pn(B)})(${A} + ${pn(B)})` };
      break;
    }
    case 'sumadif': {
      P.push(
        paso('Expresión original', `(${A} + ${pn(B)})(${A} - ${pn(B)})`),
        paso('Reconocemos el producto de una suma por una diferencia: (a + b)(a − b) = a² − b²', `(a + b)(a - b) = a^{2} - b^{2}, \\quad a = ${A},\\; b = ${B}`),
        paso('Aplicamos la identidad', `(${A} + ${pn(B)})(${A} - ${pn(B)}) = ${pot(A, 2)} - ${pot(B, 2)}`),
        paso('Calculamos las potencias', `${pot(A, 2)} - ${pot(B, 2)} = ${A * A} - ${B * B} = ${valor}`),
        paso('Comprobamos multiplicando los paréntesis', `(${A + B}) \\cdot (${A - B}) = ${valor}`),
      );
      h.factorizado = { tex: `(${A} + ${pn(B)})(${A} - ${pn(B)})` };
      break;
    }
    case 'cubos': {
      const s = h.signo; // +1 suma, -1 diferencia
      const ab = A * B;
      const f1 = s > 0 ? A + B : A - B;
      const f2 = A * A - BigInt(s) * ab + B * B;
      const nombre = s > 0 ? 'suma' : 'diferencia';
      const formula = s > 0 ? 'a^{3} + b^{3} = (a + b)(a^{2} - ab + b^{2})' : 'a^{3} - b^{3} = (a - b)(a^{2} + ab + b^{2})';
      const titulo = s > 0 ? 'a³ + b³ = (a + b)(a² − ab + b²)' : 'a³ − b³ = (a − b)(a² + ab + b²)';
      P.push(
        paso('Expresión original', `${pot(A, 3)} ${sg(s)} ${pot(B, 3)}`),
        paso(`Reconocemos una ${nombre} de cubos: ${titulo}`, `${formula}, \\quad a = ${A},\\; b = ${B}`),
        paso('Aplicamos la identidad sustituyendo a y b',
          `${pot(A, 3)} ${sg(s)} ${pot(B, 3)} = (${A} ${sg(s)} ${pn(B)})(${pot(A, 2)} ${s > 0 ? '-' : '+'} ${pn(A)} \\cdot ${pn(B)} + ${pot(B, 2)})`),
        paso('Calculamos cada factor', `(${A} ${sg(s)} ${pn(B)})(${A * A} ${s > 0 ? '-' : '+'} ${pn(ab)} + ${B * B}) = ${pn(f1)} \\cdot ${pn(f2)}`),
        paso('Multiplicamos los dos factores', `${pn(f1)} \\cdot ${pn(f2)} = ${valor}`),
        paso('Comprobamos calculando las potencias por separado', `${pot(A, 3)} ${sg(s)} ${pot(B, 3)} = ${A ** 3n} ${sg(s)} ${pn(B ** 3n)} = ${valor}`.replace(/\+ \\left\(-/, '- \\left(-')),
      );
      h.factorizado = { tex: `(${A} ${sg(s)} ${pn(B)})(${A * A} ${s > 0 ? '-' : '+'} ${pn(ab)} + ${B * B})` };
      break;
    }
    case 'tcp': {
      const s = h.signo, dos = 2n * A * B;
      const suma = A + BigInt(s) * B;
      const cuerpo = `${pot(A, 2)} ${sg(s)} 2 \\cdot ${pn(A)} \\cdot ${pn(B)} + ${pot(B, 2)}`;
      P.push(
        paso('Expresión original', cuerpo),
        paso(`Reconocemos un trinomio cuadrado perfecto: a² ${s > 0 ? '+' : '−'} 2ab + b² = (a ${s > 0 ? '+' : '−'} b)²`,
          `a^{2} ${sg(s)} 2ab + b^{2} = (a ${sg(s)} b)^{2}, \\quad a = ${A},\\; b = ${B}`),
        paso('Comprobamos que el término del medio es 2ab', `2 \\cdot ${pn(A)} \\cdot ${pn(B)} = ${pn(dos)}`),
        paso('Aplicamos la identidad', `${cuerpo} = (${A} ${sg(s)} ${pn(B)})^{2}`),
        paso('Calculamos el paréntesis y elevamos al cuadrado', `(${A} ${sg(s)} ${pn(B)})^{2} = ${pn(suma)}^{2} = ${valor}`),
        paso('Comprobamos sumando los términos', `${A * A} ${sg(s)} ${dos < 0n ? -dos : dos} + ${B * B} = ${valor}`),
      );
      h.factorizado = { tex: `(${A} ${sg(s)} ${pn(B)})^{2}` };
      break;
    }
    case 'binomio': {
      const s = h.signo, k = h.k;
      const base = `(${A} ${sg(s)} ${pn(B)})^{${k}}`;
      const sumaB = A + BigInt(s) * B;
      if (k === 2) {
        const dos = 2n * A * B;
        P.push(
          paso('Expresión original', base),
          paso(`Reconocemos el cuadrado de un binomio: (a ${s > 0 ? '+' : '−'} b)² = a² ${s > 0 ? '+' : '−'} 2ab + b²`,
            `(a ${sg(s)} b)^{2} = a^{2} ${sg(s)} 2ab + b^{2}, \\quad a = ${A},\\; b = ${B}`),
          paso('Aplicamos la identidad sustituyendo a y b', `${base} = ${pot(A, 2)} ${sg(s)} 2 \\cdot ${pn(A)} \\cdot ${pn(B)} + ${pot(B, 2)}`),
          paso('Calculamos cada término', `${pot(A, 2)} ${sg(s)} 2 \\cdot ${pn(A)} \\cdot ${pn(B)} + ${pot(B, 2)} = ${A * A} ${sg(s)} ${pn(dos)} + ${B * B}`),
          paso('Sumamos', `${A * A} ${sg(s)} ${pn(dos)} + ${B * B} = ${valor}`),
          paso('Comprobamos resolviendo primero el paréntesis', `(${A} ${sg(s)} ${pn(B)})^{2} = ${pn(sumaB)}^{2} = ${valor}`),
        );
      } else {
        const t2 = 3n * A * A * B, t3 = 3n * A * B * B;
        P.push(
          paso('Expresión original', base),
          paso(`Reconocemos el cubo de un binomio: (a ${s > 0 ? '+' : '−'} b)³ = a³ ${s > 0 ? '+' : '−'} 3a²b + 3ab² ${s > 0 ? '+' : '−'} b³`,
            `(a ${sg(s)} b)^{3} = a^{3} ${sg(s)} 3a^{2}b + 3ab^{2} ${sg(s)} b^{3}, \\quad a = ${A},\\; b = ${B}`),
          paso('Aplicamos la identidad sustituyendo a y b',
            `${base} = ${pot(A, 3)} ${sg(s)} 3 \\cdot ${pot(A, 2)} \\cdot ${pn(B)} + 3 \\cdot ${pn(A)} \\cdot ${pot(B, 2)} ${sg(s)} ${pot(B, 3)}`),
          paso('Calculamos cada término', `${A ** 3n} ${sg(s)} ${pn(t2)} + ${pn(t3)} ${sg(s)} ${pn(B ** 3n)} = ${valor}`),
          paso('Comprobamos resolviendo primero el paréntesis', `(${A} ${sg(s)} ${pn(B)})^{3} = ${pn(sumaB)}^{3} = ${valor}`),
        );
      }
      h.factorizado = null;
      break;
    }
    default: return null;
  }
  return P;
}

function respuesta(h, pasos, resultadoTex) {
  return {
    ok: true,
    resultado: texAAscii(resultadoTex),
    latex: resultadoTex,
    pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })),
    nivel: 'completo',
    verificado: true,
    metodo: 'identidades',
    identidad: h.familia,
  };
}

/** Evalúa una expresión numérica que encaja con una identidad notable, mostrando la identidad aplicada. */
export function resolverIdentidad(texto) {
  const h = detectarIdentidad(texto);
  if (!h) return { ok: false, mensaje: 'No es una identidad notable con números.' };
  const pasos = pasosFamilia(h);
  if (!pasos) return { ok: false, mensaje: 'No se pudo desarrollar esta identidad.' };
  return respuesta(h, pasos, `${h.valor}`);
}

// ───────────── Factorización de enteros ─────────────
/** Descompone n (> 1) en primos por división por tentativa. Devuelve [{ p, e }] y los pasos de división. */
function descomponer(n) {
  const divisiones = [];
  const primos = [];
  let r = n;
  const dividir = (p) => {
    let e = 0;
    while (r % p === 0n) { divisiones.push({ de: r, p, cociente: r / p }); r /= p; e++; }
    if (e) primos.push({ p, e });
  };
  dividir(2n);
  for (let p = 3n; p * p <= r; p += 2n) dividir(p);
  if (r > 1n) { divisiones.push({ de: r, p: r, cociente: 1n }); primos.push({ p: r, e: 1 }); }
  return { primos, divisiones };
}

const potenciaTex = ({ p, e }) => (e === 1 ? `${p}` : `${p}^{${e}}`);

function pasosEntero(n, titulo = 'Número a factorizar') {
  const P = [paso(titulo, `${n}`)];
  if (n === 0n) return { pasos: [...P, paso('El cero no se factoriza en primos', '0')], tex: '0', primos: [] };
  const neg = n < 0n;
  const m = neg ? -n : n;
  if (m === 1n) return { pasos: [...P, paso('El 1 no tiene factores primos', `${n}`)], tex: `${n}`, primos: [] };
  if (m > MAX_FACTORIZABLE) return { error: `El número es demasiado grande para factorizarlo paso a paso (máximo ${MAX_FACTORIZABLE}).` };

  if (neg) P.push(paso('El número es negativo: sacamos el factor −1 y factorizamos su valor absoluto', `${n} = -1 \\cdot ${m}`));
  const { primos, divisiones } = descomponer(m);
  if (primos.length === 1 && primos[0].e === 1) {
    P.push(paso(`${m} es un número primo: solo es divisible entre 1 y entre sí mismo`, `${m}`));
    return { pasos: P, tex: neg ? `-1 \\cdot ${m}` : `${m}`, primos, primo: true };
  }
  P.push(paso('Dividimos entre los primos más pequeños posibles, empezando por el 2, hasta llegar a 1',
    divisiones.map((d) => `${d.de} \\div ${d.p} = ${d.cociente}`).join(';\\; ')));
  const plano = primos.flatMap(({ p, e }) => Array(e).fill(`${p}`)).join(' \\cdot ');
  const compacto = primos.map(potenciaTex).join(' \\cdot ');
  const finalTex = `${neg ? '-1 \\cdot ' : ''}${compacto}`;
  P.push(paso('Agrupamos los primos repetidos con exponentes', plano === compacto ? `${m} = ${plano}` : `${m} = ${plano} = ${compacto}`));
  return { pasos: P, tex: finalTex, primos };
}

/** factor(…) sin variables: identidad notable si encaja; si no, factorización en primos del valor exacto. */
export function resolverFactorNumerico(texto) {
  const tokens = tokenizar(texto);
  if (!tokens) return { ok: false, mensaje: 'Para factorizar con números usa enteros, + − × ÷ ^ y paréntesis.' };
  let valor;
  try { valor = evaluar(parsear(tokens)); } catch (e) {
    return { ok: false, mensaje: e instanceof RangeError ? 'No se puede evaluar esa expresión (división entre cero o exponente demasiado grande).' : 'No se entiende la expresión.' };
  }

  const h = detectarIdentidad(texto);
  if (h) {
    const base = pasosFamilia(h);
    if (base) {
      const lista = [...base];
      let resultadoTex = h.factorizado ? `${h.factorizado.tex} = ${h.valor}` : `${h.valor}`;
      if (valor.isInt() && valor.n > 1n && valor.n <= MAX_FACTORIZABLE) {
        const f = pasosEntero(valor.n, `Factorizamos el resultado, ${valor.n}, en primos`);
        if (!f.error && !f.primo) { lista.push(...f.pasos); resultadoTex += ` = ${f.tex}`; }
        else if (!f.error && f.primo) { lista.push(f.pasos[f.pasos.length - 1]); }
      }
      return respuesta(h, lista, resultadoTex);
    }
  }

  if (!valor.isInt()) {
    const num = pasosEntero(valor.n, 'Numerador'), den = pasosEntero(valor.d, 'Denominador');
    if (num.error || den.error) return { ok: false, mensaje: num.error || den.error };
    const tex = `\\frac{${num.tex}}{${den.tex}}`;
    const pasos = [paso('Expresión original', `${texto}`.replace(/\s+/g, '') ? `\\frac{${valor.n}}{${valor.d}}` : ''), ...num.pasos, ...den.pasos, paso('Fracción factorizada', `\\frac{${valor.n}}{${valor.d}} = ${tex}`)];
    return { ok: true, resultado: texAAscii(`\\frac{${valor.n}}{${valor.d}} = ${tex}`), latex: `\\frac{${valor.n}}{${valor.d}} = ${tex}`, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado: true, metodo: 'identidades' };
  }

  const f = pasosEntero(valor.n);
  if (f.error) return { ok: false, mensaje: f.error };
  const pasos = [];
  if (tokens.length > 1) pasos.push(paso('Calculamos el valor de la expresión', `${texto.replace(/\s+/g, '')} = ${valor.n}`.replace(/\*/g, ' \\cdot ').replace(/\^(\d+)/g, '^{$1}')));
  pasos.push(...f.pasos);
  const tex = f.primo || !f.primos.length ? `${valor.n}` : `${valor.n} = ${f.tex}`;
  return {
    ok: true, resultado: texAAscii(tex), latex: tex, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })),
    nivel: 'completo', verificado: true, metodo: 'identidades',
  };
}
