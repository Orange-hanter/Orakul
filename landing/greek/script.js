/* ============================================================
   ΟΡΑΚΟΥΛ — greek landing JS
   Parallax · Reveal · Counters (thousand-separated) · Eye tracking
   ============================================================ */

(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* -------- 1. Sticky nav -------- */
  const nav = document.getElementById('nav');
  const onScrollNav = () => {
    if (window.scrollY > 24) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  document.addEventListener('scroll', onScrollNav, { passive: true });
  onScrollNav();

  /* -------- 2. Parallax -------- */
  const parallaxEls = Array.from(document.querySelectorAll('[data-parallax]')).map(el => ({
    el,
    speed: parseFloat(el.dataset.parallax) || 0.2,
    baseTop: el.getBoundingClientRect().top + window.scrollY,
    transform: el.style.transform || '',
  }));

  let parallaxRaf = null;
  const updateParallax = () => {
    parallaxRaf = null;
    const vh = window.innerHeight;
    const sy = window.scrollY;
    for (const item of parallaxEls) {
      const rect = item.el.getBoundingClientRect();
      if (rect.bottom < -300 || rect.top > vh + 300) continue;
      const offset = (sy + vh / 2 - item.baseTop) * item.speed;
      item.el.style.transform = `${item.transform} translate3d(0, ${(-offset).toFixed(1)}px, 0)`;
    }
  };
  const scheduleParallax = () => {
    if (parallaxRaf) return;
    parallaxRaf = requestAnimationFrame(updateParallax);
  };
  if (!prefersReducedMotion) {
    document.addEventListener('scroll', scheduleParallax, { passive: true });
    window.addEventListener('resize', () => {
      for (const item of parallaxEls) {
        item.el.style.transform = item.transform;
        item.baseTop = item.el.getBoundingClientRect().top + window.scrollY;
      }
      scheduleParallax();
    });
    scheduleParallax();
  }

  /* -------- 3. Reveal on scroll -------- */
  const revealEls = document.querySelectorAll('.reveal');
  const revealIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const delay = parseInt(entry.target.dataset.revealDelay || '0', 10);
        if (delay) setTimeout(() => entry.target.classList.add('in'), delay);
        else entry.target.classList.add('in');
        revealIO.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -80px 0px' });
  revealEls.forEach(el => revealIO.observe(el));

  /* -------- 4. Animated counters (with ru-thousand-spaces) -------- */
  const formatNumber = (n, isInt) => {
    const v = isInt ? Math.round(n) : n.toFixed(1);
    // Add thin-space thousands separators (Russian/Belarusian style)
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const isInt = target % 1 === 0;
    const duration = 1800;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = formatNumber(target * easeOut(t), isInt) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = formatNumber(target, isInt) + suffix;
    };
    requestAnimationFrame(step);
  };

  const counterEls = document.querySelectorAll('[data-count]');
  const counterIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        counterIO.unobserve(entry.target);
      }
    }
  }, { threshold: 0.4 });
  counterEls.forEach(el => counterIO.observe(el));

  /* -------- 5. Tilt on .card-tilt -------- */
  if (!prefersReducedMotion && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('.card-tilt').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `translateY(-6px) perspective(900px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  /* -------- 6. Smooth scroll w/ nav offset -------- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  });

  /* -------- 7. Oracle eye pupil follows mouse + scroll -------- */
  const pupilGrp = document.getElementById('eye-pupil-grp');
  if (pupilGrp && !prefersReducedMotion) {
    let mouseX = 0, mouseY = 0, hasMouse = false;
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX / window.innerWidth;  // 0..1
      mouseY = e.clientY / window.innerHeight; // 0..1
      hasMouse = true;
      schedulePupil();
    }, { passive: true });
    document.addEventListener('scroll', schedulePupil, { passive: true });

    let pupilRaf = null;
    function schedulePupil() {
      if (pupilRaf) return;
      pupilRaf = requestAnimationFrame(() => {
        pupilRaf = null;
        // mouse contributes most; scroll progress contributes slight downward drift
        const scrollFrac = Math.min(window.scrollY / window.innerHeight, 1);
        let dx, dy;
        if (hasMouse) {
          dx = (mouseX - 0.5) * 14;  // px
          dy = (mouseY - 0.5) * 10 + scrollFrac * 6;
        } else {
          dx = 0;
          dy = scrollFrac * 8;
        }
        pupilGrp.setAttribute('transform', `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      });
    }
    schedulePupil();
  }
})();
