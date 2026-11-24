// motorPyodide.js — Cliente del Web Worker de Pyodide + SymPy (carga perezosa).
// No descarga nada hasta que se llama a cargar(). resolver() mata el worker si se agota el tiempo
// (los cálculos de SymPy no se pueden interrumpir de otra forma); el siguiente uso lo recarga desde caché.

const URL_WORKER = new URL('./pyodideWorker.js', import.meta.url);

class MotorPyodide {
  constructor() {
    this.worker = null;
    this.cargado = false;
    this._listo = null;
    this._pend = new Map();
    this._seq = 0;
    this._onProgreso = null;
    this._ultimo = 0;     // instante del último aviso de progreso del worker
    this._vigilante = null;
  }

  _crear() {
    const w = new Worker(URL_WORKER); // worker clásico: usa importScripts para Pyodide
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') { this._ultimo = Date.now(); this._onProgreso?.(data.texto); return; }
      const p = this._pend.get(data.id);
      if (!p) return;
      clearTimeout(p.t);
      this._pend.delete(data.id);
      const { id, ...resto } = data;
      p.res(resto);
    };
    w.onerror = (e) => this._matar(new Error(e.message || 'Error en el worker de SymPy'));
    this.worker = w;
  }

  _llamar(op, payload, ms) {
    return new Promise((res, rej) => {
      const id = ++this._seq;
      const t = setTimeout(() => this._matar(new Error('Tiempo de espera agotado')), ms);
      this._pend.set(id, { res, rej, t });
      this.worker.postMessage({ id, op, payload });
    });
  }

  _pararVigilante() { clearInterval(this._vigilante); this._vigilante = null; }

  _matar(err) {
    this._pararVigilante();
    this.worker?.terminate();
    this.worker = null;
    this.cargado = false;
    this._listo = null;
    for (const [, p] of this._pend) { clearTimeout(p.t); p.rej(err); }
    this._pend.clear();
  }

  /** Descarga e inicializa Pyodide + SymPy. onProgreso(texto) para la barra de estado. */
  cargar(onProgreso) {
    if (this.cargado) return Promise.resolve();
    if (onProgreso) this._onProgreso = onProgreso;
    if (!this._listo) {
      this._crear();
      this._ultimo = Date.now();
      onProgreso?.('Iniciando la descarga…');
      // Si el worker no da señales (conexión muy lenta o bloqueada) se avisa, en vez de dejar "Descargando…" fijo.
      this._vigilante = setInterval(() => {
        const s = Math.round((Date.now() - this._ultimo) / 1000);
        if (s >= 20) this._onProgreso?.(`Sin avances desde hace ${s} s: la conexión está lenta o bloqueada. Si no avanza, vuelve a intentarlo (lo ya descargado se conserva).`);
      }, 5000);
      // El tiempo máximo es largo a propósito: son ~30 MB y en datos móviles lentos pueden tardar; los bloqueos los detecta el worker.
      this._listo = this._llamar('init', {}, 900000).then((r) => {
        this._pararVigilante();
        if (r.ok === false) throw new Error(r.mensaje || 'No se pudo iniciar SymPy');
        this.cargado = true;
      }).catch((e) => { this._pararVigilante(); this._listo = null; throw e; });
    }
    return this._listo;
  }

  /** solicitud: { tipo: 'integral'|'integral_def'|'limite'|'edo'|'ecuacion', ... } */
  async resolver(solicitud, ms = 30000) {
    try {
      if (!this.cargado) await this.cargar();
      return await this._llamar('resolver', solicitud, ms);
    } catch (e) {
      return { ok: false, mensaje: e.message };
    }
  }
}

export const motorPyodide = new MotorPyodide();
