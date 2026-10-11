'use strict';
const vscode = require('vscode');
const { relativeTime, agentKey, agentLabel } = require('./format.js');
const { strings } = require('./i18n.js');

const ICON = { merged: 'git-merge', backlog: 'checklist' };

/** One session row as a TreeItem — the same look in all three views. */
function sessionItem(row, { language, showFolder = false } = {}) {
  const t = strings(language);
  const key = agentKey(row);
  const label = row.title || (row.preview || '').slice(0, 70) || row.id.slice(0, 8);
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.id = `s:${row.id}`;
  const tags = (row.tags || []).slice(0, 2).map((g) => `#${g}`).join(' ');
  item.description = [relativeTime(row.startedAt, Date.now(), language), showFolder && (row.folder || t.unfiled), tags].filter(Boolean).join(' · ');
  item.iconPath = new vscode.ThemeIcon(ICON[key] || 'circle-filled', new vscode.ThemeColor(`mycelium.agent.${key}`));
  item.contextValue = key === 'backlog' ? 'backlog' : key === 'merged' ? 'product' : 'session';
  const tip = new vscode.MarkdownString();
  tip.appendMarkdown('**').appendText(label).appendMarkdown('**');
  tip.appendMarkdown(`  \n${agentLabel(row)} · `).appendText(row.folder || t.unfiled);
  if (row.summary) tip.appendMarkdown('\n\n').appendText(row.summary);
  tip.appendMarkdown(`\n\n\`${row.id}\``);
  item.tooltip = tip;
  item.command = { command: 'mycelium.open', title: 'Open', arguments: [{ type: 'session', row }] };
  return item;
}

function folderItem(path, { count, hasKnowledge, language }) {
  const t = strings(language);
  const item = new vscode.TreeItem(path.split('/').pop(), vscode.TreeItemCollapsibleState.Collapsed);
  item.id = `f:${path}`;
  item.description = String(count ?? 0);
  item.iconPath = new vscode.ThemeIcon(hasKnowledge ? 'folder-library' : 'folder');
  item.contextValue = 'folder';
  item.tooltip = hasKnowledge ? `${path} — ${t.hasKnowledge}` : path;
  return item;
}

function inboxItem(count, language) {
  const t = strings(language);
  const item = new vscode.TreeItem(t.unfiled, vscode.TreeItemCollapsibleState.Collapsed);
  item.id = 'inbox';
  item.description = String(count);
  item.iconPath = new vscode.ThemeIcon('inbox');
  item.contextValue = 'inbox';
  item.tooltip = t.unfiledTip;
  return item;
}

function groupItem(group) {
  const item = new vscode.TreeItem(group.label, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `g:${group.key}`;
  item.description = String(group.rows.length);
  item.contextValue = 'group';
  return item;
}

/** ANSI colors only: a terminal tab's color is picked from the terminal palette. */
const TERMINAL_COLOR = { claude: 'terminal.ansiBlue', codex: 'terminal.ansiYellow', kiro: 'terminal.ansiMagenta', opencode: 'terminal.ansiGreen', merged: 'terminal.ansiCyan', backlog: 'terminal.ansiCyan' };
const terminalColor = (key) => new vscode.ThemeColor(TERMINAL_COLOR[key] || 'terminal.ansiCyan');

module.exports = { sessionItem, folderItem, inboxItem, groupItem, terminalColor };
