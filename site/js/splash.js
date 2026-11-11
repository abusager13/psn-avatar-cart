// Intro splash: a short clip, crossfading into the XMB wave, which then keeps
// looping as the site's ambient background. Skipped on repeat visits and under
// prefers-reduced-motion.

const KEY = 'ps3avatars.splash.v4';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CLIPS = ['media/ps3back.mp4', 'media/ps3-ascii.mp4'];

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

  let index = 0;
  let previous = null;
  let ambientMode = false;
  let finished = false;

  /** Drop the overlay entirely — used only when the video cannot play. */
  const remove = () => {
    if (finished) return;
    finished = true;
    wrap.classList.add('leaving');
    document.documentElement.classList.remove('splashing');
    setTimeout(() => wrap.remove(), 1100);
  };

  /** Hand the wave over to the page: behind the content, looping, not blocking. */
  const goAmbient = (el) => {
    if (ambientMode || finished) return;
    ambientMode = true;
    el.loop = true;
    wrap.classList.add('ambient');
    document.documentElement.classList.add('ambient');
    document.documentElement.classList.remove('splashing');
  };

  const show = () => {
    if (ambientMode || finished) return;
    if (index >= CLIPS.length) { remove(); return; }

    const current = video(CLIPS[index]);
    wrap.appendChild(current);
    if (previous) {
      const old = previous;
      setTimeout(() => old.remove(), 1200); // free the layer once it has faded
    }
    previous = current;

    const isLast = index === CLIPS.length - 1;
    const advance = () => {
      current.removeEventListener('ended', advance);
      current.removeEventListener('error', advance);
      index += 1;
      show();
    };
    if (!isLast) {
      current.addEventListener('ended', advance);
    }
    current.addEventListener('error', () => (isLast ? remove() : advance()));

    current.play().then(() => {
      requestAnimationFrame(() => current.classList.add('on'));
      if (isLast) {
        // once the crossfade has finished, the wave becomes the background
        setTimeout(() => goAmbient(current), 1200);
      }
    }).catch(() => (isLast ? remove() : advance()));
  };

  // A click skips straight to the wave in ambient mode.
  wrap.addEventListener('click', () => {
    if (ambientMode) return;
    wrap.querySelectorAll('video').forEach((v) => v.remove());
    previous = null;
    index = CLIPS.length - 1;
    show();
  });

  // Don't decode video in a hidden tab.
  document.addEventListener('visibilitychange', () => {
    const v = wrap.querySelector('.splash-video.on');
    if (!v) return;
    if (document.hidden) v.pause();
    else if (!finished) v.play().catch(() => {});
  });

  setTimeout(remove, 45000); // safety net if nothing ever plays
  show();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', play, { once: true });
} else {
  play();
}
