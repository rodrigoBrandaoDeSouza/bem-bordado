// Gera o SVG do bastidor animado do topo do site, reproduzindo o desenho da logo:
// girassol grande em traço preto sobre tecido amarelo, "Bem BORDADO" no centro
// e um girassol pequeno à direita. Substitui o <svg class="hoop-svg"> em public/index.html.
// Uso: node scripts/gerar-bastidor.js
const fs = require('fs');
const path = require('path');

const INK = '#252220';
const SUN = '#f6c324';
const CX = 210, CY = 230, R = 170; // tecido do bastidor
const f = (n) => +n.toFixed(1);

// Pétala apontando para cima, da base (r0) até a ponta (r1), com nervura central.
function petal(r0, r1, w) {
  const L = r1 - r0;
  const body = `M0 ${f(-r0)} C${f(w)} ${f(-(r0 + L * 0.3))} ${f(w * 0.75)} ${f(-(r0 + L * 0.78))} 0 ${f(-r1)} ` +
    `C${f(-w * 0.75)} ${f(-(r0 + L * 0.78))} ${f(-w)} ${f(-(r0 + L * 0.3))} 0 ${f(-r0)}Z`;
  const vein = `M0 ${f(-(r0 + L * 0.12))} Q${f(w * 0.12)} ${f(-(r0 + L * 0.5))} 0 ${f(-(r1 - L * 0.12))}`;
  return { body, vein };
}

let delay = 0.15;
const step = 0.045;
function ring({ n, r0, r1, w, rot0, cx = CX, cy = CY, cls = 'petal', sw = 2.2, vein = true, jitter = 0 }) {
  const p = petal(r0, r1, w);
  let out = '';
  for (let i = 0; i < n; i++) {
    const j = jitter ? Math.sin(i * 2.7) * jitter : 0; // irregularidade de desenho à mão
    const a = f(rot0 + (360 / n) * i + j);
    const d1 = delay.toFixed(2), d2 = (delay + 0.7).toFixed(2);
    out += `<g transform="translate(${cx} ${cy}) rotate(${a})">` +
      `<path class="${cls}" pathLength="1" d="${p.body}" style="animation-delay:${d1}s,${d2}s" stroke-width="${sw}"/>` +
      (vein ? `<path class="vein" pathLength="1" d="${p.vein}" style="animation-delay:${(delay + 0.4).toFixed(2)}s"/>` : '') +
      `</g>`;
    delay += step;
  }
  return out;
}

// Girassol grande: duas camadas de pétalas longas, saindo do centro (escondido pelo texto)
const outer = ring({ n: 16, r0: 60, r1: 196, w: 30, rot0: 0, jitter: 3 });
const inner = ring({ n: 16, r0: 50, r1: 132, w: 24, rot0: 11.25, jitter: 4 });

// Girassol pequeno à direita (como na logo)
delay += 0.2;
const MX = 310, MY = 212;
const miniPetals = ring({ n: 18, r0: 13, r1: 33, w: 7, rot0: 0, cx: 0, cy: 0, cls: 'petal mini', sw: 1.8, vein: false });
let seeds = '';
for (let r = 3.5; r <= 11; r += 3.5)
  for (let k = 0, n = Math.round(r * 1.7); k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r;
    seeds += `<circle cx="${f(Math.cos(a) * r)}" cy="${f(Math.sin(a) * r)}" r="1.1"/>`;
  }

const svg = `<svg viewBox="0 0 420 440" class="hoop-svg">
          <defs>
            <pattern id="linenP" width="7" height="7" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill="${SUN}"/>
              <path d="M0 3.5h7M3.5 0v7" stroke="#e2ae10" stroke-width=".7"/>
            </pattern>
            <clipPath id="fabricClip"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>
          </defs>

          <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#linenP)"/>
          <g clip-path="url(#fabricClip)" fill="${SUN}" stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">
            <g class="sun-big">${outer}${inner}</g>

            <!-- centro do girassol, coberto pelo nome (como na logo) -->
            <ellipse class="pop p-center" cx="${CX - 8}" cy="${CY}" rx="74" ry="56" fill="${SUN}" stroke="none"/>
            <g class="pop p-text" fill="${INK}" stroke="none">
              <text x="${CX - 30}" y="${CY - 8}" text-anchor="middle" class="logo-bem">Bem</text>
              <text x="${CX - 6}" y="${CY + 34}" text-anchor="middle" class="logo-bordado">BORDADO</text>
            </g>

            <g class="mini-sun" transform="translate(${MX} ${MY})">
              <g class="mini-spin">
                ${miniPetals}
                <circle class="pop p-seeds" r="13" fill="${SUN}" stroke-width="1.8"/>
                <g class="pop p-seeds" fill="${INK}" stroke="none">${seeds}</g>
              </g>
            </g>
          </g>

          <!-- aro de madeira -->
          <circle cx="${CX}" cy="${CY}" r="177" fill="none" stroke="#c99b62" stroke-width="14"/>
          <circle cx="${CX}" cy="${CY}" r="177" fill="none" stroke="#a87a45" stroke-width="2" stroke-dasharray="1 10" opacity=".7"/>
          <circle cx="${CX}" cy="${CY}" r="169" fill="none" stroke="#8a5f30" stroke-width="1.5" opacity=".4"/>
          <rect x="194" y="40" width="32" height="20" rx="5" fill="#b8a48a"/>
          <rect x="203" y="28" width="14" height="16" rx="3" fill="#9a8770"/>

          <!-- agulha com linha -->
          <g class="needle">
            <path d="M330 70 L392 8" stroke="#9aa3ab" stroke-width="4" stroke-linecap="round"/>
            <ellipse cx="386" cy="14" rx="2" ry="5" transform="rotate(45 386 14)" fill="#fbf4e8"/>
            <path class="needle-thread" d="M386 14 C 420 40, 400 90, 360 100 S 300 140, 330 70" fill="none" stroke="${INK}" stroke-width="2.2"/>
          </g>
        </svg>`;

const file = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('<svg viewBox="0 0 420 440" class="hoop-svg">');
const end = html.indexOf('</svg>', start) + '</svg>'.length;
if (start < 0) throw new Error('hoop-svg não encontrado');
html = html.slice(0, start) + svg + html.slice(end);
fs.writeFileSync(file, html);
console.log(`bastidor gerado (${(svg.length / 1024).toFixed(1)} KB, animação termina em ~${(delay + 1.5).toFixed(1)}s)`);
