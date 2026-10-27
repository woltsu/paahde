// Packet arrival never advances simulation time. A server tick consumes at most one queued input;
// excess old inputs are acknowledged as discarded, so reconciliation corrects the client to reality.
export type InputCommand = { seq: number; input: number; yaw: number; pitch: number };
export const MAX_QUEUED_INPUTS = 12;
export const HOLD_INPUT_MS = 250;
/** Inputs a queue may keep for jitter: one that hasn't been shorter than this for DRAIN_TICKS is only delay (a burst
 *  after a client hitch, which a queue consumed at the rate it fills never works off), and drops the rest. */
export const QUEUE_SLACK = 2;
export const DRAIN_TICKS = 60;

export class InputQueue {
  ack = 0;
  private lastSeq = 0;
  private receivedAt = -Infinity;
  private queue: InputCommand[] = [];
  private held: InputCommand | null = null;
  private low = Infinity;
  private ticks = 0;

  get length() { return this.queue.length; }

  receive(command: InputCommand, now: number): boolean {
    if (!Number.isSafeInteger(command.seq) || command.seq <= this.lastSeq) return false;
    this.lastSeq = command.seq;
    this.receivedAt = now;
    this.queue.push(command);
    while (this.queue.length > MAX_QUEUED_INPUTS) this.ack = this.queue.shift()!.seq;
    return true;
  }

  take(now: number): InputCommand | null {
    this.low = Math.min(this.low, this.queue.length);
    if (++this.ticks >= DRAIN_TICKS) {
      for (let n = this.low - QUEUE_SLACK; n > 0; n--) this.ack = this.queue.shift()!.seq;
      this.low = Infinity;
      this.ticks = 0;
    }
    const command = this.queue.shift();
    if (command) { this.ack = command.seq; this.held = command; return command; }
    if (this.held && now - this.receivedAt <= HOLD_INPUT_MS) return this.held;
    return null;
  }

  clear() {
    this.ack = this.lastSeq;
    this.queue.length = 0;
    this.held = null;
    this.low = Infinity;
    this.ticks = 0;
  }
}
