// =====================================================
// BAĞLANTILAR (Ayarlar > Bağlantılar)
// Telefon bildirimi (ntfy), yedekleme, ChatGPT haber analizi ve Google.
// Data: /api/integrations/{ntfy,backup,ai}; Google bölümü ayrı bir bileşendir.
// =====================================================
const React = require('react');
const { useState } = React;
const { FadeIn, Stagger, StaggerItem } = require('../ui/motion');
const { SectionCard, Icon } = require('../integrations/ui');
const NtfySection = require('../integrations/NtfySection');
const BackupSection = require('../integrations/BackupSection');
const ChatGPTNewsSection = require('../integrations/ChatGPTNewsSection');

const unwrap = (m) => (m && m.default ? m.default : m);
const GoogleSection = unwrap(require('../integrations/GoogleSection'));

// A failing section must never take the whole page down.
class SectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err) {
    console.error('[Bağlantılar] bölüm hatası:', err);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="bg-bg-surface border border-negative/30 rounded-2xl p-5 text-sm text-negative">
          {this.props.name} bölümü yüklenemedi. Sayfayı yenilemeyi deneyin.
        </div>
      );
    }
    return this.props.children;
  }
}

const IntegrationsPage = ({ onNavigate }) => (
  <IntegrationsContent onNavigate={onNavigate} />
);

const categories = [
  { id: 'notifications', label: 'Bildirimler', description: 'Telefonuna görev ve haber bildirimleri gönder.' },
  { id: 'backup', label: 'Yedekleme', description: 'Yerel verilerini yedekle ve geri yükle.' },
  { id: 'ai', label: 'ChatGPT haber analizi', description: 'Haberleri kendi ChatGPT hesabınla değerlendir.' },
  { id: 'google', label: 'Google', description: 'Google Classroom ve Takvim bağlantılarını yönet.' },
];

const IntegrationsContent = ({ onNavigate }) => {
  const [category, setCategory] = useState('notifications');
  const active = categories.find((item) => item.id === category) || categories[0];
  return (
  <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <FadeIn>
      <h1 className="text-2xl font-semibold text-text-primary">Bağlantılar</h1>
      <p className="text-text-secondary text-sm mt-1">Bağlantıları konu başlıklarına göre ayrı ayrı yönet.</p>
    </FadeIn>

    <div className="mt-6 grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-5 items-start">
      <nav className="bg-bg-surface border border-border rounded-xl p-2 space-y-1" aria-label="Bağlantı kategorileri">
        {categories.map((item) => (
          <button key={item.id} type="button" onClick={() => setCategory(item.id)} aria-current={category === item.id ? 'page' : undefined}
            className={`w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${category === item.id ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-input hover:text-text-primary'}`}>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="min-w-0">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-text-primary">{active.label}</h2>
          <p className="text-sm text-text-tertiary mt-0.5">{active.description}</p>
        </div>
        <Stagger className="space-y-5" stagger={0.06}>
          {category === 'notifications' && <StaggerItem><SectionBoundary name="Telefon bildirimi"><NtfySection /></SectionBoundary></StaggerItem>}
          {category === 'backup' && <StaggerItem><SectionBoundary name="Yedekleme"><BackupSection /></SectionBoundary></StaggerItem>}
          {category === 'ai' && <StaggerItem><SectionBoundary name="ChatGPT haber analizi"><ChatGPTNewsSection /></SectionBoundary></StaggerItem>}
          {category === 'google' && <StaggerItem><SectionBoundary name="Google"><SectionCard icon={<Icon.Google />} title="Google" subtitle="Classroom ve Takvim bağlantısı."><GoogleSection onNavigate={onNavigate} /></SectionCard></SectionBoundary></StaggerItem>}
        </Stagger>
      </div>
    </div>
  </div>
  );
};

module.exports = IntegrationsPage;
