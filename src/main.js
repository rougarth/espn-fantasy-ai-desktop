// src/main.js — ESPN Fantasy AI (Electron) — COMPLETO

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let authWindow;
let creds = { espn_s2: null, SWID: null };

// -------------------------------------------------------------
// Window principal
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

function headers(){
  // Cabeçalhos "fortes" que ajudam a obter JSON da API de fantasy
  return {
    'User-Agent': 'ESPN-Fantasy-AI-Desktop/0.1',
    'Accept': 'application/json',
    'Referer': 'https://fantasy.espn.com',
    'Origin': 'https://fantasy.espn.com',
    'x-fantasy-platform': 'kona',
    'x-fantasy-source': 'kona'
  };
}

// -------------------------------------------------------------
// Login (abre ESPN, usuário faz login normal; app captura cookies)
// -------------------------------------------------------------
ipcMain.handle('espn:login', async () => {
  return new Promise(async (resolve) => {
    authWindow = new BrowserWindow({
      width: 900,
      height: 800,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
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
// Fetch centralizado: sempre lê texto, tenta JSON, retorna diagnóstico
// -------------------------------------------------------------
async function fetchESPN(url, extraHeaders = {}) {
  if (!creds.espn_s2 || !creds.SWID) {
    return { ok:false, reason:'invalid', message:'Não autenticado' };
  }

  const cookieHeader = `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`;

  const res = await fetch(url, {
    headers: {
      ...headers(),
      'Cookie': cookieHeader,
      ...extraHeaders
    },
    redirect: 'follow'
  });

  const contentType = res.headers.get('content-type') || '';
  const status = res.status;
  let bodyText = '';

  try {
    bodyText = await res.text();
  } catch { bodyText = ''; }

  // 401/403: sessão inválida/expirada
  if (status === 401 || status === 403) {
    return { ok:false, reason:'invalid', message:'Sessão expirada. Clique em Conectar com ESPN novamente.', status, contentType };
  }

  // Tenta JSON a partir do texto
  try {
    const data = JSON.parse(bodyText);
    return { ok:true, data, status, contentType };
  } catch {
    return {
      ok:false,
      reason:'indisponivel',
      message:'Formato inesperado',
      status,
      contentType,
      raw: bodyText.slice(0, 500) // trecho p/ diagnóstico se necessário
    };
  }
}

// -------------------------------------------------------------
// IPC: chamadas reais da ESPN (sempre dados reais, zero invenção)
// -------------------------------------------------------------

// Ligas do usuário (usa filtro na query)
ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  const base = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues`;
  const filterObj = { memberships: { membershipTypes: ["OWNER","LEAGUE_MANAGER","MEMBER"], seasonIds:[y] } };
  const filterQP = encodeURIComponent(JSON.stringify(filterObj));
  const url = `${base}?x-fantasy-filter=${filterQP}`;
  return fetchESPN(url);
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

// Confrontos (mMatchup) — aceita scoringPeriodId
ipcMain.handle('espn:getMatchups', async (_e, { leagueId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mMatchup`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});

// Roster (mRoster) — aceita scoringPeriodId
ipcMain.handle('espn:getRoster', async (_e, { leagueId, teamId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mRoster`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});
