// src/main.js — ESPN Fantasy AI (Electron) — versão completa e simples

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let authWindow;
let creds = { espn_s2: null, SWID: null };

// UA de navegador real — evita páginas HTML/landing no fetch
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// -------------------------------------------------------------
// Janela principal
// -------------------------------------------------------------
async function createWindow () {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // força UA em TODAS as requests da app session
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = BROWSER_UA;
    callback({ requestHeaders: details.requestHeaders });
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// -------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------
function currentYear(){
  const d = new Date();
  return (d.getMonth() + 1) >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

// Lê cookies tanto de fantasy quanto de www (o que tiver válido primeiro)
async function pollCookies(targetSession){
  const domains = ['https://fantasy.espn.com', 'https://www.espn.com'];
  let s2v = null, swv = null;

  for (const url of domains) {
    try {
      const s2 = await targetSession.cookies.get({ url, name: 'espn_s2' });
      const sw = await targetSession.cookies.get({ url, name: 'SWID' });
      if (!s2v && s2 && s2[0] && s2[0].value) s2v = s2[0].value;
      if (!swv && sw && sw[0] && sw[0].value) swv = sw[0].value;
      if (s2v && swv) break;
    } catch(e) {}
  }
  return { espn_s2: s2v, SWID: swv };
}

function baseHeaders(){
  return {
    'User-Agent': BROWSER_UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,pt;q=0.8',
    'Referer': 'https://fantasy.espn.com',
    'Origin': 'https://fantasy.espn.com',
    'x-fantasy-platform': 'kona',
    'x-fantasy-source': 'kona',
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache'
  };
}

function cookieHeaderValue(){
  return `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`;
}

// -------------------------------------------------------------
// Login — abre o site de fantasy (garante cookies no domínio certo)
// -------------------------------------------------------------
ipcMain.handle('espn:login', async () => {
  return new Promise(async (resolve) => {
    authWindow = new BrowserWindow({
      width: 900,
      height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    // força UA na janela de login também
    authWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = BROWSER_UA;
      callback({ requestHeaders: details.requestHeaders });
    });

    // abre primeiro o fantasy (não o www) para setar cookies válidos lá
    authWindow.loadURL('https://fantasy.espn.com/');

    let tries = 0;
    const check = async () => {
      tries += 1;
      const c = await pollCookies(authWindow.webContents.session);
      if (c.espn_s2 && c.SWID) {
        creds = c;
        try { authWindow.close(); } catch(e) {}
        resolve({ authenticated: true });
        return;
      }
      if (tries > 120) { // ~60s
        resolve({ authenticated: false, message: 'Tempo esgotado para login' });
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
});

ipcMain.handle('espn:status', async () => ({ authenticated: !!(creds.espn_s2 && creds.SWID) }));

// -------------------------------------------------------------
// Helpers de fetch: GET e POST — sempre leem texto e tentam JSON
// -------------------------------------------------------------
async function parseResponse(res){
  const contentType = res.headers.get('content-type') || '';
  const status = res.status;
  let bodyText = '';
  try { bodyText = await res.text(); } catch { bodyText = ''; }

  if (status === 401 || status === 403) {
    return { ok:false, reason:'invalid', message:'Sessão expirada. Clique em Conectar com ESPN novamente.', status, contentType };
  }

  try {
    const data = JSON.parse(bodyText);
    return { ok:true, data, status, contentType };
  } catch {
    return { ok:false, reason:'indisponivel', message:'Formato inesperado', status, contentType, raw: bodyText.slice(0, 500) };
  }
}

async function fetchESPN(url, extraHeaders = {}) {
  if (!creds.espn_s2 || !creds.SWID) return { ok:false, reason:'invalid', message:'Não autenticado' };
  const res = await fetch(url, {
    method: 'GET',
    headers: { ...baseHeaders(), 'Cookie': cookieHeaderValue(), ...extraHeaders },
    redirect: 'follow'
  });
  return parseResponse(res);
}

async function fetchESPN_POST(url, body = {}, extraHeaders = {}) {
  if (!creds.espn_s2 || !creds.SWID) return { ok:false, reason:'invalid', message:'Não autenticado' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Cookie': cookieHeaderValue(), 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  return parseResponse(res);
}

// -------------------------------------------------------------
// IPC — chamadas reais (sempre dados reais, sem invenção)
// -------------------------------------------------------------

// Ligas do usuário — endpoint indicado: leagueHistory/members (com fallbacks)
// Se falhar, faz um probe simples para confirmar autenticação.
ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  const urls = [
    'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/leagueHistory/members',
    'https://fantasy.espn.com/apis/v3/games/ffl/leagueHistory/members'
  ];

  for (const url of urls) {
    const res = await fetchESPN(url, { 'Accept': 'application/json' });

    if (res && res.ok && Array.isArray(res.data)) {
      const active = res.data.filter((l) => {
        const s = l.seasonId ?? l.season ?? l.seasonYear ?? l.season_id ?? null;
        return s === y || s === y - 1;
      });
      return { ok:true, data: active, status: res.status, contentType: res.contentType };
    }
    if (res && res.reason === 'invalid') return res; // sessão expirada
  }

  // Probe simples: se players responde, cookies estão bons
  const probeUrl = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/players?view=players_wl&limit=1`;
  const probe = await fetchESPN(probeUrl, { 'Accept': 'application/json' });
  if (probe && probe.ok) {
    return {
      ok: true,
      data: [],
      status: probe.status,
      contentType: probe.contentType,
      note: 'Autenticado, mas leagueHistory/members não retornou ligas agora.'
    };
  }

  return {
    ok:false,
    reason:'indisponivel',
    message:'Não foi possível obter suas ligas agora (leagueHistory/members retornou HTML/redirecionamento). Clique em Conectar com ESPN e faça login novamente.'
  };
});

// Times (mTeam)
ipcMain.handle('espn:getTeams', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mTeam`;
  return fetchESPN(url);
});

// Classificação (mStandings)
ipcMain.handle('espn:getStandings', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mStandings`;
  return fetchESPN(url);
});

// Confrontos (mMatchup)
ipcMain.handle('espn:getMatchups', async (_e, { leagueId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mMatchup`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});

// Roster (mRoster)
ipcMain.handle('espn:getRoster', async (_e, { leagueId, teamId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mRoster`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});
