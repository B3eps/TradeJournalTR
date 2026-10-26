// Small stroke icon set for the Kartlar page (drawn for this project).
const React = require('react');

const mk = (children, name) => {
  const Icon = ({ className = 'w-4 h-4', strokeWidth = 2, ...rest }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
  Icon.displayName = `CardIcon${name}`;
  return Icon;
};

module.exports = {
  Plus: mk(<path d="M12 5v14M5 12h14" />, 'Plus'),
  X: mk(<path d="M6 6l12 12M18 6L6 18" />, 'X'),
  Check: mk(<path d="M5 12.5l4.5 4.5L19 7.5" />, 'Check'),
  Alert: mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16v.5" /></>, 'Alert'),
  Play: mk(<path d="M7 5l12 7-12 7z" />, 'Play'),
  Undo: mk(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>, 'Undo'),
  Edit: mk(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>, 'Edit'),
  Trash: mk(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>, 'Trash'),
  Pause: mk(<><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></>, 'Pause'),
  Search: mk(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>, 'Search'),
  Fire: mk(<path d="M12 3c1 3.5 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .3 1.2 1 1.8 1.7 2C10.5 8 11 5.5 12 3z" />, 'Fire'),
  Target: mk(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>, 'Target'),
  Layers: mk(<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>, 'Layers'),
  Sparkle: mk(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />, 'Sparkle'),
  Refresh: mk(<><path d="M20 11a8 8 0 00-14.5-4M4 4v4h4" /><path d="M4 13a8 8 0 0014.5 4M20 20v-4h-4" /></>, 'Refresh'),
  Upload: mk(<><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4 15v4h16v-4" /></>, 'Upload'),
  Download: mk(<><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4 19h16" /></>, 'Download'),
  Settings: mk(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>, 'Settings'),
  Back: mk(<path d="M15 5l-7 7 7 7" />, 'Back'),
};
