# PoolPatternBoard

Plan a run-out on a pool table: place balls on a table canvas, then draw shot
lines and shaded polygons to show the pattern you would play to clear the table.

## Running it

**Use it online: https://jflogr.github.io/PoolPatternBoard/** — GitHub Pages
serves the latest version on `master`, updated a minute or so after each push.

To run it locally, open `index.html` in a current browser, or run
`node server.mjs` and go to http://localhost:4175.

Nothing is installed and nothing leaves the browser: the board is kept in the
browser's local storage, so each browser (and the online and local copies) has
its own board.

## Using it

The table is to scale: a 9 ft table's 100 x 50 in playing surface with 2.25 in
balls. **Help** (or F1) in the app explains everything below.

### Sharing a layout

**Share layout** makes a link holding only the balls' positions, with no
pockets, zones or lines, so everyone who opens it can plan the same rack their
own way. On a phone it opens the share sheet; elsewhere it copies the link.
Opening a link asks before replacing a table that already has something on it,
and Undo brings the old table back.

A shared layout opens with the balls **locked**: they can still be selected and
planned, but not dragged, added or removed, so nothing moves by accident.
**🔒 Balls locked**, next to the Balls/Lines switch, unlocks them, and
**🔓 Lock balls** locks any layout.

### Phones and tablets

The app works by touch. Tap a tray ball, then tap the table to place it.
Buttons above the table do what the keys do: tap **Set zone**, **Widen**,
**Movement** or **Draw zone**, then tap the table. **Delete**, **Done**,
**Undo corner/bounce** and **Cancel** cover the rest. Held upright, a phone
shows the table on end so it's bigger; the buttons and the tray stay on screen
around it.

There are two modes: **Balls** (B) for each ball's pocket and target zones, and
**Lines** (L) for free lines. Each mode only picks up its own things.

### Balls mode

- **Balls**: drag them from the tray onto the table, and drag them around once
  they are there. Double-click a ball, press Delete, or drag it off the table to
  put it back in the tray.
- **Selected ball**: click a ball (or one of its zones) to select it. It stays
  selected while you work on it, and the toolbar shows its pocket, zone,
  widened zone and movement, each with a × to clear it. Esc deselects. The
  cue ball has none of these, so selecting it clears the selected ball.
- The keys below act at the mouse, so keep it on the table when you press them.
  The line above the toolbar lists them.
- **Pocket line**: click a pocket. The line runs from the back of the ball,
  directly away from the pocket, to the cushion: the line the cue ball is on
  for a straight-in shot. Click the pocket again to clear it. P turns pocket
  lines on or off.
- **Set zone (Z)**: with the mouse where the cue ball should end up, press
  Z. A ball-sized target ring goes there, and a good zone is built around it: a
  trapezoid along the line to the object ball, its narrow edge halfway to the
  ball and its far edge, twice as wide, the same distance behind the target.
  Pressing Z again moves the target and rebuilds the good zone.
- **Widen (W)**: with the mouse outside the good zone, press W. The side
  nearest the mouse gets two new corners pushed out level with the mouse, which
  widens or lengthens the OK zone. W on another side pushes that side out too,
  starting from the corner the first widening made, so the OK zone stays one
  clean shape.
- **Movement (M)**: draws where the cue ball goes after hitting the ball,
  starting from the ghost ball (so the ball needs its pocket first). Click a
  rail to bounce off it, as many times as needed; click the cloth where the
  cue ball stops, which finishes the path with a ball-sized ring. Backspace
  takes back the last bounce. Once drawn, drag its points: bounces slide along the rails.
- **Good (G)** draws a good shape by hand instead: click each corner, then click
  the first corner, double-click or press Enter to close it.
- **Editing a zone**: click it to show its points. Hover a point to highlight
  it, then drag it, or click it and nudge it with the arrow keys (Shift for 1 in
  steps). Click an edge to add a point, and drag an edge to slide that side
  parallel. Double-click a point or press Delete to remove it.

Zones take the ball's color; striped balls get a striped fill.

### Lines mode

Drag to draw a line, or click the start and then the end. Click a line to
select it, then drag it or its ends, or change its color, width (thin,
medium or thick; thin is the default) and arrow.

Ctrl+Z / Ctrl+Y undo and redo. **Save image** downloads the table as a PNG
(2280 x 1280), leaving out handles and selection rings.
