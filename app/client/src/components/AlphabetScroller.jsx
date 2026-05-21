import { useRef, useState } from 'react';

const RU = ['#', ...'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('')];

export default function AlphabetScroller({ availableLetters, onJump, inModal = false }) {
  const ref = useRef();
  const dragging = useRef(false);
  const [active, setActive] = useState(null);
  const available = new Set(availableLetters);

  function findClosest(letter) {
    if (available.has(letter)) return letter;
    const idx = RU.indexOf(letter);
    for (let d = 1; d < RU.length; d++) {
      const up = RU[idx + d];
      const down = RU[idx - d];
      if (up && available.has(up)) return up;
      if (down && available.has(down)) return down;
    }
    return null;
  }

  function handle(e) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top));
    const idx = Math.floor((y / rect.height) * RU.length);
    const L = RU[idx];
    setActive(L);
    const target = findClosest(L);
    if (target) onJump(target);
  }

  return (
    <>
      <div
        ref={ref}
        className={`alphabet-scroller${inModal ? ' in-modal' : ''}`}
        onPointerDown={e => {
          e.preventDefault();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          handle(e);
        }}
        onPointerMove={e => dragging.current && handle(e)}
        onPointerUp={() => { dragging.current = false; setActive(null); }}
        onPointerCancel={() => { dragging.current = false; setActive(null); }}
      >
        {RU.map(L => (
          <span
            key={L}
            className={`alpha-letter${available.has(L) ? '' : ' disabled'}${active === L ? ' active' : ''}`}
          >
            {L}
          </span>
        ))}
      </div>
      {active && <div className={`alpha-overlay${inModal ? ' in-modal' : ''}`}>{active}</div>}
    </>
  );
}

export function firstLetter(name) {
  const m = (name || '').match(/[А-ЯЁа-яё]/);
  return m ? m[0].toUpperCase().replace('Ё', 'Е') : '#';
}

export function sortLetters(letters) {
  return [...letters].sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a.localeCompare(b, 'ru');
  });
}
