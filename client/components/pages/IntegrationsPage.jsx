// =====================================================
// BAĞLANTILAR (Ayarlar > Bağlantılar)
// Telefon bildirimi (ntfy), yedekleme, yerel yapay zeka (Ollama) ve Google.
// Data: /api/integrations/{ntfy,backup,ai}; Google bölümü ayrı bir bileşendir.
// =====================================================
const React = require('react');
const { FadeIn, Stagger, StaggerItem } = require('../ui/motion');
const { SectionCard, Icon } = require('../integrations/ui');
const NtfySection = require('../integrations/NtfySection');
const BackupSection = require('../integrations/BackupSection');
const AiSection = require('../integrations/AiSection');

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
  <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <FadeIn>
      <h1 className="text-2xl font-semibold text-text-primary">Bağlantılar</h1>
      <p className="text-text-secondary text-sm mt-1">
        Telefon bildirimleri, yedekler, yerel yapay zeka ve Google hesabı. Hepsi isteğe bağlıdır ve bu bilgisayarda çalışır.
      </p>
    </FadeIn>

    <Stagger className="mt-6 space-y-5" stagger={0.06}>
      <StaggerItem>
        <SectionBoundary name="Telefon bildirimi"><NtfySection /></SectionBoundary>
      </StaggerItem>
      <StaggerItem>
        <SectionBoundary name="Yedekleme"><BackupSection /></SectionBoundary>
      </StaggerItem>
      <StaggerItem>
        <SectionBoundary name="Yerel yapay zeka"><AiSection onNavigate={onNavigate} /></SectionBoundary>
      </StaggerItem>
      <StaggerItem>
        <SectionBoundary name="Google">
          <SectionCard icon={<Icon.Google />} title="Google" subtitle="Classroom ve Takvim bağlantısı.">
            <GoogleSection onNavigate={onNavigate} />
          </SectionCard>
        </SectionBoundary>
      </StaggerItem>
    </Stagger>
  </div>
);

module.exports = IntegrationsPage;
