// Greeting, date and quick actions.
const React = require('react');
const { FadeIn } = require('../ui/motion');
const { requestQuickAddTask, requestNewTrade } = require('../../utils/navigation');
const { requestNewNote } = require('../notes/events');
const focusStore = require('../focus/store');
const sound = require('../../utils/sound');
const { Icon } = require('./ui');

const greeting = (hour) => (hour < 5 ? 'İyi geceler' : hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar');

const Header = ({ onNavigate }) => {
  const now = new Date();
  const dateText = now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const actions = [
    { label: 'Yeni görev', onClick: () => requestQuickAddTask(), primary: true },
    { label: 'Yeni işlem', onClick: () => requestNewTrade() },
    { label: 'Yeni not', onClick: () => requestNewNote() },
    {
      label: 'Odak başlat',
      onClick: () => {
        onNavigate('focus');
        // Sayaç zaten çalışmıyorsa başlat (çalışıyorsa dokunma).
        if (focusStore.getState().status !== 'running') { sound.play('start'); focusStore.start(); }
      },
    },
  ];
  return (
    <FadeIn className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{greeting(now.getHours())}</h1>
        <p className="text-sm text-text-secondary mt-1">{dateText}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
              a.primary ? 'bg-accent text-accent-text border-accent hover:opacity-90' : 'bg-bg-surface text-text-primary border-border hover:border-text-tertiary'
            }`}
          >
            <Icon name="plus" className="w-3.5 h-3.5" />{a.label}
          </button>
        ))}
      </div>
    </FadeIn>
  );
};

module.exports = Header;
