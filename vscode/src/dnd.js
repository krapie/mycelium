'use strict';
const vscode = require('vscode');

const MIME = 'application/vnd.mycelium.sessions';

/**
 * Drag sessions out of any of the three views; drop them on a folder (or New)
 * in the Folders view to file them. Dropping on a session files into that
 * session's folder, which is what people expect from "drop on this row".
 */
function dndController(client, { accept, onMoved }) {
  return {
    dragMimeTypes: [MIME],
    dropMimeTypes: accept ? [MIME] : [],
    handleDrag(source, dataTransfer) {
      const ids = source.filter((e) => e.type === 'session').map((e) => e.row.id);
      if (ids.length) dataTransfer.set(MIME, new vscode.DataTransferItem(ids));
    },
    async handleDrop(target, dataTransfer) {
      const item = dataTransfer.get(MIME);
      if (!accept || !item || !target) return;
      let folder;
      if (target.type === 'inbox') folder = '';
      else if (target.type === 'folder') folder = target.path;
      else if (target.type === 'session') folder = target.row.folder || '';
      else return;
      try {
        await client.request('move', { ids: item.value, folder });
        await onMoved();
      } catch (err) {
        vscode.window.showErrorMessage(`Mycelium: ${err.message}`);
      }
    },
  };
}

module.exports = { dndController };
