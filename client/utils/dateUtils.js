const formatDuration = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}g ${hours}sa ${minutes}dk`;
  if (hours > 0) return `${hours}sa ${minutes}dk ${seconds}sn`;
  if (minutes > 0) return `${minutes}dk ${seconds}sn`;
  return `${seconds}sn`;
};

// Geçmişte işlem günlüğü sabit New York (EST) saatine göre çalışıyordu. Artık tarayıcının yerel
// saat dilimi kullanılıyor (uygulamanın geri kalanıyla tutarlı). Fonksiyon adları geriye dönük
// uyumluluk için aynı kaldı ("EST" adı artık "yerel saat" anlamına gelir).
const resolveLocalTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
};
const EST_TZ = resolveLocalTz();
const NEW_YORK_TZ = 'America/New_York';

// Date components in the local timezone - returns an object with the same shape as before
const toEST = (date) => {
  const d = new Date(date);
  // Use Intl to get the parts in EST
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find(p => p.type === type).value;
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hours: parseInt(get('hour'), 10) % 24,
    minutes: parseInt(get('minute'), 10),
    seconds: parseInt(get('second'), 10),
  };
};

const formatDateEST = (dateString) => {
  return new Date(dateString).toLocaleDateString('tr-TR', { month: 'short', day: 'numeric', year: 'numeric', timeZone: EST_TZ });
};

const formatTimeEST = (dateString) => {
  return new Date(dateString).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: EST_TZ });
};

const formatFullDateEST = (dateString) => {
  return new Date(dateString).toLocaleDateString('tr-TR', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: EST_TZ });
};

// Offset string ("+03:00") of the local timezone for the given date (handles DST)
const getESTOffset = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Z';
  const total = -d.getTimezoneOffset();
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
};

// New York offset ("-04:00" / "-05:00") - only for explicit "New York" choices (e.g. CSV import)
const getNewYorkOffset = (date) => {
  const d = new Date(date);
  const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
  const nyStr = d.toLocaleString('en-US', { timeZone: NEW_YORK_TZ });
  const diffHours = (new Date(nyStr) - new Date(utcStr)) / 3600000;
  return diffHours === -4 ? '-04:00' : '-05:00';
};

module.exports = { formatDuration, EST_TZ, toEST, formatDateEST, formatTimeEST, formatFullDateEST, getESTOffset, getNewYorkOffset };
