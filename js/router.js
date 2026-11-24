// router.js — Enrutador de motores de MathSolver.
//
//   Nivel 1  C-WASM (OmniCore)        numérico, matrices, estadística      -> 'solo_resultado'
//   Nivel 2  JS (motorPasos+nerdamer) álgebra y derivadas con pasos         -> 'completo' | 'parcial'
//   Nivel 3  Pyodide + SymPy (lazy)   integrales, límites, EDOs, trig/log   -> 'parcial'
//
// Respuesta común: { ok, resultado, latex?, pasos: Step[], nivel, motor, errorEstimado?,
//                    verificado?, advertencias?, mensaje?, accion?, puedeMejorar?, solicitud }
//
// Uso:
//   import { iniciarRouter, resolverEntrada } from './router.js';
//   iniciarRouter({ core: await OmniCore.load(...) });
//   const r = await resolverEntrada('diff(x^2*sin(x)/ln(x), x)');

import { motorPyodide } from './motorPyodide.js';
import { desarrollarAritmetica, esAritmeticaSimple } from './aritmetica.js';
import { esExpresionFraccionaria, resolverFracciones } from './fracciones.js';
import { detectarEspecial, resolverEspecial } from './especiales.js';
import { resolverSistemaLineal } from './sistemas.js';
import { detectarIdentidad, resolverIdentidad, resolverFactorNumerico } from './identidades.js';

export const NIVEL = Object.freeze({
  SOLO_RESULTADO: 'solo_resultado',
  COMPLETO: 'completo',
  PARCIAL: 'parcial',
  REQUIERE_DESCARGA: 'requiere_descarga',
  ERROR: 'error',
});

let core = null;
let motorWasm = null;
let _js = null; // import() diferido de motorJS; si falla, se vuelve a intentar en la próxima llamada
const cargarJS = () => (_js ??= import('./motorJS.js').catch((e) => { _js = null; throw e; }));

/** nerdamer se carga con un <script> global (all.min.js); el router no lo importa. */
export const nerdamerDisponible = () => typeof globalThis.nerdamer === 'function';

/** Garantiza que la interfaz nunca espere indefinidamente a una promesa colgada. */
function conTiempo(promesa, ms, mensaje) {
  let t;
  return Promise.race([promesa, new Promise((_, rechazar) => { t = setTimeout(() => rechazar(new Error(mensaje)), ms); })]).finally(() => clearTimeout(t));
}

export function iniciarRouter({ core: c }) {
  core = c;
  motorWasm = crearMotorWasm(c);
}
export const pyodideCargado = () => motorPyodide.cargado;
export const cargarSimbolico = (onProgreso) => motorPyodide.cargar(onProgreso);

// ───────────── Parser de solicitudes ─────────────
const FUNC_NOMBRES = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'sqrt', 'sen', 'tg', 'arcsin', 'arccos', 'arctan', 'raiz', 'abs']);
const CONST_NOMBRES = new Set(['e', 'pi', 'inf', 'infinity']);

const normalizar = (t) => String(t).trim()
  .replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/')
  .replace(/√/g, 'sqrt').replace(/π/g, 'pi').replace(/∞/g, 'inf');

function partirArgs(s) {
  const out = []; let prof = 0, ini = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) prof++;
    else if (')]}'.includes(c)) prof--;
    else if (c === ',' && prof === 0) { out.push(s.slice(ini, i).trim()); ini = i + 1; }
  }
  out.push(s.slice(ini).trim());
  return out.filter((a, i, arr) => a !== '' || arr.length === 1);
}

/** nombre(args) cuyo paréntesis de apertura cierra justo al final; si no, null. */
function llamada(t) {
  const m = t.match(/^([A-Za-zñáéíóú_]\w*)\s*\(/);
  if (!m) return null;
  let prof = 0;
  for (let i = m[0].length - 1; i < t.length; i++) {
    if (t[i] === '(') prof++;
    else if (t[i] === ')' && --prof === 0) {
      return i === t.length - 1 ? { nombre: m[1].toLowerCase(), args: partirArgs(t.slice(m[0].length, i)) } : null;
    }
  }
  return null;
}

function identificadores(expr) {
  return (String(expr).match(/[A-Za-z_]\w*/g) ?? []).filter((n) => !FUNC_NOMBRES.has(n.toLowerCase()) && !CONST_NOMBRES.has(n.toLowerCase()));
}
const tieneVariables = (expr) => identificadores(expr).length > 0;
function autoVar(...exprs) {
  const ids = [...new Set(exprs.flatMap((e) => identificadores(e).filter((n) => n.length === 1)))];
  return ids.includes('x') || !ids.length ? 'x' : ids[0];
}

/** Valor numérico de un literal ("2", "-1.5e3", "pi", "inf"); NaN si no es literal. */
function literal(s) {
  const t = String(s).trim().toLowerCase().replace(/\s+/g, '');
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(t)) return Number(t);
  const sg = t.startsWith('-') ? -1 : 1;
  const b = t.replace(/^[-+]/, '');
  if (b === 'inf' || b === 'infinity') return sg * Infinity;
  if (b === 'pi') return sg * Math.PI;
  return NaN;
}

// Códigos de operación de oc_matrix / core.matrix(op, n, A, B, k) en core.c.
export const MATRIZ_OPS = Object.freeze({
  1: 'A+B', 2: 'A-B', 3: 'A*B', 4: 'A^T', 5: 'A^-1', 6: 'det', 7: 'rango', 8: 'traza', 9: 'A^n', 10: 'Ax=b', 11: 'k*A',
});
const MAX_MATRIZ = 5;
// Nombre escrito por el usuario -> código de operación.
const MATRIZ_ALIAS = {
  suma: 1, resta: 2, producto: 3, transpuesta: 4, trans: 4, inversa: 5, inv: 5, det: 6, rango: 7, rank: 7,
  traza: 8, trace: 8, potencia: 9, sistema_lineal: 10, ax: 10, escalar: 11,
};
const ALIAS_STATS = { media: 'mean', mean: 'mean', stats: 'stats', estadistica: 'stats', linreg: 'linreg', regresion: 'linreg' };

export function parseSolicitud(entrada) {
  if (entrada && typeof entrada === 'object') return entrada; // ya estructurada
  const t = normalizar(entrada ?? '');
  if (!t) return { tipo: 'vacio' };
  if (detectarEspecial(t)) return { tipo: 'especial', expr: t };
  let m;

  if ((m = t.match(/^∫\s*(.+?)\s*d([a-z])$/i))) return { tipo: 'integral', expr: m[1], v: m[2] };
  if ((m = t.match(/^d\/d([a-z])\s*(.+)$/i))) return { tipo: 'derivada', expr: m[2].replace(/^\[(.*)\]$/, '$1'), v: m[1] };

  const c = llamada(t);
  if (c) {
    const [a0, a1, a2, a3] = c.args;
    switch (c.nombre) {
      case 'diff': case 'derivar': case 'derivada':
        return { tipo: 'derivada', expr: a0, v: a1 || autoVar(a0) };
      case 'deriv': // derivada numérica en un punto -> C-WASM
        return { tipo: 'num_deriv', expr: a0, x0: literal(a1), order: a2 ? Number(a2) : 1 };
      case 'integral': case 'int': case 'integrar': {
        if (c.args.length >= 3 && !Number.isNaN(literal(a1)) && !Number.isNaN(literal(a2))) {
          return { tipo: 'num_integral', expr: a0, a: literal(a1), b: literal(a2), aTxt: a1, bTxt: a2 };
        }
        if (c.args.length >= 3) return { tipo: 'integral_def', expr: a0, a: a1, b: a2, v: a3 || autoVar(a0) };
        return { tipo: 'integral', expr: a0, v: a1 || autoVar(a0) };
      }
      case 'integral_exacta': case 'integralexacta':
        return { tipo: 'integral_def', expr: a0, a: a1, b: a2, v: a3 || autoVar(a0) };
      case 'limit': case 'lim': case 'limite':
        return { tipo: 'limite', expr: a0, v: a1, a: a2, dir: a3 };
      case 'ode': case 'edo': case 'dsolve':
        return { tipo: 'edo', ecuacion: a0, f: a1 || 'y', v: a2 || 'x' };
      case 'simplificar': case 'simplify':
        return tieneVariables(a0) ? { tipo: 'simplificar', expr: a0 } : solicitudNumerica(a0);
      // factor(): con variables lo factoriza el motor algebraico (y SymPy si hace falta), nunca nerdamer;
      // con números es una identidad notable o la descomposición en primos, con pasos.
      case 'factor': case 'factorizar':
        return tieneVariables(a0) ? { tipo: 'factorizar', expr: a0 } : { tipo: 'factor_num', expr: a0 };
      case 'expand': case 'expandir':
        return tieneVariables(a0) ? { tipo: 'expandir', expr: a0 } : solicitudNumerica(a0);
      case 'solve': case 'resolver': {
        const [l, r = '0'] = a0.split('=');
        return { tipo: 'ecuacion', lhs: l, rhs: r, v: a1 };
      }
      case 'sistema': case 'system': return { tipo: 'sistema', ecuaciones: c.args };
      case 'roots': case 'raices': return { tipo: 'num_raices', expr: a0, a: literal(a1), b: literal(a2), max: a3 ? Number(a3) : 10 };
      default:
        if (MATRIZ_ALIAS[c.nombre]) {
          const op = MATRIZ_ALIAS[c.nombre];
          try {
            const J = (t) => JSON.parse(t);
            if (op <= 3) return { tipo: 'matriz', op, A: J(a0), B: J(a1) };
            if (op === 9) return { tipo: 'matriz', op, A: J(a0), k: Number(a1) };
            if (op === 10) return { tipo: 'matriz', op, A: J(a0), b: J(a1) };
            if (op === 11) return { tipo: 'matriz', op, k: Number(a0), A: J(a1) };
            return { tipo: 'matriz', op, A: J(a0) };
          } catch {
            return { tipo: 'error_sintaxis', mensaje: 'Escribe las matrices como JSON, por ejemplo suma([[1,2],[3,4]], [[1,0],[0,1]]) o det([[1,2],[3,4]]).' };
          }
        }
        if (ALIAS_STATS[c.nombre]) {
          try { return { tipo: 'estadistica', op: ALIAS_STATS[c.nombre], x: JSON.parse(a0), y: a1 ? JSON.parse(a1) : null }; }
          catch { return { tipo: 'error_sintaxis', mensaje: 'Escribe los datos como lista, por ejemplo mean([1,2,3]).' }; }
        }
    }
  }

  if (/[;\n]/.test(t) && t.includes('=')) return { tipo: 'sistema', ecuaciones: t.split(/[;\n]/).map((e) => e.trim()).filter(Boolean) };
  if (/(^|[^A-Za-z_])y'|dy\/dx/.test(t)) return { tipo: 'edo', ecuacion: t, f: 'y', v: 'x' };
  if (t.includes('=') && !/[<>]=|==/.test(t)) {
    const [l, r] = t.split('=');
    return { tipo: 'ecuacion', lhs: l, rhs: r };
  }
  // Fracciones con enteros (3/4+2/3, (1/2)*(3/5)...): se resuelven en exacto y con pasos, no como decimal aproximado.
  const crudo = String(entrada ?? '').trim(); // sin normalizar: conserva "÷" y los números mixtos ("1 1/2")
  if (esExpresionFraccionaria(crudo)) return { tipo: 'fracciones', expr: crudo };
  if (!tieneVariables(t)) return solicitudNumerica(crudo);
  return { tipo: 'simplificar', expr: t };
}

/** Expresión sin variables: identidad notable (a²−b², (a±b)², a³±b³…) con pasos, o evaluación numérica. */
function solicitudNumerica(expr) {
  if (detectarIdentidad(expr)) return { tipo: 'identidad', expr: String(expr).trim() };
  return { tipo: 'num_eval', expr: normalizar(expr) };
}

// ───────────── Clasificadores (los tres que pide la especificación) ─────────────
const NUMERICOS = new Set(['num_eval', 'num_integral', 'num_deriv', 'num_raices', 'matriz', 'estadistica']);
const ALGEBRA = new Set(['derivada', 'ecuacion', 'sistema', 'simplificar', 'factorizar', 'expandir']);
const AVANZADOS = new Set(['integral', 'integral_def', 'limite', 'edo']);
const tipoDe = (x) => (typeof x === 'string' ? parseSolicitud(x) : x).tipo;

export const esNumericoOMatricial = (x) => NUMERICOS.has(tipoDe(x));
export const esAlgebraODerivada = (x) => ALGEBRA.has(tipoDe(x));
export const esAvanzado = (x) => AVANZADOS.has(tipoDe(x));

// ───────────── Adaptador C-WASM (usa OmniCore tal cual) ─────────────
const num = (v) => Number(Number(v).toPrecision(12));

export function crearMotorWasm(c) {
  const requiere = (nombre) => {
    if (typeof c[nombre] !== 'function') throw new Error(`OmniCore no expone ${nombre}(): agrega ese wrapper en core.js (ver oc_* en core.c).`);
  };
  return {
    async resolver(s) {
      switch (s.tipo) {
        case 'num_eval': {
          const r = c.evaluate(s.expr);
          if (!r.ok) return { ok: false, mensaje: r.message ?? 'No se pudo evaluar.' };
          return { ok: true, resultado: String(num(r.value)), valor: r.value };
        }
        case 'num_integral': {
          // Los límites infinitos viajan como Infinity nativo.
          const r = c.integral(s.expr, s.a, s.b);
          if (!r.ok) return { ok: false, mensaje: r.message ?? 'No se pudo integrar numéricamente.' };
          const adv = [];
          if (r.bad > 0) adv.push(`${r.bad} puntos del integrando no fueron válidos; el resultado puede no ser fiable.`);
          if (Number.isFinite(r.error) && r.error > 1e-6 * (1 + Math.abs(r.value))) adv.push('El error estimado es alto: prueba otro intervalo o confirma con el valor exacto.');
          return { ok: true, resultado: String(num(r.value)), valor: r.value, errorEstimado: r.error, advertencias: adv, sugerencia: 'exacto_disponible' };
        }
        case 'num_deriv': {
          requiere('derivative');
          const r = c.derivative(s.expr, s.x0, s.order);
          return r.ok === false ? { ok: false, mensaje: r.message } : { ok: true, resultado: String(num(r.value ?? r)), valor: r.value ?? r };
        }
        case 'num_raices': {
          requiere('roots');
          const r = c.roots(s.expr, s.a, s.b, s.max);
          if (r.ok === false) return { ok: false, mensaje: r.message };
          const lista = r.roots ?? r;
          return { ok: true, resultado: lista.length ? lista.map((v, i) => `x${i + 1} ≈ ${num(v)}`).join(',  ') : 'Sin raíces en el intervalo', valor: lista };
        }
        case 'matriz': {
          const n = s.A?.length;
          const cuadrada = (M) => Array.isArray(M) && M.length === n && M.every((f) => Array.isArray(f) && f.length === n);
          if (!n || !cuadrada(s.A)) return { ok: false, mensaje: 'La matriz debe ser cuadrada.' };
          if (n > MAX_MATRIZ) return { ok: false, mensaje: `Tamaño máximo de matriz: ${MAX_MATRIZ}×${MAX_MATRIZ}.` };
          const B = new Array(n * n).fill(0);
          if (s.op <= 3) {
            if (!cuadrada(s.B)) return { ok: false, mensaje: 'B debe ser cuadrada y del mismo tamaño que A.' };
            s.B.flat().forEach((v, i) => { B[i] = v; });
          }
          if (s.op === 10) {
            if (!Array.isArray(s.b) || s.b.length !== n) return { ok: false, mensaje: `El vector b debe tener ${n} elementos.` };
            s.b.forEach((v, i) => { B[i * n] = v; }); // b viaja en la primera columna de B
          }
          if (s.op === 9 && !(Number.isInteger(s.k) && s.k >= 0)) return { ok: false, mensaje: 'La potencia debe ser un entero mayor o igual que 0.' };
          if (s.op === 11 && !Number.isFinite(s.k)) return { ok: false, mensaje: 'El escalar k no es válido.' };
          const r = c.matrix(s.op, n, s.A.flat(), B, s.k ?? 0);
          if (r.ok === false) return { ok: false, mensaje: r.message ?? 'Operación no válida (¿matriz singular?).' };
          const pasos = typeof r.steps === 'string' ? r.steps.split('\n').filter(Boolean).map((d, i) => ({ numero: i + 1, descripcion: d, profundidad: 0 })) : Array.isArray(r.steps) ? r.steps : [];
          const m = r.matrix ? `[${chunk(Array.from(r.matrix), n).map((f) => f.map(num).join(', ')).join(' ; ')}]` : null;
          return { ok: true, resultado: m ?? String(num(r.scalar)), valor: r.matrix ?? r.scalar, pasos };
        }
        case 'estadistica': {
          requiere(s.op === 'linreg' ? 'linreg' : 'stats');
          const r = s.op === 'linreg' ? c.linreg(s.x, s.y) : c.stats(s.x);
          return r.ok === false ? { ok: false, mensaje: r.message } : { ok: true, resultado: typeof r === 'string' ? r : JSON.stringify(r.result ?? r), valor: r };
        }
      }
      return { ok: false, mensaje: `Tipo numérico no soportado: ${s.tipo}` };
    },
  };
}
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

// ───────────── Enrutador ─────────────
const err = (mensaje, extra = {}) => ({ ok: false, nivel: NIVEL.ERROR, motor: null, pasos: [], mensaje, ...extra });
const requiereDescarga = (s) => ({
  ok: false, nivel: NIVEL.REQUIERE_DESCARGA, motor: 'pyodide', pasos: [], accion: 'cargar_sympy', solicitud: s,
  mensaje: 'Esta operación requiere el motor simbólico avanzado (SymPy). La descarga es de varios MB y se guarda para usarlo sin conexión. ¿Descargarlo ahora?',
});

export async function resolverEntrada(input) {
  let s;
  try { s = parseSolicitud(input); } catch (e) { return err(`No se entiende la entrada: ${e.message}`); }
  try {
    if (s.tipo === 'vacio') return err('Escribe una expresión o un problema.');
    if (s.tipo === 'error_sintaxis') return err(s.mensaje);

    // Fracciones exactas con desarrollo completo: no necesita el motor numérico ni nerdamer.
    if (s.tipo === 'fracciones') {
      const r = resolverFracciones(s.expr);
      if (!r.ok) return err(r.mensaje, { motor: 'fracciones', solicitud: s });
      return { ...r, nivel: NIVEL.COMPLETO, motor: 'fracciones', solicitud: s };
    }

    // log con base y raíz de negativos: casos que el motor numérico rechaza.
    if (s.tipo === 'especial') {
      const r = resolverEspecial(s.expr);
      if (!r.ok) return err(r.mensaje, { motor: 'especiales', solicitud: s });
      return { ...r, nivel: NIVEL.COMPLETO, motor: 'especiales', solicitud: s };
    }

    // Sistemas lineales con coeficientes racionales: eliminación exacta con pasos, sin depender de Nerdamer.
    if (s.tipo === 'sistema') {
      const r = resolverSistemaLineal(s.ecuaciones);
      if (r.ok) return { ...r, nivel: NIVEL.COMPLETO, motor: 'sistemas', solicitud: s };
      if (r.definitivo) return err(r.mensaje, { motor: 'sistemas', solicitud: s });
    }

    // Identidades notables con números y factorización de enteros: exactas y con pasos, sin motor externo.
    if (s.tipo === 'identidad' || s.tipo === 'factor_num') {
      const r = s.tipo === 'identidad' ? resolverIdentidad(s.expr) : resolverFactorNumerico(s.expr);
      if (r.ok) return { ...r, nivel: NIVEL.COMPLETO, motor: 'identidades', solicitud: s };
      if (s.tipo === 'factor_num') return err(r.mensaje, { motor: 'identidades', solicitud: s });
      s = { tipo: 'num_eval', expr: normalizar(s.expr) }; // la identidad no se pudo desarrollar: evaluación numérica normal
    }

    if (esNumericoOMatricial(s)) {
      if (!motorWasm) return err('El motor numérico no está iniciado: llama a iniciarRouter({ core }).');
      const r = await motorWasm.resolver(s);
      if (!r.ok) return err(r.mensaje, { motor: 'c-wasm', solicitud: s });
      const pasos = r.pasos ?? [];
      // El valor numérico viaja en la solicitud: el método desarrollado lo contrasta con el resultado exacto.
      const solicitud = Number.isFinite(r.valor) ? { ...s, ref: r.valor } : s;
      const respuesta = { ...r, pasos, nivel: pasos.length ? NIVEL.PARCIAL : NIVEL.SOLO_RESULTADO, motor: 'c-wasm', solicitud };
      if (!pasos.length) {
        if (s.tipo === 'num_integral') respuesta.puedeMejorar = { texto: 'Método desarrollado', requiereDescarga: !motorPyodide.cargado };
        else if (s.tipo === 'num_eval' && esAritmeticaSimple(s.expr)) respuesta.puedeMejorar = { texto: 'Método desarrollado', requiereDescarga: false };
      }
      return respuesta;
    }

    if (esAlgebraODerivada(s)) {
      const js = await conTiempo(cargarJS(), 10000, 'No se pudo cargar el motor de álgebra (motorJS.js). Revisa la consola del navegador.');
      const r = await conTiempo(js.resolver(s), 20000, 'El cálculo tardó demasiado y se canceló.');
      if (r.ok) return { ...r, nivel: r.nivel ?? NIVEL.PARCIAL, motor: r.metodo === 'mathsteps' ? 'mathsteps' : r.metodo === 'nerdamer' ? 'nerdamer' : 'pasos', solicitud: s };
      // Fallback: ecuaciones que el motor ligero no resolvió (trig, log, exp) -> SymPy
      if (s.tipo === 'ecuacion' || s.tipo === 'factorizar') return await viaAvanzado(s, r);
      return err(r.mensaje ?? 'No se pudo resolver.', { motor: 'nerdamer', solicitud: s });
    }

    if (esAvanzado(s)) return await viaAvanzado(s);

    return err('No reconozco ese tipo de problema. Ejemplos: diff(x^2*sin(x), x) · 2x+3=7 · integral(x*e^x, x) · limit(sin(x)/x, x, 0) · det([[1,2],[3,4]]) · integral(exp(-x^2), -inf, inf)');
  } catch (e) {
    return err(`Error inesperado: ${e?.message ?? e}`, { solicitud: s });
  }
}

async function viaAvanzado(s, previo) {
  const rapido = s.tipo === 'integral' || s.tipo === 'limite';

  // 1) SymPy ya cargado: mejores pasos (manualintegrate, clasificación de EDOs...).
  if (motorPyodide.cargado) {
    const r = await motorPyodide.resolver(s);
    if (r.ok) return { ...r, nivel: NIVEL.PARCIAL, motor: 'sympy', solicitud: s };
    if (!rapido) return err(r.mensaje ?? 'SymPy no pudo resolverlo.', { motor: 'sympy', solicitud: s });
  }

  // 2) Respuesta rápida con nerdamer (integrales y límites), con opción de mejorar.
  if (rapido && nerdamerDisponible()) {
    const js = await conTiempo(cargarJS(), 10000, 'No se pudo cargar el motor de álgebra (motorJS.js).');
    const r = await conTiempo(js.resolver(s), 20000, 'El cálculo tardó demasiado y se canceló.');
    if (r.ok) {
      return {
        ...r, nivel: NIVEL.PARCIAL, motor: 'nerdamer', solicitud: s,
        puedeMejorar: motorPyodide.cargado ? undefined : { texto: 'Método desarrollado', requiereDescarga: true },
      };
    }
  }

  // 3) Nada que ofrecer sin SymPy.
  if (!motorPyodide.cargado) return requiereDescarga(s);
  return err(previo?.mensaje ?? 'No se pudo resolver con ningún motor.', { solicitud: s });
}

const limiteTxt = (x) => (x === Infinity ? 'oo' : x === -Infinity ? '-oo' : String(x));

/**
 * Botón “Método desarrollado”: sustituye el resultado rápido por el desglose paso a paso.
 *  · Operación simple entre dos números (15/4, 2.5*3.1…) -> aritmetica.js: instantáneo y sin descargas.
 *  · Integral numérica integral(f, a, b)                   -> SymPy: integral definida exacta con su método.
 *  · Cualquier otra solicitud                              -> SymPy, como hasta ahora.
 * Si no se puede desarrollar devuelve una respuesta de error y el panel conserva el resultado rápido.
 */
export async function desarrollarMetodo(solicitudOEntrada, onProgreso) {
  const s = parseSolicitud(solicitudOEntrada);

  if (s.tipo === 'num_eval' && esAritmeticaSimple(s.expr)) {
    const r = desarrollarAritmetica(s.expr);
    if (!r.ok) return err(r.mensaje, { motor: 'aritmetica', solicitud: s });
    const advertencias = [];
    const exacto = /^-?\d+(\.\d+)?$/.test(r.resultado) ? Number(r.resultado) : null;
    if (exacto !== null && Number.isFinite(s.ref) && Math.abs(exacto - s.ref) > 1e-9 * (1 + Math.abs(s.ref))) {
      advertencias.push(`El motor numérico dio ${s.ref} y el método exacto ${r.resultado}; revisa la expresión.`);
    }
    return { ...r, advertencias, motor: 'aritmetica', solicitud: s };
  }

  if (s.tipo === 'num_integral') {
    await cargarSimbolico(onProgreso);
    const r = await motorPyodide.resolver({
      tipo: 'integral_def', expr: s.expr, a: s.aTxt ?? limiteTxt(s.a), b: s.bTxt ?? limiteTxt(s.b),
      v: autoVar(s.expr), ref: Number.isFinite(s.ref) ? s.ref : undefined,
    });
    if (!r.ok) return err(r.mensaje ?? 'SymPy no pudo desarrollar esta integral.', { motor: 'sympy', solicitud: s });
    return { ...r, nivel: NIVEL.PARCIAL, motor: 'sympy', solicitud: s };
  }

  await cargarSimbolico(onProgreso);
  return resolverEntrada(s);
}

/** Nombre anterior, que sigue usando index.html: el botón “Descargar motor simbólico” y “Método desarrollado”. */
export const mejorarConSimbolico = desarrollarMetodo;
