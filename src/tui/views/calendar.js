const blessed = require('blessed');

module.exports = function(screen, state) {
  const list = blessed.list({
    parent: screen,
    top: 1,
    left: 0,
    width: '100%',
    height: '100%-1',
    keys: true,
    vi: true,
    mouse: true,
    border: 'line',
    style: { selected: { bg: 'blue' } }
  });

  list.on('keypress', (ch, key) => {
    if (key.name === 'r') {
      state.resumeSession(list.selected);
    } else if (key.name === 'h') {
      state.handoffSession(list.selected);
    } else if (key.name === 'x') {
      state.deleteSession(list.selected);
    } else if (key.name === 'y') {
      state.copySession(list.selected);
    } else if (ch === '.') {
      state.openActionPalette(list.selected);
    }
  });

  return list;
};