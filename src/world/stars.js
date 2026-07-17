/*=== HARNESS:STARS ==========================================================*/
// 3-layer parallax star field (z = 0.2 / 0.5 / 0.9, ~400 stars).
const STARS = [];
(function seedStars() {
  const save = _seed; setSeed(1337);
  for (let i = 0; i < 400; i++) { const p = rnd();
    STARS.push({ x: rnd() * 2400 - 1200, y: rnd() * 2400 - 1200,
      z: p < 0.34 ? 0.2 : p < 0.67 ? 0.5 : 0.9, b: 0.3 + rnd() * 0.6 }); }
  _seed = save;
})();
