
// Simple in-app i18n (PT-BR and EN)
const MESSAGES = {
  "pt": {
    TITLE: "ESPN Fantasy AI",
    SUBTITLE: "Login simples. Dados reais. Zero configuração.",
    STATUS: "Status",
    DISCONNECTED: "Desconectado",
    CONNECTED: "Conectado",
    CONNECT_BTN: "Conectar com ESPN",
    MY_LEAGUES: "📊 Minhas Ligas",
    LOAD_LEAGUES: "Carregar ligas",
    ASSISTANT: "💬 Assistente IA",
    HINT: "Perguntas (ex.): \"Quem escalar esta semana?\"",
    PLACEHOLDER_Q: "Quem escalar esta semana?",
    LEAGUE_ID: "leagueId",
    TEAM_ID: "teamId",
    PERIOD_ID: "scoringPeriodId (opcional)",
    ASK: "Perguntar",
    CONSULTING: "Consultando...",
    LOADING: "Carregando...",
    LOGIN_OPENING: "Abrindo ESPN para login...",
    LOGIN_ERROR: "Erro no login",
    TIP: "Se algum item estiver indisponível, tente novamente mais tarde. Nunca mostramos dados fictícios.",
    LANGUAGE: "Idioma",
    DRAFT: "🏈 Draft Helper",
    DRAFT_HINT: "Forneça IDs de jogadores (ex.: 8479,3916387) e veja recomendações sem invenção (em breve).",
    RECOMMEND: "Recomendar"
  },
  "en": {
    TITLE: "ESPN Fantasy AI",
    SUBTITLE: "Simple login. Real data. Zero configuration.",
    STATUS: "Status",
    DISCONNECTED: "Disconnected",
    CONNECTED: "Connected",
    CONNECT_BTN: "Connect with ESPN",
    MY_LEAGUES: "📊 My Leagues",
    LOAD_LEAGUES: "Load leagues",
    ASSISTANT: "💬 AI Assistant",
    HINT: "Examples: \"Who should I start this week?\"",
    PLACEHOLDER_Q: "Who should I start this week?",
    LEAGUE_ID: "leagueId",
    TEAM_ID: "teamId",
    PERIOD_ID: "scoringPeriodId (optional)",
    ASK: "Ask",
    CONSULTING: "Fetching...",
    LOADING: "Loading...",
    LOGIN_OPENING: "Opening ESPN for login...",
    LOGIN_ERROR: "Login error",
    TIP: "If anything is unavailable, try again later. We never show fabricated data.",
    LANGUAGE: "Language",
    DRAFT: "🏈 Draft Helper",
    DRAFT_HINT: "Provide player IDs (e.g., 8479,3916387) and see grounded recommendations (coming soon).",
    RECOMMEND: "Recommend"
  }
};

function getDefaultLang(){
  try {
    const saved = localStorage.getItem('espn.lang');
    if (saved) return saved;
  } catch {}
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('pt')) return 'pt';
  return 'en';
}

let CUR_LANG = getDefaultLang();

function t(key){
  return (MESSAGES[CUR_LANG] && MESSAGES[CUR_LANG][key]) || (MESSAGES['en'][key]) || key;
}

function setLang(lang){
  CUR_LANG = (lang === 'pt' || lang === 'en') ? lang : 'en';
  try { localStorage.setItem('espn.lang', CUR_LANG); } catch {}
  document.dispatchEvent(new CustomEvent('espn:lang-changed', { detail: { lang: CUR_LANG } }));
}

export { t, setLang, getDefaultLang };
