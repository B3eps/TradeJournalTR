// Small stroke icon set for the Tasks page (drawn for this project).
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
  Icon.displayName = `TaskIcon${name}`;
  return Icon;
};

const TI = {
  Inbox: mk(<><path d="M4 13l2.5-7.5h11L20 13" /><path d="M4 13v6h16v-6h-5l-1 2h-4l-1-2z" /></>, 'Inbox'),
  Sun: mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, 'Sun'),
  Calendar: mk(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>, 'Calendar'),
  Layers: mk(<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>, 'Layers'),
  CheckCircle: mk(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>, 'CheckCircle'),
  Check: mk(<path d="M5 12.5l4.5 4.5L19 7.5" />, 'Check'),
  Hash: mk(<path d="M9 4L7 20M17 4l-2 16M4 9h16M3.5 15h16" />, 'Hash'),
  Tag: mk(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8" r="1.3" /></>, 'Tag'),
  Plus: mk(<path d="M12 5v14M5 12h14" />, 'Plus'),
  X: mk(<path d="M6 6l12 12M18 6L6 18" />, 'X'),
  Trash: mk(<><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" /><path d="M10 11v5M14 11v5" /></>, 'Trash'),
  Play: mk(<path d="M7 5l12 7-12 7z" />, 'Play'),
  Stop: mk(<rect x="6" y="6" width="12" height="12" rx="2" />, 'Stop'),
  Pencil: mk(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>, 'Pencil'),
  Flag: mk(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>, 'Flag'),
  Repeat: mk(<><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>, 'Repeat'),
  Link: mk(<><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" /></>, 'Link'),
  Clock: mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, 'Clock'),
  Search: mk(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>, 'Search'),
  ChevronDown: mk(<path d="M6 9l6 6 6-6" />, 'ChevronDown'),
  ChevronRight: mk(<path d="M9 6l6 6-6 6" />, 'ChevronRight'),
  Grip: mk(<><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></>, 'Grip'),
  Columns: mk(<><rect x="3.5" y="4" width="5" height="16" rx="1.5" /><rect x="10.5" y="4" width="5" height="11" rx="1.5" /><rect x="17.5" y="4" width="3" height="7" rx="1" /></>, 'Columns'),
  Rows: mk(<path d="M4 6h16M4 12h16M4 18h16" />, 'Rows'),
  Note: mk(<><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>, 'Note'),
  Trend: mk(<><path d="M3 17l6-6 4 4 7-7" /><path d="M15 8h5v5" /></>, 'Trend'),
  News: mk(<><rect x="3" y="5" width="15" height="14" rx="1.5" /><path d="M18 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h4" /></>, 'News'),
  Globe: mk(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>, 'Globe'),
  Eye: mk(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>, 'Eye'),
  Alert: mk(<><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></>, 'Alert'),
  Refresh: mk(<><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 3v5h5" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 21v-5h-5" /></>, 'Refresh'),
  Subtask: mk(<><path d="M6 4v9a3 3 0 0 0 3 3h9" /><path d="M15 13l3 3-3 3" /></>, 'Subtask'),
  Fire: mk(<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2-4.6.2 1.6 1 2.6 2 3 0-3 .5-5.6 1-8.4z" />, 'Fire'),
  Target: mk(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>, 'Target'),
  Sort: mk(<><path d="M7 4v16M3.5 16.5L7 20l3.5-3.5" /><path d="M17 20V4M13.5 7.5L17 4l3.5 3.5" /></>, 'Sort'),
  Dots: mk(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>, 'Dots'),
  External: mk(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>, 'External'),
};

module.exports = TI;
