// One-time intro: a short clip, a crossfade into the XMB wave, then the page.
// Skipped on repeat visits and under prefers-reduced-motion.

const KEY = 'ps3avatars.splash.v2';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLIPS = ['media/ps3back.mp4', 'media/ps3-xmb.mp4'];

function video(src) {
  const v = document.createElement('video');
  v.className = 'splash-video';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.setAttribute('aria-hidden', 'true');
  v.src = `${src}?v=__V__`;
  return v;
}

function play() {
  if (REDUCED || sessionStorage.getItem(KEY)) return;
  sessionStorage.setItem(KEY, '1');

  const wrap = document.createElement('div');
  wrap.className = 'splash';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<span class="splash-skip">click to skip</span>';
  document.body.appendChild(wrap);
  document.documentElement.classList.add('splashing');

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    wrap.classList.add('leaving');
    document.documentElement.classList.remove('splashing');
    setTimeout(() => wrap.remove(), 1100);
  };

  let index = 0;
  let previous = null;
  const show = () => {
    if (finished) return;
    if (index >= CLIPS.length) { done(); return; }

    const current = video(CLIPS[index]);
    wrap.appendChild(current);
    if (previous) {
      const old = previous;
      setTimeout(() => old.remove(), 1200); // free the layer once it has faded
    }
    previous = current;

    const advance = () => {
      current.removeEventListener('ended', advance);
      current.removeEventListener('error', advance);
      index += 1;
      show();
    };
    current.addEventListener('ended', advance);
    current.addEventListener('error', advance);
    current.play().then(() => {
      requestAnimationFrame(() => current.classList.add('on'));
    }).catch(advance);
  };

  wrap.addEventListener('click', done);
  setTimeout(done, 45000); // safety net
  show();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', play, { once: true });
} else {
  play();
}
