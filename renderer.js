
import { t, setLang, getDefaultLang } from './i18n.js';

const statusText = document.getElementById('statusText');
const statusLabel = document.getElementById('statusLabel');
const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const loginBtn = document.getElementById('loginBtn');
const loadLeaguesBtn = document.getElementById('loadLeagues');
const leaguesDiv = document.getElementById('leagues');
const askBtn = document.getElementById('ask');
const q = document.getElementById('q');
const leagueIdInput = document.getElementById('leagueId');
const teamIdInput = document.getElementById('teamId');
const periodIdInput = document.getElementById('periodId');
const answerPre = document.getElementById('answer');
const langSel = document.getElementById('langSel');
const langLabel = document.getElementById('langLabel');
const myLeagues = document.getElementById('myLeagues');
const assistant = document.getElementById('assistant');
const hint = document.getElementById('hint');
const draft = document.getElementById('draft');
const draftHint = document.getElementById('draftHint');
const recoPre = document.getElementById('reco');
const recommendBtn = document.getElementById('recommend');
const candidateIdsInput = document.getElementById('candidateIds');

function applyI18n(){
  title.innerText = `🏈 ${t('TITLE')}`;
  subtitle.innerText = t('SUBTITLE');
  statusLabel.innerText = t('STATUS');
  statusText.innerText = statusText.innerText === 'Conectado' || statusText.innerText === 'Connected' ? t('CONNECTED') : t('DISCONNECTED');
  loginBtn.innerText = t('CONNECT_BTN');
  myLeagues.innerText = t('MY_LEAGUES');
  loadLeaguesBtn.innerText = t('LOAD_LEAGUES');
  assistant.innerText = t('ASSISTANT');
  hint.innerText = t('HINT');
  q.placeholder = t('PLACEHOLDER_Q');
  leagueIdInput.placeholder = t('LEAGUE_ID');
  teamIdInput.placeholder = t('TEAM_ID');
  periodIdInput.placeholder = t('PERIOD_ID');
  askBtn.innerText = t('ASK');
  langLabel.innerText = t('LANGUAGE');
  draft.innerText = t('DRAFT');
  draftHint.innerText = t('DRAFT_HINT');
  recommendBtn.innerText = t('RECOMMEND');
}

document.addEventListener('espn:lang-changed', applyI18n);

async function refreshStatus(){
  const s = await window.espn.getStatus();
  statusText.innerText = s?.authenticated ? t('CONNECTED') : t('DISCONNECTED');
}

langSel.value = getDefaultLang();
langSel.addEventListener('change', (e) => {
  setLang(e.target.value);
});

loginBtn.onclick = async () => {
  loginBtn.disabled = true;
  statusText.innerText = t('LOGIN_OPENING');
  try {
    const res = await window.espn.login();
    statusText.innerText = res?.authenticated ? t('CONNECTED') : t('DISCONNECTED');
  } catch(e){
    statusText.innerText = t('LOGIN_ERROR');
  } finally {
    loginBtn.disabled = false;
  }
};

loadLeaguesBtn.onclick = async () => {
  leaguesDiv.innerText = t('LOADING');
  const leagues = await window.espn.getLeagues();
  leaguesDiv.innerText = JSON.stringify(leagues, null, 2);
};

askBtn.onclick = async () => {
  answerPre.innerText = t('CONSULTING');
  const leagueId = parseInt(leagueIdInput.value || '0', 10);
  const teamId = parseInt(teamIdInput.value || '0', 10);
  const scoringPeriodId = periodIdInput.value ? parseInt(periodIdInput.value, 10) : undefined;
  const result = await window.espn.getMatchups(leagueId, scoringPeriodId);
  const roster = await window.espn.getRoster(leagueId, teamId, scoringPeriodId);
  const standings = await window.espn.getStandings(leagueId);
  const response = {
    ok: true,
    info: {
      standings_ok: !!standings && standings.ok !== false,
      matchups_ok: !!result && result.ok !== false,
      roster_ok: !!roster && roster.ok !== false
    },
    tip: t('TIP')
  };
  answerPre.innerText = JSON.stringify(response, null, 2);
};

recommendBtn.onclick = async () => {
  recoPre.innerText = t('CONSULTING');
  const ids = (candidateIdsInput.value || '').split(',').map(s => parseInt(s.trim(),10)).filter(Boolean);
  // Future release: call recommendation IPC. For now, placeholder message (no fake data shown).
  recoPre.innerText = t('DRAFT_HINT');
};

applyI18n();
refreshStatus();
