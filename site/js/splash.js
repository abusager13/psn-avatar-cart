// One-time background clip: plays the intro, then fades the page back in.

const KEY = 'ps3avatars.splash.v1';
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function play() {
  if (REDUCED || sessionStorage.getItem(KEY)) return;
  sessionStorage.setItem(KEY, '1');

  const wrap = document.createElement('div');
  wrap.className = 'splash';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = '<video muted playsinline preload="auto" src="media/ps3back.mp4?v=__V__"></video>';
  document.body.appendChild(wrap);
  document.documentElement.classList.add('splashing');

  const video = wrap.querySelector('video');
  let finished = false;

  const done = () => {
    if (finished) return;
    finished = true;
    wrap.classList.add('leaving');
    document.documentElement.classList.remove('splashing');
    setTimeout(() => wrap.remove(), 1000);
  };

  video.addEventListener('ended', done);
  video.addEventListener('error', done);
  wrap.addEventListener('click', done);
  setTimeout(done, 12000); // safety net if 'ended' never fires

  video.play().catch(done);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', play, { once: true });
} else {
  play();
}
