import React, { useState, useMemo, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Mains — a pipe-rotation puzzle drawn as an engineer's blueprint.    */
/*  Turn each fitting until every branch runs back to the source.       */
/* ------------------------------------------------------------------ */

const DIRS = [
  [-1, 0], // 0 up
  [0, 1],  // 1 right
  [1, 0],  // 2 down
  [0, -1], // 3 left
];
const EDGE = [
  [50, 0],
  [100, 50],
  [50, 100],
  [0, 50],
];

const C = {
  ink: "#09203A",
  board: "#0E2C49",
  rule: "#27567F",
  casing: "#193D61",
  dead: "#4A749E",
  live: "#F2C063",
  liveDim: "#B98A3C",
  chalk: "#DDE9F5",
  muted: "#7B9EC0",
};

const SIZES = [3, 4, 4, 5, 5, 5, 6, 6, 6, 7];
const sizeFor = (lvl) => SIZES[Math.min(lvl - 1, SIZES.length - 1)];

function rotMask(m, r) {
  r = ((r % 4) + 4) % 4;
  for (let i = 0; i < r; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
}

/* Grow a random spanning tree so every layout is solvable. */
function growTree(size) {
  const n = size * size;
  const mask = new Array(n).fill(0);
  const seen = new Array(n).fill(false);
  const src = Math.floor(size / 2) * size + Math.floor(size / 2);
  const frontier = [];

  const push = (idx) => {
    const r = Math.floor(idx / size);
    const c = idx % size;
    for (let d = 0; d < 4; d++) {
      const nr = r + DIRS[d][0];
      const nc = c + DIRS[d][1];
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const to = nr * size + nc;
      if (!seen[to]) frontier.push([idx, to, d]);
    }
  };

  seen[src] = true;
  push(src);
  while (frontier.length) {
    const i = Math.floor(Math.random() * frontier.length);
    const [from, to, d] = frontier.splice(i, 1)[0];
    if (seen[to]) continue;
    seen[to] = true;
    mask[from] |= 1 << d;
    mask[to] |= 1 << ((d + 2) % 4);
    push(to);
  }
  return { mask, src };
}

/* Flood the network from the source; depth drives the light-up stagger. */
function power(base, rot, size, src) {
  const n = size * size;
  const depth = new Array(n).fill(-1);
  const queue = [src];
  depth[src] = 0;
  let reached = 1;

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const m = rotMask(base[cur], rot[cur]);
    const r = Math.floor(cur / size);
    const c = cur % size;
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const nr = r + DIRS[d][0];
      const nc = c + DIRS[d][1];
      if (nr < 0 || nc < 0 || nr >= size || nc >= size) continue;
      const to = nr * size + nc;
      if (depth[to] !== -1) continue;
      if (!(rotMask(base[to], rot[to]) & (1 << ((d + 2) % 4)))) continue;
      depth[to] = depth[cur] + 1;
      reached++;
      queue.push(to);
    }
  }
  return { depth, solved: reached === n };
}

function newGame(level) {
  const size = sizeFor(level);
  const { mask, src } = growTree(size);
  const zero = new Array(size * size).fill(0);
  let base = mask;
  for (let attempt = 0; attempt < 40; attempt++) {
    base = mask.map((m) => rotMask(m, Math.floor(Math.random() * 4)));
    if (!power(base, zero, size, src).solved) break;
  }
  return { level, size, src, base, rot: zero, moves: 0 };
}

/* ------------------------------------------------------------------ */

function Fitting({ mask, rot, live, delay, isSource, onTurn, label }) {
  const ends = [0, 1, 2, 3].filter((d) => mask & (1 << d));
  const core = live ? C.live : C.dead;
  const coreStyle = { transitionDelay: live ? `${delay}ms` : "0ms" };

  return (
    <button
      type="button"
      className="cell"
      aria-label={label}
      onClick={() => onTurn(1)}
      onContextMenu={(e) => {
        e.preventDefault();
        onTurn(-1);
      }}
      style={{
        display: "block",
        width: "100%",
        aspectRatio: "1 / 1",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <svg viewBox="0 0 100 100" style={{ display: "block", width: "100%" }}>
        <rect
          x="0"
          y="0"
          width="100"
          height="100"
          fill="transparent"
          stroke={C.rule}
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <g
          className="rotg"
          style={{ transform: `rotate(${rot * 90}deg)`, transformOrigin: "50% 50%" }}
        >
          {ends.map((d) => (
            <line
              key={`k${d}`}
              x1="50"
              y1="50"
              x2={EDGE[d][0]}
              y2={EDGE[d][1]}
              stroke={C.casing}
              strokeWidth="19"
              strokeLinecap="round"
            />
          ))}
          {ends.map((d) => (
            <line
              key={`c${d}`}
              className="core"
              style={coreStyle}
              x1="50"
              y1="50"
              x2={EDGE[d][0]}
              y2={EDGE[d][1]}
              stroke={core}
              strokeWidth="8"
              strokeLinecap="round"
            />
          ))}
        </g>

        {isSource ? (
          <>
            <circle cx="50" cy="50" r="21" fill={C.board} stroke={C.live} strokeWidth="3.5" />
            <circle cx="50" cy="50" r="8" fill={C.live} />
          </>
        ) : ends.length === 1 ? (
          <>
            <circle cx="50" cy="50" r="17" fill={C.casing} />
            <circle className="core" style={coreStyle} cx="50" cy="50" r="9" fill={core} />
          </>
        ) : null}
      </svg>
    </button>
  );
}

export default function Mains() {
  const [game, setGame] = useState(() => newGame(1));
  const { depth, solved } = useMemo(
    () => power(game.base, game.rot, game.size, game.src),
    [game]
  );

  const turn = useCallback(
    (idx, dir) => {
      setGame((g) => ({
        ...g,
        rot: g.rot.map((v, i) => (i === idx ? v + dir : v)),
        moves: g.moves + 1,
      }));
    },
    []
  );

  const reset = () => setGame((g) => ({ ...g, rot: g.rot.map(() => 0), moves: 0 }));
  const relay = () => setGame((g) => newGame(g.level));
  const next = () => setGame((g) => newGame(g.level + 1));

  return (
    <div
      style={{
        minHeight: "100%",
        background: C.ink,
        color: C.chalk,
        fontFamily:
          'Inter, "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, sans-serif',
        padding: "28px 20px 36px",
      }}
    >
      <style>{`
        .cell { -webkit-tap-highlight-color: transparent; }
        .cell:hover rect { fill: rgba(255,255,255,0.035); }
        .cell:focus { outline: none; }
        .cell:focus-visible rect { stroke: ${C.live}; stroke-opacity: 1; stroke-width: 3; }
        .rotg { transition: transform 280ms cubic-bezier(.2,.75,.25,1); }
        .core { transition: stroke 400ms ease, fill 400ms ease; }
        .btn { transition: border-color 160ms ease, color 160ms ease; }
        .btn:hover { border-color: ${C.live}; color: ${C.live}; }
        .btn:focus-visible { outline: 2px solid ${C.live}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) {
          .rotg, .core, .btn { transition: none !important; }
        }
      `}</style>

      <div style={{ width: "min(92vw, 470px)", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1,
          }}
        >
          Mains
        </h1>
        <p style={{ margin: "10px 0 22px", fontSize: 14, lineHeight: 1.5, color: C.muted }}>
          Turn each fitting until every branch runs back to the source. Click to turn it
          clockwise, right-click to turn it back.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${game.size}, 1fr)`,
            background: C.board,
            border: `1px solid ${solved ? C.liveDim : C.rule}`,
            transition: "border-color 700ms ease",
          }}
        >
          {game.base.map((m, i) => (
            <Fitting
              key={i}
              mask={m}
              rot={game.rot[i]}
              live={depth[i] !== -1}
              delay={depth[i] > 0 ? depth[i] * 45 : 0}
              isSource={i === game.src}
              onTurn={(dir) => !solved && turn(i, dir)}
              label={`Fitting, row ${Math.floor(i / game.size) + 1}, column ${
                (i % game.size) + 1
              }`}
            />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 14, color: solved ? C.live : C.muted }}>
            {solved ? (
              <span>
                Mains live in {game.moves} {game.moves === 1 ? "move" : "moves"}
              </span>
            ) : (
              <span>
                Circuit {game.level} &nbsp;&nbsp; {game.size} × {game.size} &nbsp;&nbsp;{" "}
                {game.moves} {game.moves === 1 ? "move" : "moves"}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {solved ? (
              <button
                type="button"
                className="btn"
                onClick={next}
                style={{
                  padding: "9px 18px",
                  fontSize: 14,
                  fontWeight: 500,
                  color: C.ink,
                  background: C.live,
                  border: `1px solid ${C.live}`,
                  cursor: "pointer",
                }}
              >
                Next circuit
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={reset}
                  style={ghost}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={relay}
                  style={ghost}
                >
                  New layout
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ghost = {
  padding: "9px 16px",
  fontSize: 14,
  fontWeight: 500,
  color: C.muted,
  background: "transparent",
  border: `1px solid ${C.rule}`,
  cursor: "pointer",
};
