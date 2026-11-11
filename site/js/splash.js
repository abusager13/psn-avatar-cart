// Intro splash + persistent ambient background.
//
// First visit in a session: a short clip crossfades into the looping background,
// which then lives behind every page of the site.
// Later pages (Search, Catalogue, Delisted): the background is attached at once,
// resuming near where it was, so navigating never loses it.

const KEY = 'ps3avatars.splash.v5';
const POS = `${KEY}.pos`;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLIPS = ['media/ps3back.mp4', 'media/ps3-ascii.mp4'];
const AMBIENT = CLIPS[CLIPS.length - 1];

function video(src, { loop = false } = {}) {
  const v = document.createElement('video');
  v.className = 'splash-video';
  v.muted = true;
  v.playsInline = true;
  v.defaultMuted = true;
  v.loop = loop;
  if (loop) v.setAttribute('loop', '');
  v.preload = 'auto';
  v.setAttribute('aria-hidden', 'true');
  v.src = `${src}?v=__V__`;
  return v;
}

function attach(el) {
  const wrap = document.createElement('div');
  wrap.className = 'splash ambient';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.appendChild(el);
  document.body.appendChild(wrap);
  document.documentElement.classList.add('ambient');
  return wrap;
}

/** Background only — used on every page after the intro has played once. */
function resumeAmbient() {
  if (document.querySelector('.splash')) return;
  const el = video(AMBIENT, { loop: true });
  el.classList.add('on');
  attach(el);

  el.addEventListener('ended', () => { el.currentTime = 0; el.play().catch(() => {}); });

  const saved = Number(sessionStorage.getItem(POS) || 0);
  const start = () => {
    if (saved > 0 && Number.isFinite(saved)) {
      try { el.currentTime = saved; } catch { /* not seekable yet */ }
    }
    el.play().catch(() => {});
  };
  if (el.readyState >= 1) start();
  else el.addEventListener('loadedmetadata', start, { once: true });

  window.addEventListener('pagehide', () => {
    sessionStorage.setItem(POS, String(el.currentTime || 0));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && el.paused) el.play().catch(() => {});
  });
}

function intro() {
  const wrap = document.createElement('div');
  wrap.className = 'splash';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<span class="splash-skip">click to skip</span>';
  document.body.appendChild(wrap);
  document.documentElement.classList.add('splashing');

  let index = 0;
  let previous = null;
  let ambientMode = false;
  let finished = false;

  const remove = () => {
    if (finished || ambientMode) return;
    finished = true;
    wrap.classList.add('leaving');
    document.documentElement.classList.remove('splashing');
    setTimeout(() => wrap.remove(), 1100);
  };

  const goAmbient = (el) => {
    if (ambientMode || finished) return;
    ambientMode = true;
    el.loop = true;
    el.setAttribute('loop', '');
    el.addEventListener('ended', () => { el.currentTime = 0; el.play().catch(() => {}); });
    wrap.classList.add('ambient');
    document.documentElement.classList.add('ambient');
    document.documentElement.classList.remove('splashing');
    window.addEventListener('pagehide', () => {
      sessionStorage.setItem(POS, String(el.currentTime || 0));
    });
  };

  const show = () => {
    if (ambientMode || finished) return;
    if (index >= CLIPS.length) { remove(); return; }

    const current = video(CLIPS[index], { loop: false });
    wrap.appendChild(current);
    if (previous) {
      const old = previous;
      setTimeout(() => old.remove(), 1200);
    }
    previous = current;

    const isLast = index === CLIPS.length - 1;
    const advance = () => {
      current.removeEventListener('ended', advance);
      current.removeEventListener('error', advance);
      index += 1;
      show();
    };
    if (!isLast) current.addEventListener('ended', advance);
    current.addEventListener('error', () => (isLast ? remove() : advance()));

    current.play().then(() => {
      requestAnimationFrame(() => current.classList.add('on'));
      if (isLast) setTimeout(() => goAmbient(current), 1200);
    }).catch(() => (isLast ? remove() : advance()));
  };

  wrap.addEventListener('click', () => {
    if (ambientMode) return;
    wrap.querySelectorAll('video').forEach((v) => v.remove());
    previous = null;
    index = CLIPS.length - 1;
    show();
  });

  setTimeout(remove, 45000);
  show();
}

function start() {
  if (REDUCED) {
    // No motion: never attach video, and leave the page clean.
    document.documentElement.classList.add('ambient');
    return;
  }
  if (sessionStorage.getItem(KEY)) {
    resumeAmbient();
    return;
  }
  sessionStorage.setItem(KEY, '1');
  intro();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
