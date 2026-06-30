// Shared Web MIDI helper (used by the player and the admin). Wires every input,
// normalises messages to a stable key, fires on "press" events, and supports a
// learn mode (capture the next press). Keys: note:<ch>:<d1> or cc:<ch>:<d1>.
class MidiBus {
    constructor() {
        this.access = null;
        this.inputs = [];
        this.onpress = null;   // (key) => {}
        this.onports = null;   // (names[]) => {}
        this._learn = null;
        this.last = null;
    }
    get supported() { return !!navigator.requestMIDIAccess; }

    async init() {
        if (!this.supported) throw new Error('Web MIDI not supported in this browser');
        this.access = await navigator.requestMIDIAccess({ sysex: false });
        this.access.onstatechange = () => this._wire();
        this._wire();
        return this;
    }

    _wire() {
        this.inputs = this.access ? [...this.access.inputs.values()] : [];
        this.inputs.forEach(inp => { inp.onmidimessage = (e) => this._msg(e); });
        if (this.onports) this.onports(this.inputs.map(i => i.name));
    }

    _msg(e) {
        const [status, d1, d2] = e.data;
        const type = status & 0xf0, ch = status & 0x0f;
        let key = null, pressed = false;
        if (type === 0x90) { key = 'note:' + ch + ':' + d1; pressed = d2 > 0; }   // note-on (vel 0 = off)
        else if (type === 0x80) { key = 'note:' + ch + ':' + d1; pressed = false; }
        else if (type === 0xB0) { key = 'cc:' + ch + ':' + d1; pressed = d2 > 0; } // control change
        else return;
        if (!pressed) return;                  // act on presses only
        this.last = key;
        if (this._learn) { const cb = this._learn; this._learn = null; cb(key); return; }
        if (this.onpress) this.onpress(key);
    }

    learnNext(cb) { this._learn = cb; }
    cancelLearn() { this._learn = null; }
}

function midiKeyLabel(key) {
    if (!key) return '—';
    const [t, ch, d1] = key.split(':');
    return (t === 'cc' ? 'CC ' : 'Note ') + d1 + ' · ch' + (Number(ch) + 1);
}

window.MidiBus = MidiBus;
window.midiKeyLabel = midiKeyLabel;
