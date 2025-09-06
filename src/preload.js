
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('espn', {
  login: () => ipcRenderer.invoke('espn:login'),
  getStatus: () => ipcRenderer.invoke('espn:status'),
  getLeagues: () => ipcRenderer.invoke('espn:getLeagues'),
  getTeams: (leagueId) => ipcRenderer.invoke('espn:getTeams', leagueId),
  getStandings: (leagueId) => ipcRenderer.invoke('espn:getStandings', leagueId),
  getMatchups: (leagueId, scoringPeriodId) => ipcRenderer.invoke('espn:getMatchups', { leagueId, scoringPeriodId }),
  getRoster: (leagueId, teamId, scoringPeriodId) => ipcRenderer.invoke('espn:getRoster', { leagueId, teamId, scoringPeriodId }),
});
