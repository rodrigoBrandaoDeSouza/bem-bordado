// Gera ilustrações SVG de exemplo para a galeria (substituídas pelas fotos reais no painel).
// Uso: node scripts/gerar-amostras.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'amostras');
fs.mkdirSync(OUT, { recursive: true });

const linen = (id, base, line) => `
  <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="${base}"/>
    <path d="M0 3h6M3 0v6" stroke="${line}" stroke-width=".6" opacity=".55"/>
  </pattern>`;

function frame(bg, inner, { hoop = true, fabric = '#f7efe2', extra = '' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
<defs>${linen('lin', fabric, '#e3d4bd')}
  <pattern id="wood" width="600" height="600" patternUnits="userSpaceOnUse">
    <rect width="600" height="600" fill="${bg}"/>
    ${Array.from({ length: 14 }, (_, i) => `<path d="M0 ${i * 45 + 10} Q300 ${i * 45 + 30} 600 ${i * 45 + 5}" stroke="#000" stroke-opacity=".04" stroke-width="10" fill="none"/>`).join('')}
  </pattern>
</defs>
<rect width="600" height="600" fill="url(#wood)"/>
${extra}
${hoop ? `<circle cx="300" cy="300" r="232" fill="url(#lin)"/>` : ''}
${inner}
${hoop ? `<circle cx="300" cy="300" r="238" fill="none" stroke="#c99b62" stroke-width="16"/>
<circle cx="300" cy="300" r="238" fill="none" stroke="#a87a45" stroke-width="2" stroke-dasharray="1 9" opacity=".6"/>
<circle cx="300" cy="300" r="229" fill="none" stroke="#8a5f30" stroke-width="2" opacity=".5"/>
<rect x="282" y="46" width="36" height="22" rx="5" fill="#b8a48a"/><rect x="292" y="34" width="16" height="16" rx="3" fill="#9a8770"/>` : ''}
</svg>`;
}

const stem = (d, c = '#6f8b5b') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-dasharray="9 4"/>`;
const daisy = (x, y, r, c, center = '#e8b94a', n = 7) =>
  Array.from({ length: n }, (_, i) => {
    const a = (360 / n) * i;
    return `<ellipse cx="${x}" cy="${y - r}" rx="${r * 0.38}" ry="${r * 0.8}" transform="rotate(${a} ${x} ${y})" fill="${c}" fill-opacity=".25" stroke="${c}" stroke-width="3"/>`;
  }).join('') + `<circle cx="${x}" cy="${y}" r="${r * 0.35}" fill="${center}"/>`;
const knots = (pts, c) => pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/><circle cx="${x - 1.5}" cy="${y - 1.5}" r="1.6" fill="#fff" opacity=".5"/>`).join('');
const leaf = (x, y, rot, c = '#7d9a68') => `<path d="M${x} ${y} q 14 -22 34 -6 q -18 18 -34 6z" transform="rotate(${rot} ${x} ${y})" fill="${c}" fill-opacity=".3" stroke="${c}" stroke-width="3"/>`;

const svgs = [];

// 1. Bastidor floral
svgs.push(frame('#d9c3a5', `
  ${stem('M300 470 Q290 380 250 300')}${stem('M300 470 Q310 360 350 260')}${stem('M300 470 Q300 400 300 330')}${stem('M300 470 Q260 420 200 390')}${stem('M300 470 Q350 420 410 380')}
  ${leaf(270, 380, -30)}${leaf(320, 370, 200)}${leaf(250, 420, 10)}${leaf(340, 410, 160)}
  ${daisy(250, 290, 30, '#d9826b')}${daisy(352, 250, 34, '#e6a6b0')}${daisy(300, 322, 24, '#f2f0ea', '#e8b94a', 9)}
  ${daisy(200, 385, 20, '#9fb7d6')}${daisy(412, 375, 22, '#d9826b')}
  ${knots([[230, 220], [380, 330], [180, 330], [420, 300], [270, 230], [330, 190]], '#c46a7a')}
  <path d="M230 500 q70 -30 140 0" fill="none" stroke="#c46a7a" stroke-width="3" stroke-dasharray="6 5"/>`));

// 2. Nome do bebê
svgs.push(frame('#e7d2c4', `
  <text x="300" y="320" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="96" fill="none" stroke="#c46a7a" stroke-width="5" stroke-dasharray="10 4" stroke-linecap="round">Helena</text>
  <text x="300" y="380" text-anchor="middle" font-family="Georgia, serif" font-size="26" fill="#8a6f57" letter-spacing="6">12 · 03 · 2026</text>
  ${stem('M170 230 Q240 180 300 200 Q360 180 430 230', '#7d9a68')}
  ${daisy(300, 195, 18, '#e6a6b0')}${daisy(220, 205, 13, '#f2f0ea', '#e8b94a', 8)}${daisy(380, 205, 13, '#f2f0ea', '#e8b94a', 8)}
  ${leaf(250, 200, -40)}${leaf(340, 195, 210)}
  ${knots([[180, 430], [420, 430], [300, 450], [240, 445], [360, 445]], '#9fb7d6')}`, { fabric: '#fbf5ec' }));

// 3. Granny squares (crochê)
{
  const pal = [['#e6a6b0', '#f2e3c6', '#7d9a68', '#f7efe2'], ['#e8b94a', '#9fb7d6', '#d9826b', '#f7efe2'], ['#c46a7a', '#f2e3c6', '#9fb7d6', '#f7efe2'], ['#7d9a68', '#e6a6b0', '#e8b94a', '#f7efe2']];
  let g = '';
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const p = pal[(r + c * 3) % 4];
      const x = 40 + c * 130, y = 40 + r * 130;
      g += `<rect x="${x}" y="${y}" width="128" height="128" rx="6" fill="${p[3]}"/>`;
      [52, 36, 20].forEach((s, i) => {
        const col = p[i];
        for (let k = 0; k < 4; k++) {
          const ang = k * 90;
          g += `<g transform="rotate(${ang} ${x + 64} ${y + 64})">${[-1, 0, 1].map((j) => `<rect x="${x + 64 + j * s * 0.6 - 6}" y="${y + 64 - s - 4}" width="12" height="${14 - i * 2}" rx="5" fill="${col}" stroke="#000" stroke-opacity=".08"/>`).join('')}</g>`;
        }
      });
      g += `<circle cx="${x + 64}" cy="${y + 64}" r="7" fill="${p[0]}"/>`;
    }
  svgs.push(frame('#cfb08c', `<g transform="rotate(-4 300 300)"><rect x="34" y="34" width="532" height="532" rx="10" fill="#f2e3c6"/>${g}</g>`, { hoop: false }));
}

// 4. Lavanda
{
  let lav = '';
  [[240, 200], [300, 170], [360, 205], [270, 230], [330, 225]].forEach(([x, y], s) => {
    lav += stem(`M300 470 Q${(x + 300) / 2} ${(y + 470) / 2 + 30} ${x} ${y + 60}`, '#8a9a5b');
    for (let i = 0; i < 8; i++) {
      const yy = y + i * 9, off = i % 2 ? 6 : -6;
      lav += `<ellipse cx="${x + off}" cy="${yy}" rx="6" ry="9" transform="rotate(${off * 4} ${x + off} ${yy})" fill="${s % 2 ? '#a68bc4' : '#8f73b3'}" stroke="#6d548f" stroke-width="1.5"/>`;
    }
  });
  lav += `<path d="M270 430 q30 25 60 0 l-10 30 h-40z" fill="#e6c79a" stroke="#c99b62" stroke-width="3"/><path d="M262 430 q38 -14 76 0" fill="none" stroke="#c46a7a" stroke-width="4" stroke-dasharray="6 3"/>`;
  svgs.push(frame('#d6c6b8', lav, { fabric: '#f4efe6' }));
}

// 5. Bolsinha de crochê
{
  let rows = '';
  for (let r = 0; r < 12; r++) {
    const y = 250 + r * 22;
    const w = 200 - Math.max(0, r - 8) * 12;
    const col = r % 4 === 3 ? '#c46a7a' : r % 2 ? '#f2e3c6' : '#efd9b5';
    for (let x = 300 - w; x < 300 + w; x += 18) rows += `<path d="M${x} ${y} l9 16 l9 -16" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  svgs.push(frame('#a9c1b2', `
    <path d="M200 250 Q200 120 300 120 Q400 120 400 250" fill="none" stroke="#a87a45" stroke-width="18" stroke-linecap="round"/>
    <path d="M200 250 Q200 120 300 120 Q400 120 400 250" fill="none" stroke="#c99b62" stroke-width="8" stroke-linecap="round"/>
    <path d="M95 240 h410 l-30 290 q-145 30 -350 0z" fill="#e8d2ae"/>
    <g clip-path="url(#bag)">${rows}</g>
    <clipPath id="bag"><path d="M95 240 h410 l-30 290 q-145 30 -350 0z"/></clipPath>
    ${daisy(300, 380, 30, '#f7efe2', '#e8b94a', 8)}`, { hoop: false }));
}

// 6. Bastidor de família com barrado de crochê
{
  let scallop = '';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const x = 300 + Math.cos(a) * 262, y = 300 + Math.sin(a) * 262;
    scallop += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="26" fill="#f7efe2" stroke="#e3d4bd" stroke-width="2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="#d9c3a5"/>`;
  }
  svgs.push(frame('#b9a3c4', `
    <path d="M300 380 C 210 320 200 240 250 225 C 280 216 296 240 300 255 C 304 240 320 216 350 225 C 400 240 390 320 300 380z" fill="#e6a6b0" fill-opacity=".3" stroke="#c46a7a" stroke-width="5" stroke-dasharray="10 4"/>
    <text x="300" y="440" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="40" fill="#6d548f">nossa família</text>
    ${daisy(210, 200, 16, '#9fb7d6')}${daisy(395, 200, 16, '#e8b94a', '#c46a7a')}
    ${knots([[300, 175], [180, 300], [420, 300], [250, 470], [350, 470]], '#7d9a68')}`, { extra: scallop }));
}

// Paleta da marca: amarelo-girassol + traço preto
const PALETTE = {
  '#e6a6b0': '#fde58c', '#c46a7a': '#252220', '#d9826b': '#f6c324', '#9fb7d6': '#fffdf7', '#e8b94a': '#6b4a12',
  '#d48a96': '#252220', '#e7d2c4': '#efe3c6', '#b9a3c4': '#e9d48f', '#a9c1b2': '#c9cf9f', '#6d548f': '#252220',
  '#7d9a68': '#6f7d3c', '#6f8b5b': '#252220', '#8a9a5b': '#535e2b',
};
const recolor = (svg) => svg.replace(/#[0-9a-f]{6}/gi, (c) => PALETTE[c.toLowerCase()] || c);

svgs.forEach((s, i) => fs.writeFileSync(path.join(OUT, `amostra-${i + 1}.svg`), recolor(s).replace(/\n\s*\n/g, '\n')));
console.log(`${svgs.length} amostras geradas em ${OUT}`);
