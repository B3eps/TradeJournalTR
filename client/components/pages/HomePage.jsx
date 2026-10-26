// "Bugün": the default home page combining tasks, time, markets, trades, cards, notes and habits.
// Each widget fetches independently and handles its own loading/error state.
const React = require('react');
const { navigate } = require('../../utils/navigation');
const Header = require('../home/Header');
const TasksWidget = require('../home/TasksWidget');
const TimeWidget = require('../home/TimeWidget');
const MarketWidget = require('../home/MarketWidget');
const TradeWidget = require('../home/TradeWidget');
const { CardsWidget, NotesWidget, HabitsWidget } = require('../home/LifeWidgets');
const WeeklyReview = require('../home/WeeklyReview');

// A crash inside one widget must never take the page down.
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* swallow */ }
  render() {
    if (this.state.failed) {
      return (
        <div className="bg-bg-surface border border-border rounded-2xl p-5 text-xs text-text-tertiary">
          Bu bölüm şu anda gösterilemiyor.
        </div>
      );
    }
    return this.props.children;
  }
}

const HomePage = ({ onNavigate, trades }) => {
  const go = React.useCallback((page) => {
    if (typeof onNavigate === 'function') onNavigate(page);
    else navigate(page);
  }, [onNavigate]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-8 flex flex-col gap-6">
      <Header onNavigate={go} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        <Boundary><TasksWidget onNavigate={go} /></Boundary>
        <Boundary><TimeWidget onNavigate={go} /></Boundary>
        <Boundary><MarketWidget onNavigate={go} navigate={navigate} /></Boundary>
        <Boundary><TradeWidget onNavigate={go} trades={trades} /></Boundary>
        <Boundary><CardsWidget onNavigate={go} /></Boundary>
        <Boundary><NotesWidget onNavigate={go} /></Boundary>
        <Boundary><HabitsWidget onNavigate={go} /></Boundary>
      </div>
      <Boundary><WeeklyReview trades={trades} /></Boundary>
    </div>
  );
};

module.exports = HomePage;
