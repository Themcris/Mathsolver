// StepsPanel.js — Panel de resolución paso a paso.
//
//  · Los pasos se revelan de uno en uno ("Siguiente paso ➔"), con animación.
//  · Las ecuaciones se muestran con KaTeX (window.katex). Si el paso trae LaTeX se usa tal cual;
//    si solo trae texto ASCII (x^2, sqrt(1)…) se convierte con el parser de motorPasos.js.
//  · Cada paso añade una explicación "Por qué" cuando se reconoce la regla aplicada.
//  · Construye el DOM con textContent (nunca innerHTML): la entrada del usuario no puede inyectar HTML.
//
//   const panel = renderStepsPanel(respuesta, {
//     onMejorar: (resp, progreso) => mejorarConSimbolico(resp.solicitud, progreso), // devuelve la nueva respuesta
//   });
//   contenedor.replaceChildren(panel);

import { parsear, tex } from './motorPasos.js';

const MOTORES = { pasos: 'motor de pasos', aritmetica: 'aritmética decimal', fracciones: 'fracciones exactas', identidades: 'identidades notables', sistemas: 'eliminación gaussiana', especiales: 'logaritmos y complejos', 'c-wasm': 'motor numérico', nerdamer: 'nerdamer', mathsteps: 'mathsteps', sympy: 'SymPy', pyodide: 'SymPy' };
const NIVELES = { completo: 'Pasos completos', parcial: 'Resultado y método', solo_resultado: 'Cálculo numérico' };
// Solo se muestra cuando el arreglo de pasos está estrictamente vacío: si hay pasos (aunque sean pocos), no hay aviso.
const AVISO_SIN_PASOS = 'El desarrollo paso a paso no está disponible para este tipo de problema; se muestra solo el resultado.';
const AVISO_NUMERICO = 'Cálculo numérico: valor aproximado, sin desarrollo paso a paso.';

// ───────────── ASCII → LaTeX ─────────────
const SEPARADORES = { '=': ' = ', '≈': ' \\approx ', ',': ',\\; ', ';': ';\\; ' };

/** Parte el texto en los separadores de nivel superior (=, ≈, coma, punto y coma), respetando paréntesis y corchetes. */
function partir(t) {
  const out = []; let prof = 0, ini = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ('([{'.includes(c)) prof++;
    else if (')]}'.includes(c)) prof--;
    else if (prof === 0 && (c in SEPARADORES)) { out.push({ txt: t.slice(ini, i), sep: c }); ini = i + 1; }
  }
  out.push({ txt: t.slice(ini), sep: '' });
  return out;
}

const escTex = (s) => s.replace(/[\\{}$&#_%^~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`));

function parteATex(texto) {
  const t = texto.trim();
  if (!t) return '';
  let m;
  if ((m = t.match(/^([fFgG])(′|')?\(([a-z])\)$/))) return `${m[1]}${m[2] ? "'" : ''}(${m[3]})`;
  if ((m = t.match(/^∫\s*(.+?)\s+d([a-z])$/))) return `\\int ${parteATex(m[1])}\\,d${m[2]}`;
  if ((m = t.match(/^lim\s+([a-z])→(\S+)\s+de\s+(.+)$/))) return `\\lim_{${m[1]} \\to ${parteATex(m[2])}} ${parteATex(m[3])}`;
  if ((m = t.match(/^\[([-\d.eE+,;\s]+)\]$/)) && t.includes(';')) {
    const filas = m[1].split(';').map((f) => f.split(',').map((c) => c.trim()).join(' & '));
    return `\\begin{bmatrix} ${filas.join(' \\\\ ')} \\end{bmatrix}`;
  }
  try {
    const s = t.replace(/−/g, '-').replace(/[·×]/g, '*').replace(/÷/g, '/').replace(/Δ/g, 'Delta').replace(/∞/g, 'infinity').replace(/\s*±\s*/g, ' + PMX*');
    let out = tex(parsear(s));
    out = out.replace(/\+ PMX \\cdot /g, '\\pm ');
    if (out.includes('PMX')) throw new Error('±');
    return out
      .replace(/\bDelta\b/g, '\\Delta').replace(/\binfinity\b/g, '\\infty')
      .replace(/--(\d+(?:\.\d+)?|[A-Za-z]\w*)/g, '-\\left(-$1\\right)')
      .replace(/\+ -/g, '- ')
      .replace(/(\d) \\cdot (?=[A-Za-z\\])/g, '$1')
      .replace(/(^|[^\\A-Za-z])([A-Za-z])(\d)(?!\d)/g, '$1$2_{$3}');
  } catch {
    return `\\text{${escTex(t)}}`;
  }
}

/** Convierte la notación ASCII del motor (x^2, sqrt(1), 2*x…) a LaTeX. Lo que no entiende queda como texto. */
export function texDeAscii(texto) {
  return partir(String(texto ?? '')).map(({ txt, sep }) => parteATex(txt) + (SEPARADORES[sep] ?? '')).join('');
}

/** Pinta una expresión con KaTeX; sin KaTeX (o si falla) deja el texto ASCII. */
export function renderMath(el, latex, ascii, display = false) {
  const fuente = latex ?? (ascii != null ? texDeAscii(ascii) : null);
  if (fuente && globalThis.katex) {
    try {
      const grande = /\\(frac|int|lim|begin)/.test(fuente) ? '\\displaystyle ' : ''; // fracciones y límites a tamaño completo
      globalThis.katex.render(grande + fuente, el, { throwOnError: false, strict: 'ignore', displayMode: display });
      return el;
    } catch { /* cae a texto */ }
  }
  el.textContent = ascii ?? latex ?? '';
  return el;
}

// ───────────── Textos pedagógicos ("por qué") ─────────────
// Las descripciones vienen de los motores; aquí solo se añade la razón de cada regla. Primero lo más específico.
const POR_QUE = [
  [/^(Ecuación a resolver|Función a derivar|Integral a resolver|Límite a calcular|Integral definida|Ecuación diferencial|Expresión original|Sistema( de ecuaciones)?$)/, 'Es el punto de partida: el problema tal como lo escribiste.'],
  [/^Pasar todo a un lado/, 'Se llevan todos los términos a un solo lado para que la ecuación quede igualada a cero.'],
  [/^Dejar el término con x solo/, 'Se resta el mismo número en ambos lados: la igualdad se mantiene y el término con x queda aislado.'],
  [/^Dividir entre/, 'Se dividen ambos lados entre el coeficiente de la incógnita para dejarla sola.'],
  [/^Llevar a la forma estándar/, 'La fórmula general se aplica a ecuaciones escritas como ax² + bx + c = 0.'],
  [/^Identificar los coeficientes/, 'a acompaña a x², b acompaña a x y c es el término independiente.'],
  [/^Calcular el discriminante/, 'El signo de Δ decide cuántas raíces reales tiene la ecuación.'],
  [/^Δ > 0/, 'Con Δ positivo la raíz cuadrada es real y los dos signos ± dan soluciones distintas.'],
  [/^Δ = 0/, 'Con Δ nulo ambos signos ± dan el mismo valor: la raíz está repetida.'],
  [/^Δ < 0/, 'Con Δ negativo la raíz cuadrada es imaginaria, así que las soluciones son números complejos.'],
  [/^Aplicar la fórmula general/, 'Se sustituyen a, b y Δ en la fórmula; el ± produce las dos soluciones.'],
  [/^Raíces de la ecuación característica/, 'Cada raíz r aporta un término a la solución general.'],
  [/^Raíz/, 'Es un valor de x que hace cierta la ecuación.'],
  [/^(Sumar el mismo valor|Restar el mismo valor|Multiplicar ambos lados|Dividir ambos lados)/, 'Lo que se hace a un lado de la igualdad se hace también al otro, así la igualdad se mantiene.'],
  [/^Agrupar y sumar términos semejantes/, 'Los términos con la misma parte literal se suman entre sí.'],
  [/^Aplicar la propiedad distributiva/, 'Cada término dentro del paréntesis se multiplica por el factor de fuera.'],
  // Derivadas
  [/^Regla de la suma|^Regla de la resta/, 'La derivada de una suma (o resta) es la suma (o resta) de las derivadas de cada término.'],
  [/^Regla del múltiplo constante/, 'Un número que multiplica a la función sale fuera de la derivada.'],
  [/^Regla del producto/, 'Para derivar un producto se deriva un factor dejando el otro igual, y se suman ambos casos.'],
  [/^Regla del cociente/, 'Se calcula (numerador derivado × denominador − numerador × denominador derivado) y todo se divide entre el denominador al cuadrado.'],
  [/^Regla de la potencia con regla de la cadena/, 'El exponente baja multiplicando, el exponente nuevo es uno menos y se multiplica por la derivada de la base.'],
  [/^Regla de la cadena/, 'Si hay una función dentro de otra, se deriva la de fuera dejando lo de dentro igual y se multiplica por la derivada de lo de dentro.'],
  [/^Regla de la potencia:/, 'El exponente baja a multiplicar y el exponente nuevo es uno menos.'],
  [/^Exponencial/, 'La exponencial se reproduce al derivarla; aparece ln(a) si la base no es e, y se multiplica por la derivada del exponente.'],
  [/^Derivación logarítmica/, 'Cuando la base y el exponente dependen de x se usa el logaritmo para poder derivar.'],
  [/^Derivada del opuesto/, 'El signo menos se conserva al derivar.'],
  [/^Derivada de /, 'Es una derivada básica de la tabla de derivadas.'],
  [/^Reunir los resultados/, 'Se sustituyen las derivadas ya calculadas en la regla anterior.'],
  [/^Simplificar/, 'Se agrupan y reducen términos para dejar el resultado en su forma más compacta.'],
  // Integrales
  [/^Regla de la potencia$/, 'Se suma 1 al exponente y se divide entre el nuevo exponente.'],
  [/^Integral de una constante/, 'La integral de una constante es la constante multiplicada por la variable.'],
  [/^Sacar la constante/, 'Una constante que multiplica se puede sacar de la integral.'],
  [/^Integrar término a término/, 'La integral de una suma es la suma de las integrales.'],
  [/^Integración por partes/, 'Se usa ∫u dv = uv − ∫v du, eligiendo u fácil de derivar y dv fácil de integrar.'],
  [/^Cambio de variable/, 'Se sustituye una parte complicada por u para simplificar la integral y después se devuelve la variable original.'],
  [/^Reescribir el integrando/, 'Se transforma la expresión en otra equivalente que es más fácil de integrar.'],
  [/^Fracciones parciales/, 'Se descompone la fracción en otras más simples que sí se saben integrar.'],
  [/^Antiderivada/, 'Es una función cuya derivada es el integrando.'],
  [/^Teorema fundamental/, 'La integral definida es F(b) − F(a): la antiderivada evaluada en los extremos.'],
  [/^Resultado \(más la constante/, 'Toda antiderivada queda definida salvo una constante C, porque la derivada de una constante es cero.'],
  // Límites
  [/^Sustitución directa/, 'Si al sustituir el valor sale un número, ese número es el límite.'],
  [/forma indeterminada/, 'Una forma como 0/0 o ∞/∞ no fija el valor por sí sola: hay que aplicar otro método.'],
  [/^Regla de L/, 'En una forma 0/0 o ∞/∞, el límite del cociente coincide con el de las derivadas (si ese límite existe).'],
  // Aritmética decimal
  [/^Dividimos \d[\d.,]* entre /, 'Se reparte el dividendo entre el divisor cifra a cifra; en cada paso se busca cuántas veces cabe el divisor.'],
  [/^Multiplicamos dividendo y divisor/, 'Multiplicar ambos por la misma potencia de 10 no cambia el cociente y elimina las comas.'],
  [/^(Tomamos|Bajamos el|El \d+ no cabe)/, 'Se busca cuántas veces cabe el divisor en lo que llevamos; esa cifra va al cociente y el resto pasa al siguiente paso.'],
  [/^Ya no quedan cifras|^Bajamos otro 0/, 'Al acabar las cifras enteras, la coma pasa al cociente y se pueden bajar ceros para seguir dividiendo.'],
  [/^(El resto es 0|El resto \d+ ya apareció|Calculamos \d+ decimales)/, 'Si el resto llega a 0 la división termina; si un resto se repite, las cifras se repiten sin fin.'],
  [/^Quitamos las comas/, 'Se multiplica como con enteros y la coma se devuelve al final contando los decimales.'],
  [/^Multiplicamos \d+ por la cifra|^La cifra de las/, 'Cada cifra del segundo factor multiplica a todo el primero; por cada lugar que sube la cifra, el resultado se corre un lugar a la izquierda.'],
  [/^Sumamos los productos parciales/, 'El producto total es la suma de los productos parciales, ya corridos a su lugar.'],
  [/^Contamos los decimales/, 'El producto tiene tantos decimales como los dos factores juntos.'],
  [/^Alineamos las comas/, 'Para sumar o restar, las cifras del mismo orden (unidades con unidades, décimas con décimas…) deben quedar en la misma columna.'],
  [/^Columna de las/, 'Se opera columna por columna, de derecha a izquierda; si se pasa de 9 se lleva 1 a la columna siguiente (al restar, se pide prestado).'],
  [/^(Los dos números tienen el mismo signo|Los signos son distintos)/, 'Con signos iguales se suma y se conserva el signo; con signos distintos se resta el menor del mayor y se pone el signo del mayor.'],
  // Fracciones
  [/^Buscamos un denominador común/, 'Para sumar o restar fracciones los denominadores deben ser iguales. El MCM es el menor número al que llegan todos, así que es el denominador común más sencillo.'],
  [/^Convertimos (el número mixto|los números mixtos)/, 'Un número mixto es una parte entera más una fracción: se multiplica la parte entera por el denominador, se suma el numerador y se conserva el denominador.'],
  [/^Convertimos/, 'Multiplicar numerador y denominador por el mismo número no cambia el valor de la fracción (es como multiplicar por 1): solo cambia cómo se escribe.'],
  [/^Operamos los números enteros/, 'Si todos los términos son números enteros no hay denominadores que igualar: se suman y restan de izquierda a derecha.'],
  [/^Sumamos (y restamos )?los numeradores/, 'Con el mismo denominador las partes son del mismo tamaño: se suman o restan las partes (los numeradores) y el denominador se queda igual.'],
  [/^Una división de fracciones/, 'Dividir entre una fracción es lo mismo que multiplicar por su recíproca: se intercambian numerador y denominador.'],
  [/^Multiplicamos los números$/, 'Se multiplican los números respetando la regla de los signos (signos iguales dan +, distintos dan −).'],
  [/^Multiplicamos los numeradores/, 'Para multiplicar fracciones se multiplican los numeradores entre sí y los denominadores entre sí.'],
  [/^Simplificamos/, 'Dividir numerador y denominador entre el mismo número (su MCD) da una fracción equivalente, más sencilla.'],
  [/^La fracción .* ya está en su mínima expresión/, 'Si el MCD es 1, numerador y denominador no tienen factores en común: la fracción no se puede reducir más.'],
  [/^Expresamos como número mixto/, 'Una fracción impropia (numerador mayor que el denominador) se puede escribir como parte entera más una fracción propia.'],
  [/^Reescribimos la expresión/, 'Se sustituye el resultado parcial para continuar con el resto de la operación.'],
  [/^Aplicamos el signo menos/, 'El signo menos delante de una fracción afecta a todo su valor: se pasa al numerador.'],
  // Identidades notables y factorización numérica
  [/^Reconocemos (una|un) /, 'Las identidades notables son atajos que siempre se cumplen: reconocer su forma evita multiplicar todo a mano.'],
  [/^Aplicamos la identidad/, 'Se sustituyen a y b por los números concretos de la expresión.'],
  [/^Calculamos cada paréntesis/, 'Primero se resuelve lo que hay dentro de cada paréntesis.'],
  [/^Comprobamos calculando/, 'Calcular el resultado por el camino largo confirma que la identidad se aplicó bien.'],
  [/^Dividimos entre los primos/, 'Todo número se descompone de forma única en primos: se divide entre el menor primo posible hasta llegar a 1.'],
  [/^Agrupamos los primos repetidos/, 'Los primos que se repiten se escriben como potencia: 2·2·5·5 = 2²·5².'],
  // Expresiones algebraicas: factorización y fracciones algebraicas
  [/^(Numerador|Denominador) — Factor común|^Factor común/, 'Si todos los términos comparten un número o una variable, se saca fuera como factor: al multiplicarlo de nuevo se recupera la expresión original.'],
  [/^Diferencia de cuadrados/, 'Un producto de la suma por la diferencia de dos términos da la diferencia de sus cuadrados; se usa al revés para factorizar.'],
  [/^Trinomio de 2\.º grado/, 'Las raíces del trinomio se obtienen con la fórmula general; el discriminante Δ dice si son reales y racionales.'],
  [/^Δ es negativo|^Δ no es un cuadrado perfecto/, 'Sin raíces racionales no hay factores con coeficientes racionales: el polinomio ya no se puede descomponer más.'],
  [/^Fórmula general: x = /, 'Con las raíces r₁ y r₂ el trinomio se escribe a(x − r₁)(x − r₂).'],
  [/^Cada raíz r da un factor/, 'Si r es raíz del polinomio, (x − r) es uno de sus factores.'],
  [/^Grado \d+: se buscan raíces racionales/, 'Una raíz racional p/q debe tener p divisor del término independiente y q divisor del coeficiente principal; si ninguna anula el polinomio, no hay factores lineales racionales.'],
  [/^Teorema de la raíz racional/, 'Si una raíz racional anula el polinomio, (x − raíz) es un factor.'],
  [/^Se divide entre \(.*Ruffini/, 'La regla de Ruffini divide un polinomio entre (x − r) y da el cociente que falta factorizar.'],
  [/^(Numerador|Denominador) factorizado|^Forma factorizada final|^Reescribimos la fracción con ambos/, 'Se escribe cada polinomio como producto de sus factores para poder comparar los de arriba con los de abajo.'],
  [/^(El numerador|El denominador|No se puede factorizar más|Es un monomio)/, 'Un polinomio de grado 1, de un solo término o sin raíces racionales ya es irreducible: no admite más descomposición.'],
  [/^Cancelamos los factores comunes/, 'Un factor que aparece arriba y abajo se puede cancelar porque dividir numerador y denominador entre el mismo número (distinto de 0) no cambia el valor de la fracción.'],
  [/^Numerador y denominador no tienen factores comunes/, 'Sin factores comunes no hay nada que cancelar: la fracción ya está simplificada.'],
  [/^Pasamos el signo al numerador/, 'Dividir numerador y denominador entre el mismo número, incluso negativo, no cambia el valor; así el signo queda arriba.'],
  [/^Restricciones del dominio/, 'La fracción original no existe donde su denominador vale 0; el resultado simplificado solo es equivalente fuera de esos valores.'],
  [/^Resultado \(válido/, 'Es la fracción simplificada, igual a la original en todos los valores permitidos.'],
  [/^Sugerencia: simplificar no factoriza/, 'Simplificar solo agrupa términos; para ver el producto de factores hay que pedir la factorización.'],
  [/^Opcional — forma factorizada/, 'Sacar el factor común es una forma equivalente, a veces más útil para resolver o cancelar.'],
  [/^La expresión ya está (simplificada|desarrollada)/, 'No hay términos semejantes ni productos pendientes que reducir.'],
  // Sistemas lineales, logaritmos y números imaginarios
  [/^Escribimos la matriz ampliada/, 'Una matriz ampliada guarda solo los coeficientes: así se pueden combinar ecuaciones sin arrastrar las letras.'],
  [/^(Dividimos F|Eliminamos |Intercambiamos F)/, 'Sumar o restar múltiplos de una ecuación a otra no cambia la solución del sistema; se hace hasta dejar un 1 por incógnita.'],
  [/^Comprobamos sustituyendo/, 'Sustituir la solución en las ecuaciones originales confirma que no hubo errores.'],
  [/^Significado: log_b/, 'Un logaritmo responde a la pregunta: ¿a qué exponente hay que elevar la base para obtener este número?'],
  [/^El argumento no es una potencia exacta/, 'Cualquier logaritmo se puede calcular con logaritmos naturales dividiendo ln(a) entre ln(b).'],
  [/^Descomponemos en factores primos para ver/, 'Escribir argumento y base como productos de primos deja ver qué potencia de la base es el argumento.'],
  [/^Como .*, el exponente buscado es/, 'Si b elevado a x da exactamente a, entonces x es el logaritmo buscado.'],
  [/^Condiciones: la base/, 'El logaritmo solo está definido si la base es positiva y distinta de 1 y el argumento es positivo.'],
  [/^Definición: log_b/, 'Un logaritmo y la potencia correspondiente son la misma relación escrita de dos maneras.'],
  [/^Despejamos y: fórmula del cambio de base/, 'Tomando ln en ambos lados de b^y = u queda y·ln(b) = ln(u), y de ahí y = ln(u)/ln(b).'],
  [/^Extraemos los factores cuadrados/, 'Un factor que es cuadrado perfecto sale de la raíz como su raíz cuadrada: √(k²·m) = k·√m.'],
  [/^Resultado: número imaginario puro/, 'Se junta la raíz simplificada con la unidad imaginaria i.'],
  [/^La matriz quedó en forma reducida/, 'Con un 1 en cada pivote y ceros en el resto de su columna, cada fila dice directamente el valor de una incógnita.'],
  [/^Dentro de los números reales/, 'Ningún número real al cuadrado da un negativo; por eso se define i = √(−1) y se trabaja con números imaginarios.'],
  // Ecuaciones diferenciales
  [/^Tipo de ecuación/, 'Identificar el tipo permite elegir el método de solución adecuado.'],
  [/^Ecuación característica/, 'Se prueba y = e^(r·x); al sustituir queda un polinomio en r.'],
  [/^Solución general/, 'Las constantes C1, C2… quedan libres hasta conocer condiciones iniciales.'],
];
const explicacion = (desc) => POR_QUE.find(([re]) => re.test(desc ?? ''))?.[1] ?? null;

// ───────────── Estilos (usa las variables del tema si existen) ─────────────
const CSS = `
.oc-sp{--oc-nivel:var(--acento,#f2b84b);display:flex;flex-direction:column;gap:.9rem;min-height:100%;min-width:0;max-width:100%;color:inherit;font:inherit}
.oc-sp[data-nivel=completo]{--oc-nivel:#5fd3a0}
.oc-sp[data-nivel=solo_resultado]{--oc-nivel:#8fb4ff}
.oc-sp[data-nivel=parcial],.oc-sp[data-nivel=requiere_descarga]{--oc-nivel:#f2b84b}
.oc-sp[data-nivel=error]{--oc-nivel:#ef6b5b}
.oc-sp-nivel{display:inline-flex;align-items:center;gap:.5rem;align-self:flex-start;padding:.25rem .75rem;border:1px solid color-mix(in srgb,var(--oc-nivel) 45%,transparent);border-radius:999px;background:color-mix(in srgb,var(--oc-nivel) 12%,transparent);font-size:.8rem}
.oc-sp-punto{width:.5rem;height:.5rem;border-radius:50%;background:var(--oc-nivel)}
.oc-sp-aviso,.oc-sp-nota{margin:0;padding:.6rem .8rem;border-radius:12px;font-size:.88rem;line-height:1.45;background:color-mix(in srgb,var(--oc-nivel) 12%,transparent)}
.oc-sp-nota{background:color-mix(in srgb,currentColor 8%,transparent)}
.oc-sp-lista{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:.65rem}
.oc-sp-paso{min-width:0;margin-left:calc(var(--d,0)*.9rem);padding:.8rem .9rem;border:1px solid var(--linea,color-mix(in srgb,currentColor 18%,transparent));border-radius:14px;background:var(--superficie,color-mix(in srgb,currentColor 6%,transparent));scroll-margin-bottom:9rem}
.oc-sp-cab{display:flex;gap:.65rem;align-items:flex-start}
.oc-sp-n{flex:none;display:grid;place-items:center;width:1.6rem;height:1.6rem;border-radius:50%;background:color-mix(in srgb,var(--oc-nivel) 22%,transparent);color:var(--oc-nivel);font-size:.8rem;font-weight:650;font-variant-numeric:tabular-nums}
.oc-sp-desc{min-width:0;padding-top:.1rem;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.oc-sp-eq{min-width:0;margin:.6rem 0 0 2.25rem;padding:.2rem 0;overflow-x:auto;font-size:1.05rem}
.oc-sp-eq .katex{font-size:1.15em}
.oc-sp-eq .katex-display{margin:0;text-align:left}
.oc-sp-dibujo{min-width:0;margin:.6rem 0 0 2.25rem;padding:.6rem .75rem;overflow-x:auto;border-radius:10px;background:color-mix(in srgb,currentColor 7%,transparent);font:.95rem/1.35 var(--mono,ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace);white-space:pre;tab-size:1}
.oc-sp-por{margin:.55rem 0 0 2.25rem;font-size:.88rem;line-height:1.45;color:var(--suave,color-mix(in srgb,currentColor 65%,transparent))}
.oc-sp-por strong{font-weight:600;color:inherit}
@keyframes oc-entra{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.oc-entra{animation:oc-entra .3s cubic-bezier(.2,.7,.2,1) both}
.oc-sp-final{display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem;scroll-margin-bottom:2rem;outline:none}
.oc-sp-res{padding:.35rem 0 .35rem .9rem;border-left:4px solid var(--oc-nivel)}
.oc-sp-etiqueta{font-size:.8rem;opacity:.7}
.oc-sp-valor{margin-top:.2rem;font-size:1.3rem;line-height:1.45;overflow-x:auto;overflow-wrap:anywhere}
.oc-sp-valor .katex{font-size:1.2em}
.oc-sp-valor .katex-display{margin:0;text-align:left}
.oc-sp-meta{margin-top:.3rem;font-size:.8rem;opacity:.7}
.oc-sp-barra{position:sticky;bottom:0;z-index:2;margin-top:auto;display:grid;gap:.55rem;margin-inline:calc(-1*var(--pad-pantalla,1rem));padding:1.1rem var(--pad-pantalla,1rem) calc(.8rem + env(safe-area-inset-bottom));background:linear-gradient(to bottom,transparent,var(--tinta,#0b1120) 32%)}
.oc-sp-fila{display:flex;align-items:center;justify-content:space-between;gap:.75rem;font-size:.85rem}
.oc-sp-contador{font-variant-numeric:tabular-nums;opacity:.8}
.oc-sp-prog{height:4px;overflow:hidden;border-radius:2px;background:color-mix(in srgb,currentColor 16%,transparent)}
.oc-sp-prog>span{display:block;width:0;height:100%;background:var(--oc-nivel);transition:width .25s}
.oc-sp button{min-height:44px;padding:0 1rem;border:1px solid var(--linea,color-mix(in srgb,currentColor 30%,transparent));border-radius:12px;background:var(--superficie,transparent);color:inherit;font:inherit;cursor:pointer;touch-action:manipulation}
.oc-sp button:focus-visible{outline:2px solid var(--acento,currentColor);outline-offset:2px}
.oc-sp button:disabled{opacity:.55;cursor:default}
.oc-sp .oc-sp-sig,.oc-sp button[data-primario]{border:0;background:var(--acento,#f2b84b);color:var(--acento-tinta,#1b1405);font-weight:650}
.oc-sp .oc-sp-sig{min-height:3.25rem;border-radius:14px;font-size:1.05rem}
.oc-sp .oc-sp-todo{min-height:44px;padding:0 .25rem;border:0;background:none;text-decoration:underline;text-underline-offset:3px;opacity:.85}
.oc-sp-acciones{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.oc-sp-estado{font-size:.85rem;opacity:.8}
.oc-sp-mejora{display:grid;gap:.45rem}
.oc-sp-mejora .oc-sp-btn-metodo{width:100%;min-height:3.25rem;border-radius:14px;font-size:1.05rem}
.oc-sp-nota-mejora{margin:0;font-size:.82rem;line-height:1.4;opacity:.75}
@media (prefers-reduced-motion:reduce){.oc-entra{animation:none}.oc-sp-prog>span{transition:none}}
`;

function inyectarEstilos() {
  if (document.getElementById('oc-sp-estilos')) return;
  const s = document.createElement('style');
  s.id = 'oc-sp-estilos';
  s.textContent = CSS;
  document.head.append(s);
}

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'type' || k === 'tabindex') el.setAttribute(k, v === true ? '' : v);
    else el[k] = v;
  }
  for (const c of hijos.flat()) if (c != null) el.append(c);
  return el;
}

const sinAnimacion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const mirar = (el) => el.scrollIntoView({ block: 'nearest', behavior: sinAnimacion() ? 'auto' : 'smooth' });

// ───────────── Bloques ─────────────
function chipNivel(r) {
  const motor = r.motor ? ` · ${MOTORES[r.motor] ?? r.motor}` : '';
  return h('div', { class: 'oc-sp-nivel' }, h('span', { class: 'oc-sp-punto', 'aria-hidden': 'true' }), `${NIVELES[r.nivel] ?? ''}${motor}`);
}

function bloqueResultado(r) {
  const meta = [];
  if (Number.isFinite(r.errorEstimado)) meta.push(`error estimado ≈ ${Number(r.errorEstimado).toExponential(1)}`);
  if (r.verificado === true) meta.push('verificado numéricamente');
  const valor = renderMath(h('div', { class: 'oc-sp-valor' }), r.latex, r.resultado);
  return h('div', { class: 'oc-sp-res', role: 'status' },
    h('div', { class: 'oc-sp-etiqueta' }, 'Resultado'),
    valor,
    meta.length ? h('div', { class: 'oc-sp-meta' }, meta.join(' · ')) : null);
}

function botonMejora(panel, r, opts, texto) {
  const descarga = r.puedeMejorar ? r.puedeMejorar.requiereDescarga !== false : true;
  const estado = h('span', { class: 'oc-sp-estado', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'oc-sp-btn-metodo', 'data-primario': true }, texto);
  btn.onclick = async () => {
    if (!opts.onMejorar) { estado.textContent = 'Falta conectar onMejorar en el panel.'; return; }
    btn.disabled = true;
    estado.textContent = descarga ? 'Descargando…' : 'Calculando…';
    try {
      const nueva = await opts.onMejorar(r, (t) => { estado.textContent = t; });
      // Si no se pudo desarrollar, se conserva el resultado rápido y se explica el motivo.
      if (r.puedeMejorar && nueva?.ok === false) {
        btn.disabled = false;
        estado.textContent = nueva.mensaje ?? 'No se pudo desarrollar el método.';
        return;
      }
      panel.replaceWith(renderStepsPanel(nueva, opts));
    } catch (e) {
      btn.disabled = false;
      estado.textContent = `No se pudo completar: ${e?.message ?? e}`;
    }
  };
  const nota = r.puedeMejorar
    ? h('p', { class: 'oc-sp-nota-mejora' }, descarga
      ? 'Muestra el desarrollo paso a paso. La primera vez se descarga el motor simbólico (unos 30 MB); después funciona sin conexión.'
      : 'Muestra el desarrollo paso a paso.')
    : null;
  return h('div', { class: 'oc-sp-mejora' }, h('div', { class: 'oc-sp-acciones' }, btn, estado), nota);
}

function crearPaso(p, i, animar) {
  const d = p.profundidad ?? 0;
  const por = explicacion(p.descripcion);
  const li = h('li', { class: `oc-sp-paso${animar ? ' oc-entra' : ''}`, 'data-d': String(d) },
    h('div', { class: 'oc-sp-cab' },
      h('span', { class: 'oc-sp-n', 'aria-hidden': 'true' }, String(p.numero ?? i + 1)),
      h('div', { class: 'oc-sp-desc' }, p.descripcion ?? '')),
    p.ecuacion || p.latex ? renderMath(h('div', { class: 'oc-sp-eq' }), p.latex, p.ecuacion) : null,
    p.dibujo ? h('pre', { class: 'oc-sp-dibujo', role: 'img', 'aria-label': 'Esquema de la operación' }, p.dibujo) : null,
    por ? h('p', { class: 'oc-sp-por' }, h('strong', {}, 'Por qué: '), por) : null);
  li.style.setProperty('--d', String(d));
  return li;
}

// ───────────── Panel ─────────────
export function renderStepsPanel(r, opts = {}) {
  inyectarEstilos();
  const nivel = r?.nivel ?? 'error';
  const panel = h('section', { class: 'oc-sp', 'data-nivel': nivel, 'aria-label': 'Resolución paso a paso' });
  const pasos = Array.isArray(r?.pasos) ? r.pasos : [];

  if (nivel === 'error' || (r?.ok === false && nivel !== 'requiere_descarga')) {
    panel.append(h('div', { class: 'oc-sp-res', role: 'alert' },
      h('div', { class: 'oc-sp-etiqueta' }, 'No se pudo resolver'),
      h('div', { class: 'oc-sp-desc' }, r?.mensaje ?? 'Error desconocido.')));
    return panel;
  }

  if (nivel === 'requiere_descarga') {
    panel.append(
      h('p', { class: 'oc-sp-aviso', role: 'status' }, r.mensaje ?? 'Esta operación requiere el motor simbólico avanzado.'),
      botonMejora(panel, r, opts, 'Descargar motor simbólico'));
    return panel;
  }

  panel.append(chipNivel(r));
  if (pasos.length === 0) panel.append(h('p', { class: 'oc-sp-aviso' }, nivel === 'solo_resultado' ? AVISO_NUMERICO : AVISO_SIN_PASOS));

  // Bloque final: resultado, notas y acciones.
  const final = h('div', { class: 'oc-sp-final', tabindex: '-1' }, bloqueResultado(r));
  if (r.puedeMejorar) final.append(botonMejora(panel, r, opts, r.puedeMejorar.texto ?? 'Método desarrollado'));
  for (const a of r.advertencias ?? []) final.append(h('p', { class: 'oc-sp-nota' }, a));
  if (r.sugerencia === 'exacto_disponible' && !r.puedeMejorar) final.append(h('p', { class: 'oc-sp-nota' }, 'Es un valor numérico. Para el valor exacto usa integral_exacta(f, a, b) (requiere SymPy).'));

  if (!pasos.length) {
    panel.append(final);
    return panel;
  }

  // Pasos interactivos: se muestra el primero y el resto se revela con el botón.
  const total = pasos.length;
  let visibles = 0;
  const lista = h('ol', { class: 'oc-sp-lista', 'aria-live': 'polite' });
  const relleno = h('span');
  const contador = h('span', { class: 'oc-sp-contador' });
  const btnSig = h('button', { type: 'button', class: 'oc-sp-sig' });
  const btnTodo = h('button', { type: 'button', class: 'oc-sp-todo' }, 'Ver todo');
  const barra = h('div', { class: 'oc-sp-barra' },
    h('div', { class: 'oc-sp-prog', role: 'progressbar', 'aria-label': 'Progreso de los pasos', 'aria-valuemin': '0', 'aria-valuemax': String(total) }, relleno),
    h('div', { class: 'oc-sp-fila' }, contador, btnTodo),
    btnSig);

  function actualizar() {
    relleno.style.width = `${(visibles / total) * 100}%`;
    barra.querySelector('[role=progressbar]').setAttribute('aria-valuenow', String(visibles));
    contador.textContent = `Paso ${visibles} de ${total}`;
    btnSig.textContent = visibles < total ? 'Siguiente paso ➔' : 'Ver resultado ➔';
  }
  function revelar(n, animar) {
    let ultimo = null;
    for (let k = 0; k < n && visibles < total; k++) {
      ultimo = crearPaso(pasos[visibles], visibles, animar);
      lista.append(ultimo);
      visibles++;
    }
    actualizar();
    return ultimo;
  }
  function mostrarResultado() {
    barra.hidden = true;
    final.classList.add('oc-entra');
    panel.append(final);
    final.focus({ preventScroll: true });
    mirar(final);
  }

  btnSig.onclick = () => {
    if (visibles < total) mirar(revelar(1, true));
    else mostrarResultado();
  };
  btnTodo.onclick = () => {
    revelar(total - visibles, false);
    mostrarResultado();
  };

  panel.append(lista, barra);
  revelar(1, false);
  return panel;
}

export function mountStepsPanel(contenedor, respuesta, opts) {
  const p = renderStepsPanel(respuesta, opts);
  contenedor.replaceChildren(p);
  return p;
}

/** Texto plano para el showSteps()/stepsText() existente. */
export function stepsText(r) {
  if (!r) return '';
  if (r.ok === false) return r.mensaje ?? 'No se pudo resolver.';
  const out = [`Resultado: ${r.resultado}`];
  if (!(r.pasos ?? []).length) out.push(r.nivel === 'solo_resultado' ? AVISO_NUMERICO : AVISO_SIN_PASOS);
  for (const p of r.pasos ?? []) {
    const sangria = '  '.repeat(p.profundidad ?? 0);
    out.push(`${p.numero}. ${sangria}${p.descripcion}${p.ecuacion ? `\n   ${sangria}${p.ecuacion}` : ''}${p.dibujo ? `\n${p.dibujo.split('\n').map((l) => `   ${sangria}${l}`).join('\n')}` : ''}`);
  }
  for (const a of r.advertencias ?? []) out.push(`Nota: ${a}`);
  return out.join('\n');
}
