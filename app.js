"use strict";

// Board coordinates are inches on a 9 ft table: the playing surface (the cloth
// inside the cushion noses) runs 0..100 across and 0..50 down, and the balls
// are 2.25 in. The SVG viewBox adds the cushions and rails around it, so
// screen scaling is the browser's job.
const CLOTH_WIDTH = 100;
const CLOTH_HEIGHT = 50;
const CUSHION = 2;
const EDGE = 7; // cushion + rail
const BALL_RADIUS = 1.125;

const BOARD_KEY = "poolPatternBoard.board.v1";
const SETTINGS_KEY = "poolPatternBoard.settings.v1";

const BALL_IDS = ["cue", ...Array.from( { length: 15 }, ( _, index ) => String( index + 1 ) )];
const BALL_COLORS = ["#f2c200", "#1d4fc4", "#d3212d", "#5a2d8c", "#f2711c", "#128041", "#7d1d24", "#141414"];
const CUE_COLOR = "#f6f3ea";

const CLOTH_COLOR = "#a3acb6";
const CUSHION_COLOR = "#86909b";

// A corner pocket's 4.6 in mouth runs across the corner, so its middle sits
// this far in from each rail.
const CORNER_MOUTH_INSET = 4.6 / Math.SQRT2 / 2;

// aim: the middle of the pocket opening, where a straight-in shot is played.
// corner: the cloth corner behind a corner pocket's opening. draw: the pocket
// hole drawn on the rail, sized to a regulation mouth (corners about 4.6 in,
// sides about 5 in).
const POCKETS = [
  { id: "tl", aim: { x: CORNER_MOUTH_INSET, y: CORNER_MOUTH_INSET }, corner: { x: 0, y: 0 }, draw: { x: -1.1, y: -1.1 }, radius: 2.35 },
  { id: "tm", aim: { x: 50, y: 0 }, draw: { x: 50, y: -2.4 }, radius: 2.5 },
  { id: "tr", aim: { x: CLOTH_WIDTH - CORNER_MOUTH_INSET, y: CORNER_MOUTH_INSET }, corner: { x: CLOTH_WIDTH, y: 0 }, draw: { x: 101.1, y: -1.1 }, radius: 2.35 },
  { id: "bl", aim: { x: CORNER_MOUTH_INSET, y: CLOTH_HEIGHT - CORNER_MOUTH_INSET }, corner: { x: 0, y: CLOTH_HEIGHT }, draw: { x: -1.1, y: 51.1 }, radius: 2.35 },
  { id: "bm", aim: { x: 50, y: CLOTH_HEIGHT }, draw: { x: 50, y: 52.4 }, radius: 2.5 },
  { id: "br", aim: { x: CLOTH_WIDTH - CORNER_MOUTH_INSET, y: CLOTH_HEIGHT - CORNER_MOUTH_INSET }, corner: { x: CLOTH_WIDTH, y: CLOTH_HEIGHT }, draw: { x: 101.1, y: 51.1 }, radius: 2.35 }
];

// OK is the good shape made wider or longer, so it is drawn first and the good
// shape stays clickable on top of it.
const REGION_KINDS = {
  ok: { label: "OK shape", opacity: 0.2, strokeWidth: 0.25, dash: "1.1 0.7" },
  good: { label: "Good shape", opacity: 0.4, strokeWidth: 0.3, dash: "" }
};
const KIND_ORDER = ["ok", "good"];

// The good zone built around a target: its near edge sits halfway
// to the object ball, its far edge the same distance behind the marker, and the
// far edge is twice as wide as the near one.
const ZONE_NEAR_WIDTH_RATIO = 1 / 3; // near edge width as a share of the zone's length
const ZONE_MIN_NEAR_WIDTH = 4 * BALL_RADIUS;

const LINE_COLORS = ["#ffffff", "#ffd60a", "#ff453a", "#0a84ff", "#111111", "#ff9f0a", "#30d158", "#ff2dd1"];
const LINE_WIDTHS = { thin: 0.22, medium: 0.4, thick: 0.7 };

const NUDGE = 0.25;
const NUDGE_LARGE = 1;
const DRAG_THRESHOLD_PX = 3;
const DOUBLE_CLICK_MS = 350;

// Phones held upright get the table stood on end: the world group turns it a
// quarter turn so the head rail is at the top.
const LANDSCAPE_VIEW = "-7 -7 114 64";
const PORTRAIT_VIEW = "-7 -7 64 114";
const PORTRAIT_TRANSFORM = `matrix(0 1 -1 0 ${CLOTH_HEIGHT} 0)`;
const portraitQuery = matchMedia( "(orientation: portrait) and (max-width: 760px)" );
// fingers need bigger grips than a mouse
const coarseQuery = matchMedia( "(pointer: coarse)" );

const svg = document.getElementById( "board" );
const world = document.getElementById( "world" );
const layers = {
  table: document.getElementById( "layer-table" ),
  regions: document.getElementById( "layer-regions" ),
  pocketLines: document.getElementById( "layer-pocket-lines" ),
  lines: document.getElementById( "layer-lines" ),
  pockets: document.getElementById( "layer-pockets" ),
  balls: document.getElementById( "layer-balls" ),
  handles: document.getElementById( "layer-handles" ),
  draft: document.getElementById( "layer-draft" )
};
const tray = document.getElementById( "tray" );
const ghost = document.getElementById( "drag-ghost" );
const statusText = document.getElementById( "status" );

let board = loadBoard();
const settings = loadSettings();
const POCKET_NAMES = { tl: "Top left", tm: "Top side", tr: "Top right", bl: "Bottom left", bm: "Bottom side", br: "Bottom right" };

const ui = {
  mode: "ball", // ball: pockets, markers and shapes | line: free lines
  tool: "select", // ball mode: select | hand | widen | good
  ball: null, // the selected object ball: shapes, pockets and markers act on it
  selection: null, // { type: "ball" | "hand" | "region" | "line", id }
  point: null, // { region, index } of the selected shape point
  draft: null, // a good shape or line being drawn
  cursor: null, // last pointer position in board coordinates
  placing: null, // a tray ball tapped, waiting for a tap on the table
  portrait: false, // the table is drawn on end
  message: ""
};
let drag = null;
let undoStack = [];
let redoStack = [];
let lastDown = { time: 0, x: 0, y: 0 };

// ---------- helpers ----------

const isStripe = id => Number( id ) > 8;
const ballColor = id => id === "cue" ? CUE_COLOR : BALL_COLORS[( Number( id ) - 1 ) % 8];
const ballFill = id => isStripe( id ) ? `url(#stripes-${id})` : ballColor( id );
const ballName = id => id === "cue" ? "cue ball" : `${id} ball`;
const newId = () => Math.random().toString( 36 ).slice( 2, 10 );
const distance = ( a, b ) => Math.hypot( a.x - b.x, a.y - b.y );
const clamp = ( value, min, max ) => Math.min( max, Math.max( min, value ) );
const round = value => Math.round( value * 100 ) / 100;
const pointsAttr = points => points.map( p => `${round( p.x )},${round( p.y )}` ).join( " " );

function clampToCloth( p, margin = 0 ) {
  return {
    x: clamp( p.x, margin, CLOTH_WIDTH - margin ),
    y: clamp( p.y, margin, CLOTH_HEIGHT - margin )
  };
}

const isOnTable = p => p.x >= -EDGE && p.x <= CLOTH_WIDTH + EDGE && p.y >= -EDGE && p.y <= CLOTH_HEIGHT + EDGE;
const isOnCloth = p => Boolean( p ) && p.x >= 0 && p.x <= CLOTH_WIDTH && p.y >= 0 && p.y <= CLOTH_HEIGHT;

function toBoard( event ) {
  const matrix = world.getScreenCTM();
  if ( !matrix ) return { x: 0, y: 0 };
  const point = new DOMPoint( event.clientX, event.clientY ).matrixTransform( matrix.inverse() );
  return { x: point.x, y: point.y };
}

function pixels( count ) {
  const matrix = world.getScreenCTM();
  return matrix ? count / Math.hypot( matrix.a, matrix.b ) : count / 10;
}

// Screen pixels for a grip: a bit over double for a finger.
const grip = count => pixels( coarseQuery.matches ? count * 2.2 : count );

function applyOrientation( portrait = portraitQuery.matches ) {
  ui.portrait = portrait;
  svg.setAttribute( "viewBox", ui.portrait ? PORTRAIT_VIEW : LANDSCAPE_VIEW );
  if ( ui.portrait ) world.setAttribute( "transform", PORTRAIT_TRANSFORM );
  else world.removeAttribute( "transform" );
  svg.classList.toggle( "portrait", ui.portrait );
}

function findRegion( id ) { return board.regions.find( region => region.id === id ); }
function findLine( id ) { return board.lines.find( line => line.id === id ); }
function regionFor( ball, kind ) { return board.regions.find( region => region.ball === ball && region.kind === kind ); }

function isSelected( type, id ) { return ui.selection?.type === type && ui.selection.id === id; }

function currentBall() { return ui.ball && board.balls[ui.ball] ? ui.ball : null; }

// The cue ball has no pocket, zones or movement, so selecting it clears the selected ball.
function setBall( id ) {
  ui.ball = id && id !== "cue" ? id : null;
}

function centroid( points ) {
  return {
    x: points.reduce( ( sum, p ) => sum + p.x, 0 ) / points.length,
    y: points.reduce( ( sum, p ) => sum + p.y, 0 ) / points.length
  };
}

// The edge of a shape nearest p, with where p falls on it.
function nearestEdge( points, p ) {
  let best = null;
  points.forEach( ( a, index ) => {
    const b = points[( index + 1 ) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp( ( ( p.x - a.x ) * dx + ( p.y - a.y ) * dy ) / ( dx * dx + dy * dy || 1 ), 0, 1 );
    const projected = { x: a.x + dx * t, y: a.y + dy * t };
    const gap = distance( p, projected );
    if ( !best || gap < best.distance ) best = { index, distance: gap, point: projected };
  } );
  return best;
}

// Unit normal of edge a→b pointing away from the shape's middle.
function outwardNormal( points, a, b ) {
  const length = distance( a, b ) || 1;
  let normal = { x: ( b.y - a.y ) / length, y: -( b.x - a.x ) / length };
  const center = centroid( points );
  const middle = { x: ( a.x + b.x ) / 2, y: ( a.y + b.y ) / 2 };
  if ( normal.x * ( middle.x - center.x ) + normal.y * ( middle.y - center.y ) < 0 ) normal = { x: -normal.x, y: -normal.y };
  return normal;
}

// ---------- persistence ----------

// locked: the balls stay where they are, so planning can't knock them about
function emptyBoard() { return { balls: {}, regions: [], lines: [], locked: false }; }

function validPoint( p ) { return p && Number.isFinite( p.x ) && Number.isFinite( p.y ); }

function loadBoard() {
  try {
    const parsed = JSON.parse( localStorage.getItem( BOARD_KEY ) );
    if ( !parsed ) return emptyBoard();
    const result = emptyBoard();
    for ( const [id, ball] of Object.entries( parsed.balls ?? {} ) ) {
      if ( BALL_IDS.includes( id ) && validPoint( ball ) ) {
        const isObject = id !== "cue";
        result.balls[id] = {
          x: ball.x,
          y: ball.y,
          pocket: isObject && POCKETS.some( p => p.id === ball.pocket ) ? ball.pocket : null,
          hand: isObject && validPoint( ball.hand ) ? { x: ball.hand.x, y: ball.hand.y } : null,
          path: isObject && Array.isArray( ball.path ) && ball.path.length && ball.path.every( validPoint )
            ? ball.path.map( p => ( { x: p.x, y: p.y, rail: Boolean( p.rail ) } ) )
            : null
        };
      }
    }
    result.regions = ( parsed.regions ?? [] ).filter( region =>
      REGION_KINDS[region.kind] && result.balls[region.ball] && Array.isArray( region.points ) &&
      region.points.length >= 3 && region.points.every( validPoint ) );
    result.lines = ( parsed.lines ?? [] ).filter( line =>
      validPoint( line.a ) && validPoint( line.b ) && typeof line.color === "string" );
    result.locked = parsed.locked === true;
    return result;
  } catch {
    return emptyBoard();
  }
}

function saveBoard() {
  try {
    localStorage.setItem( BOARD_KEY, JSON.stringify( board ) );
  } catch {
    // storage blocked: the board still works for this visit
  }
}

function loadSettings() {
  const defaults = {
    pocketLines: true,
    show: { hand: true, good: true, ok: true, path: true },
    lineColor: LINE_COLORS[0],
    lineArrow: true,
    lineWidth: "thin"
  };
  try {
    const parsed = JSON.parse( localStorage.getItem( SETTINGS_KEY ) ) ?? {};
    return {
      pocketLines: parsed.pocketLines ?? defaults.pocketLines,
      show: { ...defaults.show, ...parsed.show },
      lineColor: typeof parsed.lineColor === "string" ? parsed.lineColor : defaults.lineColor,
      lineArrow: parsed.lineArrow ?? defaults.lineArrow,
      lineWidth: LINE_WIDTHS[parsed.lineWidth] ? parsed.lineWidth : defaults.lineWidth
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem( SETTINGS_KEY, JSON.stringify( settings ) );
  } catch {
    // ignore
  }
}

// ---------- undo ----------

function pushUndo() {
  undoStack.push( JSON.stringify( board ) );
  if ( undoStack.length > 200 ) undoStack.shift();
  redoStack = [];
}

function restore( from, to ) {
  if ( !from.length ) return;
  to.push( JSON.stringify( board ) );
  // the lock is a setting, not an edit: undo leaves it as it is
  const locked = board.locked;
  board = JSON.parse( from.pop() );
  board.locked = locked;
  ui.draft = null;
  drag = null;
  ui.tool = "select";
  const selection = ui.selection;
  const exists = !selection ||
    ( selection.type === "ball" && board.balls[selection.id] ) ||
    ( selection.type === "hand" && board.balls[selection.id]?.hand ) ||
    ( selection.type === "path" && board.balls[selection.id]?.path ) ||
    ( selection.type === "region" && findRegion( selection.id ) ) ||
    ( selection.type === "line" && findLine( selection.id ) );
  if ( !exists ) ui.selection = null;
  if ( ui.point && !findRegion( ui.point.region )?.points[ui.point.index] ) ui.point = null;
  render();
}

const undo = () => restore( undoStack, redoStack );
const redo = () => restore( redoStack, undoStack );

// ---------- markup ----------

function ballMarkup( id ) {
  const r = BALL_RADIUS;
  const color = ballColor( id );
  let markup = isStripe( id )
    ? `<circle r="${r}" fill="${CUE_COLOR}"/><rect x="${-r}" y="${-r * 0.56}" width="${2 * r}" height="${r * 1.12}" fill="${color}" clip-path="url(#ball-clip)"/>`
    : `<circle r="${r}" fill="${color}"/>`;
  if ( id !== "cue" ) {
    // the number fills its white disc
    const size = id.length > 1 ? 0.92 : 1.12;
    markup += `<circle r="${r * 0.64}" fill="#fbfaf5"/><text class="ball-number" y="${size * 0.36}" font-size="${size}"${id.length > 1 ? ` textLength="${r * 1.12}" lengthAdjust="spacingAndGlyphs"` : ""}>${id}</text>`;
  }
  return markup + `<circle r="${r}" fill="url(#ball-shade)" stroke="rgba(0,0,0,0.35)" stroke-width="0.04"/>`;
}

function renderDefs() {
  const stripes = BALL_IDS.filter( isStripe ).map( id =>
    `<pattern id="stripes-${id}" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(45)">` +
    `<rect width="0.75" height="1.4" fill="${ballColor( id )}"/></pattern>` ).join( "" );
  document.getElementById( "board-defs" ).innerHTML = `
    <clipPath id="ball-clip"><circle r="${BALL_RADIUS}"/></clipPath>
    <radialGradient id="ball-shade" cx="0.36" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.6"/>
      <stop offset="0.28" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.85" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.18"/>
    </radialGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2d31"/>
      <stop offset="1" stop-color="#151619"/>
    </linearGradient>
    <radialGradient id="cloth-light" cx="0.5" cy="0.5" r="0.7">
      <stop offset="0" stop-color="#fff" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.1"/>
    </radialGradient>
    ${stripes}`;
}

function renderTable() {
  const diamonds = [];
  const diamond = ( x, y ) => `<path d="M${x} ${y - 0.45}L${x + 0.3} ${y}L${x} ${y + 0.45}L${x - 0.3} ${y}Z" fill="#d9dde2"/>`;
  for ( let step = 1; step < 8; step++ ) {
    if ( step === 4 ) continue;
    diamonds.push( diamond( step * 12.5, -4.5 ), diamond( step * 12.5, CLOTH_HEIGHT + 4.5 ) );
  }
  for ( let step = 1; step < 4; step++ ) {
    diamonds.push( diamond( -4.5, step * 12.5 ), diamond( CLOTH_WIDTH + 4.5, step * 12.5 ) );
  }
  const holes = POCKETS.map( p => `<circle cx="${p.draw.x}" cy="${p.draw.y}" r="${p.radius}" fill="#050505"/>` ).join( "" );
  const spot = ( x, y ) => `<circle cx="${x}" cy="${y}" r="0.3" fill="rgba(255,255,255,0.45)"/>`;
  layers.table.innerHTML = `
    <rect x="${-EDGE}" y="${-EDGE}" width="${CLOTH_WIDTH + 2 * EDGE}" height="${CLOTH_HEIGHT + 2 * EDGE}" rx="2.6" fill="url(#rail)"/>
    <rect x="${-CUSHION}" y="${-CUSHION}" width="${CLOTH_WIDTH + 2 * CUSHION}" height="${CLOTH_HEIGHT + 2 * CUSHION}" fill="${CUSHION_COLOR}"/>
    <rect width="${CLOTH_WIDTH}" height="${CLOTH_HEIGHT}" fill="${CLOTH_COLOR}"/>
    <rect width="${CLOTH_WIDTH}" height="${CLOTH_HEIGHT}" fill="url(#cloth-light)"/>
    ${diamonds.join( "" )}
    ${holes}
    ${spot( 25, 25 )}${spot( 75, 25 )}`;
}

function regionMarkup( region ) {
  const kind = REGION_KINDS[region.kind];
  const opacity = isStripe( region.ball ) ? Math.min( 1, kind.opacity * 1.5 ) : kind.opacity;
  const selected = isSelected( "region", region.id ) ? " selected" : "";
  const dash = kind.dash ? ` stroke-dasharray="${kind.dash}"` : "";
  return `<polygon class="region${selected}" data-hit="region" data-id="${region.id}" points="${pointsAttr( region.points )}" ` +
    `fill="${ballFill( region.ball )}" fill-opacity="${opacity}" stroke="${ballColor( region.ball )}" stroke-width="${kind.strokeWidth}"${dash}/>`;
}

// A target is a ball-sized ring where the cue ball should end up, edged in the
// same color as the ball's zones.
function handMarkup( id, hand ) {
  const selected = isSelected( "hand", id ) ? `<circle class="selected-ring" cx="${round( hand.x )}" cy="${round( hand.y )}" r="${BALL_RADIUS + 0.6}"/>` : "";
  return `<circle class="hand-marker" data-hit="hand" data-id="${id}" cx="${round( hand.x )}" cy="${round( hand.y )}" r="${BALL_RADIUS - 0.25}" ` +
    `fill="${CUE_COLOR}" fill-opacity="0.55" stroke="${ballColor( id )}" stroke-width="0.5"/>${selected}`;
}

function arrowParts( a, b, width ) {
  const length = distance( a, b );
  if ( length < 0.01 ) return { end: b, head: "" };
  const ux = ( b.x - a.x ) / length;
  const uy = ( b.y - a.y ) / length;
  const headLength = Math.min( width * 4.75, length * 0.6 );
  const halfWidth = headLength * 0.5;
  const base = { x: b.x - ux * headLength, y: b.y - uy * headLength };
  const corners = [b, { x: base.x - uy * halfWidth, y: base.y + ux * halfWidth }, { x: base.x + uy * halfWidth, y: base.y - ux * halfWidth }];
  // stop the shaft inside the head so the round cap doesn't poke past the tip
  return { end: { x: base.x + ux * 0.2, y: base.y + uy * 0.2 }, head: pointsAttr( corners ) };
}

function lineMarkup( line, hit = true ) {
  // lines from before the width option are medium
  const width = LINE_WIDTHS[line.width] ?? LINE_WIDTHS.medium;
  const { end, head } = line.arrow ? arrowParts( line.a, line.b, width ) : { end: line.b, head: "" };
  let markup = `<line class="line-visual" x1="${round( line.a.x )}" y1="${round( line.a.y )}" x2="${round( end.x )}" y2="${round( end.y )}" stroke="${line.color}" stroke-width="${width}"/>`;
  if ( head ) markup += `<polygon class="line-visual" points="${head}" fill="${line.color}"/>`;
  if ( hit ) {
    markup += `<line class="line-hit" data-hit="line" data-id="${line.id}" x1="${line.a.x}" y1="${line.a.y}" x2="${line.b.x}" y2="${line.b.y}" stroke-width="${Math.max( 2, grip( 14 ) )}"/>`;
  }
  return markup;
}

// Where a straight-in shot on this ball aims: the middle of the pocket
// opening. A ball closer to a rail than that middle is played along the rail
// instead, so the aim slides level with the ball on that side.
function pocketAim( ball ) {
  const pocket = POCKETS.find( p => p.id === ball.pocket );
  if ( !pocket ) return null;
  const { aim, corner } = pocket;
  if ( !corner ) return aim;
  return {
    x: Math.abs( ball.x - corner.x ) < Math.abs( aim.x - corner.x ) ? ball.x : aim.x,
    y: Math.abs( ball.y - corner.y ) < Math.abs( aim.y - corner.y ) ? ball.y : aim.y
  };
}

// Unit vector from the pocket's aim back through the ball: the cue ball's side.
function awayFromPocket( ball ) {
  const aim = pocketAim( ball );
  if ( !aim ) return null;
  const length = distance( ball, aim );
  if ( length < 0.01 ) return null;
  return { x: ( ball.x - aim.x ) / length, y: ( ball.y - aim.y ) / length };
}

// The line the cue ball travels on for a straight-in shot: from the back of
// the object ball, directly away from the pocket, to where the cue ball would
// meet the cushion.
function pocketLineMarkup( id, ball ) {
  const away = awayFromPocket( ball );
  if ( !away ) return "";
  const ux = away.x;
  const uy = away.y;
  const limits = [];
  if ( ux > 0 ) limits.push( ( CLOTH_WIDTH - BALL_RADIUS - ball.x ) / ux );
  if ( ux < 0 ) limits.push( ( BALL_RADIUS - ball.x ) / ux );
  if ( uy > 0 ) limits.push( ( CLOTH_HEIGHT - BALL_RADIUS - ball.y ) / uy );
  if ( uy < 0 ) limits.push( ( BALL_RADIUS - ball.y ) / uy );
  const reach = Math.max( 0, Math.min( ...limits ) );
  if ( reach <= BALL_RADIUS ) return "";
  const coords = `x1="${round( ball.x + ux * BALL_RADIUS )}" y1="${round( ball.y + uy * BALL_RADIUS )}" ` +
    `x2="${round( ball.x + ux * reach )}" y2="${round( ball.y + uy * reach )}"`;
  return `<line class="pocket-line" ${coords} stroke="${ballColor( id )}" stroke-opacity="0.75" stroke-width="0.22" stroke-dasharray="0.01 0.65"/>`;
}

// Where the cue ball's center is at contact: one ball width behind the object
// ball, directly away from its pocket. Movement paths start here.
function ghostBall( ball ) {
  const away = awayFromPocket( ball );
  if ( !away ) return null;
  return {
    x: ball.x + away.x * 2 * BALL_RADIUS,
    y: ball.y + away.y * 2 * BALL_RADIUS
  };
}

// Where the cue ball touches the cushion nearest p: its center sits one radius
// in from the cloth edge.
function toRail( p ) {
  const sides = [
    { side: "left", over: -p.x },
    { side: "right", over: p.x - CLOTH_WIDTH },
    { side: "top", over: -p.y },
    { side: "bottom", over: p.y - CLOTH_HEIGHT }
  ];
  const { side } = sides.reduce( ( best, next ) => next.over > best.over ? next : best );
  const inside = clampToCloth( p, BALL_RADIUS );
  if ( side === "left" ) return { x: BALL_RADIUS, y: inside.y, rail: true };
  if ( side === "right" ) return { x: CLOTH_WIDTH - BALL_RADIUS, y: inside.y, rail: true };
  if ( side === "top" ) return { x: inside.x, y: BALL_RADIUS, rail: true };
  return { x: inside.x, y: CLOTH_HEIGHT - BALL_RADIUS, rail: true };
}

const toFinal = p => ( { ...clampToCloth( p, BALL_RADIUS ), rail: false } );

// The cue ball's route after contact: from the ghost ball, off any rails, to a
// ball-sized ring where it stops.
function pathMarkup( id, start, points, hit = true ) {
  const color = ballColor( id );
  const route = [start, ...points];
  const last = route[route.length - 1];
  const previous = route[route.length - 2];
  const gap = previous ? distance( previous, last ) : 0;
  // stop the line at the edge of the stopping ring
  const end = gap > BALL_RADIUS
    ? { x: last.x - ( last.x - previous.x ) / gap * BALL_RADIUS, y: last.y - ( last.y - previous.y ) / gap * BALL_RADIUS }
    : last;
  const width = isSelected( "path", id ) ? 0.3 : 0.18;
  let markup = `<circle class="path-visual" cx="${round( start.x )}" cy="${round( start.y )}" r="${BALL_RADIUS}" fill="none" stroke="${color}" stroke-width="0.15" stroke-dasharray="0.45 0.3"/>`;
  if ( route.length > 1 ) {
    markup += `<polyline class="path-visual" points="${pointsAttr( [...route.slice( 0, -1 ), end] )}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
    markup += `<circle class="path-visual" cx="${round( last.x )}" cy="${round( last.y )}" r="${BALL_RADIUS - width / 2}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  }
  if ( hit ) {
    markup += `<polyline class="line-hit" data-hit="path" data-id="${id}" points="${pointsAttr( route )}" stroke-width="${Math.max( 1.5, grip( 12 ) )}"/>`;
  }
  return markup;
}

// ---------- render ----------

function render() {
  const ballId = currentBall();

  const regions = KIND_ORDER
    .filter( kind => settings.show[kind] )
    .flatMap( kind => board.regions.filter( region => region.kind === kind ) )
    .map( regionMarkup ).join( "" );
  const hands = settings.show.hand
    ? Object.entries( board.balls ).filter( ( [, ball] ) => ball.hand ).map( ( [id, ball] ) => handMarkup( id, ball.hand ) ).join( "" )
    : "";
  const paths = settings.show.path
    ? Object.entries( board.balls ).map( ( [id, ball] ) => {
      const start = ball.path && ghostBall( ball );
      return start ? pathMarkup( id, start, ball.path ) : "";
    } ).join( "" )
    : "";
  layers.regions.innerHTML = regions + hands + paths;

  layers.lines.innerHTML = board.lines.map( line => lineMarkup( line ) ).join( "" );

  layers.pocketLines.innerHTML = settings.pocketLines
    ? Object.entries( board.balls ).filter( ( [, ball] ) => ball.pocket ).map( ( [id, ball] ) => pocketLineMarkup( id, ball ) ).join( "" )
    : "";

  const chosenPocket = ballId ? board.balls[ballId].pocket : null;
  layers.pockets.innerHTML = POCKETS.map( p => {
    const state = !ballId ? "" : p.id === chosenPocket ? " armed chosen" : " armed";
    return `<circle class="pocket-hit${state}" data-hit="pocket" data-id="${p.id}" cx="${p.draw.x}" cy="${p.draw.y}" r="${p.radius + 0.8}"/>`;
  } ).join( "" );

  layers.balls.innerHTML = BALL_IDS.filter( id => board.balls[id] ).map( id => {
    const ball = board.balls[id];
    const offTable = drag?.type === "ball" && drag.id === id && drag.outside ? "ball-off-table" : "";
    const ring = id === ballId || isSelected( "ball", id )
      ? `<circle class="selected-ring${id === ballId ? " current" : ""}" r="${BALL_RADIUS + 0.5}"/>`
      : "";
    // on end, the ball turns back so its number stays upright
    const turn = ui.portrait ? " rotate(-90)" : "";
    const reach = grip( 9 );
    const fingerHit = reach > BALL_RADIUS ? `<circle r="${round( reach )}" fill="transparent"/>` : "";
    return `<g class="${offTable}" data-hit="ball" data-id="${id}" transform="translate(${round( ball.x )} ${round( ball.y )})${turn}">${fingerHit}${ballMarkup( id )}${ring}</g>`;
  } ).join( "" );

  layers.handles.innerHTML = handlesMarkup();
  renderDraft();
  renderTray();
  renderControls();
  if ( !drag ) saveBoard();
}

// Points and edge grips for the selected shape: the edges take clicks (add a
// point) and drags (shift that side), the points take drags and nudges.
// A grip point: the dot you see, over a wider invisible target for a finger.
function handleMarkup( hitAttributes, p, extraClass = "" ) {
  const at = `cx="${round( p.x )}" cy="${round( p.y )}"`;
  const reach = grip( 12 );
  const radius = pixels( coarseQuery.matches ? 8 : 6 );
  const fingerHit = reach > radius * 1.5 ? `<circle class="handle-hit" ${hitAttributes} ${at} r="${reach}"/>` : "";
  return `${fingerHit}<circle class="handle${extraClass}" ${hitAttributes} ${at} r="${radius}"/>`;
}

function handlesMarkup() {
  const selection = ui.selection;
  if ( selection?.type === "region" ) {
    const region = findRegion( selection.id );
    if ( !region || !settings.show[region.kind] ) return "";
    const points = region.points;
    const edges = points.map( ( a, index ) => {
      const b = points[( index + 1 ) % points.length];
      return `<line class="edge-hit" data-hit="edge" data-id="${region.id}" data-index="${index}" ` +
        `x1="${round( a.x )}" y1="${round( a.y )}" x2="${round( b.x )}" y2="${round( b.y )}" stroke-width="${grip( 12 )}"/>`;
    } ).join( "" );
    const handles = points.map( ( p, index ) => {
      const chosen = ui.point?.region === region.id && ui.point.index === index ? " chosen" : "";
      return handleMarkup( `data-hit="vertex" data-id="${region.id}" data-index="${index}"`, p, chosen );
    } ).join( "" );
    return edges + handles;
  }
  if ( selection?.type === "path" ) {
    const path = board.balls[selection.id]?.path;
    if ( !path || !settings.show.path ) return "";
    return path.map( ( p, index ) =>
      handleMarkup( `data-hit="path-point" data-id="${selection.id}" data-index="${index}"`, p ) ).join( "" );
  }
  if ( selection?.type === "line" ) {
    const line = findLine( selection.id );
    if ( !line ) return "";
    return ["a", "b"].map( end =>
      handleMarkup( `data-hit="line-end" data-id="${line.id}" data-end="${end}"`, line[end] ) ).join( "" );
  }
  return "";
}

function renderDraft() {
  const draft = ui.draft;
  svg.classList.toggle( "drawing", ui.mode === "ball" && ui.tool !== "select" );
  svg.classList.toggle( "mode-ball", ui.mode === "ball" );
  svg.classList.toggle( "mode-line", ui.mode === "line" );
  if ( !draft ) {
    layers.draft.innerHTML = "";
    return;
  }
  if ( draft.type === "line" ) {
    const end = draft.awaitingEnd ? ui.cursor ?? draft.a : draft.b;
    layers.draft.innerHTML = lineMarkup( { a: draft.a, b: end, color: settings.lineColor, arrow: settings.lineArrow, width: settings.lineWidth }, false );
    return;
  }
  if ( draft.type === "path" ) {
    const start = ghostBall( board.balls[draft.ball] );
    const cursor = ui.cursor && isOnTable( ui.cursor ) ? ( isOnCloth( ui.cursor ) ? toFinal( ui.cursor ) : toRail( ui.cursor ) ) : null;
    const points = cursor ? [...draft.points, cursor] : draft.points;
    layers.draft.innerHTML = pathMarkup( draft.ball, start, points, false ) +
      draft.points.map( p => `<circle class="handle" cx="${round( p.x )}" cy="${round( p.y )}" r="${pixels( 5 )}"/>` ).join( "" );
    return;
  }
  const color = ballColor( draft.ball );
  const points = draft.points;
  const radius = pixels( 5 );
  const cursor = ui.cursor ? clampToCloth( ui.cursor ) : null;
  const path = cursor ? [...points, cursor] : points;
  let markup = path.length > 1
    ? `<polyline points="${pointsAttr( path )}" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="0.3" stroke-dasharray="0.8 0.5"/>`
    : "";
  markup += points.map( ( p, index ) => {
    const closing = index === 0 && points.length >= 3 ? " closing" : "";
    return `<circle class="handle${closing}" cx="${round( p.x )}" cy="${round( p.y )}" r="${closing ? radius * 1.5 : radius}"/>`;
  } ).join( "" );
  layers.draft.innerHTML = markup;
}

function renderTray() {
  const ballId = currentBall();
  tray.innerHTML = BALL_IDS.map( id => {
    const classes = ["tray-ball"];
    if ( board.balls[id] ) classes.push( "placed" );
    if ( id === ballId || id === ui.placing ) classes.push( "selected" );
    const title = board.balls[id] ? `${ballName( id )} is on the table: click to select it` : `Drag the ${ballName( id )} onto the table`;
    return `<button type="button" class="${classes.join( " " )}" data-ball="${id}" title="${title}" aria-label="${ballName( id )}">` +
      `<svg viewBox="-1.25 -1.25 2.5 2.5">${ballMarkup( id )}</svg></button>`;
  } ).join( "" );
}

function renderControls() {
  const ballId = currentBall();
  const hasGood = Boolean( ballId && regionFor( ballId, "good" ) );
  for ( const button of document.querySelectorAll( "[data-mode]" ) ) button.classList.toggle( "active", button.dataset.mode === ui.mode );
  document.getElementById( "ball-strip" ).hidden = ui.mode !== "ball";
  document.getElementById( "line-strip" ).hidden = ui.mode !== "line";

  document.getElementById( "hotkeys" ).innerHTML = ui.mode === "ball"
    ? "With the mouse on the table: <kbd>Z</kbd> set zone · <kbd>W</kbd> widen · <kbd>M</kbd> movement · <kbd>G</kbd> draw a zone by hand · click a pocket for the pocket line"
    : "Drag to draw a line, or click its start then its end · click a line to edit it";
  renderActions();

  const ball = ballId ? board.balls[ballId] : null;
  const hasOk = Boolean( ballId && regionFor( ballId, "ok" ) );
  document.getElementById( "ball-strip" ).style.setProperty( "--ball", ballId ? ballColor( ballId ) : "#666" );
  const isCue = ui.selection?.type === "ball" && ui.selection.id === "cue";
  document.getElementById( "current-ball" ).innerHTML = ballId
    ? `<svg viewBox="-1.25 -1.25 2.5 2.5">${ballMarkup( ballId )}</svg><span>${ballName( ballId )}</span>`
    : isCue
      ? `<svg viewBox="-1.25 -1.25 2.5 2.5">${ballMarkup( "cue" )}</svg><span>Cue ball <span class="muted">(nothing to plan)</span></span>`
      : `<span class="muted">No ball selected</span>`;
  const pocketName = document.getElementById( "pocket-name" );
  pocketName.textContent = ball?.pocket ? POCKET_NAMES[ball.pocket] : ballId ? "click a pocket" : "none";
  pocketName.classList.toggle( "muted", !ball?.pocket );
  document.getElementById( "clear-pocket" ).disabled = !ball?.pocket;
  const parts = { zone: Boolean( ball?.hand || hasGood ), ok: hasOk, path: Boolean( ball?.path ) };
  for ( const [part, isSet] of Object.entries( parts ) ) {
    document.getElementById( `item-${part}` ).classList.toggle( "unset", !isSet );
    document.getElementById( `clear-${part}` ).disabled = !isSet;
  }
  document.getElementById( "clear-zones" ).disabled = !( parts.zone || parts.ok || parts.path );

  const selectedLine = ui.selection?.type === "line" ? findLine( ui.selection.id ) : null;
  const activeColor = selectedLine?.color ?? settings.lineColor;
  for ( const swatch of document.querySelectorAll( ".line-swatch" ) ) {
    swatch.classList.toggle( "active", swatch.dataset.color === activeColor );
  }
  document.getElementById( "line-custom-color" ).value = activeColor;
  document.getElementById( "line-arrow" ).checked = selectedLine ? Boolean( selectedLine.arrow ) : settings.lineArrow;
  document.getElementById( "delete-line" ).disabled = !selectedLine;
  const activeWidth = selectedLine ? ( LINE_WIDTHS[selectedLine.width] ? selectedLine.width : "medium" ) : settings.lineWidth;
  for ( const button of document.querySelectorAll( "[data-width]" ) ) button.classList.toggle( "active", button.dataset.width === activeWidth );

  const lockButton = document.getElementById( "lock-balls" );
  lockButton.classList.toggle( "active", board.locked );
  lockButton.setAttribute( "aria-pressed", String( board.locked ) );
  lockButton.innerHTML = board.locked ? "🔒 Balls locked" : "🔓 Lock balls";
  lockButton.title = board.locked
    ? "The balls can't be moved, added or removed. Click to unlock them."
    : "Lock the balls in place so planning can't move them by accident";
  svg.classList.toggle( "balls-locked", board.locked );
  document.getElementById( "undo" ).disabled = !undoStack.length;
  document.getElementById( "redo" ).disabled = !redoStack.length;
  document.getElementById( "show-pocket-lines" ).checked = settings.pocketLines;
  for ( const box of document.querySelectorAll( "[data-show]" ) ) box.checked = settings.show[box.dataset.show];

  statusText.textContent = ui.message || hint();
}

// The keys as buttons, for touch screens: a tool button arms the tool and the
// next tap on the table does it.
const TOOL_BUTTONS = [
  { tool: "hand", label: "Set zone", key: "Z" },
  { tool: "widen", label: "Widen", key: "W" },
  { tool: "path", label: "Movement", key: "M" },
  { tool: "good", label: "Draw zone", key: "G" }
];

function renderActions() {
  const draft = ui.draft;
  const button = ( action, label, { active = false, disabled = false, title = "" } = {} ) =>
    `<button type="button" data-action="${action}"${active ? ` class="active"` : ""}${disabled ? " disabled" : ""}${title ? ` title="${title}"` : ""}>${label}</button>`;
  const parts = [];
  if ( ui.mode === "ball" ) {
    const hasBall = Boolean( currentBall() );
    parts.push( TOOL_BUTTONS.map( item => button( `tool-${item.tool}`, item.label,
      { active: ui.tool === item.tool, disabled: !hasBall, title: `${item.label} (${item.key})` } ) ).join( "" ) );
    if ( draft?.type === "region" ) {
      parts.push( button( "finish", "Done", { disabled: draft.points.length < 3, title: "Close the zone (Enter)" } ) );
    }
    if ( draft?.type === "region" || draft?.type === "path" ) {
      parts.push( button( "back", draft.type === "path" ? "Undo bounce" : "Undo corner", { disabled: !draft.points.length, title: "Backspace" } ) );
    }
  }
  const isBusy = Boolean( draft || ui.placing || ( ui.mode === "ball" && ui.tool !== "select" ) );
  const hasSelection = Boolean( ui.point || ui.selection );
  if ( !isBusy ) parts.push( button( "delete", "Delete", { disabled: !hasSelection, title: "Remove the selected item (Delete)" } ) );
  parts.push( isBusy
    ? button( "escape", "Cancel", { title: "Esc" } )
    : button( "escape", "Deselect", { disabled: !hasSelection && !currentBall(), title: "Esc" } ) );
  document.getElementById( "actions" ).innerHTML = parts.join( `<span class="actions-gap"></span>` );
}

function hint() {
  const ballId = currentBall();
  const draft = ui.draft;
  if ( ui.placing ) return `Tap the table where the ${ballName( ui.placing )} goes.`;
  if ( draft?.type === "region" ) {
    return draft.points.length < 3
      ? `Good shape for the ${ballName( draft.ball )}: click each corner on the cloth. Esc cancels.`
      : `Good shape for the ${ballName( draft.ball )}: keep adding corners, then click the first corner, double-click or press Enter to close it. Backspace removes the last corner.`;
  }
  if ( draft?.type === "path" ) {
    return draft.points.length
      ? "Click a rail for another bounce, or click the cloth where the cue ball stops. Backspace removes the last bounce, Esc cancels."
      : `Movement for the ${ballName( draft.ball )}: click the cloth where the cue ball stops, or click a rail for the first bounce. Esc cancels.`;
  }
  if ( draft?.type === "line" && draft.awaitingEnd ) return "Click where the line ends. Esc cancels.";
  if ( ui.mode === "line" ) {
    return ui.selection?.type === "line"
      ? "Line selected. Drag it, or drag its ends. Pick a color or the arrow to restyle it. Delete removes it. B goes back to the balls."
      : "Lines: drag across the table to draw one, or click the start and then the end. Click a line to edit it. B goes back to the balls.";
  }
  if ( ui.tool === "hand" ) return `Click where the cue ball should end up for the ${ballName( ballId )}.`;
  if ( ui.tool === "widen" ) return "Click outside the good shape to widen or lengthen the OK shape toward that spot.";

  const selection = ui.selection;
  if ( ui.point ) return "Point selected. Drag it, or nudge it with the arrow keys (Shift for bigger steps). Delete removes it.";
  if ( selection?.type === "region" ) {
    const region = findRegion( selection.id );
    return `${REGION_KINDS[region.kind].label} for the ${ballName( region.ball )}. Drag a point to move it, click an edge to add a point, drag an edge to shift that side.` +
      ( region.kind === "good" ? " W with the mouse outside it widens the OK shape." : "" );
  }
  if ( selection?.type === "path" ) return `Movement for the ${ballName( selection.id )}. Drag its points: bounces stay on the rails. Press M to draw it again. Delete removes it.`;
  if ( selection?.type === "hand" ) return "Target. Drag it or nudge it with the arrow keys. Press Z over the table to set the zone again. Delete removes it.";
  if ( selection?.type === "ball" && selection.id === "cue" ) return "Cue ball selected. Drag to move it. Delete or double-click returns it to the tray.";
  if ( ballId ) {
    return `${ballName( ballId )} selected. Click a pocket for its pocket line. With the mouse on the table, Z sets its zone, W widens it toward the mouse, and M draws the cue ball's movement.`;
  }
  if ( !Object.keys( board.balls ).length ) return "Drag balls from the tray onto the table, or tap one and then tap the table. Help (F1) explains the rest.";
  return "Click a ball to select it.";
}

// ---------- actions ----------

function setMode( mode ) {
  ui.mode = mode;
  ui.tool = "select";
  ui.draft = null;
  ui.point = null;
  ui.placing = null;
  ui.message = "";
  if ( ( ui.selection?.type === "line" ) !== ( mode === "line" ) ) ui.selection = null;
  render();
}

function setTool( tool ) {
  ui.message = "";
  ui.draft = null;
  ui.placing = null;
  if ( ui.mode !== "ball" ) {
    ui.mode = "ball";
    if ( ui.selection?.type === "line" ) ui.selection = null;
  }
  const ballId = currentBall();
  if ( ( tool === "hand" || tool === "good" || tool === "widen" || tool === "path" ) && !ballId ) {
    ui.tool = "select";
    ui.message = "Select an object ball first.";
  } else if ( tool === "path" && !board.balls[ballId].pocket ) {
    ui.tool = "select";
    ui.message = `Pick the ${ballName( ballId )}'s pocket first: the movement starts from the ghost ball.`;
  } else if ( tool === "widen" && !regionFor( ballId, "good" ) ) {
    ui.tool = "select";
    ui.message = `The ${ballName( ballId )} needs a zone first: press Z with the mouse where the cue ball should end up.`;
  } else {
    ui.tool = tool;
    if ( tool === "good" ) ui.draft = { type: "region", kind: "good", ball: ballId, points: [] };
    if ( tool === "path" ) ui.draft = { type: "path", ball: ballId, points: [] };
  }
  render();
}

// H and W act at the mouse when it is over the cloth; otherwise they arm the
// tool so the next click on the table does it.
function keyAction( tool, action ) {
  if ( isOnCloth( ui.cursor ) && currentBall() && !drag ) {
    ui.message = "";
    if ( ui.mode !== "ball" ) setMode( "ball" );
    action( ui.cursor );
  } else {
    setTool( tool );
  }
}

function replaceRegion( ball, kind, points ) {
  board.regions = board.regions.filter( region => !( region.ball === ball && region.kind === kind ) );
  const region = { id: newId(), ball, kind, points };
  board.regions.push( region );
  return region;
}

// Target at p, plus a fresh good zone around it: a trapezoid along the
// line from the marker to the object ball, its narrow near edge halfway to the
// ball and its far edge, twice as wide, the same distance behind the marker.
function placeHand( p ) {
  const ballId = currentBall();
  const ball = board.balls[ballId];
  const hand = clampToCloth( p, BALL_RADIUS );
  const gap = distance( hand, ball );
  if ( gap < 4 * BALL_RADIUS ) {
    ui.message = "That's too close to the object ball for a target.";
    ui.tool = "select";
    render();
    return;
  }
  pushUndo();
  ball.hand = hand;
  const along = { x: ( ball.x - hand.x ) / gap, y: ( ball.y - hand.y ) / gap };
  const across = { x: -along.y, y: along.x };
  const half = gap / 2;
  const nearHalfWidth = Math.max( ZONE_MIN_NEAR_WIDTH, gap * ZONE_NEAR_WIDTH_RATIO ) / 2;
  const at = ( forward, sideways ) => clampToCloth( {
    x: hand.x + along.x * forward + across.x * sideways,
    y: hand.y + along.y * forward + across.y * sideways
  } );
  const zone = replaceRegion( ballId, "good", [
    at( half, nearHalfWidth ),
    at( -half, 2 * nearHalfWidth ),
    at( -half, -2 * nearHalfWidth ),
    at( half, -nearHalfWidth )
  ] );
  settings.show.hand = settings.show.good = true;
  saveSettings();
  ui.tool = "select";
  ui.selection = { type: "region", id: zone.id };
  ui.point = null;
  render();
}

// The OK shape is the good shape pushed out toward p. The side of the shape
// nearest p gets two new corners level with p; a side that was already pushed
// out just moves out to p. Where a corner of that side was already widened in
// another direction, the new corner is pushed out from the widened corner
// instead, and the old inner corner drops out, so two widenings make one
// bigger shape rather than a notched one.
function widenOk( p ) {
  const ballId = currentBall();
  const good = regionFor( ballId, "good" );
  if ( !good ) return;
  const ok = regionFor( ballId, "ok" );
  const base = ok ?? good;
  const points = base.points.map( q => ( { ...q } ) );
  const edge = nearestEdge( points, p );
  const a = points[edge.index];
  const nextIndex = ( edge.index + 1 ) % points.length;
  const b = points[nextIndex];
  const normal = outwardNormal( points, a, b );
  const push = ( p.x - a.x ) * normal.x + ( p.y - a.y ) * normal.y;
  if ( push <= 0.1 ) {
    ui.message = "Point outside the shape, on the side you want to widen.";
    ui.tool = "select";
    render();
    return;
  }
  pushUndo();
  // move q along the side's normal onto the line through p parallel to the side
  const pushed = q => {
    const step = Math.max( 0, ( p.x - q.x ) * normal.x + ( p.y - q.y ) * normal.y );
    return clampToCloth( { x: q.x + normal.x * step, y: q.y + normal.y * step } );
  };
  const isGoodCorner = q => good.points.some( g => distance( g, q ) < 0.01 );
  if ( isGoodCorner( a ) && isGoodCorner( b ) ) {
    const count = points.length;
    const previous = points[( edge.index - 1 + count ) % count];
    const next = points[( nextIndex + 1 ) % count];
    const widenedBefore = ok && !isGoodCorner( previous );
    const widenedAfter = ok && !isGoodCorner( next );
    const replacement = [
      ...( widenedBefore ? [pushed( previous )] : [a, pushed( a )] ),
      ...( widenedAfter ? [pushed( next )] : [pushed( b ), b] )
    ];
    if ( nextIndex === 0 ) {
      // the side wraps from the last point to the first
      points.splice( edge.index, 1, ...replacement );
      points.shift();
    } else {
      points.splice( edge.index, 2, ...replacement );
    }
  } else {
    points[edge.index] = pushed( a );
    points[nextIndex] = pushed( b );
  }
  const region = ok ?? replaceRegion( ballId, "ok", points );
  region.points = points;
  settings.show.ok = true;
  saveSettings();
  ui.tool = "select";
  ui.selection = { type: "region", id: region.id };
  ui.point = null;
  render();
}

function finishRegion() {
  const draft = ui.draft;
  if ( draft?.type !== "region" || draft.points.length < 3 ) return;
  pushUndo();
  const region = replaceRegion( draft.ball, draft.kind, draft.points );
  ui.draft = null;
  ui.tool = "select";
  ui.selection = { type: "region", id: region.id };
  ui.point = null;
  render();
}

// A rail click adds a bounce and keeps going; a cloth click is where the cue
// ball stops, which ends the path.
function pathDraftClick( p ) {
  const draft = ui.draft;
  if ( !isOnTable( p ) ) return;
  if ( isOnCloth( p ) ) {
    pushUndo();
    board.balls[draft.ball].path = [...draft.points, toFinal( p )];
    ui.draft = null;
    ui.tool = "select";
    ui.selection = { type: "path", id: draft.ball };
    render();
    return;
  }
  draft.points.push( toRail( p ) );
  renderDraft();
  renderControls();
}

function regionDraftClick( p, isDouble ) {
  const draft = ui.draft;
  const points = draft.points;
  const point = clampToCloth( p );
  const closeDistance = pixels( 10 );
  if ( points.length >= 3 && ( isDouble || distance( point, points[0] ) < closeDistance ) ) {
    finishRegion();
    return;
  }
  if ( points.length && distance( point, points[points.length - 1] ) < closeDistance ) return;
  points.push( point );
  renderDraft();
  renderControls();
}

function commitLine( a, b ) {
  pushUndo();
  const line = { id: newId(), color: settings.lineColor, arrow: settings.lineArrow, width: settings.lineWidth, a, b };
  board.lines.push( line );
  ui.draft = null;
  ui.selection = { type: "line", id: line.id };
  render();
}

const LOCKED_MESSAGE = "The balls are locked. Unlock them (the button by Balls and Lines) to move, add or remove them.";

function isLockedOut() {
  if ( !board.locked ) return false;
  ui.message = LOCKED_MESSAGE;
  render();
  return true;
}

function removeBall( id ) {
  if ( isLockedOut() ) return;
  pushUndo();
  delete board.balls[id];
  board.regions = board.regions.filter( region => region.ball !== id );
  if ( ui.ball === id ) ui.ball = null;
  ui.selection = null;
  ui.point = null;
  render();
}

function deletePoint( regionId, index ) {
  const region = findRegion( regionId );
  if ( region.points.length <= 3 ) {
    ui.message = "A shape needs at least three points.";
    render();
    return;
  }
  pushUndo();
  region.points.splice( index, 1 );
  ui.point = null;
  render();
}

function deleteSelection() {
  if ( ui.point ) {
    deletePoint( ui.point.region, ui.point.index );
    return;
  }
  const selection = ui.selection;
  if ( !selection ) return;
  if ( selection.type === "ball" ) {
    removeBall( selection.id );
    return;
  }
  pushUndo();
  if ( selection.type === "hand" ) board.balls[selection.id].hand = null;
  if ( selection.type === "path" ) board.balls[selection.id].path = null;
  if ( selection.type === "region" ) board.regions = board.regions.filter( region => region.id !== selection.id );
  if ( selection.type === "line" ) board.lines = board.lines.filter( line => line.id !== selection.id );
  ui.selection = null;
  render();
}

function pocketClick( pocketId ) {
  const ballId = currentBall();
  if ( !ballId ) {
    ui.message = "Select an object ball first, then click the pocket it goes in.";
    render();
    return;
  }
  pushUndo();
  const ball = board.balls[ballId];
  ball.pocket = ball.pocket === pocketId ? null : pocketId;
  render();
}

function insertPoint( regionId, edgeIndex, p ) {
  const region = findRegion( regionId );
  const points = region.points;
  const a = points[edgeIndex];
  const b = points[( edgeIndex + 1 ) % points.length];
  const onEdge = nearestEdge( [a, b], p ).point;
  pushUndo();
  points.splice( edgeIndex + 1, 0, onEdge );
  ui.point = { region: regionId, index: edgeIndex + 1 };
  render();
}

function nudge( dx, dy ) {
  if ( ui.point ) {
    const region = findRegion( ui.point.region );
    pushUndo();
    const p = region.points[ui.point.index];
    region.points[ui.point.index] = clampToCloth( { x: p.x + dx, y: p.y + dy } );
  } else if ( ui.selection?.type === "hand" ) {
    const ball = board.balls[ui.selection.id];
    pushUndo();
    ball.hand = clampToCloth( { x: ball.hand.x + dx, y: ball.hand.y + dy }, BALL_RADIUS );
  } else {
    return false;
  }
  render();
  return true;
}

// ---------- pointer handling ----------

function isDoubleDown( event ) {
  const isDouble = event.timeStamp - lastDown.time < DOUBLE_CLICK_MS &&
    Math.hypot( event.clientX - lastDown.x, event.clientY - lastDown.y ) < 6;
  lastDown = isDouble ? { time: 0, x: 0, y: 0 } : { time: event.timeStamp, x: event.clientX, y: event.clientY };
  return isDouble;
}

function startDrag( details ) {
  drag = { ...details, moved: false };
  render();
}

svg.addEventListener( "pointerdown", event => {
  if ( event.button !== 0 ) return;
  event.preventDefault();
  ui.message = "";
  const p = toBoard( event );
  ui.cursor = p;
  const isDouble = isDoubleDown( event );

  if ( ui.placing ) {
    if ( isOnTable( p ) ) placeBall( ui.placing, p );
    return;
  }

  if ( ui.draft?.type === "region" ) {
    regionDraftClick( p, isDouble );
    return;
  }
  if ( ui.draft?.type === "path" ) {
    pathDraftClick( p );
    return;
  }
  if ( ui.tool === "hand" || ui.tool === "widen" ) {
    if ( !isOnCloth( p ) ) return;
    if ( ui.tool === "hand" ) placeHand( p );
    else widenOk( p );
    return;
  }
  const hit = event.target.closest( "[data-hit]" );
  if ( ui.mode === "line" ) {
    lineModeDown( hit, p );
    return;
  }

  const id = hit?.dataset.id;
  const index = Number( hit?.dataset.index );
  if ( hit?.dataset.hit !== "vertex" && hit?.dataset.hit !== "edge" ) ui.point = null;
  switch ( hit?.dataset.hit ) {
    case "vertex":
      if ( isDouble ) {
        deletePoint( id, index );
        break;
      }
      ui.point = { region: id, index };
      startDrag( { type: "vertex", id, index, start: p, origin: { ...findRegion( id ).points[index] } } );
      break;
    case "edge": {
      ui.point = null;
      const points = findRegion( id ).points;
      const nextIndex = ( index + 1 ) % points.length;
      startDrag( { type: "edge", id, index, nextIndex, start: p, origin: [{ ...points[index] }, { ...points[nextIndex] }] } );
      break;
    }
    case "ball":
      if ( isDouble ) {
        removeBall( id );
        break;
      }
      setBall( id );
      ui.selection = { type: "ball", id };
      // a locked ball still selects; dragging it only says why it won't move
      startDrag( board.locked
        ? { type: "locked-ball", start: p }
        : { type: "ball", id, start: p, origin: { x: board.balls[id].x, y: board.balls[id].y } } );
      break;
    case "path":
      setBall( id );
      ui.selection = { type: "path", id };
      render();
      break;
    case "path-point":
      startDrag( { type: "path-point", id, index, start: p } );
      break;
    case "hand":
      setBall( id );
      ui.selection = { type: "hand", id };
      startDrag( { type: "hand", id, start: p, origin: { ...board.balls[id].hand } } );
      break;
    case "pocket":
      pocketClick( id );
      break;
    case "region":
      // zones only change through their points and edges, so a click just selects
      setBall( findRegion( id ).ball );
      ui.selection = { type: "region", id };
      render();
      break;
    default:
      // empty table: drop the selected item but keep the selected ball
      ui.selection = null;
      render();
  }
} );

// In line mode a click picks up a line or one of its ends; anywhere else starts a new line.
function lineModeDown( hit, p ) {
  const id = hit?.dataset.id;
  if ( ui.draft?.awaitingEnd ) {
    commitLine( ui.draft.a, p );
  } else if ( hit?.dataset.hit === "line-end" ) {
    startDrag( { type: "line-end", id, end: hit.dataset.end, start: p } );
  } else if ( hit?.dataset.hit === "line" ) {
    const line = findLine( id );
    ui.selection = { type: "line", id };
    startDrag( { type: "line", id, start: p, origin: { a: { ...line.a }, b: { ...line.b } } } );
  } else {
    ui.selection = null;
    ui.draft = { type: "line", a: p, b: p, awaitingEnd: false };
    startDrag( { type: "line-draft", start: p } );
  }
}

// Move a set of points by (dx, dy) without letting any of them leave the cloth.
function shiftPoints( origin, dx, dy ) {
  const xs = origin.map( q => q.x );
  const ys = origin.map( q => q.y );
  const shiftX = clamp( dx, -Math.min( ...xs ), CLOTH_WIDTH - Math.max( ...xs ) );
  const shiftY = clamp( dy, -Math.min( ...ys ), CLOTH_HEIGHT - Math.max( ...ys ) );
  return origin.map( q => ( { x: q.x + shiftX, y: q.y + shiftY } ) );
}

window.addEventListener( "pointermove", event => {
  if ( drag?.type === "tray" ) {
    if ( Math.hypot( event.clientX - drag.startX, event.clientY - drag.startY ) > DRAG_THRESHOLD_PX * 2 ) drag.moved = true;
    moveGhost( event );
    return;
  }
  const p = toBoard( event );
  ui.cursor = p;
  if ( !drag ) {
    if ( ui.draft ) renderDraft();
    return;
  }
  if ( !drag.moved ) {
    if ( distance( p, drag.start ) < pixels( DRAG_THRESHOLD_PX ) ) return;
    drag.moved = true;
    if ( drag.type === "locked-ball" ) {
      ui.message = LOCKED_MESSAGE;
      renderControls();
      return;
    }
    if ( drag.type !== "line-draft" ) pushUndo();
  }
  if ( drag.type === "locked-ball" ) return;
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  switch ( drag.type ) {
    case "ball": {
      const ball = board.balls[drag.id];
      const target = { x: drag.origin.x + dx, y: drag.origin.y + dy };
      drag.outside = !isOnTable( target );
      Object.assign( ball, drag.outside ? target : clampToCloth( target, BALL_RADIUS ) );
      break;
    }
    case "hand":
      board.balls[drag.id].hand = clampToCloth( { x: drag.origin.x + dx, y: drag.origin.y + dy }, BALL_RADIUS );
      break;
    case "vertex":
      findRegion( drag.id ).points[drag.index] = clampToCloth( { x: drag.origin.x + dx, y: drag.origin.y + dy } );
      break;
    case "path-point": {
      // bounces slide along the rails; the stopping point stays on the cloth
      const path = board.balls[drag.id].path;
      path[drag.index] = path[drag.index].rail ? toRail( p ) : toFinal( p );
      break;
    }
    case "edge": {
      // slide the whole side, keeping it parallel to where it was
      const [a, b] = shiftPoints( drag.origin, dx, dy );
      const points = findRegion( drag.id ).points;
      points[drag.index] = a;
      points[drag.nextIndex] = b;
      break;
    }
    case "line": {
      const line = findLine( drag.id );
      line.a = { x: drag.origin.a.x + dx, y: drag.origin.a.y + dy };
      line.b = { x: drag.origin.b.x + dx, y: drag.origin.b.y + dy };
      break;
    }
    case "line-end":
      findLine( drag.id )[drag.end] = p;
      break;
    case "line-draft":
      ui.draft.b = p;
      renderDraft();
      return;
  }
  render();
} );

function endDrag( event, cancelled ) {
  if ( !drag ) return;
  const finished = drag;
  drag = null;
  if ( finished.type === "tray" ) {
    ghost.hidden = true;
    const p = toBoard( event );
    if ( !cancelled && isOnTable( p ) ) {
      placeBall( finished.id, p );
      return;
    }
    // a tap rather than a drag: the next tap on the table places it
    if ( !cancelled && !finished.moved ) ui.placing = finished.id;
  } else if ( finished.type === "edge" && !finished.moved && !cancelled ) {
    // a click on an edge, not a drag: add a point there
    insertPoint( finished.id, finished.index, finished.start );
    return;
  } else if ( finished.type === "line-draft" ) {
    if ( cancelled ) {
      ui.draft = null;
    } else if ( finished.moved && distance( ui.draft.a, ui.draft.b ) > 1 ) {
      commitLine( ui.draft.a, ui.draft.b );
      return;
    } else {
      ui.draft.awaitingEnd = true;
      ui.cursor = toBoard( event );
    }
  } else if ( finished.type === "ball" && finished.outside ) {
    // dropped off the table: back to the tray (the undo snapshot was taken when the drag began)
    delete board.balls[finished.id];
    board.regions = board.regions.filter( region => region.ball !== finished.id );
    if ( ui.ball === finished.id ) ui.ball = null;
    ui.selection = null;
  }
  render();
}

window.addEventListener( "pointerup", event => endDrag( event, false ) );
window.addEventListener( "pointercancel", event => endDrag( event, true ) );

// ---------- tray ----------

function placeBall( id, p ) {
  pushUndo();
  board.balls[id] = { ...clampToCloth( p, BALL_RADIUS ), pocket: null, hand: null, path: null };
  ui.placing = null;
  setBall( id );
  ui.selection = { type: "ball", id };
  render();
}

function moveGhost( event ) {
  const size = 2 * BALL_RADIUS / pixels( 1 );
  ghost.style.width = `${size}px`;
  ghost.style.height = `${size}px`;
  ghost.style.transform = `translate(${event.clientX - size / 2}px, ${event.clientY - size / 2}px)`;
}

tray.addEventListener( "pointerdown", event => {
  const button = event.target.closest( "[data-ball]" );
  if ( !button || event.button !== 0 ) return;
  event.preventDefault();
  const id = button.dataset.ball;
  ui.message = "";
  if ( ui.mode !== "ball" ) setMode( "ball" );
  if ( board.balls[id] ) {
    ui.placing = null;
    setBall( id );
    ui.selection = { type: "ball", id };
    ui.point = null;
    render();
    return;
  }
  if ( isLockedOut() ) return;
  // tapping the ball already waiting to be placed puts it down again
  const wasPlacing = ui.placing === id;
  ui.placing = null;
  ui.draft = null;
  ui.tool = "select";
  if ( wasPlacing ) {
    render();
    return;
  }
  ghost.innerHTML = `<svg viewBox="-1.25 -1.25 2.5 2.5">${ballMarkup( id )}</svg>`;
  ghost.hidden = false;
  moveGhost( event );
  drag = { type: "tray", id, startX: event.clientX, startY: event.clientY, moved: false };
} );

// ---------- toolbar ----------


for ( const button of document.querySelectorAll( "[data-mode]" ) ) {
  button.addEventListener( "click", () => setMode( button.dataset.mode ) );
}

// Clear parts of the selected ball's plan.
function clearForBall( parts ) {
  const ballId = currentBall();
  if ( !ballId ) return;
  const ball = board.balls[ballId];
  pushUndo();
  if ( parts.includes( "pocket" ) ) ball.pocket = null;
  if ( parts.includes( "hand" ) ) ball.hand = null;
  if ( parts.includes( "path" ) ) ball.path = null;
  board.regions = board.regions.filter( region => !( region.ball === ballId && parts.includes( region.kind ) ) );
  if ( ui.selection?.type === "hand" && !ball.hand ) ui.selection = null;
  if ( ui.selection?.type === "path" && !ball.path ) ui.selection = null;
  if ( ui.selection?.type === "region" && !findRegion( ui.selection.id ) ) ui.selection = null;
  if ( ui.point && !findRegion( ui.point.region ) ) ui.point = null;
  render();
}

document.getElementById( "clear-pocket" ).addEventListener( "click", () => clearForBall( ["pocket"] ) );
document.getElementById( "clear-zone" ).addEventListener( "click", () => clearForBall( ["hand", "good"] ) );
document.getElementById( "clear-ok" ).addEventListener( "click", () => clearForBall( ["ok"] ) );
document.getElementById( "clear-path" ).addEventListener( "click", () => clearForBall( ["path"] ) );
document.getElementById( "clear-zones" ).addEventListener( "click", () => clearForBall( ["hand", "good", "ok", "path"] ) );
document.getElementById( "delete-line" ).addEventListener( "click", deleteSelection );

document.getElementById( "line-swatches" ).innerHTML = LINE_COLORS.map( color =>
  `<button type="button" class="line-swatch" data-color="${color}" style="background:${color}" title="Line color" aria-label="Line color ${color}"></button>` ).join( "" );

for ( const button of document.querySelectorAll( "[data-width]" ) ) {
  button.addEventListener( "click", () => {
    settings.lineWidth = button.dataset.width;
    saveSettings();
    const line = ui.selection?.type === "line" ? findLine( ui.selection.id ) : null;
    if ( line && line.width !== settings.lineWidth ) {
      pushUndo();
      line.width = settings.lineWidth;
    }
    render();
  } );
}

function applyLineColor( color ) {
  settings.lineColor = color;
  saveSettings();
  const line = ui.selection?.type === "line" ? findLine( ui.selection.id ) : null;
  if ( line && line.color !== color ) {
    pushUndo();
    line.color = color;
  }
  render();
}

document.getElementById( "line-swatches" ).addEventListener( "click", event => {
  const swatch = event.target.closest( "[data-color]" );
  if ( swatch ) applyLineColor( swatch.dataset.color );
} );
document.getElementById( "line-custom-color" ).addEventListener( "change", event => applyLineColor( event.target.value ) );

document.getElementById( "line-arrow" ).addEventListener( "change", event => {
  settings.lineArrow = event.target.checked;
  saveSettings();
  const line = ui.selection?.type === "line" ? findLine( ui.selection.id ) : null;
  if ( line ) {
    pushUndo();
    line.arrow = event.target.checked;
  }
  render();
} );

// ---------- save image ----------

const EXPORT_PIXELS_PER_INCH = 20;
// The page stylesheet doesn't travel with a serialized SVG, so the rules the
// table's own drawing relies on go in with it.
const EXPORT_STYLE = `
  .ball-number { font-family: "Arial Black", "Segoe UI Black", "Segoe UI", sans-serif; font-weight: 900; text-anchor: middle; fill: #111; stroke: #111; stroke-width: 0.04; paint-order: stroke; }
  .line-visual, .path-visual, .pocket-line { stroke-linecap: round; }
  .region { stroke-linejoin: round; }`;

// Draw the table as it stands, without handles, selection rings or click
// targets, and download it as a PNG.
async function saveImage() {
  const kept = { selection: ui.selection, point: ui.point, draft: ui.draft };
  ui.selection = null;
  ui.point = null;
  ui.draft = null;
  // the picture is always the table lying flat, however the screen shows it
  applyOrientation( false );
  render();
  const copy = svg.cloneNode( true );
  Object.assign( ui, kept );
  applyOrientation();
  render();

  copy.querySelectorAll( ".line-hit, .edge-hit, .pocket-hit, .handle, .handle-hit, .selected-ring" ).forEach( node => node.remove() );
  const [, , width, height] = LANDSCAPE_VIEW.split( " " ).map( Number );
  const pixelWidth = width * EXPORT_PIXELS_PER_INCH;
  const pixelHeight = height * EXPORT_PIXELS_PER_INCH;
  copy.setAttribute( "xmlns", "http://www.w3.org/2000/svg" );
  copy.setAttribute( "width", pixelWidth );
  copy.setAttribute( "height", pixelHeight );
  const style = document.createElementNS( "http://www.w3.org/2000/svg", "style" );
  style.textContent = EXPORT_STYLE;
  copy.prepend( style );

  const url = URL.createObjectURL( new Blob( [new XMLSerializer().serializeToString( copy )], { type: "image/svg+xml" } ) );
  try {
    const picture = new Image();
    await new Promise( ( resolve, reject ) => {
      picture.onload = resolve;
      picture.onerror = reject;
      picture.src = url;
    } );
    const canvas = document.createElement( "canvas" );
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext( "2d" );
    context.fillStyle = "#12161b"; // page background behind the rounded rail corners
    context.fillRect( 0, 0, pixelWidth, pixelHeight );
    context.drawImage( picture, 0, 0, pixelWidth, pixelHeight );
    const blob = await new Promise( resolve => canvas.toBlob( resolve, "image/png" ) );
    const now = new Date();
    const two = value => String( value ).padStart( 2, "0" );
    const stamp = `${now.getFullYear()}-${two( now.getMonth() + 1 )}-${two( now.getDate() )}-${two( now.getHours() )}${two( now.getMinutes() )}`;
    const link = document.createElement( "a" );
    link.href = URL.createObjectURL( blob );
    link.download = `pool-pattern-${stamp}.png`;
    link.click();
    setTimeout( () => URL.revokeObjectURL( link.href ), 1000 );
  } catch {
    ui.message = "Couldn't make the image in this browser.";
    render();
  } finally {
    URL.revokeObjectURL( url );
  }
}

document.getElementById( "save-image" ).addEventListener( "click", saveImage );

document.getElementById( "lock-balls" ).addEventListener( "click", () => {
  board.locked = !board.locked;
  ui.message = board.locked ? "Balls locked: they stay put while you plan." : "Balls unlocked: drag them to move them.";
  render();
} );
document.getElementById( "undo" ).addEventListener( "click", undo );
document.getElementById( "redo" ).addEventListener( "click", redo );

document.getElementById( "clear-board" ).addEventListener( "click", () => {
  if ( !Object.keys( board.balls ).length && !board.lines.length ) return;
  if ( !confirm( "Clear every ball, shape and line from the table? Undo can bring them back." ) ) return;
  pushUndo();
  board = emptyBoard();
  ui.ball = null;
  ui.selection = null;
  ui.point = null;
  ui.draft = null;
  ui.tool = "select";
  render();
} );

document.getElementById( "show-pocket-lines" ).addEventListener( "change", event => {
  settings.pocketLines = event.target.checked;
  saveSettings();
  render();
} );

for ( const box of document.querySelectorAll( "[data-show]" ) ) {
  box.addEventListener( "change", () => {
    settings.show[box.dataset.show] = box.checked;
    saveSettings();
    render();
  } );
}

// ---------- share layout ----------

// A shared layout is the balls alone, packed into the link: per ball, its
// number as one hex digit, then x and y in tenths of an inch as two base-36
// digits each.
const LAYOUT_PREFIX = "#rack=";

function encodeLayout() {
  const digits = value => Math.round( value * 10 ).toString( 36 ).padStart( 2, "0" );
  return BALL_IDS.filter( id => board.balls[id] ).map( id => {
    const ball = clampToCloth( board.balls[id], BALL_RADIUS );
    return BALL_IDS.indexOf( id ).toString( 16 ) + digits( ball.x ) + digits( ball.y );
  } ).join( "" );
}

function decodeLayout( code ) {
  if ( !/^([0-9a-f][0-9a-z]{4})+$/.test( code ) ) return null;
  const balls = {};
  for ( let at = 0; at < code.length; at += 5 ) {
    const id = BALL_IDS[parseInt( code[at], 16 )];
    const x = parseInt( code.slice( at + 1, at + 3 ), 36 ) / 10;
    const y = parseInt( code.slice( at + 3, at + 5 ), 36 ) / 10;
    balls[id] = { ...clampToCloth( { x, y }, BALL_RADIUS ), pocket: null, hand: null, path: null };
  }
  return balls;
}

async function shareLayout() {
  if ( !Object.keys( board.balls ).length ) {
    ui.message = "Put some balls on the table first.";
    render();
    return;
  }
  const url = location.href.split( "#" )[0] + LAYOUT_PREFIX + encodeLayout();
  if ( navigator.share && coarseQuery.matches ) {
    try {
      await navigator.share( { title: "Pool layout", text: "How would you run this rack?", url } );
      return;
    } catch ( error ) {
      if ( error.name === "AbortError" ) return;
      // no share sheet after all: copy it instead
    }
  }
  try {
    await navigator.clipboard.writeText( url );
    ui.message = "Link copied. It holds the balls only, so whoever opens it can plan the rack their own way.";
  } catch {
    prompt( "Copy this link to share the layout:", url );
  }
  render();
}

// Opening a shared link puts its balls on the table, after asking if the
// table already has something on it. The link is then dropped from the
// address bar so a reload doesn't ask again.
function openSharedLayout() {
  if ( !location.hash.startsWith( LAYOUT_PREFIX ) ) return;
  const balls = decodeLayout( location.hash.slice( LAYOUT_PREFIX.length ).toLowerCase() );
  history.replaceState( null, "", location.href.split( "#" )[0] );
  if ( !balls ) {
    ui.message = "That link's layout couldn't be read.";
    render();
    return;
  }
  const hasWork = Object.keys( board.balls ).length || board.lines.length;
  if ( hasWork && !confirm( "Open the shared layout? It replaces what's on your table. Undo brings your table back." ) ) return;
  pushUndo();
  // locked, so planning it can't knock a ball out of place
  board = { balls, regions: [], lines: [], locked: true };
  Object.assign( ui, { ball: null, selection: null, point: null, draft: null, placing: null, tool: "select" } );
  setMode( "ball" );
  ui.message = `Opened a shared layout: ${Object.keys( balls ).length} balls. Plan it your way.`;
  render();
}

document.getElementById( "share-layout" ).addEventListener( "click", shareLayout );
window.addEventListener( "hashchange", openSharedLayout );

// ---------- help ----------

const help = document.getElementById( "help" );

function openHelp() {
  if ( !help.open ) help.showModal();
}

document.getElementById( "open-help" ).addEventListener( "click", openHelp );
document.getElementById( "close-help" ).addEventListener( "click", () => help.close() );
// a click on the dimmed page around it closes it too
help.addEventListener( "click", event => {
  if ( event.target === help ) help.close();
} );

// ---------- keyboard ----------

const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

// Esc: drop whatever is half done, then the selected point, item and ball in turn.
function cancelOrDeselect() {
  if ( ui.draft || ui.placing || ( ui.mode === "ball" && ui.tool !== "select" ) ) {
    ui.draft = null;
    ui.placing = null;
    ui.tool = "select";
  } else if ( ui.point ) {
    ui.point = null;
  } else if ( ui.selection ) {
    ui.selection = null;
  } else if ( ui.mode === "ball" ) {
    ui.ball = null;
  }
  ui.message = "";
  render();
}

function takeBackDraftPoint() {
  ui.draft.points.pop();
  renderDraft();
  renderControls();
}

document.getElementById( "actions" ).addEventListener( "click", event => {
  const action = event.target.closest( "[data-action]" )?.dataset.action;
  if ( !action ) return;
  if ( action.startsWith( "tool-" ) ) {
    const tool = action.slice( 5 );
    // the armed tool's button puts it down again
    if ( ui.tool === tool ) cancelOrDeselect();
    else setTool( tool );
  } else if ( action === "finish" ) {
    finishRegion();
  } else if ( action === "back" ) {
    takeBackDraftPoint();
  } else if ( action === "delete" ) {
    deleteSelection();
  } else if ( action === "escape" ) {
    cancelOrDeselect();
  }
} );

document.addEventListener( "keydown", event => {
  if ( event.key === "F1" ) {
    event.preventDefault();
    openHelp();
    return;
  }
  if ( help.open ) return;
  if ( event.target.matches( "input[type=text], input[type=color], select, textarea" ) ) return;
  const key = event.key.toLowerCase();
  if ( event.ctrlKey || event.metaKey ) {
    if ( key === "z" && !event.shiftKey ) {
      undo();
    } else if ( key === "y" || ( key === "z" && event.shiftKey ) ) {
      redo();
    } else {
      return;
    }
    event.preventDefault();
    return;
  }
  if ( event.altKey ) return;

  const draft = ui.draft;
  if ( ARROWS[key] ) {
    const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
    if ( !nudge( ARROWS[key][0] * step, ARROWS[key][1] * step ) ) return;
  } else if ( key === "escape" ) {
    cancelOrDeselect();
  } else if ( key === "enter" && draft?.type === "region" ) {
    finishRegion();
  } else if ( key === "backspace" && ( draft?.type === "path" || draft?.type === "region" ) ) {
    takeBackDraftPoint();
  } else if ( key === "delete" || key === "backspace" ) {
    deleteSelection();
  } else if ( key === "v" ) {
    setTool( "select" );
  } else if ( key === "b" ) {
    setMode( "ball" );
  } else if ( key === "l" ) {
    setMode( "line" );
  } else if ( key === "g" ) {
    setTool( "good" );
  } else if ( key === "m" ) {
    setTool( "path" );
  } else if ( key === "z" ) {
    keyAction( "hand", placeHand );
  } else if ( key === "w" ) {
    if ( currentBall() && !regionFor( currentBall(), "good" ) ) setTool( "widen" );
    else keyAction( "widen", widenOk );
  } else if ( key === "p" ) {
    settings.pocketLines = !settings.pocketLines;
    saveSettings();
    render();
  } else {
    return;
  }
  event.preventDefault();
} );

window.addEventListener( "resize", () => {
  applyOrientation();
  render();
} );

applyOrientation();
renderDefs();
renderTable();
render();
openSharedLayout();
