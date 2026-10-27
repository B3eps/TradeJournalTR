/*
 * Rail button + popover for UI sound and animation preferences.
 *   <SoundSettings side="right" />            (default trigger: icon button)
 *   <SoundSettings trigger={<button>...</button>} />
 */
const React = require('react');
const { useState } = React;
const { Volume2, Volume1, VolumeX, Sparkles } = require('lucide-react');
const { Popover, PopoverTrigger, PopoverContent } = require('../ui/popover');
const { cn } = require('../../lib/utils');
const sound = require('../../utils/sound');
const { useAnimationPreference } = require('../ui/motion');

let muteTimeout = null;

const Switch = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cn(
      'ui-anim relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
      checked ? 'bg-accent border-accent' : 'bg-bg-input border-border'
    )}
  >
    <span
      className={cn(
        'ui-anim inline-block h-3.5 w-3.5 rounded-full shadow-sm transition-transform duration-200',
        checked ? 'translate-x-[18px] bg-accent-text' : 'translate-x-[3px] bg-text-tertiary'
      )}
    />
  </button>
);

const Row = ({ icon: Icon, title, hint, children }) => (
  <div className="flex items-center gap-3 py-2">
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-bg-input text-text-secondary">
      <Icon className="h-4 w-4" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-text-primary leading-tight">{title}</p>
      {hint && <p className="mt-0.5 text-[11px] text-text-tertiary leading-tight">{hint}</p>}
    </div>
    {children}
  </div>
);

const SoundSettings = ({ side = 'right', align = 'end', trigger, className }) => {
  const [open, setOpen] = useState(false);
  const { enabled, volume } = sound.useSound();
  const [animPref, setAnimPref] = useAnimationPreference();

  const VolIcon = !enabled || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const toggleSound = (next) => {
    if (next) {
      if (muteTimeout) clearTimeout(muteTimeout);
      muteTimeout = null;
      sound.setEnabled(true);
      sound.play('toggle-on');
    } else {
      sound.play('toggle-off');
      // Let the "off" sound be heard before muting.
      if (muteTimeout) clearTimeout(muteTimeout);
      muteTimeout = setTimeout(() => {
        muteTimeout = null;
        sound.setEnabled(false);
      }, 120);
    }
  };

  const toggleAnim = (next) => {
    setAnimPref(next);
    sound.play(next ? 'toggle-on' : 'toggle-off');
  };

  const pct = Math.round(volume * 100);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) sound.play('click'); }}>
      <PopoverTrigger asChild>
        {trigger || (
          <button
            type="button"
            aria-label="Ses ve animasyon ayarları"
            className={cn(
              'group relative flex h-10 w-10 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              open && 'bg-bg-surface text-text-primary',
              className
            )}
          >
            <VolIcon className="h-[18px] w-[18px]" />
            {!open && (
              <span className="ui-tooltip pointer-events-none absolute left-full top-1/2 z-[70] ml-3 whitespace-nowrap rounded-md border border-border bg-bg-surface px-2 py-1 text-xs font-medium text-text-primary shadow-lg">
                Ses ve animasyon
              </span>
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={12} className="w-72 rounded-xl p-0 shadow-2xl">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-text-primary">Ses ve animasyon</p>
          <p className="mt-0.5 text-[11px] text-text-tertiary">Arayüz geri bildirimlerini ayarlayın</p>
        </div>
        <div className="px-4 py-2">
          <Row icon={enabled ? Volume2 : VolumeX} title="Ses efektleri" hint={enabled ? 'Açık' : 'Kapalı'}>
            <Switch checked={enabled} onChange={toggleSound} label="Ses efektleri" />
          </Row>

          <div className={cn('py-2 transition-opacity', !enabled && 'pointer-events-none opacity-40')}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-text-secondary">Ses düzeyi</span>
              <span className="font-data text-xs tabular-nums text-text-tertiary">%{pct}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              aria-label="Ses düzeyi"
              onChange={(e) => sound.setVolume(Number(e.target.value) / 100)}
              onPointerUp={() => sound.play('pop')}
              onKeyUp={() => sound.play('click')}
              className="ui-range h-1.5 w-full cursor-pointer"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[['click', 'Tık'], ['complete', 'Tamam'], ['notify', 'Bildirim'], ['alert', 'Uyarı']].map(([name, lbl]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => sound.play(name)}
                  className="rounded-md border border-border bg-bg-input/60 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary"
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <Row icon={Sparkles} title="Animasyonlar" hint="Sistem 'hareketi azalt' ayarı her zaman geçerlidir">
            <Switch checked={animPref} onChange={toggleAnim} label="Animasyonlar" />
          </Row>
        </div>
      </PopoverContent>
    </Popover>
  );
};

module.exports = SoundSettings;
