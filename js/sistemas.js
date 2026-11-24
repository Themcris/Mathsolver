// sistemas.js — Sistemas de ecuaciones lineales con coeficientes racionales, resueltos por
// eliminación de Gauss-Jordan con fracciones exactas (BigInt). Sin Nerdamer ni SymPy.
//   resolverSistemaLineal(['x+y=5','x-y=1']) -> { ok, resultado, latex, pasos, ... }
// Si las ecuaciones no son lineales/analizables devuelve { ok:false } (el router prueba otro motor);
// si el sistema es lineal pero incompatible devuelve { ok:false, definitivo:true, mensaje }.
import { Frac } from './frac.js';

const MAX_VARS = 6, MAX_ECS = 6;
const tex = (f) => (f.d === 1n ? `${f.n}` : `${f.n < 0n ? '-' : ''}\\frac{${f.n < 0n ? -f.n : f.n}}{${f.d}}`);
const plano = (f) => f.toString();
const paso = (descripcion, latex, ecuacion) => ({ descripcion, latex, ecuacion, profundidad: 0 });

const RE_TERMINO = /^([+-])?(\d+(?:\.\d+)?(?:\/\d+)?)?\*?([a-z])?(?:\/(\d+(?:\.\d+)?))?$/;

/** "2x-3y+1/2" -> { coef: Map(var->Frac), cte: Frac } o null si no es lineal. */
function lineal(txt) {
  const t = txt.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[·×]/g, '*');
  if (!t || /[()^]|\*\*|[+\-*/]{2,}[^\d]/.test(t.replace(/^[+-]/, ''))) return null;
  const terminos = t.split(/(?<![*/])(?=[+-])/);
  const coef = new Map();
  let cte = new Frac(0);
  for (const tm of terminos) {
    const m = RE_TERMINO.exec(tm);
    if (!m || (!m[2] && !m[3])) return null;
    let c = m[2] ? Frac.parse(m[2]) : new Frac(1);
    if (!c) return null;
    if (m[4]) { const d = Frac.parse(m[4]); if (!d || d.isZero()) return null; c = c.div(d); }
    if (m[1] === '-') c = c.neg();
    if (m[3]) coef.set(m[3], (coef.get(m[3]) ?? new Frac(0)).add(c));
    else { if (m[4]) return null; cte = cte.add(c); }
  }
  return { coef, cte };
}

function terminoTex(c, v, primero) {
  if (c.isZero()) return '';
  const neg = c.isNeg(), a = c.abs();
  const cuerpo = a.eq(1) ? v : `${tex(a)}${v}`;
  return (neg ? (primero ? '-' : ' - ') : (primero ? '' : ' + ')) + cuerpo;
}
function ecTex(fila, vars) {
  let s = '';
  vars.forEach((v, j) => { const t = terminoTex(fila[j], v, s === ''); s += t; });
  return `${s || '0'} = ${tex(fila[vars.length])}`;
}
function ecPlano(fila, vars) {
  let s = '';
  vars.forEach((v, j) => {
    const c = fila[j]; if (c.isZero()) return;
    const a = c.abs(), cu = a.eq(1) ? v : `${plano(a)}${v}`;
    s += (c.isNeg() ? (s ? ' - ' : '-') : (s ? ' + ' : '')) + cu;
  });
  return `${s || '0'} = ${plano(fila[vars.length])}`;
}
const matTex = (M, n) => `\\left[\\begin{array}{${'c'.repeat(n)}|c}${M.map((f) => f.map(tex).join(' & ')).join(' \\\\ ')}\\end{array}\\right]`;
const matPlano = (M) => M.map((f) => `[${f.map(plano).join(', ')}]`).join(' ');
const sistemaTex = (M, vars) => `\\begin{cases}${M.map((f) => ecTex(f, vars)).join(' \\\\ ')}\\end{cases}`;

export function resolverSistemaLineal(ecuaciones) {
  const no = { ok: false, mensaje: 'No es un sistema lineal con coeficientes racionales.' };
  try {
    if (!Array.isArray(ecuaciones) || ecuaciones.length < 1 || ecuaciones.length > MAX_ECS) return no;
    const filas = [];
    const vars = [];
    for (const e of ecuaciones) {
      const partes = String(e).split('=');
      if (partes.length !== 2) return no;
      const L = lineal(partes[0]), R = lineal(partes[1]);
      if (!L || !R) return no;
      const f = { coef: new Map(L.coef), cte: R.cte.sub(L.cte) };
      for (const [v, c] of R.coef) f.coef.set(v, (f.coef.get(v) ?? new Frac(0)).sub(c));
      for (const v of f.coef.keys()) if (!vars.includes(v)) vars.push(v);
      filas.push(f);
    }
    if (!vars.length || vars.length > MAX_VARS) return no;
    vars.sort();
    const n = vars.length;
    const A0 = filas.map((f) => [...vars.map((v) => f.coef.get(v) ?? new Frac(0)), f.cte]);
    let M = A0.map((f) => f.slice());

    const pasos = [paso('Sistema de ecuaciones', sistemaTex(A0, vars), A0.map((f) => ecPlano(f, vars)).join(' ; '))];
    pasos.push(paso('Escribimos la matriz ampliada: cada fila es una ecuación y la última columna son los términos independientes', matTex(M, n), matPlano(M)));

    let r = 0;
    const pivotes = [];
    for (let c = 0; c < n && r < M.length; c++) {
      let p = r;
      while (p < M.length && M[p][c].isZero()) p++;
      if (p === M.length) continue;
      if (p !== r) {
        [M[p], M[r]] = [M[r], M[p]];
        pasos.push(paso(`Intercambiamos F${r + 1} y F${p + 1} para tener un pivote distinto de 0 en la columna de ${vars[c]}`, matTex(M, n), matPlano(M)));
      }
      const piv = M[r][c];
      if (!piv.eq(1)) {
        M[r] = M[r].map((x) => x.div(piv));
        pasos.push(paso(`Dividimos F${r + 1} entre ${plano(piv)} para que el pivote valga 1`, `F_{${r + 1}} \\leftarrow \\frac{F_{${r + 1}}}{${tex(piv)}} \\quad ${matTex(M, n)}`, `F${r + 1} ← F${r + 1} / ${plano(piv)} → ${matPlano(M)}`));
      }
      for (let i = 0; i < M.length; i++) {
        if (i === r || M[i][c].isZero()) continue;
        const k = M[i][c];
        M[i] = M[i].map((x, j) => x.sub(k.mul(M[r][j])));
        const kk = k.isNeg() ? `+ ${plano(k.abs())}` : `− ${plano(k)}`;
        const kt = k.isNeg() ? `+ ${tex(k.abs())}` : `- ${tex(k)}`;
        pasos.push(paso(`Eliminamos ${vars[c]} de F${i + 1}: restamos ${plano(k)}·F${r + 1}`,
          `F_{${i + 1}} \\leftarrow F_{${i + 1}} ${kt}\\,F_{${r + 1}} \\quad ${matTex(M, n)}`, `F${i + 1} ← F${i + 1} ${kk}·F${r + 1} → ${matPlano(M)}`));
      }
      pivotes.push(c);
      r++;
    }

    // ¿Incompatible? fila 0 = k con k ≠ 0
    for (const f of M) {
      if (f.slice(0, n).every((x) => x.isZero()) && !f[n].isZero()) {
        pasos.push(paso('Una fila queda como 0 = ' + plano(f[n]) + ', lo cual es imposible', `0 = ${tex(f[n])}`, `0 = ${plano(f[n])}`));
        return { ok: false, definitivo: true, mensaje: 'El sistema no tiene solución: las ecuaciones se contradicen (incompatible).', pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })) };
      }
    }

    const libres = vars.map((_, j) => j).filter((j) => !pivotes.includes(j));
    let resTex, resPlano;
    if (!libres.length) {
      const sol = pivotes.map((c, i) => M[i][n]);
      pasos.push(paso('La matriz quedó en forma reducida: cada fila nos da el valor de una incógnita',
        `${vars.map((v, j) => `${v} = ${tex(sol[j])}`).join(',\\; ')}`, vars.map((v, j) => `${v} = ${plano(sol[j])}`).join(', ')));
      // Comprobación independiente en las ecuaciones originales.
      const ok = A0.every((f) => f.slice(0, n).reduce((s, c, j) => s.add(c.mul(sol[j])), new Frac(0)).eq(f[n]));
      if (!ok) return { ok: false, mensaje: 'No se pudo verificar la solución.' };
      pasos.push(paso('Comprobamos sustituyendo en las ecuaciones originales: todas se cumplen',
        `\\checkmark\\; ${vars.map((v, j) => `${v} = ${tex(sol[j])}`).join(',\\; ')}`, 'Comprobación: todas las ecuaciones se cumplen'));
      resTex = vars.map((v, j) => `${v} = ${tex(sol[j])}`).join(',\\; ');
      resPlano = vars.map((v, j) => `${v} = ${plano(sol[j])}`).join(', ');
      return { ok: true, resultado: resPlano, latex: resTex, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado: true, metodo: 'sistemas', solucion: Object.fromEntries(vars.map((v, j) => [v, plano(sol[j])])) };
    }

    // Infinitas soluciones: las incógnitas sin pivote son parámetros.
    const ts = [], ps = [];
    pivotes.forEach((c, i) => {
      let t = tex(M[i][n]), q = plano(M[i][n]);
      for (const j of libres) {
        const k = M[i][j].neg();
        if (k.isZero()) continue;
        t += (k.isNeg() ? ' - ' : ' + ') + (k.abs().eq(1) ? '' : tex(k.abs())) + vars[j];
        q += (k.isNeg() ? ' - ' : ' + ') + (k.abs().eq(1) ? '' : plano(k.abs())) + vars[j];
      }
      ts.push(`${vars[c]} = ${t}`); ps.push(`${vars[c]} = ${q}`);
    });
    const libTxt = libres.map((j) => vars[j]).join(', ');
    pasos.push(paso(`Hay menos ecuaciones independientes que incógnitas: ${libTxt} queda${libres.length > 1 ? 'n' : ''} libre${libres.length > 1 ? 's' : ''} (puede valer cualquier número) y las demás dependen de ${libres.length > 1 ? 'ellas' : 'ella'}`,
      ts.join(',\\; '), ps.join(', ')));
    resTex = `${ts.join(',\\; ')},\\; ${libTxt} \\in \\mathbb{R}`;
    resPlano = `${ps.join(', ')}, ${libTxt} libre`;
    return { ok: true, resultado: resPlano, latex: resTex, pasos: pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', verificado: true, metodo: 'sistemas' };
  } catch (e) {
    return { ok: false, mensaje: `No se pudo resolver el sistema: ${e.message}` };
  }
}
