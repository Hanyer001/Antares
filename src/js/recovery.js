// El navegador ejecuta los temporizadores y el intento de audio. Rust decide
// cuándo programarlos y si el resultado todavía pertenece a la pista actual.
import { RecoveryEngine } from "./rust-core.js";

export class Recovery {
  #engine = new RecoveryEngine();
  #view = { state: "idle", position: 0, intent: false, inFlight: false, attempts: 0 };
  #watchdog;

  constructor({
    retry, waiting, failed, recovered = () => {}, stateChanged = () => {},
    timeout = 20000, online = () => navigator.onLine,
    timer = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id),
  }) {
    Object.assign(this, { retry, waiting, failed, recovered, stateChanged, timeout, online, timer, cancel });
  }

  get state() { return this.#view.state; }
  get position() { return this.#view.position; }
  get intent() { return this.#view.intent; }
  get inFlight() { return this.#view.inFlight; }
  get attempts() { return this.#view.attempts; }

  #dispatch(event, args) {
    const { state, effects } = JSON.parse(this.#engine.apply(JSON.stringify({ event, args })));
    this.#view = state;
    for (const { effect, args } of effects) {
      switch (effect) {
        case "cancelWatchdog": this.cancel(this.#watchdog); this.#watchdog = null; break;
        case "startWatchdog": this.#watchdog = this.timer(() => this.fail(), this.timeout); break;
        case "stateChanged": this.stateChanged(args); break;
        case "waiting": this.waiting(); break;
        case "failed": this.failed(); break;
        case "recovered": this.recovered(); break;
        case "retry": return this.#retry(...args);
      }
    }
  }

  async #retry(generation, position) {
    let ok = false;
    let deadline;
    try {
      ok = await Promise.race([
        this.retry(position),
        new Promise(resolve => { deadline = this.timer(() => resolve(false), this.timeout); }),
      ]);
    } catch {
      // Rust decidirá si hay que esperar la conexión o mostrar el error.
    } finally {
      this.cancel(deadline);
    }
    this.#dispatch("retryFinished", [generation, Boolean(ok), Boolean(ok) || this.online()]);
  }

  begin(position = 0) { this.#dispatch("begin", Number.isFinite(Number(position)) ? Number(position) : 0); }
  resume(resetAttempts = false) { this.#dispatch("resume", resetAttempts); }
  buffering() { this.#dispatch("buffering"); }
  progress(position) {
    if (Number.isFinite(position)) this.#dispatch("progress", position);
  }
  playing() { this.#dispatch("playing"); }
  pause() { this.#dispatch("pause"); }
  fail() { return this.#dispatch("fail", this.online()); }
  reconnect() { this.#dispatch("reconnect"); }
}
