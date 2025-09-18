const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;
let authWindow;
let creds = { espn_s2: null, SWID: null };

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function createWindow () {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = BROWSER_UA;
    callback({ requestHeaders: details.requestHeaders });
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
function cookieHeaderValue(){ return `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`; }

ipcMain.handle('espn:login', async () => {
  return new Promise(async (resolve) => {
    authWindow = new BrowserWindow({
      width: 1000,
      height: 900,
      show: true,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    authWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = BROWSER_UA;
      callback({ requestHeaders: details.requestHeaders });
    });

    async function navigateSequence() {
  try {
    // Abre ESPN no browser padrão do sistema
    const { shell } = require('electron');
    await shell.openExternal('https://www.espn.com/login/' );
    
    // Mostra instruções para o usuário
    const { dialog } = require('electron');
    const result = await dialog.showMessageBox(authWindow, {
      type: 'info',
      title: 'Login na ESPN',
      message: 'Faça login na ESPN no seu navegador e clique OK quando terminar.',
      buttons: ['OK', 'Cancelar']
    });
    
    if (result.response === 0) {
      // Usuário clicou OK, tenta capturar cookies
      const cookies = await pollCookies(authWindow.webContents.session);
      // resto da lógica...
    }
  } catch (e) {
    // tratamento de erro...
  }
}

    }
    navigateSequence();

    let tries = 0;
    const MAX_TRIES = 180; // ~90s
    const check = async () => {
      tries += 1;
      const c = await pollCookies(authWindow.webContents.session);
      if (c.espn_s2 && c.SWID) {
        creds = c;
        try { authWindow.close(); } catch(e) {}
        resolve({ authenticated: true });
        return;
      }
      if (tries % 20 === 0) {
        try { await authWindow.loadURL('https://fantasy.espn.com/'); } catch {}
      }
      if (tries > MAX_TRIES) {
        const stillOpen = authWindow && !authWindow.isDestroyed();
        resolve({ authenticated: false, message: stillOpen ? 'Finalize o login e tente de novo.' : 'A janela de login não abriu. Tente novamente.' });
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
});

ipcMain.handle('espn:status', async () => ({ authenticated: !!(creds.espn_s2 && creds.SWID) }));

async function parseResponse(res){
  const contentType = res.headers.get('content-type') || '';
  const status = res.status;
  let bodyText = '';
  try { bodyText = await res.text(); } catch { bodyText = ''; }
  if (status === 401 || status === 403) return { ok:false, reason:'invalid', message:'Sessão expirada. Clique em Conectar com ESPN novamente.', status, contentType };
  try { const data = JSON.parse(bodyText); return { ok:true, data, status, contentType }; }
  catch { return { ok:false, reason:'indisponivel', message:'Formato inesperado', status, contentType, raw: bodyText.slice(0, 500) }; }
}
async function fetchESPN(url, extraHeaders = {}) {
  if (!creds.espn_s2 || !creds.SWID) return { ok:false, reason:'invalid', message:'Não autenticado' };
  const res = await fetch(url, { method: 'GET', headers: { ...baseHeaders(), 'Cookie': cookieHeaderValue(), ...extraHeaders }, redirect: 'follow' });
  return parseResponse(res);
}
ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  
  // ENDPOINT CORRETO que funciona
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues?view=mTeam`;
  
  const res = await fetchESPN(url, { 'Accept': 'application/json' } );
  
  if (res && res.ok && res.data) {
    // Filtra apenas ligas onde o usuário é membro
    const userLeagues = res.data.filter(league => 
      league.members && league.members.length > 0
    );
    
    return { 
      ok: true, 
      data: userLeagues, 
      status: res.status, 
      contentType: res.contentType 
    };
  }
  
  return res;
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
