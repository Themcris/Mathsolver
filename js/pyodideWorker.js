// pyodideWorker.js — Web Worker clásico: Pyodide + SymPy.
// Para uso offline: aloja Pyodide en tu dominio (p. ej. /pyodide/) y apunta BASE ahí,
// o haz que tu service worker cachee (cache-first) todo lo que venga de BASE.

const PYODIDE_VERSION = '0.26.4'; // fija la versión; actualízala tú tras probar
const BASE = "../pyodide/";

let pyodide = null;
let resolverPy = null;

const post = (m) => self.postMessage(m);

// ───────────── Descarga con progreso ─────────────
// Los archivos pesados se bajan con contador de MB (cache 'force-cache' para que el navegador los reutilice cuando
// Pyodide los vuelva a pedir) y se guardan en CacheStorage con el nombre que usa sw.js (pyodide-v1): el service
// worker los sirve desde ahí, sin red, tanto en este uso como sin conexión.
// Tamaños en bytes (solo para el porcentaje; si cambias los archivos de /pyodide/, actualízalos).
const CACHE_PYO = 'pyodide-v1';
const ARCHIVOS = [
  ['pyodide.asm.wasm', 10088051, 'application/wasm'],
  ['python_stdlib.zip', 2341872, 'application/zip'],
  ['pyodide-lock.json', 106335, 'application/json'],
  ['mpmath-1.3.0-py3-none-any.whl', 1519112, 'application/octet-stream'],
  ['sympy-1.12-py3-none-any.whl', 15800402, 'application/octet-stream'],
];
const ESPERA_SIN_DATOS_MS = 45000; // si la conexión no entrega ni un byte en este tiempo, se avisa en vez de quedarse colgado
const fetchRed = self.fetch.bind(self);
let cachePyo = null;

const conEspera = (promesa, ms, mensaje) => {
  let t;
  return Promise.race([promesa, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(mensaje)), ms); })]).finally(() => clearTimeout(t));
};

async function predescargar() {
  try { cachePyo = await caches.open(CACHE_PYO); } catch { cachePyo = null; }
  if (!cachePyo) return; // sin CacheStorage: Pyodide descarga por su cuenta, sin contador
  const total = ARCHIVOS.reduce((s, [, n]) => s + n, 0);
  const mb = (b) => (b / 1048576).toFixed(1);
  let hecho = 0, ultimoAviso = 0;
  const avisar = (forzar) => {
    const ahora = Date.now();
    if (!forzar && ahora - ultimoAviso < 250) return;
    ultimoAviso = ahora;
    post({ type: 'progress', texto: `Descargando motor simbólico… ${mb(Math.min(hecho, total))} de ${mb(total)} MB (${Math.min(99, Math.floor((hecho / total) * 100))}%)` });
  };
  avisar(true);
  for (const [nombre, tam, tipo] of ARCHIVOS) {
    const url = new URL(BASE + nombre, self.location.href).href;
    if (await cachePyo.match(url)) { hecho += tam; avisar(true); continue; } // ya descargado antes
    const r = await conEspera(fetchRed(url, { cache: 'force-cache' }), ESPERA_SIN_DATOS_MS, `El servidor no respondió al pedir ${nombre}. Revisa tu conexión e inténtalo de nuevo.`);
    if (!r.ok) throw new Error(`No se encontró ${nombre} en el servidor (HTTP ${r.status}). Comprueba que la carpeta pyodide/ se haya subido completa.`);
    if (/text\/html/.test(r.headers.get('content-type') || '')) throw new Error(`El servidor devolvió una página web en lugar de ${nombre}. Comprueba que la carpeta pyodide/ se haya subido completa.`);
    const lector = r.body.getReader();
    const partes = [];
    for (;;) {
      const { done, value } = await conEspera(lector.read(), ESPERA_SIN_DATOS_MS, `La descarga de ${nombre} se detuvo (sin datos durante ${ESPERA_SIN_DATOS_MS / 1000} s). Inténtalo de nuevo: lo ya descargado se conserva.`);
      if (done) break;
      partes.push(value);
      hecho += value.length;
      avisar(false);
    }
    await cachePyo.put(url, new Response(new Blob(partes, { type: tipo }), { status: 200, headers: { 'Content-Type': tipo } }));
  }
  avisar(true);
}

async function iniciar() {
  if (pyodide) return;
  await predescargar();
  post({ type: 'progress', texto: 'Iniciando Pyodide…' });
  importScripts(BASE + 'pyodide.js');
  pyodide = await self.loadPyodide({ indexURL: BASE });
  post({ type: 'progress', texto: 'Cargando SymPy…' });
  await pyodide.loadPackage('sympy'); // incluye mpmath
  post({ type: 'progress', texto: 'Preparando el motor…' });
  pyodide.runPython(CODIGO_PY);
  resolverPy = pyodide.globals.get('resolver');
  post({ type: 'progress', texto: 'Listo' });
}

self.onmessage = async ({ data: { id, op, payload } }) => {
  try {
    if (op === 'init') { await iniciar(); post({ id, ok: true }); return; }
    if (!pyodide) await iniciar();
    // El payload viaja como JSON: nunca se interpola en código Python.
    post({ id, ...JSON.parse(resolverPy(JSON.stringify(payload))) });
  } catch (e) {
    post({ id, ok: false, mensaje: String(e?.message ?? e) });
  }
};

const CODIGO_PY = String.raw`
import json, re
import sympy as sp
from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,
                                        implicit_multiplication_application, convert_xor)
from sympy.integrals.manualintegrate import integral_steps

_T = standard_transformations + (implicit_multiplication_application, convert_xor)
_L = {'e': sp.E, 'pi': sp.pi, 'inf': sp.oo, 'oo': sp.oo, 'infinity': sp.oo, 'ln': sp.log, 'log': sp.log,
      'sen': sp.sin, 'tg': sp.tan, 'arcsin': sp.asin, 'arccos': sp.acos, 'arctan': sp.atan,
      'sqrt': sp.sqrt, 'exp': sp.exp}

def P(s, extra=None):
    d = dict(_L)
    if extra:
        d.update(extra)
    return parse_expr(str(s), local_dict=d, transformations=_T)

def paso(desc, a=None, l=None, prof=0):
    return {'descripcion': desc, 'ecuacion': a, 'latex': l, 'profundidad': prof}

def verifica_num(f, g, x):
    """True si la derivada numérica de f coincide con g en varios puntos; None si no concluyente."""
    ok = mal = 0
    for x0 in (0.7, 1.3, 2.1, -0.9, 0.35):
        try:
            h = 1e-6
            num = (sp.N(f.subs(x, x0 + h)) - sp.N(f.subs(x, x0 - h))) / (2 * h)
            val = sp.N(g.subs(x, x0))
            if not (num.is_real and val.is_real):
                continue
            if abs(num - val) <= 1e-4 * (1 + abs(val)):
                ok += 1
            else:
                mal += 1
        except Exception:
            pass
    return False if mal else (True if ok >= 2 else None)

# ───────── Integrales con pasos (manualintegrate) ─────────
_ES = {
    'PowerRule': 'Regla de la potencia', 'ConstantRule': 'Integral de una constante',
    'ConstantTimesRule': 'Sacar la constante fuera de la integral', 'AddRule': 'Integrar término a término',
    'URule': 'Cambio de variable (sustitución)', 'PartsRule': 'Integración por partes',
    'CyclicPartsRule': 'Integración por partes cíclica', 'ExpRule': 'Integral de una exponencial',
    'ReciprocalRule': 'Integral de 1/x', 'RewriteRule': 'Reescribir el integrando',
    'AlternativeRule': 'Método alternativo', 'PartialFractionRule': 'Fracciones parciales',
    'TrigRule': 'Integral trigonométrica básica', 'SinRule': 'Integral del seno', 'CosRule': 'Integral del coseno',
    'ArctanRule': 'Integral que da arcotangente', 'DontKnowRule': 'Sin método identificado',
    'NestedPowRule': 'Potencia anidada', 'LogRule': 'Integral logarítmica', 'SqrtQuadraticRule': 'Raíz de una cuadrática',
}

def _walk(r, out, prof, v):
    nombre = type(r).__name__
    desc = _ES.get(nombre, 'Regla ' + nombre.replace('Rule', ''))
    try:
        if nombre == 'PartsRule':
            desc += f': u = {r.u}, dv = {r.dv} d{v}'
        elif nombre == 'URule':
            desc += f': u = {r.u_func}'
        elif nombre == 'ConstantTimesRule':
            desc += f' (constante: {r.constant})'
        elif nombre == 'RewriteRule':
            desc += f': {r.rewritten}'
    except Exception:
        pass
    ctx = getattr(r, 'context', None)
    a = l = None
    if ctx is not None:
        a = f'∫ {ctx} d{v}'
        l = r'\int ' + sp.latex(ctx) + r'\, d' + str(v)
    out.append(paso(desc, a, l, prof))
    for attr in ('substep', 'v_step', 'second_step'):
        ch = getattr(r, attr, None)
        if ch is not None and hasattr(ch, 'context'):
            _walk(ch, out, prof + 1, v)
    for ch in (getattr(r, 'substeps', None) or []):
        if hasattr(ch, 'context'):
            _walk(ch, out, prof + 1, v)

def op_integral(p):
    v = sp.Symbol(p.get('v') or 'x')
    f = P(p['expr'], {v.name: v})
    res = sp.integrate(f, v)
    if res.has(sp.Integral):
        return {'ok': False, 'mensaje': 'SymPy no encontró una antiderivada en forma cerrada.'}
    pasos = [paso('Integral a resolver', f'∫ {f} d{v}', r'\int ' + sp.latex(f) + r'\, d' + str(v))]
    try:
        _walk(integral_steps(f, v), pasos, 1, v)
    except Exception:
        pasos.append(paso('SymPy no pudo desglosar el método; se muestra solo el resultado.'))
    pasos.append(paso('Resultado (más la constante de integración)', f'{res} + C', sp.latex(res) + ' + C'))
    ver = verifica_num(res, f, v)
    adv = [] if ver is not False else ['La derivada del resultado no coincide con el integrando en la verificación numérica.']
    return {'ok': True, 'resultado': f'{res} + C', 'latex': sp.latex(res) + ' + C', 'pasos': pasos,
            'verificado': ver is True, 'advertencias': adv, 'metodo': 'SymPy (manualintegrate)'}

def op_integral_def(p):
    v = sp.Symbol(p.get('v') or 'x')
    f = P(p['expr'], {v.name: v})
    a, b = P(p['a']), P(p['b'])
    val = sp.integrate(f, (v, a, b))
    if val.has(sp.Integral):
        return {'ok': False, 'mensaje': 'SymPy no pudo evaluar esta integral definida de forma exacta.'}
    es_inf = lambda x: x == sp.oo or x == -sp.oo
    pasos = [paso('Integral definida', f'∫[{a}, {b}] {f} d{v}', r'\int_{' + sp.latex(a) + '}^{' + sp.latex(b) + '} ' + sp.latex(f) + r'\, d' + str(v))]
    F = sp.integrate(f, v)
    if not F.has(sp.Integral):
        try:
            _walk(integral_steps(f, v), pasos, 1, v)
        except Exception:
            pasos.append(paso('SymPy no pudo desglosar el método de integración; se usa directamente la antiderivada', None, None, 1))
        pasos.append(paso('Antiderivada F(x)', f'F({v}) = {F}', 'F(' + str(v) + ') = ' + sp.latex(F)))
        pasos.append(paso('Teorema fundamental: F(b) − F(a)', f'F({b}) - F({a})', r'\int_a^b f\,dx = F(b) - F(a)'))
        try:
            def en(x):
                return sp.limit(F, v, x) if es_inf(x) else sp.simplify(F.subs(v, x))
            Fb, Fa = en(b), en(a)
            pasos.append(paso('Evaluar F en el extremo superior' + (' (es infinito: se toma el límite)' if es_inf(b) else ''),
                              f'F({b}) = {Fb}', 'F(' + sp.latex(b) + ') = ' + sp.latex(Fb)))
            pasos.append(paso('Evaluar F en el extremo inferior' + (' (es infinito: se toma el límite)' if es_inf(a) else ''),
                              f'F({a}) = {Fa}', 'F(' + sp.latex(a) + ') = ' + sp.latex(Fa)))
            pasos.append(paso('Restar: F(b) − F(a)', f'{Fb} - ({Fa})', sp.latex(Fb) + r' - \left(' + sp.latex(Fa) + r'\right)'))
        except Exception:
            pass
    val = sp.simplify(val)
    aprox = sp.N(val, 10)
    res = f'{val}' if val == aprox else f'{val} ≈ {aprox}'
    pasos.append(paso('Valor de la integral', res, sp.latex(val)))
    # Contraste con el valor numérico que ya calculó el motor C (si viene en la solicitud)
    ver = None
    ref = p.get('ref')
    if ref is not None:
        try:
            ver = abs(float(aprox) - float(ref)) <= 1e-6 * (1 + abs(float(ref)))
        except Exception:
            pass
    adv = ['El valor exacto de SymPy no coincide con el cálculo numérico del motor C; revisa la expresión.'] if ver is False else []
    return {'ok': True, 'resultado': res, 'latex': sp.latex(val), 'pasos': pasos, 'verificado': ver is True,
            'advertencias': adv, 'metodo': 'SymPy'}

# ───────── Límites ─────────
def op_limite(p):
    x = sp.Symbol(p.get('v') or 'x')
    f = P(p['expr'], {x.name: x})
    a = P(p['a'], {x.name: x})
    d = {'+': '+', '-': '-', '+-': '+-', '': '+-', None: '+-'}.get(p.get('dir'), '+-')
    pasos = [paso('Límite a calcular', f'lim {x}→{a} de {f}', r'\lim_{' + str(x) + r' \to ' + sp.latex(a) + '} ' + sp.latex(f))]
    adv = []
    directo = None
    try:
        directo = f.subs(x, a)
    except Exception:
        pass
    res = sp.limit(f, x, a, dir=d)
    if directo is not None and directo.is_number and not directo.has(sp.nan, sp.zoo, sp.oo, -sp.oo):
        pasos.append(paso('Sustitución directa', f'{f} en {x} = {a} da {directo}', None))
    else:
        forma = None
        lp = None
        try:
            num, den = sp.fraction(sp.together(f))
            nl, dl = sp.limit(num, x, a, dir=d), sp.limit(den, x, a, dir=d)
            if nl == 0 and dl == 0:
                forma = '0/0'
            elif nl.is_infinite and dl.is_infinite:
                forma = '∞/∞'
            if forma:
                pasos.append(paso(f'La sustitución directa da la forma indeterminada {forma}'))
                fp = sp.simplify(sp.diff(num, x) / sp.diff(den, x))
                lp = sp.limit(fp, x, a, dir=d)
                pasos.append(paso("Regla de L'Hôpital: derivar numerador y denominador", f'lim ({sp.diff(num, x)}) / ({sp.diff(den, x)})',
                                  r'\lim \frac{' + sp.latex(sp.diff(num, x)) + '}{' + sp.latex(sp.diff(den, x)) + '}'))
                if lp != res:
                    adv.append("El valor por L'Hôpital difiere del de SymPy; se muestra el de SymPy.")
        except Exception:
            pass
        if not forma:
            pasos.append(paso('SymPy calculó el límite por otro método (sin desarrollo disponible)'))
    pasos.append(paso('Valor del límite', str(res), sp.latex(res)))
    ver = None
    try:
        if a.is_finite and res.is_number and res.is_finite:
            pts = [a + sp.Rational(1, 10**6)] if d == '+' else [a - sp.Rational(1, 10**6)] if d == '-' else [a + sp.Rational(1, 10**6), a - sp.Rational(1, 10**6)]
            vals = [sp.N(f.subs(x, q)) for q in pts]
            ver = all(abs(vv - sp.N(res)) <= 1e-3 * (1 + abs(sp.N(res))) for vv in vals)
    except Exception:
        pass
    if ver is False:
        adv.append('La evaluación numérica cerca del punto no coincide con el resultado; revísalo.')
    return {'ok': True, 'resultado': str(res), 'latex': sp.latex(res), 'pasos': pasos, 'verificado': ver is True,
            'advertencias': adv, 'metodo': 'SymPy (limit)'}

# ───────── EDOs ─────────
_HINT = {
    'separable': 'Separable', '1st_linear': 'Lineal de primer orden', 'Bernoulli': 'Bernoulli', '1st_exact': 'Exacta',
    '1st_homogeneous_coeff_best': 'Homogénea de primer orden', 'almost_linear': 'Casi lineal', 'Riccati_special_minus2': 'Riccati',
    'nth_linear_constant_coeff_homogeneous': 'Lineal homogénea de coeficientes constantes',
    'nth_linear_constant_coeff_undetermined_coefficients': 'Lineal de coeficientes constantes (coeficientes indeterminados)',
    'nth_linear_constant_coeff_variation_of_parameters': 'Lineal de coeficientes constantes (variación de parámetros)',
}

def _parse_ode(s, f, x):
    s = s.replace('dy/dx', "y'")
    ini = r'(?<![A-Za-z_])'  # no \\b: en "3y'" no hay frontera entre 3 e y
    s = re.sub(ini + f"{f}''", f'Derivative({f}({x}),({x},2))', s)
    s = re.sub(ini + f"{f}'", f'Derivative({f}({x}),{x})', s)
    s = re.sub(ini + f"{f}(?![A-Za-z_(])", f'{f}({x})', s)
    if '=' in s:
        l, r = s.split('=', 1)
    else:
        l, r = s, '0'
    loc = {'Derivative': sp.Derivative, f: sp.Function(f), x: sp.Symbol(x)}
    return sp.Eq(P(l, loc), P(r, loc))

def op_edo(p):
    fname, xname = p.get('f') or 'y', p.get('v') or 'x'
    x = sp.Symbol(xname)
    fx = sp.Function(fname)(x)
    eq = _parse_ode(p['ecuacion'], fname, xname)
    pasos = [paso('Ecuación diferencial', str(eq.lhs) + ' = ' + str(eq.rhs), sp.latex(eq))]
    hints = sp.classify_ode(eq, fx)
    hint = next((h for h in hints if h in _HINT), hints[0] if hints else None)
    if hint:
        pasos.append(paso('Tipo de ecuación: ' + _HINT.get(hint, hint)))
    if hint == 'nth_linear_constant_coeff_homogeneous':
        try:
            r = sp.Symbol('r')
            ex = (eq.lhs - eq.rhs).subs(fx, sp.exp(r * x)).doit() / sp.exp(r * x)
            ch = sp.expand(sp.simplify(ex))
            raices = sp.roots(sp.Poly(ch, r))
            pasos.append(paso('Ecuación característica (probando y = e^(r·x))', f'{ch} = 0', sp.latex(ch) + ' = 0'))
            pasos.append(paso('Raíces de la ecuación característica', ', '.join(f'r = {k} (mult. {m})' for k, m in raices.items())))
        except Exception:
            pass
    sol = sp.dsolve(eq, fx)
    pasos.append(paso('Solución general (las constantes C1, C2… dependen de las condiciones iniciales)', str(sol), sp.latex(sol)))
    ver = None
    try:
        ver = bool(sp.checkodesol(eq, sol)[0])
    except Exception:
        pass
    return {'ok': True, 'resultado': str(sol), 'latex': sp.latex(sol), 'pasos': pasos, 'verificado': ver is True,
            'advertencias': [] if ver is not False else ['La solución no verificó al sustituirla en la ecuación.'],
            'metodo': 'SymPy (dsolve)'}

# ───────── Ecuaciones trascendentes (trig/log/exp) ─────────
def op_ecuacion(p):
    x = sp.Symbol(p.get('v') or 'x')
    L, R = P(p['lhs'], {x.name: x}), P(p['rhs'], {x.name: x})
    eq = sp.Eq(L, R)
    sol = sp.solveset(eq, x, domain=sp.S.Reals)
    if isinstance(sol, sp.ConditionSet):
        return {'ok': False, 'mensaje': 'SymPy no pudo resolver esta ecuación de forma cerrada.'}
    pasos = [paso('Ecuación a resolver', f'{L} = {R}', sp.latex(eq)),
             paso('Soluciones reales (SymPy, sin desarrollo del método)', str(sol), sp.latex(sol))]
    adv = ['Soluciones en ℝ. En ecuaciones periódicas el conjunto se repite; en logaritmos y raíces comprueba el dominio.']
    ver = None
    if isinstance(sol, sp.FiniteSet):
        try:
            ver = all(abs(sp.N((L - R).subs(x, s))) < 1e-8 for s in sol)
        except Exception:
            pass
    return {'ok': True, 'resultado': str(sol), 'latex': sp.latex(sol), 'pasos': pasos, 'verificado': ver is True,
            'advertencias': adv, 'metodo': 'SymPy (solveset)'}

# ───────── Factorización (polinomios y expresiones que el motor ligero no cubre) ─────────
def op_factorizar(p):
    expr = P(p['expr'])
    c, factores = sp.factor_list(expr)
    f = sp.factor(expr)
    pasos = [paso('Expresión original', str(expr), sp.latex(expr))]
    if f == expr or (not factores and c == 1):
        pasos.append(paso('No se encuentra una factorización más sencilla con coeficientes racionales', str(expr), sp.latex(expr)))
        return {'ok': True, 'resultado': str(expr), 'latex': sp.latex(expr), 'pasos': pasos, 'verificado': True,
                'advertencias': [], 'metodo': 'SymPy (factor)'}
    if c != 1:
        pasos.append(paso('Sacamos el factor numérico común', str(c), sp.latex(c)))
    if factores:
        det = ' · '.join(f'({sp.factor(b)})' + (f'^{e}' if e != 1 else '') for b, e in factores)
        detl = ' \\cdot '.join(r'\left(' + sp.latex(b) + r'\right)' + (f'^{{{e}}}' if e != 1 else '') for b, e in factores)
        pasos.append(paso('Factores irreducibles de la expresión (con sus multiplicidades)', det, detl))
    pasos.append(paso('Forma factorizada', str(f), sp.latex(f)))
    ok = sp.simplify(sp.expand(f) - sp.expand(expr)) == 0 if expr.is_polynomial() else sp.simplify(f - expr) == 0
    pasos.append(paso('Comprobación: al multiplicar los factores se recupera la expresión original', str(sp.expand(f)) if expr.is_polynomial() else str(expr), sp.latex(sp.expand(f)) if expr.is_polynomial() else sp.latex(expr)))
    return {'ok': True, 'resultado': str(f), 'latex': sp.latex(f), 'pasos': pasos, 'verificado': bool(ok),
            'advertencias': [] if ok else ['La comprobación por expansión no coincidió: revisa el resultado.'], 'metodo': 'SymPy (factor)'}

_OPS = {'integral': op_integral, 'integral_def': op_integral_def, 'limite': op_limite, 'edo': op_edo, 'ecuacion': op_ecuacion, 'factorizar': op_factorizar}

def resolver(payload_json):
    p = json.loads(payload_json)
    try:
        op = _OPS.get(p.get('tipo'))
        if op is None:
            r = {'ok': False, 'mensaje': 'Tipo no soportado por el motor avanzado: ' + str(p.get('tipo'))}
        else:
            r = op(p)
    except Exception as ex:
        r = {'ok': False, 'mensaje': f'{type(ex).__name__}: {ex}'}
    for i, s in enumerate(r.get('pasos', []), 1):
        s['numero'] = i
    return json.dumps(r, default=str, ensure_ascii=False)
`;
