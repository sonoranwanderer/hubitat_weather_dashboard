'use strict';

class JestEnvironmentJsdomStub {
  constructor() {
    this.global = global;
  }

  async setup() {}

  async teardown() {}

  runScript(script) {
    return script.runInThisContext();
  }
}

module.exports = JestEnvironmentJsdomStub;
