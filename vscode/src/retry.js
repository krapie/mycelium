'use strict';

// "<bin> not installed" from the CLI means its `which` didn't find the agent on
// the PATH it was given. On a machine where the editor never got the shell's
// PATH, the agent may well be installed in a directory only the login shell
// knows. So: once, widen the PATH (ask the login shell) and ask again.

const NOT_INSTALLED = / not installed$/;

/**
 * Run `fn`; if it fails with "<bin> not installed" and `widenPath()` can
 * learn new directories (it resolves true), run it once more. Anything else,
 * including a second failure, is thrown as it is.
 */
async function withWiderPath(fn, widenPath, log = () => {}) {
  try {
    return await fn();
  } catch (err) {
    if (!NOT_INSTALLED.test(String((err && err.message) || ''))) throw err;
    log(`${err.message} — looking again with the login shell's PATH`);
    if (!(await widenPath())) {
      log('the login shell has no further directories to offer');
      throw err;
    }
    return fn();
  }
}

module.exports = { withWiderPath, NOT_INSTALLED };
