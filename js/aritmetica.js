// aritmetica.js — Aritmética decimal con el método desarrollado: división larga, multiplicación con
// coma decimal, y suma/resta alineando las comas. Sin dependencias ni DOM; usa BigInt (sin errores
// de coma flotante). Cada resultado se comprueba con una cuenta independiente antes de devolverse.
//
//   parseOperacion('15/4')       -> { op: '/', a, b } | null      (solo "número operador número")
//   desarrollarAritmetica('15/4') -> { ok, resultado, latex, pasos, nivel: 'completo', verificado, metodo }
//
// Cada paso: { numero, descripcion, ecuacion, latex, dibujo, profundidad }
// `dibujo` es el esquema de la operación en texto monoespaciado (se va completando de un paso al siguiente).

const MAX_CIFRAS = 15;     // cifras máximas por operando
const MAX_DECIMALES = 12;  // decimales que se calculan como máximo en una división

// ───────────── Lectura y formato ─────────────
const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)';
const RE_OPERACION = new RegExp(`^([-+]?${NUM})([-+*/])([-+]?${NUM})$`);

/** "-2.50" -> { neg, n: 25n, dec: 1 }  (valor = ±n / 10^dec, sin ceros sobrantes). */
function leerNumero(txt) {
  const neg = txt.startsWith('-');
  let [ent, dec = ''] = txt.replace(/^[-+]/, '').split('.');
  ent = ent.replace(/^0+(?=\d)/, '') || '0';
  dec = dec.replace(/0+$/, '');
  const n = BigInt(ent + dec);
  return { neg: neg && n !== 0n, n, dec: dec.length };
}

const fmt = (n, dec) => {
  const s = n.toString();
  if (dec === 0) return s;
  const p = s.padStart(dec + 1, '0');
  return `${p.slice(0, -dec)}.${p.slice(-dec)}`;
};
const sinCerosFinales = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const texto = (x) => `${x.neg ? '-' : ''}${fmt(x.n, x.dec)}`;
const pot10 = (k) => 10n ** BigInt(k);

/** Reconoce "número operador número" (con signos opcionales). Devuelve null si es otra cosa. */
export function parseOperacion(expr) {
  const t = String(expr).replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/[÷:]/g, '/');
  const m = RE_OPERACION.exec(t);
  if (!m) return null;
  const a = leerNumero(m[1]), b = leerNumero(m[3]);
  if (a.n.toString().length > MAX_CIFRAS || b.n.toString().length > MAX_CIFRAS) return null;
  return { op: m[2], a, b };
}
export const esAritmeticaSimple = (expr) => parseOperacion(expr) !== null;

// ───────────── Utilidades de texto ─────────────
const POS_ENT = ['unidades', 'decenas', 'centenas', 'unidades de millar', 'decenas de millar', 'centenas de millar', 'unidades de millón'];
const POS_DEC = ['décimas', 'centésimas', 'milésimas', 'diezmilésimas', 'cienmilésimas', 'millonésimas'];
const nombrePos = (p) => (p >= 0 ? POS_ENT[p] : POS_DEC[-p - 1]) ?? `posición 10^${p}`;
const veces = (q) => (BigInt(q) === 1n ? 'vez' : 'veces');
const rep = (c, n) => c.repeat(Math.max(0, n));
const derecha = (t, ancho) => rep(' ', ancho - t.length) + t;
const paso = (descripcion, ecuacion, latex, dibujo) => ({ descripcion, ecuacion, latex, dibujo, profundidad: 0 });

// ───────────── División larga ─────────────
/** Calcula N ÷ D cifra a cifra (N ≥ 0, D > 0). */
function divisionLarga(N, D) {
  const dig = N.toString().split('').map(Number);
  const iters = [];
  let k = 0, cur = 0n;
  while (k < dig.length) { cur = cur * 10n + BigInt(dig[k]); k++; if (cur >= D) break; }
  let col = k - 1;
  let q = cur / D, prod = q * D, rem = cur - prod;
  iters.push({ tipo: 'primera', tomadas: dig.slice(0, k).join(''), cur, q, prod, rem, col });
  let cociente = q.toString();
  const cocientes = [cociente];
  while (k < dig.length) {
    const d = dig[k++]; col++;
    cur = rem * 10n + BigInt(d); q = cur / D; prod = q * D; rem = cur - prod;
    iters.push({ tipo: 'bajar', bajado: d, cur, q, prod, rem, col });
    cociente += q.toString();
    cocientes.push(cociente);
  }
  const decimales = [];
  const vistos = new Map();
  let periodo = null, truncado = false;
  const entera = cociente;
  while (rem !== 0n) {
    if (vistos.has(rem)) { periodo = { desde: vistos.get(rem), largo: decimales.length - vistos.get(rem) }; break; }
    if (decimales.length >= MAX_DECIMALES) { truncado = true; break; }
    vistos.set(rem, decimales.length);
    col++;
    cur = rem * 10n; q = cur / D; prod = q * D; rem = cur - prod;
    iters.push({ tipo: 'decimal', primera: decimales.length === 0, cur, q, prod, rem, col });
    decimales.push(q.toString());
    cociente += (decimales.length === 1 ? '.' : '') + q.toString();
    cocientes.push(cociente);
  }
  return { iters, cocientes, entera, decimales, periodo, truncado, restoFinal: rem };
}

/** Primera iteración en la que el divisor no cabe en el dividendo (cociente 0): no se dibuja la resta. */
const noCabe = (it) => it.tipo === 'primera' && it.q === 0n;

/** Diseño tradicional: devuelve una función snapshot(t) con el tablero tras la iteración t (-1 = solo el planteamiento). */
function disenarDivision(N, D, iters, cocientes) {
  const dividendo = N.toString();
  const divisor = D.toString();
  const ultimoCociente = cocientes[cocientes.length - 1] ?? '';
  let izq = 0, maxDer = dividendo.length - 1;
  iters.forEach((it, i) => {
    const sig = iters[i + 1];
    if (noCabe(it)) { maxDer = Math.max(maxDer, it.col); if (sig) izq = Math.max(izq, sig.cur.toString().length - sig.col - 1); return; }
    for (const t of [`-${it.prod}`, sig ? sig.cur.toString() : it.rem.toString(), it.rem.toString()]) izq = Math.max(izq, t.length - it.col - 1);
    maxDer = Math.max(maxDer, it.col);
  });
  const ancho = maxDer + 1 + izq;
  const x = ancho + 2;
  const anchoLinea = Math.max(divisor.length, ultimoCociente.length) + 1;
  const fila = (t, der) => derecha(t, der + 1 + izq);

  return (t) => {
    const filas = [fila(dividendo, dividendo.length - 1)];
    for (let i = 0; i <= t; i++) {
      const it = iters[i], sig = iters[i + 1];
      if (noCabe(it)) { if (i < t) filas.push(fila(sig.cur.toString(), sig.col)); continue; } // sin "-0" ni raya
      filas.push(fila(`-${it.prod}`, it.col));
      filas.push(fila(rep('─', `-${it.prod}`.length), it.col));
      filas.push(i < t ? fila(sig.cur.toString(), sig.col) : fila(it.rem.toString(), it.col));
    }
    const cociente = t >= 0 ? cocientes[t] : '';
    // Marco del divisor y del cociente (a la derecha del trabajo)
    while (filas.length < 3) filas.push('');
    const marco = [`│ ${divisor}`, `├${rep('─', anchoLinea)}`, `│ ${cociente}`];
    return filas.map((f, i) => (i < 3 ? f.padEnd(x, ' ') + marco[i] : f)).join('\n');
  };
}

function dividir(a, b) {
  if (b.n === 0n) return { ok: false, mensaje: 'No se puede dividir entre cero.' };
  const m = Math.max(a.dec, b.dec);
  const N = a.n * pot10(m - a.dec), D = b.n * pot10(m - b.dec);
  const absA = fmt(a.n, a.dec), absB = fmt(b.n, b.dec);
  const neg = (a.neg !== b.neg) && a.n !== 0n;
  const pasos = [];
  const conSigno = (s) => (neg ? `-${s}` : s);

  if (N === 0n) {
    pasos.push(paso('El dividendo es 0, y 0 dividido entre cualquier número distinto de 0 es 0', `0 ÷ ${absB} = 0`, `0 \\div ${absB} = 0`));
    return { ok: true, resultado: '0', latex: '0', pasos, verificado: true };
  }

  const L = divisionLarga(N, D);
  const tablero = disenarDivision(N, D, L.iters, L.cocientes);

  pasos.push(paso(
    `Dividimos ${absA} entre ${absB}${a.neg || b.neg ? ' (trabajamos sin los signos y al final aplicamos la regla de los signos)' : ''}`,
    `${absA} ÷ ${absB}`, `${absA} \\div ${absB}`, m > 0 ? null : tablero(-1)));
  if (m > 0) {
    pasos.push(paso(
      `Multiplicamos dividendo y divisor por ${pot10(m)} para quitar las comas (el cociente no cambia)`,
      `${absA} ÷ ${absB} = ${N} ÷ ${D}`, `${absA} \\div ${absB} = ${N} \\div ${D}`, tablero(-1)));
  }

  L.iters.forEach((it, i) => {
    const cabe = `el ${D} cabe ${it.q} ${veces(it.q)}`;
    let desc;
    if (it.tipo === 'primera') desc = it.cur < D ? `El ${D} no cabe en ${it.cur}: escribimos 0 en el cociente` : `Tomamos ${it.tomadas}: ${cabe}`;
    else if (it.tipo === 'bajar') desc = `Bajamos el ${it.bajado}: ahora tenemos ${it.cur}; ${cabe}`;
    else desc = it.primera ? `Ya no quedan cifras: ponemos la coma en el cociente y bajamos un 0 (${it.cur}); ${cabe}` : `Bajamos otro 0: ahora tenemos ${it.cur}; ${cabe}`;
    pasos.push(paso(desc,
      `${it.q} × ${D} = ${it.prod};  ${it.cur} − ${it.prod} = ${it.rem}`,
      `${it.q} \\times ${D} = ${it.prod}\\;;\\;\\; ${it.cur} - ${it.prod} = ${it.rem}`,
      tablero(i)));
  });

  // Resultado y verificación independiente: N·10^d = cociente·D + resto
  const sinPunto = L.cocientes[L.cocientes.length - 1].replace('.', '');
  const d = L.decimales.length;
  const verificado = BigInt(sinPunto) * D + L.restoFinal === N * pot10(d);
  if (!verificado) return { ok: false, mensaje: 'La división larga no superó la verificación interna.' };

  let resultado, latex, cierre;
  if (L.restoFinal === 0n) {
    resultado = L.cocientes[L.cocientes.length - 1]; latex = resultado;
    cierre = 'El resto es 0: la división es exacta';
  } else if (L.periodo) {
    const sin = L.decimales.slice(0, L.periodo.desde).join('');
    const per = L.decimales.slice(L.periodo.desde).join('');
    resultado = `${L.entera}.${sin}(${per})`; latex = `${L.entera}.${sin}\\overline{${per}}`;
    cierre = `El resto ${L.restoFinal} ya apareció antes: ${per.length === 1 ? 'la cifra' : 'las cifras'} ${per} se repite${per.length === 1 ? '' : 'n'} sin fin`;
  } else {
    resultado = `${L.cocientes[L.cocientes.length - 1]}…`; latex = `${L.cocientes[L.cocientes.length - 1]}\\ldots`;
    cierre = `Calculamos ${MAX_DECIMALES} decimales; la división no termina, así que el resultado es aproximado`;
  }
  const izq = `${a.neg ? '-' : ''}${absA}`;
  const der = b.neg ? `(-${absB})` : absB;
  pasos.push(paso(`${cierre}${neg ? '. Como los signos son distintos, el resultado es negativo' : ''}`,
    `${izq} ÷ ${der} = ${conSigno(resultado)}`,
    `${izq} \\div ${der} = ${neg ? '-' : ''}${latex}`,
    tablero(L.iters.length - 1)));
  return { ok: true, resultado: conSigno(resultado), latex: `${neg ? '-' : ''}${latex}`, pasos, verificado: true };
}

// ───────────── Multiplicación ─────────────
function dibujoMultiplicacion(A, B, parciales, total, mostrarSuma) {
  const sA = A.toString(), sB = B.toString();
  const anchoParcial = Math.max(0, ...parciales.map((p, i) => p.length + i));
  const ancho = Math.max(sA.length, sB.length + 2, total.length, anchoParcial);
  const filas = [derecha(sA, ancho), `×${derecha(sB, ancho - 1)}`, rep('─', ancho)];
  parciales.forEach((p, i) => filas.push(derecha(p, ancho - i) + rep(' ', i)));
  if (mostrarSuma) { filas.push(rep('─', ancho)); filas.push(derecha(total, ancho)); }
  return filas.join('\n');
}

function multiplicar(a, b) {
  const neg = a.neg !== b.neg;
  const A = a.n, B = b.n, dt = a.dec + b.dec;
  const absA = fmt(a.n, a.dec), absB = fmt(b.n, b.dec);
  const pasos = [];
  if (A === 0n || B === 0n) {
    pasos.push(paso('Uno de los factores es 0, así que el producto es 0', `${absA} × ${absB} = 0`, `${absA} \\times ${absB} = 0`));
    return { ok: true, resultado: '0', latex: '0', pasos, verificado: true };
  }
  if (a.neg || b.neg) pasos.push(paso('Multiplicamos los valores sin signo; al final aplicamos la regla de los signos', `${absA} × ${absB}`, `${absA} \\times ${absB}`));
  if (dt > 0) {
    pasos.push(paso('Quitamos las comas para multiplicar como si fueran números enteros',
      `${absA} → ${A}  (${a.dec} decimal${a.dec === 1 ? '' : 'es'});  ${absB} → ${B}  (${b.dec} decimal${b.dec === 1 ? '' : 'es'})`,
      `${absA} \\to ${A}\\ (${a.dec});\\quad ${absB} \\to ${B}\\ (${b.dec})`));
  }
  const dB = B.toString().split('').reverse().map(Number);
  const parciales = [];
  dB.forEach((d, i) => {
    const p = (A * BigInt(d)).toString();
    parciales.push(p);
    const desc = d === 0
      ? `La cifra de las ${nombrePos(i)} es 0: el producto parcial es 0`
      : i === 0 ? `Multiplicamos ${A} por la cifra de las ${nombrePos(i)}` : `Multiplicamos ${A} por la cifra de las ${nombrePos(i)} y corremos el resultado ${i} lugar${i > 1 ? 'es' : ''} a la izquierda`;
    const corr = d !== 0 && i > 0 ? ` → ${p}${rep('0', i)}` : ''; // producto ya corrido a su lugar
    pasos.push(paso(desc, `${A} × ${d} = ${p}${corr}`, `${A} \\times ${d} = ${p}${corr.replace('→', '\\to')}`, dibujoMultiplicacion(A, B, parciales, '', false)));
  });
  const total = (A * B).toString();
  if (parciales.length > 1) {
    const sumandos = parciales.map((p, i) => p + rep('0', i));
    pasos.push(paso('Sumamos los productos parciales', `${sumandos.join(' + ')} = ${total}`, `${sumandos.join(' + ')} = ${total}`,
      dibujoMultiplicacion(A, B, parciales, total, true)));
  }
  let resultado = total;
  if (dt > 0) {
    const conComa = fmt(A * B, dt);
    resultado = sinCerosFinales(conComa);
    pasos.push(paso(
      `Contamos los decimales: ${a.dec} + ${b.dec} = ${dt}. Separamos ${dt} cifra${dt > 1 ? 's' : ''} desde la derecha${conComa !== resultado ? ' y quitamos los ceros sobrantes' : ''}`,
      `${total} → ${conComa}${conComa !== resultado ? ` = ${resultado}` : ''}`,
      `${total} \\to ${conComa}${conComa !== resultado ? ` = ${resultado}` : ''}`));
  }
  const verificado = BigInt(total) === A * B && fmt(A * B, dt) !== '' && !parciales.some((p, i) => BigInt(p) !== A * BigInt(dB[i]))
    && parciales.reduce((s, p, i) => s + BigInt(p) * pot10(i), 0n) === A * B;
  if (!verificado) return { ok: false, mensaje: 'La multiplicación no superó la verificación interna.' };
  return { ok: true, resultado: neg ? `-${resultado}` : resultado, latex: neg ? `-${resultado}` : resultado, pasos, verificado: true };
}

// ───────────── Suma y resta ─────────────
function sumarRestar(a, b, op) {
  const b2 = op === '-' ? { ...b, neg: !b.neg && b.n !== 0n } : b;
  const dec = Math.max(a.dec, b2.dec);
  const A = a.n * pot10(dec - a.dec), B = b2.n * pot10(dec - b2.dec);
  const mismoSigno = a.neg === b2.neg || A === 0n || B === 0n;
  const sumar = mismoSigno;
  let mayor = A, menor = B, neg;
  if (sumar) neg = A === 0n ? b2.neg : a.neg;
  else if (A >= B) { mayor = A; menor = B; neg = a.neg; } else { mayor = B; menor = A; neg = b2.neg; }
  if (!sumar && A === B) neg = false;

  const L = Math.max(A.toString().length, B.toString().length, dec + 1);
  const dm = mayor.toString().padStart(L, '0'), dn = menor.toString().padStart(L, '0');
  // Fila con la coma en su sitio; los ceros de relleno a la izquierda se muestran como huecos.
  const conComaFila = (digs) => {
    const ent = digs.slice(0, digs.length - dec).replace(/^0+(?=.)/, (z) => ' '.repeat(z.length));
    const dd = digs.slice(digs.length - dec);
    return dec > 0 ? `${ent}.${dd}` : ent;
  };
  const sm = conComaFila(mayor.toString().padStart(dec + 1, '0')).trim();
  const sn = conComaFila(menor.toString().padStart(dec + 1, '0')).trim();
  const W = Math.max(sm.length, sn.length) + 2; // +1 columna del operador, +1 posible llevada
  const simbolo = sumar ? '+' : '−';
  const signos = a.neg || b2.neg;
  const pasos = [];

  if (signos) {
    pasos.push(paso(sumar
      ? `Los dos números tienen el mismo signo: sumamos sus valores sin signo${neg ? ' y el resultado conserva el signo menos' : ''}`
      : `Los signos son distintos: restamos el menor valor sin signo del mayor, y el resultado lleva el signo del mayor`,
      `${texto(a)} ${op} ${b.neg ? '(' + texto(b) + ')' : texto(b)}`, null));
  }
  const dibujo = (resultadoParcial) => [
    derecha(sm, W - 0), `${simbolo}${derecha(sn, W - 1)}`, rep('─', W), derecha(resultadoParcial, W),
  ].join('\n');
  const vacio = (txt) => txt.replace(/\d/g, ' ');

  if (dec > 0 || sm.length !== sn.length) {
    pasos.push(paso(`Alineamos las comas${dec > 0 ? ' y completamos con ceros' : ''} para que cada cifra quede debajo de otra del mismo orden`,
      `${sm} ${simbolo} ${sn}`, `${sm} ${sumar ? '+' : '-'} ${sn}`, dibujo(vacio(sm))));
  }

  // Columnas de derecha a izquierda
  const cifras = new Array(L).fill(' ');
  let llevada = 0;
  for (let i = 0; i < L; i++) {
    const x = Number(dm[L - 1 - i]), y = Number(dn[L - 1 - i]);
    const pos = nombrePos(i - dec);
    let d, desc, eq;
    if (sumar) {
      const s = x + y + llevada;
      d = s % 10;
      desc = `Columna de las ${pos}: ${x} + ${y}${llevada ? ` + ${llevada} (llevada)` : ''} = ${s}${s >= 10 ? `; escribimos ${d} y llevamos 1` : ''}`;
      eq = `${x} + ${y}${llevada ? ` + ${llevada}` : ''} = ${s}`;
      llevada = s >= 10 ? 1 : 0;
    } else {
      let xv = x - llevada;
      const pedir = xv < y;
      if (pedir) xv += 10;
      d = xv - y;
      desc = `Columna de las ${pos}: ${pedir ? `${x}${llevada ? ' − 1 (prestada)' : ''} es menor que ${y}; pedimos 1 prestado y queda ${xv} − ${y} = ${d}` : `${x}${llevada ? ' − 1 (prestada)' : ''} − ${y} = ${d}`}`;
      eq = `${pedir ? xv : x - llevada} − ${y} = ${d}`;
      llevada = pedir ? 1 : 0;
    }
    cifras[L - 1 - i] = String(d);
    // Reconstruye la fila de resultado con la coma en su sitio
    const filaRes = conComaFila(cifras.join(''));
    const ultimoUtil = i === L - 1 || /^0*$/.test(dm.slice(0, L - 1 - i) + dn.slice(0, L - 1 - i)) && !llevada;
    pasos.push(paso(desc, eq, eq.replace('−', '-'), dibujo(filaRes)));
    if (ultimoUtil && i < L - 1) { cifras.fill('0', 0, L - 1 - i); break; }
  }
  if (sumar && llevada) {
    pasos.push(paso('Bajamos la última llevada: se escribe 1 a la izquierda', '1', '1', dibujo(`1${conComaFila(cifras.join(''))}`)));
    cifras.unshift('1');
  }

  const bruto = BigInt(cifras.join('').replace(/ /g, '0'));
  const esperado = sumar ? A + B : mayor - menor;
  if (bruto !== esperado) return { ok: false, mensaje: 'La operación en columna no superó la verificación interna.' };

  const conComa = fmt(bruto, dec);
  const limpio = sinCerosFinales(conComa);
  if (limpio !== conComa) pasos.push(paso('Quitamos los ceros sobrantes de la parte decimal', `${conComa} = ${limpio}`, `${conComa} = ${limpio}`));
  const res = bruto === 0n ? '0' : `${neg ? '-' : ''}${limpio}`;
  return { ok: true, resultado: res, latex: res, pasos, verificado: true };
}

// ───────────── Punto de entrada ─────────────
export function desarrollarAritmetica(expr) {
  const op = parseOperacion(expr);
  if (!op) return { ok: false, mensaje: 'Solo se desarrolla el método de operaciones simples entre dos números.' };
  const r = op.op === '/' ? dividir(op.a, op.b) : op.op === '*' ? multiplicar(op.a, op.b) : sumarRestar(op.a, op.b, op.op);
  if (!r.ok) return r;
  return { ...r, pasos: r.pasos.map((p, i) => ({ numero: i + 1, ...p })), nivel: 'completo', metodo: 'aritmetica' };
}
