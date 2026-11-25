// motorJS.js — Capa JS: álgebra y derivadas con pasos (motorPasos) y respuestas rápidas sin
// desarrollo (nerdamer). nerdamer y mathsteps NO se importan: se leen de los globales que
// cargan los <script> del HTML (/vendor/nerdamer/all.min.js, local). Si faltan, el álgebra básica
// (lineales, cuadráticas) y las derivadas con pasos siguen funcionando.
//
// Contrato: resolver(solicitud) -> { ok, resultado, latex?, pasos: Step[], nivel, verificado?, advertencias?, metodo?, mensaje? }
// Step = { numero, descripcion, ecuacion, latex?, profundidad }

import { parsear, str, simbolos, evalAST, derivarConPasos, verificarDerivada, ErrorExpresion } from './motorPasos.js';
import { resolverAlgebraico } from './simplificarPasos.js';

const MSG_SIN_NERDAMER = 'El motor algebraico (Nerdamer) no se pudo cargar. Recarga la página; si el problema continúa, borra los datos del sitio y vuelve a abrirla.';
/** Marca interna: el error se reconoce por su código, no por el texto del mensaje. */
const esErrorSinNerdamer = (e) => e?.code === 'SIN_NERDAMER';
function nerdamerGlobal() {
  const n = globalThis.nerdamer;
  if (typeof n !== 'function') throw Object.assign(new Error(MSG_SIN_NERDAMER), { code: 'SIN_NERDAMER' });
  return n;
}
const mathsteps = () => globalThis.mathsteps ?? null; // opcional: solo si lo cargas como script global

// ───────────── Utilidades ─────────────
const paso = (descripcion, ecuacion, latex, profundidad = 0) => ({ descripcion, ecuacion, latex, profundidad });
const numerar = (pasos) => pasos.map((p, i) => ({ numero: i + 1, ...p }));
const paraN = (s) => String(s).replace(/\bln\(/g, 'log(').replace(/\bsen\(/g, 'sin(').replace(/\barctan\(/g, 'atan(').replace(/\barcsin\(/g, 'asin(').replace(/\barccos\(/g, 'acos(');
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(+x.toPrecision(10)));
const limpio = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x);

function nerd(expr) {
  const r = nerdamerGlobal()(paraN(expr));
  let tex = null;
  try { tex = r.toTeX(); } catch { /* sin LaTeX */ }
  return { txt: r.toString(), tex };
}

function varDe(s, ...ast) {
  if (s.v) return s.v;
  const set = new Set();
  ast.forEach((a) => simbolos(a, set));
  if (set.size === 0 || set.has('x')) return 'x';
  return [...set][0];
}

// ───────────── Derivadas (pasos completos) ─────────────
function derivada(s) {
  const f = parsear(s.expr);
  const v = varDe(s, f);
  const { raw, pasos } = derivarConPasos(f, v);
  const advertencias = [];

  const ver = verificarDerivada(f, raw, v);
  if (ver === false) {
    // Seguridad: si nuestro motor se equivoca, no mostramos pasos incorrectos.
    let r;
    try { r = nerd(`diff(${s.expr}, ${v})`); } catch { return { ok: false, mensaje: 'El desarrollo no pasó la verificación numérica y no hay motor de respaldo disponible.' }; }
    return {
      ok: true, resultado: r.txt, latex: r.tex, pasos: numerar([paso('Resultado del motor simbólico (no se pudo generar un desarrollo fiable)', `d/d${v}[f] = ${r.txt}`, null)]),
      nivel: 'parcial', verificado: false, metodo: 'nerdamer',
      advertencias: ['El desarrollo paso a paso no pasó la verificación numérica y se omitió.'],
    };
  }

  let finalStr = str(raw);
  let finalTex = null;
  const lista = [paso('Función a derivar', `f(${v}) = ${str(f)}`, null), ...pasos];

  try {
    const sn = nerd(str(raw));
    let aceptar = true;
    try { aceptar = verificarDerivada(f, parsear(sn.txt), v) !== false; } catch { /* nerdamer usó notación que no parseamos */ }
    if (aceptar) {
      finalStr = sn.txt; finalTex = sn.tex;
      if (sn.txt !== str(raw)) lista.push(paso('Simplificar el resultado', `f′(${v}) = ${sn.txt}`, sn.tex ? `f'(${v}) = ${sn.tex}` : null));
    } else advertencias.push('La simplificación automática no pasó la verificación; se muestra la forma sin simplificar.');
  } catch { /* se queda la forma sin simplificar */ }

  if (ver === null) advertencias.push('No se pudo verificar numéricamente el resultado (dominio restringido).');
  return { ok: true, resultado: finalStr, latex: finalTex, pasos: numerar(lista), nivel: 'completo', verificado: ver === true, metodo: 'Reglas de derivación', advertencias };
}

// ───────────── Ecuaciones ─────────────
const ES_MS = {
  ADD_TO_BOTH_SIDES: 'Sumar el mismo valor en ambos lados', SUBTRACT_FROM_BOTH_SIDES: 'Restar el mismo valor en ambos lados',
  MULTIPLY_TO_BOTH_SIDES: 'Multiplicar ambos lados', DIVIDE_FROM_BOTH_SIDES: 'Dividir ambos lados',
  SIMPLIFY_LEFT_SIDE: 'Simplificar el lado izquierdo', SIMPLIFY_RIGHT_SIDE: 'Simplificar el lado derecho',
  SWAP_SIDES: 'Intercambiar los lados', COLLECT_AND_COMBINE_LIKE_TERMS: 'Agrupar y sumar términos semejantes',
  SIMPLIFY_ARITHMETIC: 'Operar los números', REMOVE_ADDING_ZERO: 'Quitar el sumando cero', REMOVE_MULTIPLYING_BY_ONE: 'Quitar el factor 1',
  DISTRIBUTE: 'Aplicar la propiedad distributiva', CANCEL_TERMS: 'Cancelar términos', FIND_ROOTS: 'Calcular las raíces',
  RESOLVE_DOUBLE_MINUS: 'Resolver el doble signo menos', MULTIPLY_FRACTIONS: 'Multiplicar fracciones', ADD_FRACTIONS: 'Sumar fracciones',
  SIMPLIFY_FRACTION: 'Simplificar la fracción', COMBINE_NESTED_FRACTIONS: 'Combinar fracciones anidadas', COMBINE_COEFFICIENTS: 'Combinar coeficientes',
};
const descMS = (t) => ES_MS[t] ?? String(t).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const asc = (x) => (x?.ascii ? x.ascii() : x?.toString ? x.toString() : String(x));

function pasosMathsteps(lista, campoNuevo, prof = 0, out = []) {
  for (const st of lista ?? []) {
    out.push(paso(descMS(st.changeType), asc(st[campoNuevo]), null, prof));
    if (st.substeps?.length) pasosMathsteps(st.substeps, campoNuevo, prof + 1, out);
  }
  return out;
}

function coefsCuadratica(f, v) {
  try {
    const E = (x) => evalAST(f, { [v]: x });
    const c = E(0), p1 = E(1), m1 = E(-1);
    if (![c, p1, m1].every(Number.isFinite)) return null;
    const a = (p1 + m1) / 2 - c, b = (p1 - m1) / 2;
    for (const x of [2, -3, 0.5, 5]) {
      const y = E(x);
      if (!Number.isFinite(y) || Math.abs(a * x * x + b * x + c - y) > 1e-7 * (1 + Math.abs(y))) return null;
    }
    return { a: limpio(a), b: limpio(b), c: limpio(c) };
  } catch { return null; }
}

const termino = (coef, pot, v) => {
  if (coef === 0) return '';
  const m = Math.abs(coef);
  const cuerpo = pot === 0 ? fmt(m) : `${m === 1 ? '' : fmt(m)}${v}${pot === 1 ? '' : '^' + pot}`;
  return `${coef < 0 ? '-' : '+'} ${cuerpo}`;
};
const poly = (a, b, c, v) => {
  const s = [termino(a, 2, v), termino(b, 1, v), termino(c, 0, v)].filter(Boolean).join(' ').replace(/^\+ /, '');
  return s.replace(/^- /, '-') || '0';
};
const par = (x) => (x < 0 ? `(${fmt(x)})` : fmt(x));

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));

/** Fracción reducida en texto ("3", "-1/2"); decimal si no son enteros. */
function fraccion(n, d) {
  if (Number.isInteger(n) && Number.isInteger(d) && d !== 0) {
    const g = gcd(n, d) || 1;
    let p = n / g, q = d / g;
    if (q < 0) { p = -p; q = -q; }
    return q === 1 ? String(p) : `${p}/${q}`;
  }
  return fmt(limpio(n / d));
}

/** Raíz (signo sg = ±1) de a·x² + b·x + c con discriminante D. Exacta cuando es posible, sin depender de nerdamer. */
function raizCuadratica(a, b, D, sg) {
  const enteros = Number.isInteger(a) && Number.isInteger(b) && Number.isInteger(D);
  const signo = sg > 0 ? '+' : '-';
  if (D >= 0) {
    const r = Math.sqrt(D);
    if (enteros && Number.isInteger(r)) return fraccion(-b + sg * r, 2 * a);
    try { return nerd(`(-(${b}) ${signo} sqrt(${D}))/(2*(${a}))`).txt; } catch { /* sin nerdamer */ }
    return `(${fmt(-b)} ${signo} sqrt(${fmt(D)}))/${fmt(2 * a)} ≈ ${fmt(limpio((-b + sg * r) / (2 * a)))}`;
  }
  const re = fraccion(-b, 2 * a);
  const rIm = Math.sqrt(-D);
  const im = enteros && Number.isInteger(rIm) ? fraccion(rIm, 2 * Math.abs(a)) : `sqrt(${fmt(-D)})/${fmt(2 * Math.abs(a))}`;
  const imTxt = im === '1' ? 'i' : `${im}*i`;
  return re === '0' ? `${sg > 0 ? '' : '-'}${imTxt}` : `${re} ${signo} ${imTxt}`;
}

function resolverNerd(eq, v) {
  const N = nerdamerGlobal();
  return (typeof N.solve === 'function' ? N.solve(eq, v) : N(`solve(${eq}, ${v})`)).toString();
}

async function ecuacion(s) {
  const L = parsear(s.lhs), R = parsear(s.rhs);
  const v = varDe(s, L, R);
  const f = { t: 'sub', a: L, b: R };
  const eqTxt = `${str(L)} = ${str(R)}`;
  const co = coefsCuadratica(f, v);
  const pasos = [paso('Ecuación a resolver', eqTxt, null)];

  // Lineal: mathsteps si está cargado como global; si no, pasos propios.
  if (co && Math.abs(co.a) < 1e-12 && Math.abs(co.b) > 1e-12) {
    const ms = mathsteps();
    if (ms) {
      try {
        const st = ms.solveEquation(eqTxt);
        if (st?.length) {
          const lista = [...pasos, ...pasosMathsteps(st, 'newEquation')];
          return { ok: true, resultado: lista[lista.length - 1].ecuacion, pasos: numerar(lista), nivel: 'completo', verificado: true, metodo: 'mathsteps' };
        }
      } catch { /* continúa con pasos propios */ }
    }
    const { b, c } = co;
    const x = fraccion(-c, b);
    pasos.push(
      paso('Pasar todo a un lado: forma b·x + c = 0', `${poly(0, b, c, v)} = 0`, null),
      paso('Dejar el término con x solo (restar c)', `${termino(b, 1, v).replace(/^\+ /, '')} = ${fmt(-c)}`, null),
    );
    if (Math.abs(b - 1) > 1e-12) pasos.push(paso(`Dividir entre ${par(b)}`, `${v} = ${x}`, null)); // dividir entre 1 no cambia nada
    return { ok: true, resultado: `${v} = ${x}`, pasos: numerar(pasos), nivel: 'completo', verificado: true, metodo: 'Ecuación lineal' };
  }

  // Cuadrática: pasos propios con discriminante.
  if (co && Math.abs(co.a) > 1e-12) {
    const { a, b, c } = co;
    const D = limpio(b * b - 4 * a * c);
    const estandar = `${poly(a, b, c, v)} = 0`;
    const quitar = (t) => String(t).replace(/[\s*]/g, '');
    if (quitar(eqTxt) !== quitar(estandar)) pasos.push(paso('Llevar a la forma estándar a·x² + b·x + c = 0', estandar, null)); // si ya está así, no se repite
    pasos.push(
      paso('Identificar los coeficientes', `a = ${fmt(a)},  b = ${fmt(b)},  c = ${fmt(c)}`, null),
      paso('Calcular el discriminante Δ = b² − 4ac', `Δ = ${par(b)}^2 - 4*${par(a)}*${par(c)} = ${fmt(D)}`, null),
    );
    let soluciones;
    if (D > 1e-12) {
      pasos.push(paso('Δ > 0: hay dos raíces reales distintas', null, null));
      soluciones = [raizCuadratica(a, b, D, 1), raizCuadratica(a, b, D, -1)];
    } else if (Math.abs(D) <= 1e-12) {
      pasos.push(paso('Δ = 0: hay una raíz real doble', null, null));
      soluciones = [raizCuadratica(a, b, 0, 1)];
    } else {
      pasos.push(paso('Δ < 0: no hay raíces reales; las raíces son complejas conjugadas', null, null));
      soluciones = [raizCuadratica(a, b, D, 1), raizCuadratica(a, b, D, -1)];
    }
    pasos.push(paso('Aplicar la fórmula general x = (−b ± √Δ) / (2a)', `${v} = (-(${fmt(b)}) ± sqrt(${fmt(D)})) / (2*${par(a)})`, null));
    soluciones.forEach((r, i) => pasos.push(paso(soluciones.length === 1 ? 'Raíz' : `Raíz ${i + 1}`, `${v}${soluciones.length === 1 ? '' : i + 1} = ${r}`, null)));
    let verificado = null;
    if (D >= 0) {
      const rs = Math.abs(D) <= 1e-12 ? [-b / (2 * a)] : [(-b + Math.sqrt(D)) / (2 * a), (-b - Math.sqrt(D)) / (2 * a)];
      verificado = rs.every((x) => Math.abs(evalAST(f, { [v]: x })) < 1e-7 * (1 + Math.abs(a * x * x) + Math.abs(b * x) + Math.abs(c)));
    }
    return { ok: true, resultado: soluciones.map((r) => `${v} = ${r}`).join(',  '), pasos: numerar(pasos), nivel: 'completo', verificado, metodo: 'Fórmula general' };
  }

  // Otros casos (grado mayor, trascendentes): nerdamer, sin desarrollo.
  try {
    const sol = resolverNerd(paraN(eqTxt), v);
    const items = sol.replace(/^\[|\]$/g, '').split(/,(?![^()]*\))/).map((t) => t.trim()).filter(Boolean);
    if (!items.length) return { ok: false, mensaje: 'El motor ligero no encontró soluciones.' };
    let verificado = null;
    try { verificado = items.every((r) => Math.abs(evalAST(f, { [v]: evalAST(parsear(r), {}) })) < 1e-6); } catch { /* complejas o no evaluables */ }
    if (verificado === false) return { ok: false, mensaje: 'Solución descartada: no pasó la verificación por sustitución.' };
    pasos.push(paso('Solución obtenida por el motor simbólico ligero (sin desarrollo)', items.map((r) => `${v} = ${r}`).join(',  '), null));
    return { ok: true, resultado: items.map((r) => `${v} = ${r}`).join(',  '), pasos: numerar(pasos), nivel: 'parcial', verificado, metodo: 'nerdamer' };
  } catch (e) {
    return { ok: false, mensaje: esErrorSinNerdamer(e) ? e.message : 'El motor ligero no pudo resolver esta ecuación.' };
  }
}

function sistema(s) {
  const eqs = s.ecuaciones.map(paraN);
  const sol = nerdamerGlobal().solveEquations(eqs);
  if (!sol || !sol.length) return { ok: false, mensaje: 'No se encontró solución del sistema.' };
  const txt = sol.map(([n, val]) => `${n} = ${val}`).join(',  ');
  return {
    ok: true, resultado: txt, nivel: 'parcial', metodo: 'nerdamer',
    pasos: numerar([paso('Sistema', eqs.join('   ;   ')), paso('Solución (sin desarrollo de la eliminación)', txt)]),
  };
}

// ───────────── Simplificar / factorizar / expandir ─────────────
async function simplificar(s) {
  const ms = mathsteps();
  if (ms) {
    try {
      const st = ms.simplifyExpression(s.expr);
      if (st?.length) {
        const lista = [paso('Expresión original', s.expr, null), ...pasosMathsteps(st, 'newNode')];
        return { ok: true, resultado: lista[lista.length - 1].ecuacion, pasos: numerar(lista), nivel: 'completo', metodo: 'mathsteps' };
      }
    } catch { /* cae a nerdamer */ }
  }
  // Polinomios: pasos propios, verificados. Si no es un polinomio, se usa nerdamer (sin desarrollo).
  const propio = resolverAlgebraico('simplificar', s.expr);
  if (propio) return propio;
  const r = nerd(`simplify(${s.expr})`);
  return { ok: true, resultado: r.txt, latex: r.tex, nivel: 'parcial', metodo: 'nerdamer', pasos: numerar([paso('Simplificado por el motor simbólico (sin desarrollo)', r.txt)]) };
}

function transformar(s, fn, etiqueta) {
  const r = nerd(`${fn}(${s.expr})`);
  return { ok: true, resultado: r.txt, latex: r.tex, nivel: 'parcial', metodo: 'nerdamer', pasos: numerar([paso(etiqueta, `${s.expr}  →  ${r.txt}`)]) };
}

// ───────────── Integrales y límites rápidos (sin desarrollo) ─────────────
function integralRapida(s) {
  const f = parsear(s.expr);
  const v = varDe(s, f);
  const out = nerd(`integrate(${s.expr}, ${v})`);
  if (/integrate\(|undefined/.test(out.txt)) return { ok: false, mensaje: 'El motor ligero no pudo integrar esta expresión.' };
  let verificado = null;
  try { verificado = verificarDerivada(parsear(out.txt), f, v); } catch { /* no parseable */ }
  if (verificado === false) return { ok: false, mensaje: 'Resultado descartado: la derivada no coincide con el integrando.' };
  return {
    ok: true, resultado: `${out.txt} + C`, latex: out.tex ? `${out.tex} + C` : null, nivel: 'parcial', verificado, metodo: 'nerdamer',
    pasos: numerar([paso('Antiderivada obtenida por el motor ligero (sin desarrollo)', `∫ ${str(f)} d${v} = ${out.txt} + C`)]),
  };
}

function limiteRapido(s) {
  if (s.dir && s.dir !== '+-') return { ok: false, mensaje: 'Los límites laterales requieren el motor avanzado.' };
  const f = parsear(s.expr);
  const v = s.v || varDe(s, f);
  const out = nerd(`limit(${s.expr}, ${v}, ${s.a})`);
  if (/limit\(|undefined/.test(out.txt)) return { ok: false, mensaje: 'El motor ligero no pudo calcular este límite.' };
  let verificado = null;
  try {
    const val = evalAST(parsear(out.txt), {});
    const a = evalAST(parsear(String(s.a)), {});
    const pts = Number.isFinite(a) ? [a + 1e-6, a - 1e-6] : [a > 0 ? 1e6 : -1e6];
    const vals = pts.map((x) => evalAST(f, { [v]: x })).filter(Number.isFinite);
    if (vals.length && Number.isFinite(val)) verificado = vals.every((y) => Math.abs(y - val) <= 1e-3 * (1 + Math.abs(val)));
  } catch { /* no concluyente */ }
  if (verificado === false) return { ok: false, mensaje: 'Resultado descartado: no coincide con la evaluación numérica cerca del punto.' };
  return {
    ok: true, resultado: out.txt, latex: out.tex, nivel: 'parcial', verificado, metodo: 'nerdamer',
    pasos: numerar([paso('Valor del límite (sin desarrollo del método)', `lim ${v}→${s.a} de ${str(f)} = ${out.txt}`)]),
  };
}

// ───────────── Punto de entrada ─────────────
export async function resolver(s) {
  try {
    switch (s.tipo) {
      case 'derivada': return derivada(s);
      case 'ecuacion': return await ecuacion(s);
      case 'sistema': return sistema(s);
      case 'simplificar': return await simplificar(s);
      // Sin nerdamer: su factor() devuelve primos (2^2*5^2) o formas sin desarrollo. Lo que el motor algebraico propio
      // no puede factorizar (no polinomios) lo resuelve SymPy, que el router ofrece como respaldo.
      case 'factorizar': return resolverAlgebraico('factorizar', s.expr) ?? { ok: false, mensaje: 'Esta expresión no es un polinomio con coeficientes racionales: se necesita el motor avanzado (SymPy).' };
      case 'expandir': return resolverAlgebraico('expandir', s.expr) ?? transformar(s, 'expand', 'Expandido por el motor simbólico (sin desarrollo)');
      case 'integral': return integralRapida(s);
      case 'limite': return limiteRapido(s);
      default: return { ok: false, mensaje: `Tipo no soportado por el motor JS: ${s.tipo}` };
    }
  } catch (e) {
    const msg = e instanceof ErrorExpresion ? e.message : `No se pudo resolver: ${e.message ?? e}`;
    return { ok: false, mensaje: msg };
  }
}
