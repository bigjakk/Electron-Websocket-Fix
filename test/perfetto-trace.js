// Reader for the trace files Electron's contentTracing.stopRecording() writes.
//
// Since Electron 45.0.0 these are Perfetto protobuf traces, not JSON
// (electron/electron 7762d32d1c; docs/api/content-tracing.md: "Trace data is
// now written in the Perfetto protobuf format. The legacy JSON format is no
// longer supported."). The checks were written against JSON traces (and ran
// that way on v45.0.0-alpha.14), so this turns the TrackEvent packets Chrome
// writes back into events of the legacy JSON shape:
//
//   { name, cat, ph, ts, dur, pid, tid, args }
//     ph   'X' a slice (SLICE_BEGIN and SLICE_END paired per track),
//          'I' an instant
//     ts   microseconds on the trace's monotonic clock (BUILTIN MONOTONIC = 3),
//          comparable across processes; dur in microseconds
//
//   const { readTraceEvents } = require('./perfetto-trace');
//   const events = readTraceEvents(file);   // a legacy JSON trace is read too
//
// Field numbers are from third_party/perfetto/protos/perfetto/trace/ in the
// Chromium 156 checkout: trace_packet.proto, clock_snapshot.proto,
// trace_packet_defaults.proto, interned_data/interned_data.proto and
// track_event/{track_event,debug_annotation,track_descriptor,
// thread_descriptor,process_descriptor}.proto. Handled: interned event names,
// categories and debug-annotation names (cleared with the sequence's
// incremental state), trace packet defaults (track, timestamp clock),
// incremental and scaled clocks from ClockSnapshot packets, thread and process
// track descriptors, legacy events with a phase. Everything else is skipped.
'use strict';
const fs = require('fs');

// ---- protobuf wire format ----------------------------------------------------
// Varints are returned as Number while exact (below 2^53), otherwise as BigInt.
// varintAt() leaves the position after the varint in NEXT, so that nested
// parsing inside a field callback cannot clobber the caller's cursor.
let NEXT = 0;
function varintAt(b, p) {
  let v = 0, mul = 1;
  for (let i = 0; i < 7; i++) {
    const x = b[p++];
    v += (x & 0x7f) * mul;
    if (x < 0x80) { NEXT = p; return v; }
    mul *= 128;
  }
  let big = BigInt(v), shift = 49n;
  for (;;) {
    const x = b[p++];
    big |= BigInt(x & 0x7f) << shift;
    if (x < 0x80) break;
    shift += 7n;
  }
  NEXT = p;
  return big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
}
// fn(field, wire, value, start, end) for each field of the message in b[s, e):
// wire 0 value = the varint; wire 2 [start, end) = the bytes; wire 1 / 5
// start = offset of the 8 / 4 bytes.
function eachField(b, s, e, fn) {
  let p = s;
  while (p < e) {
    const key = Number(varintAt(b, p)); p = NEXT;
    const f = Math.floor(key / 8), w = key % 8;
    if (w === 0) { const v = varintAt(b, p); p = NEXT; fn(f, 0, v, 0, 0); }
    else if (w === 2) { const l = Number(varintAt(b, p)); p = NEXT; fn(f, 2, 0, p, p + l); p += l; }
    else if (w === 1) { fn(f, 1, 0, p, p + 8); p += 8; }
    else if (w === 5) { fn(f, 5, 0, p, p + 4); p += 4; }
    else throw new Error(`perfetto-trace: unsupported wire type ${w} at offset ${p}`);
  }
}
const str = (b, s, e) => b.toString('utf8', s, e);
const key = (v) => String(v);                       // 64-bit ids as map keys
const toInt64 = (v) => (typeof v === 'bigint' ? Number(v >= 2n ** 63n ? v - 2n ** 64n : v) : v);
function packedOrOne(b, w, v, s, e, push) {       // repeated varint, packed or not
  if (w === 0) { push(v); return; }
  let p = s;
  while (p < e) { push(varintAt(b, p)); p = NEXT; }
}

// ---- decoder -----------------------------------------------------------------
function decodePerfetto(b) {
  const REF = 3;                       // BUILTIN_CLOCK_MONOTONIC
  const seqs = new Map();              // trusted_packet_sequence_id -> state
  const builtinToRef = new Map();      // builtin clock id -> ns offset to REF
  const tracks = new Map();            // track uuid -> { pid, tid, parent }
  const open = new Map();              // track uuid -> stack of begun slices
  const events = [];
  const seq = (id) => {
    let st = seqs.get(id);
    if (!st) { st = { names: new Map(), cats: new Map(), ann: new Map(), defaults: {}, clocks: new Map() }; seqs.set(id, st); }
    return st;
  };

  function applySnapshot(st, s, e) {
    const clocks = [];
    eachField(b, s, e, (f, w, v, s2, e2) => {
      if (f !== 1 || w !== 2) return;
      const c = { id: 0, ts: 0, incr: false, mult: 1 };
      eachField(b, s2, e2, (g, w2, v2) => {
        if (g === 1) c.id = Number(v2);
        else if (g === 2) c.ts = Number(v2);
        else if (g === 3) c.incr = !!v2;
        else if (g === 4) c.mult = Number(v2) || 1;
      });
      clocks.push(c);
    });
    let ref = clocks.find((c) => c.id === REF);
    if (!ref) {
      // No MONOTONIC reading: go through a builtin clock whose offset is known.
      const via = clocks.find((c) => c.id < 64 && builtinToRef.has(c.id));
      if (via) ref = { id: REF, ts: via.ts * via.mult + builtinToRef.get(via.id), mult: 1 };
    }
    if (!ref) return;
    const refNs = ref.ts * ref.mult;
    for (const c of clocks) {
      if (c.id < 64) builtinToRef.set(c.id, refNs - c.ts * c.mult);
      else st.clocks.set(c.id, { snap: c.ts, last: c.ts, incr: c.incr, mult: c.mult, refNs });
    }
  }

  function resolveTs(st, ts, clockId) {
    const cid = clockId != null ? clockId : (st.defaults.clockId != null ? st.defaults.clockId : 6);
    let v = Number(ts);
    const c = st.clocks.get(cid);
    if (c) {
      if (c.incr) { c.last += v; v = c.last; }
      return c.refNs + (v - c.snap) * c.mult;
    }
    if (cid < 64) return v + (builtinToRef.get(cid) || 0);
    return v;
  }

  function annotation(st, s, e) {
    let name = null, value;
    eachField(b, s, e, (f, w, v, s2, e2) => {
      switch (f) {
        case 1: name = st.ann.get(key(v)) || `iid:${v}`; break;  // name_iid
        case 10: name = str(b, s2, e2); break;                    // name
        case 2: value = !!v; break;                               // bool_value
        case 3: value = Number(v); break;                         // uint_value
        case 4: value = toInt64(v); break;                        // int_value
        case 5: value = b.readDoubleLE(s2); break;                // double_value
        case 6: value = str(b, s2, e2); break;                    // string_value
        case 7: value = `0x${v.toString(16)}`; break;             // pointer_value
        case 9: value = str(b, s2, e2); break;                    // legacy_json_value
        default: break;
      }
    });
    return [name, value];
  }

  function trackEvent(st, s, e, tsNs) {
    let type = 0, name = null, trackUuid = st.defaults.trackUuid, legacy = null;
    const cats = [], args = {};
    eachField(b, s, e, (f, w, v, s2, e2) => {
      switch (f) {
        case 9: type = Number(v); break;                                          // type
        case 10: name = st.names.get(key(v)) || `iid:${v}`; break;                // name_iid
        case 23: name = str(b, s2, e2); break;                                    // name
        case 3: packedOrOne(b, w, v, s2, e2, (x) => cats.push(st.cats.get(key(x)) || `iid:${x}`)); break;
        case 22: cats.push(str(b, s2, e2)); break;                                // categories
        case 11: trackUuid = key(v); break;                                       // track_uuid
        case 4: { const [n, val] = annotation(st, s2, e2); if (n != null) args[n] = val; break; }
        case 6: legacy = [s2, e2]; break;                                         // legacy_event
        default: break;
      }
    });
    const ts = tsNs / 1000;
    const base = { cat: cats.join(','), args, trackUuid };
    if (legacy) {
      let phase = 0, durUs = null;
      eachField(b, legacy[0], legacy[1], (f, w, v) => {
        if (f === 1) name = st.names.get(key(v)) || name;      // name_iid
        else if (f === 2) phase = Number(v);                   // phase
        else if (f === 3) durUs = toInt64(v);                  // duration_us
      });
      const ph = String.fromCharCode(phase);
      if (ph === 'X') { events.push({ name, ph: 'X', ts, dur: durUs || 0, ...base }); return; }
      if (ph === 'B') type = 1; else if (ph === 'E') type = 2;
      else if (ph === 'I' || ph === 'i' || ph === 'n') type = 3;
      else return;
    }
    if (type === 1) {
      let stack = open.get(trackUuid);
      if (!stack) { stack = []; open.set(trackUuid, stack); }
      stack.push({ name, ts, ...base });
    } else if (type === 2) {
      const stack = open.get(trackUuid);
      const begun = stack && stack.pop();
      if (begun) events.push({ name: begun.name, ph: 'X', ts: begun.ts, dur: ts - begun.ts, cat: begun.cat, args: { ...begun.args, ...args }, trackUuid });
    } else if (type === 3) {
      events.push({ name, ph: 'I', ts, dur: 0, ...base });
    }
  }

  function trackDescriptor(s, e) {
    let uuid = null; const t = { pid: undefined, tid: undefined, parent: null };
    eachField(b, s, e, (f, w, v, s2, e2) => {
      if (f === 1) uuid = key(v);                                        // uuid
      else if (f === 5) t.parent = key(v);                               // parent_uuid
      else if (f === 3) eachField(b, s2, e2, (g, w2, v2) => { if (g === 1) t.pid = toInt64(v2); });   // process.pid
      else if (f === 4) eachField(b, s2, e2, (g, w2, v2) => {            // thread
        if (g === 1) t.pid = toInt64(v2); else if (g === 2) t.tid = toInt64(v2);
      });
    });
    if (uuid != null) tracks.set(uuid, t);
  }

  eachField(b, 0, b.length, (f, w, v, s, e) => {
    if (f !== 1 || w !== 2) return;                                      // Trace.packet
    let seqId = 0, flags = 0, cleared = false, ts = null, clockId = null;
    let te = null, interned = null, defaults = null, snapshot = null; const tds = [];
    eachField(b, s, e, (g, w2, v2, s2, e2) => {
      switch (g) {
        case 10: seqId = v2; break;                     // trusted_packet_sequence_id
        case 13: flags = Number(v2); break;             // sequence_flags
        case 41: cleared = !!v2; break;                 // incremental_state_cleared
        case 8: ts = v2; break;                         // timestamp
        case 58: clockId = Number(v2); break;           // timestamp_clock_id
        case 11: te = [s2, e2]; break;                  // track_event
        case 12: interned = [s2, e2]; break;            // interned_data
        case 59: defaults = [s2, e2]; break;            // trace_packet_defaults
        case 6: snapshot = [s2, e2]; break;             // clock_snapshot
        case 60: tds.push([s2, e2]); break;             // track_descriptor
        default: break;
      }
    });
    const st = seq(key(seqId));
    if ((flags & 1) || cleared) {                       // SEQ_INCREMENTAL_STATE_CLEARED
      st.names.clear(); st.cats.clear(); st.ann.clear(); st.defaults = {}; st.clocks.clear();
    }
    if (defaults) {
      eachField(b, defaults[0], defaults[1], (g, w2, v2, s2, e2) => {
        if (g === 58) st.defaults.clockId = Number(v2);                        // timestamp_clock_id
        else if (g === 11) eachField(b, s2, e2, (h, w3, v3) => {               // track_event_defaults
          if (h === 11) st.defaults.trackUuid = key(v3);                       // track_uuid
        });
      });
    }
    if (snapshot) applySnapshot(st, snapshot[0], snapshot[1]);
    if (interned) {
      eachField(b, interned[0], interned[1], (g, w2, v2, s2, e2) => {
        const table = g === 1 ? st.cats : g === 2 ? st.names : g === 3 ? st.ann : null;
        if (!table) return;
        let iid = null, name = null;
        eachField(b, s2, e2, (h, w3, v3, s3, e3) => { if (h === 1) iid = key(v3); else if (h === 2) name = str(b, s3, e3); });
        if (iid != null) table.set(iid, name);
      });
    }
    for (const [s2, e2] of tds) trackDescriptor(s2, e2);
    // Every timestamped packet advances its sequence's incremental clock.
    if (ts != null) {
      const tsNs = resolveTs(st, ts, clockId);
      if (te) trackEvent(st, te[0], te[1], tsNs);
    }
  });

  // pid / tid from the track (or its parents).
  const owner = (uuid) => {
    for (let u = uuid, n = 0; u != null && n < 8; n++) {
      const t = tracks.get(u);
      if (!t) return {};
      if (t.pid !== undefined) return { pid: t.pid, tid: t.tid };
      u = t.parent;
    }
    return {};
  };
  for (const ev of events) {
    const o = owner(ev.trackUuid);
    ev.pid = o.pid; ev.tid = o.tid;
    delete ev.trackUuid;
  }
  return events;
}

// Events of a trace file: a Perfetto protobuf trace (Electron >= 45.0.0) or a
// legacy JSON trace (older Electron), always as an array of legacy-shaped events.
// A Perfetto trace starts with 0x0a (field 1, length-delimited), which is also
// a newline, so only a file that starts with '{' or '[' is taken for JSON
// outright; anything else is decoded as protobuf, with JSON as the fallback.
function readTraceEvents(file) {
  const b = fs.readFileSync(file);
  const json = () => { const t = JSON.parse(b.toString('utf8')); return Array.isArray(t) ? t : t.traceEvents; };
  if (b[0] === 0x7b || b[0] === 0x5b) return json();
  try {
    return decodePerfetto(b);
  } catch (e) {
    try { return json(); } catch (e2) { throw e; }
  }
}

module.exports = { readTraceEvents, decodePerfetto };
