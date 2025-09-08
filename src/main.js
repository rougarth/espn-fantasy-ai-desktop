// src/main.js — ESPN Fantasy AI (Electron) — POST robusto para ligas

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let authWindow;
let creds = { espn_s2: null, SWID: null };

// UA de navegador real (ajuda a evitar landing HTML)
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

  // Força UA “de navegador” em todas as requests do app
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

async function pollCookies(targetSession){
  const s2 = await targetSession.cookies.get({ url: 'https://www.espn.com', name: 'espn_s2' });
  const sw = await targetSession.cookies.get({ url: 'https://www.espn.com', name: 'SWID' });
  const s2v = (s2 && s2[0] && s2[0].value) || null;
  const swv = (sw && sw[0] && sw[0].value) || null;
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

// -------------------------------------------------------------
// Login (abre ESPN; usuário faz login normal; app captura cookies)
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

    authWindow.loadURL('https://www.espn.com/');

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
// Fetch helpers: GET e POST que SEMPRE leem texto e tentam JSON
// -------------------------------------------------------------
function cookieHeaderValue(){
  return `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`;
}

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
// IPC: chamadas reais da ESPN
// -------------------------------------------------------------

// LIGAS (usa POST + fallbacks de host e de forma de filtro)
ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  const filterObj = { memberships: { membershipTypes: ["OWNER","LEAGUE_MANAGER","MEMBER"], seasonIds:[y] } };

  const hosts = [
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues`,
    `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues`
  ];

  // tenta: (1) POST com header x-fantasy-filter, (2) POST com body
  for (const base of hosts) {
    // 1) header
    let r = await fetchESPN_POST(base, {}, { 'x-fantasy-filter': JSON.stringify(filterObj) });
    if (r && r.ok && r.data) return r;
    if (r && r.reason === 'invalid') return r;

    // 2) body
    r = await fetchESPN_POST(base, { 'x-fantasy-filter': JSON.stringify(filterObj) });
    if (r && r.ok && r.data) return r;
    if (r && r.reason === 'invalid') return r;
  }

  return { ok:false, reason:'indisponivel', message:'Não foi possível obter as ligas agora (HTML/405).' };
});

// TIMES (GET padrão; se precisar trocamos para POST depois)
ipcMain.handle('espn:getTeams', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mTeam`;
  return fetchESPN(url);
});

// CLASSIFICAÇÃO
ipcMain.handle('espn:getStandings', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mStandings`;
  return fetchESPN(url);
});

// CONFRONTOS
ipcMain.handle('espn:getMatchups', async (_e, { leagueId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mMatchup`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});

// ROSTER
ipcMain.handle('espn:getRoster', async (_e, { leagueId, teamId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mRoster`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});
