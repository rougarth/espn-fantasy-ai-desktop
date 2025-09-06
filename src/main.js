
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let authWindow;
let creds = { espn_s2: null, SWID: null };

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
  app.on('activate', function () { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', function () { if (process.platform !== 'darwin') app.quit(); });

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

ipcMain.handle('espn:login', async () => {
  return new Promise(async (resolve) => {
    authWindow = new BrowserWindow({ width: 900, height: 800, webPreferences: { nodeIntegration: false, contextIsolation: true } });
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
      if (tries > 120) { resolve({ authenticated: false, message: 'Tempo esgotado para login' }); return; }
      setTimeout(check, 500);
    };
    check();
  });
});

ipcMain.handle('espn:status', async () => ({ authenticated: !!(creds.espn_s2 && creds.SWID) }));

function headers(){ return { 'User-Agent': 'ESPN-Fantasy-AI-Desktop/0.1' }; }

async function fetchESPN(url){
  if (!creds.espn_s2 || !creds.SWID) return { ok:false, reason:'invalid', message:'Não autenticado' };
  const cookieHeader = `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`;
  const res = await fetch(url, { headers: { ...headers(), 'Cookie': cookieHeader }});
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid', message: 'Cookies inválidos' };
  if (!res.ok) return { ok: false, reason: 'indisponivel', message: 'Dados temporariamente indisponíveis' };
  try { const data = await res.json(); return { ok: true, data }; }
  catch(e){ return { ok:false, reason:'indisponivel', message:'Formato inesperado' }; }
}

ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  const base = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues`;
  const filter = encodeURIComponent(JSON.stringify({ memberships: { membershipTypes: ["OWNER","LEAGUE_MANAGER","MEMBER"], seasonIds:[y] } }));
  const url = `${base}?x-fantasy-filter=${filter}`;
  return fetchESPN(url);
});
ipcMain.handle('espn:getTeams', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mTeam`;
  return fetchESPN(url);
});
ipcMain.handle('espn:getStandings', async (_e, leagueId) => {
  const y = currentYear();
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mStandings`;
  return fetchESPN(url);
});
ipcMain.handle('espn:getMatchups', async (_e, { leagueId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mMatchup`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});
ipcMain.handle('espn:getRoster', async (_e, { leagueId, teamId, scoringPeriodId }) => {
  const y = currentYear();
  let url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues/${leagueId}?view=mRoster`;
  if (scoringPeriodId) url += `&scoringPeriodId=${scoringPeriodId}`;
  return fetchESPN(url);
});
