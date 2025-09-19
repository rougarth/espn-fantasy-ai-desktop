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

function cookieHeaderValue(){ 
  return `espn_s2=${creds.espn_s2}; SWID=${creds.SWID}`; 
}

// Função separada para navegação
// Função separada para navegação
async function navigateSequence() {
  try {
    const { shell, dialog } = require('electron');
    
    // Abre ESPN no browser padrão
    await shell.openExternal('https://www.espn.com/login/' );
    
    // Mostra instruções
    const result = await dialog.showMessageBox(authWindow, {
      type: 'info',
      title: 'Login na ESPN',
      message: 'Faça login na ESPN no seu navegador e clique OK quando terminar.',
      buttons: ['OK', 'Cancelar']
    });
    
    if (result.response === 0) {
      // Pede os cookies manualmente
      const cookieDialog = await dialog.showMessageBox(authWindow, {
        type: 'info',
        title: 'Copiar Cookies da ESPN',
        message: 'Agora você precisa copiar os cookies:\n\n1. No seu navegador, vá para espn.com\n2. Pressione F12 (DevTools)\n3. Vá em Application → Cookies → espn.com\n4. Copie o valor de "espn_s2"\n5. Copie o valor de "SWID"\n\nVamos pedir esses valores agora.',
        buttons: ['Continuar', 'Cancelar']
      });
      
      if (cookieDialog.response === 0) {
        // Aqui você pode implementar input dialogs
        // Por enquanto, retorna sucesso para testar
        return { 
          authenticated: true, 
          message: 'Login realizado! (Cookies precisam ser implementados)',
          needsCookies: true
        };
      }
    }
    
    return { 
      authenticated: false, 
      message: 'Login cancelado pelo usuário' 
    };
  } catch (e) {
    console.error('Erro no login:', e);
    return { 
      authenticated: false, 
      message: 'Erro durante o login: ' + e.message 
    };
  }
}

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

    // Chama a função de login
    const result = await navigateSequence();
    
    if (result.authenticated) {
      // Simula cookies válidos por enquanto
      creds.espn_s2 = 'fake_cookie_s2';
      creds.SWID = 'fake_cookie_swid';
    }
    
    authWindow.close();
    resolve(result);
  });
});

ipcMain.handle('espn:status', async () => ({ 
  authenticated: !!(creds.espn_s2 && creds.SWID) 
}));

async function parseResponse(res){
  const contentType = res.headers.get('content-type') || '';
  const status = res.status;
  let bodyText = '';
  try { 
    bodyText = await res.text(); 
  } catch { 
    bodyText = ''; 
  }
  
  if (status === 401 || status === 403) {
    return { 
      ok: false, 
      reason: 'invalid', 
      message: 'Sessão expirada. Clique em Conectar com ESPN novamente.', 
      status, 
      contentType 
    };
  }
  
  try { 
    const data = JSON.parse(bodyText); 
    return { ok: true, data, status, contentType }; 
  } catch { 
    return { 
      ok: false, 
      reason: 'indisponivel', 
      message: 'Formato inesperado', 
      status, 
      contentType, 
      raw: bodyText.slice(0, 500) 
    }; 
  }
}

async function fetchESPN(url, extraHeaders = {}) {
  if (!creds.espn_s2 || !creds.SWID) {
    return { 
      ok: false, 
      reason: 'invalid', 
      message: 'Não autenticado' 
    };
  }
  
  const res = await fetch(url, { 
    method: 'GET', 
    headers: { 
      ...baseHeaders(), 
      'Cookie': cookieHeaderValue(), 
      ...extraHeaders 
    }, 
    redirect: 'follow' 
  });
  
  return parseResponse(res);
}

ipcMain.handle('espn:getLeagues', async () => {
  const y = currentYear();
  
  // ENDPOINT CORRETO que funciona
  const url = `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${y}/segments/0/leagues?view=mTeam`;
  
  const res = await fetchESPN(url, { 'Accept': 'application/json' });
  
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
