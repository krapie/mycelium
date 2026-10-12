'use strict';

// "<bin> not installed" from the CLI means its `which` didn't find the agent on
// the PATH it was given. On a machine where the editor never got the shell's
// PATH, the agent may well be installed in a directory only the login shell
// knows. So: once, ask the login shell for its directories and ask again with
// them — sent with the request, so nothing running is restarted.

const NOT_INSTALLED = / not installed$/;

/**
 * Run `fn()`; if it fails with "<bin> not installed" and `getExtraDirs()`
 * yields directories, run `fn(dirs)` once more. Anything else, including a
 * second failure, is thrown as it is.
 */
async function withWiderPath(fn, getExtraDirs, log = () => {}) {
  try {
    return await fn();
  } catch (err) {
    if (!NOT_INSTALLED.test(String((err && err.message) || ''))) throw err;
    log(`${err.message} — looking again with the login shell's PATH`);
    const dirs = await getExtraDirs();
    if (!dirs || !dirs.length) {
      log('the login shell has no directories to offer');
      throw err;
    }
    return fn(dirs);
  }
}

module.exports = { withWiderPath, NOT_INSTALLED };
