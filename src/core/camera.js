/*=== HARNESS:CAMERA =========================================================*/
// Camera: zoom / pan / world↔screen with ~30° pitch (world-y foreshortened, so
// orbits & rings render as ellipses and the field reads as a tilted plane).
Object.assign(GAME, {
  // world → screen
  S(wx, wy) {
    const c = this.state.cam;
    return { x: (wx - c.x) * c.zoom + CONFIG.W / 2,
             y: (wy - c.y) * c.zoom * CONFIG.pitch + CONFIG.H / 2 };
  },
  // screen → world (inverse of S)
  screenToWorld(sx, sy) {
    const c = this.state.cam;
    return { x: (sx - CONFIG.W / 2) / c.zoom + c.x,
             y: (sy - CONFIG.H / 2) / (c.zoom * CONFIG.pitch) + c.y };
  },
  // FLAT world → screen (no pitch) — matches the Forge draw fns' projection
  // (world→screen = (w - cam) * zoom + off). Used for aliens / miners / combat
  // so their drawn sprite and their tap hit-box stay aligned.
  SF(wx, wy) {
    const c = this.state.cam;
    return { x: (wx - c.x) * c.zoom + CONFIG.W / 2, y: (wy - c.y) * c.zoom + CONFIG.H / 2 };
  },
  // camera object used by ForgeCombat / ForgeFaction / ForgeNPC draw fns.
  // world→screen there is (w - x)*zoom + off, plus the pitch on y via offY math.
  drawCamera() {
    const c = this.state.cam;
    return { x: c.x, y: c.y, zoom: c.zoom, offX: CONFIG.W / 2, offY: CONFIG.H / 2, pitch: CONFIG.pitch };
  },
  applyZoom(dir) {
    const c = this.state.cam;
    c.tz = clamp(c.tz * (dir > 0 ? CONFIG.zoomStep : 1 / CONFIG.zoomStep), CONFIG.zoomMin, CONFIG.zoomMax);
  },
  tickCamera(dt) {
    const s = this.state, c = s.cam;
    c.x = lerp(c.x, s.x, Math.min(1, 6 * dt));
    c.y = lerp(c.y, s.y, Math.min(1, 6 * dt));
    c.zoom = lerp(c.zoom, c.tz, 1 - Math.pow(1 - CONFIG.zoomLerp, dt * 60));
  },
});
