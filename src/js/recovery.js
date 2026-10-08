// Recuperación con un reintento automático. Pausar o cambiar de canción la cancela.
export class Recovery {
  constructor({ retry, waiting, failed, recovered = () => {}, timeout = 20000, online = () => navigator.onLine, timer = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id) }) {
    Object.assign(this, { retry, waiting, failed, recovered, timeout, online, timer, cancel });
    this.generation = 0; this.intent = false; this.inFlight = false; this.position = 0;
  }
  clear() { this.cancel(this.handle); this.handle = null; }
  begin(position = 0) {
    this.clear(); this.generation++; this.intent = true; this.inFlight = false;
    this.attempts = 0; this.position = Math.max(0, Number(position) || 0); this.pending = false; this.healthySince = null;
    this.buffering();
  }
  buffering() {
    this.healthySince = null;
    if (!this.intent || this.handle || this.inFlight) return;
    this.handle = this.timer(() => { this.handle = null; this.fail(); }, this.timeout);
  }
  progress(position) {
    if (!Number.isFinite(position) || position < 0) return;
    if (this.intent && !this.handle && !this.inFlight && position > this.position) {
      this.healthySince ??= position;
      // Un corte nuevo tras diez segundos de audio tiene su propio reintento.
      if (position - this.healthySince >= 10) this.attempts = 0;
    } else this.healthySince = null;
    this.position = position;
  }
  playing() { this.clear(); this.pending = false; this.healthySince = null; this.recovered(); }
  pause() { this.clear(); this.intent = false; this.pending = false; this.generation++; }
  async fail() {
    if (!this.intent || this.inFlight) return;
    this.clear();
    if (!this.online()) { this.pending = true; this.waiting(); return; }
    if (this.attempts >= 1) { this.intent = false; this.failed(); return; }
    const generation = this.generation;
    this.attempts++; this.inFlight = true;
    let ok = false, deadline;
    try {
      ok = await Promise.race([
        this.retry(this.position),
        new Promise(resolve => { deadline = this.timer(() => resolve(false), this.timeout); }),
      ]);
    } catch { /* present the recovery controls */ }
    finally { this.cancel(deadline); }
    if (generation !== this.generation) return;
    this.inFlight = false;
    if (ok) this.playing();
    else if (!this.online()) { this.attempts--; this.pending = true; this.waiting(); }
    else { this.intent = false; this.failed(); }
  }
  reconnect() { if (this.intent && this.pending) { this.pending = false; this.fail(); } }
}
