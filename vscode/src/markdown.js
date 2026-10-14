/*
 * Copyright 2026 The Mycelium Authors. All rights reserved.
 *
 * Use of this source code is governed by the MIT License
 * that can be found in the LICENSE file.
 *
 * SPDX-License-Identifier: MIT
 */

'use strict';

const MAX_TURN = 4000;

// The session itself is shown by the webview panel (panel-html.js); this is
// only the raw conversation, opened as a Markdown preview from its footer.
// A single tool dump can be tens of thousands of characters, so each turn is
// cut rather than letting one of them bury the rest.
function transcriptMarkdown(s) {
  const title = (s.extracted && s.extracted.title) || s.id;
  const out = [`# ${title}`, '', `<sub>${s.id}</sub>`, ''];
  for (const t of s.turns || []) {
    const who = t.role === 'user' ? 'You' : t.role === 'assistant' ? 'Assistant' : t.role;
    const text = String(t.text || '');
    out.push(`### ${who}`, '', text.length > MAX_TURN ? `${text.slice(0, MAX_TURN)}\n\n… (${text.length - MAX_TURN} more characters)` : text, '');
  }
  return out.join('\n');
}

module.exports = { transcriptMarkdown };
