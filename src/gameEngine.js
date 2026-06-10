/* ════════════════════════════════════════════════════════════
   gameEngine.js — Pure event-log engine for Shot Chart V3
   No imports. No side effects. Fully unit-testable.
   ════════════════════════════════════════════════════════════ */

export const ZONES = [
  { id: "paint", label: "Paint", x: 140, y: 5, w: 120, h: 92, cx: 200, cy: 50 },
  { id: "2pt-left", label: "2PT Left", x: 15, y: 48, w: 115, h: 122, cx: 72, cy: 108 },
  { id: "2pt-right", label: "2PT Right", x: 270, y: 48, w: 115, h: 122, cx: 328, cy: 108 },
  { id: "3pt-left", label: "3PT Left", x: 8, y: 190, w: 130, h: 100, cx: 73, cy: 240 },
  { id: "3pt-right", label: "3PT Right", x: 262, y: 190, w: 130, h: 100, cx: 327, cy: 240 },
  { id: "3pt-top", label: "3PT Top", x: 148, y: 225, w: 104, h: 80, cx: 200, cy: 265 },
];
export const THREE_PT = new Set(["3pt-left", "3pt-right", "3pt-top"]);
export const Q_LABELS = ["Q1", "Q2", "Q3", "Q4", "OT", "OT2"];
const OLD_ZONE_MAP = { "paint":"paint","ft-line":"paint","top-key":"paint","left-block":"2pt-left","left-elbow":"2pt-left","left-mid":"2pt-left","right-block":"2pt-right","right-elbow":"2pt-right","right-mid":"2pt-right","left-wing3":"3pt-left","left-corner3":"3pt-left","right-wing3":"3pt-right","right-corner3":"3pt-right","top3":"3pt-top" };
export function mapZone(id) { return OLD_ZONE_MAP[id] || id; }

export const TALLY_STATS = ["rebound", "steal", "block", "assist", "turnover", "foul", "opp_foul"];

export function genId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function nextSeq(events) {
  let max = 0;
  for (const e of events) if (typeof e.seq === "number" && e.seq > max) max = e.seq;
  return max + 1;
}

/* Create a new event. NEVER mutates the log — returns the event to append. */
export function makeEvent(events, type, quarter, payload = {}) {
  return {
    id: genId(),
    seq: nextSeq(events),
    type,
    quarter,
    recorded_at: new Date().toISOString(),
    ...payload,
  };
}

/* ─── Format detection & legacy conversion ─── */

export function isV3(game) {
  return Array.isArray(game?.events) && game.events.some(e => e && typeof e.seq === "number");
}

/* Lossless conversion: old shots[] + events[] → ordered V3 event log.
   Order by old Date.now() ids (basketball order ≈ entry order in legacy data). */
export function toEventLog(game) {
  if (isV3(game)) return [...game.events].sort((a, b) => a.seq - b.seq);
  const shots = game?.shots || [];
  const evts = game?.events || [];
  const merged = [];
  for (const s of shots) merged.push({ _k: "shot", _id: s.id || 0, src: s });
  for (const e of evts) merged.push({ _k: "event", _id: e.id || 0, src: e });
  merged.sort((a, b) => a._id - b._id);
  const log = [];
  let seq = 0;
  for (const m of merged) {
    seq++;
    const q = m.src.quarter ?? 0;
    const rec = new Date(typeof m.src.id === "number" ? m.src.id : Date.now()).toISOString();
    if (m._k === "shot") {
      const s = m.src;
      if (s.isFT) {
        log.push({ id: "lg-" + seq, seq, type: "free_throw_attempt", quarter: q, recorded_at: rec, playerNum: s.playerNum, result: s.result, points: s.result === "make" ? 1 : 0 });
      } else {
        const z = mapZone(s.zone);
        const pts = s.result === "make" ? (THREE_PT.has(z) ? 3 : 2) : 0;
        log.push({ id: "lg-" + seq, seq, type: "shot_attempt", quarter: q, recorded_at: rec, playerNum: s.playerNum, zone: z, result: s.result, points: pts });
        if (s.assistNum) {
          seq++;
          log.push({ id: "lg-" + seq, seq, type: "stat_tally", quarter: q, recorded_at: rec, stat: "assist", playerNum: s.assistNum });
        }
      }
    } else {
      const e = m.src;
      if (e.type === "timeout") {
        log.push({ id: "lg-" + seq, seq, type: "timeout", quarter: q, recorded_at: rec, duration: e.duration });
      } else if (TALLY_STATS.includes(e.type)) {
        log.push({ id: "lg-" + seq, seq, type: "stat_tally", quarter: q, recorded_at: rec, stat: e.type, playerNum: e.playerNum });
      }
      // assist events from previous build are already TALLY_STATS
    }
  }
  return log;
}

/* ─── Reversal helpers ─── */

export function reversedIds(events) {
  const set = new Set();
  for (const e of events) if (e.type === "reversal" && e.targetId) set.add(e.targetId);
  return set;
}

/* Active = not reversed, not itself a reversal */
export function activeEvents(events) {
  const rev = reversedIds(events);
  return events.filter(e => e.type !== "reversal" && !rev.has(e.id)).sort((a, b) => a.seq - b.seq);
}

/* Find last active stat_tally for stat+player (for decrement) */
export function lastActiveTally(events, stat, playerNum) {
  const act = activeEvents(events);
  for (let i = act.length - 1; i >= 0; i--) {
    const e = act[i];
    if (e.type === "stat_tally" && e.stat === stat && e.playerNum === playerNum) return e;
  }
  return null;
}

/* ─── THE stat engine. One source of truth. ─── */

export function computeGameStats(events, players = []) {
  const act = activeEvents(events);
  const zoneStats = {};
  ZONES.forEach(z => { zoneStats[z.id] = { makes: 0, total: 0 }; });

  let totalPts = 0, fgMakes = 0, fgTotal = 0, ftMakes = 0, ftTotal = 0;
  let to60used = 0, to30used = 0;
  const qtrFouls = {}, oppQtrFouls = {};
  const oppFoulsByPlayer = {};
  let oppTotalFouls = 0, oppOrbTotal = 0;
  const P = {}; // per-player
  const ensure = (n) => { if (!P[n]) P[n] = { pts:0, fgm:0, fga:0, ftm:0, fta:0, p3m:0, p3a:0, ast:0, reb:0, stl:0, blk:0, fouls:0, tos:0 }; return P[n]; };
  players.forEach(p => ensure(p.number));

  for (const e of act) {
    if (e.type === "shot_attempt") {
      fgTotal++;
      const z = mapZone(e.zone);
      if (zoneStats[z]) zoneStats[z].total++;
      const pp = e.playerNum ? ensure(e.playerNum) : null;
      if (pp) { pp.fga++; if (THREE_PT.has(z)) pp.p3a++; }
      if (e.result === "make") {
        fgMakes++; totalPts += e.points;
        if (zoneStats[z]) zoneStats[z].makes++;
        if (pp) { pp.fgm++; pp.pts += e.points; if (THREE_PT.has(z)) pp.p3m++; }
      }
    } else if (e.type === "free_throw_attempt") {
      ftTotal++;
      const pp = e.playerNum ? ensure(e.playerNum) : null;
      if (pp) pp.fta++;
      if (e.result === "make") { ftMakes++; totalPts += 1; if (pp) { pp.ftm++; pp.pts += 1; } }
    } else if (e.type === "stat_tally") {
      if (e.stat === "opp_foul") {
        oppTotalFouls++;
        oppQtrFouls[e.quarter] = (oppQtrFouls[e.quarter] || 0) + 1;
        oppFoulsByPlayer[e.playerNum] = (oppFoulsByPlayer[e.playerNum] || 0) + 1;
      } else if (e.stat === "opp_rebound_off") {
        oppOrbTotal++;
      } else if (e.playerNum) {
        const pp = ensure(e.playerNum);
        if (e.stat === "rebound") pp.reb++;
        else if (e.stat === "steal") pp.stl++;
        else if (e.stat === "block") pp.blk++;
        else if (e.stat === "assist") pp.ast++;
        else if (e.stat === "turnover") pp.tos++;
        else if (e.stat === "foul") { pp.fouls++; qtrFouls[e.quarter] = (qtrFouls[e.quarter] || 0) + 1; }
      }
    } else if (e.type === "timeout") {
      if (e.duration === 60) to60used++; else if (e.duration === 30) to30used++;
    }
  }

  const teamFouls = Object.values(qtrFouls).reduce((a, b) => a + b, 0);
  let teamAst = 0, teamReb = 0, teamStl = 0, teamBlk = 0, teamTOs = 0;
  Object.values(P).forEach(p => { teamAst += p.ast; teamReb += p.reb; teamStl += p.stl; teamBlk += p.blk; teamTOs += p.tos; });

  return {
    totalPts, fgMakes, fgTotal, ftMakes, ftTotal,
    fgPct: fgTotal ? Math.round(fgMakes / fgTotal * 100) : 0,
    ftPct: ftTotal ? Math.round(ftMakes / ftTotal * 100) : 0,
    zoneStats, players: P,
    teamFouls, qtrFouls, teamAst, teamReb, teamStl, teamBlk, teamTOs,
    oppTotalFouls, oppQtrFouls, oppFoulsByPlayer, oppOrbTotal,
    to60left: 3 - to60used, to30left: 2 - to30used,
    activeEvents: act,
  };
}

/* Tally entries for a stat card, sorted desc */
export function tallyEntries(stats, statKey, players) {
  const field = { rebound:"reb", steal:"stl", block:"blk", assist:"ast", turnover:"tos", foul:"fouls" }[statKey];
  if (!field) return [];
  return Object.entries(stats.players)
    .filter(([, v]) => v[field] > 0)
    .map(([num, v]) => { const p = players.find(x => x.number === num); return { num, name: p ? p.name : "#" + num, count: v[field] }; })
    .sort((a, b) => b.count - a.count);
}

export function ftEntries(stats, players) {
  return Object.entries(stats.players)
    .filter(([, v]) => v.fta > 0)
    .map(([num, v]) => { const p = players.find(x => x.number === num); return { num, name: p ? p.name : "#" + num, made: v.ftm, att: v.fta }; })
    .sort((a, b) => b.att - a.att);
}

export function describeEvent(e, players) {
  const pName = (num) => { if (!num) return ""; const p = players.find(x => x.number === num); return p ? "#" + p.number + " " + p.name : "#" + num; };
  const q = Q_LABELS[e.quarter] || "";
  if (e.type === "shot_attempt") {
    const z = ZONES.find(x => x.id === mapZone(e.zone));
    return (e.result === "make" ? "Make" : "Miss") + " — " + (z ? z.label : e.zone) + (e.playerNum ? " — " + pName(e.playerNum) : "") + " — " + q;
  }
  if (e.type === "free_throw_attempt") return "FT " + (e.result === "make" ? "Make" : "Miss") + (e.playerNum ? " — " + pName(e.playerNum) : "") + " — " + q;
  if (e.type === "stat_tally") {
    const labels = { rebound:"Rebound", steal:"Steal", block:"Block", assist:"Assist", turnover:"Turnover", foul:"Foul", opp_foul:"Opp Foul", opp_rebound_off:"Opp ORB" };
    if (e.stat === "opp_foul") return "Opp Foul — #" + (e.playerNum || "?") + " — " + q;
    if (e.stat === "opp_rebound_off") return "Opp ORB — " + q;
    return (labels[e.stat] || e.stat) + " — " + pName(e.playerNum) + " — " + q;
  }
  if (e.type === "timeout") return "Timeout " + e.duration + "s — " + q;
  if (e.type === "quarter_set") return "Quarter → " + (Q_LABELS[e.toQuarter] || "");
  return "Event — " + q;
}

export function getPoints(zone, result, isFT) {
  if (result !== "make") return 0;
  if (isFT) return 1;
  return THREE_PT.has(mapZone(zone)) ? 3 : 2;
}
