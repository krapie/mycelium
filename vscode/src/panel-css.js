/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';

// Everything is expressed in --vscode-* variables so the panel follows the
// user's theme (including high contrast) without a single hardcoded surface
// color. Agent hues come from the colors the manifest contributes, which VS
// Code exposes as --vscode-mycelium-agent-*; the hex is only a fallback.
module.exports = `
:root { --agent: var(--vscode-mycelium-agent-claude, #8ab4d8); }
* { box-sizing: border-box; }
body { margin: 0; padding: 28px 32px 56px; color: var(--vscode-foreground); background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.55; }
main { max-width: 760px; margin: 0; }
.agent-claude { --agent: var(--vscode-mycelium-agent-claude, #8ab4d8); }
.agent-codex { --agent: var(--vscode-mycelium-agent-codex, #d4a24e); }
.agent-kiro { --agent: var(--vscode-mycelium-agent-kiro, #e08fb0); }
.agent-opencode { --agent: var(--vscode-mycelium-agent-opencode, #6bcf8f); }
.agent-merged { --agent: var(--vscode-mycelium-agent-merged, #a8c25a); }
.agent-backlog { --agent: var(--vscode-mycelium-agent-backlog, #7fe0c4); }

.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.agent { display: inline-flex; align-items: center; gap: 6px; color: var(--vscode-foreground); font-weight: 600; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--agent); flex: none; }
.sep { opacity: .5; }
h1 { margin: 10px 0 14px; font-size: 1.75em; font-weight: 600; line-height: 1.25; letter-spacing: -0.01em; text-wrap: balance; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
.tag { padding: 1px 9px; border-radius: 999px; font-size: 0.85em; color: var(--vscode-textLink-foreground);
  border: 1px solid var(--vscode-textLink-foreground); opacity: .9; }

.actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; padding-bottom: 22px; }
button { font: inherit; cursor: pointer; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 13px; border-radius: 2px; border: 1px solid transparent;
  color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
.btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
.btn.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.btn.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.hint { flex-basis: 100%; margin: 2px 0 0; color: var(--vscode-descriptionForeground); font-size: 0.88em; }

section { padding: 18px 0 4px; border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, transparent)); }
h2 { margin: 0 0 10px; font-size: 0.78em; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
ul.bullets, ul.todos { margin: 0 0 12px; padding: 0; list-style: none; }
ul.bullets li { position: relative; padding-left: 16px; margin: 0 0 6px; }
ul.bullets li::before { content: ''; position: absolute; left: 2px; top: 0.68em; width: 5px; height: 5px; border-radius: 50%; background: var(--agent); opacity: .85; }
ul.todos li { display: flex; gap: 9px; margin: 0 0 6px; }
ul.todos .box { flex: none; width: 13px; height: 13px; margin-top: 4px; border: 1px solid var(--vscode-checkbox-border, var(--vscode-descriptionForeground)); border-radius: 3px; }
.empty { color: var(--vscode-descriptionForeground); font-style: italic; }

.lineage-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 8px; }
.lineage-row .label { min-width: 110px; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.ref { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 10px; border-radius: 999px;
  color: var(--vscode-foreground); background: var(--vscode-badge-background); border: 1px solid transparent; }
.ref span.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.ref:hover { border-color: var(--agent); }
.ref .dot { background: var(--agent); }

footer { margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--vscode-panel-border, transparent);
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
footer code { font-family: var(--vscode-editor-font-family); }
.link { padding: 0; border: 0; background: none; color: var(--vscode-textLink-foreground); }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
.crumb { padding: 0; border: 0; background: none; color: inherit; }
.crumb:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }
`;
