const React = require('react');
const { useState, useEffect, useRef } = React;

const useWindowWidth = () => {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
};

// Escape ile kapanan katmanlar (modal/onay penceresi): yalnızca en üstteki katman tepki verir.
const escapeStack = [];
const useEscapeClose = (active, onClose) => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    const token = {};
    escapeStack.push(token);
    const handler = (e) => {
      if (e.key !== 'Escape' || escapeStack[escapeStack.length - 1] !== token) return;
      if (typeof closeRef.current === 'function') closeRef.current(e);
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      const i = escapeStack.indexOf(token);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
};

module.exports = { useWindowWidth, useEscapeClose };
