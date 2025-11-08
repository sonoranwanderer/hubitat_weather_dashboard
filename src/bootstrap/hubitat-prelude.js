(function initializeWeatherDashboardPrelude() {
  var globalReference =
    typeof window !== 'undefined'
      ? window
      : typeof globalThis !== 'undefined'
      ? globalThis
      : typeof global !== 'undefined'
      ? global
      : typeof self !== 'undefined'
      ? self
      : this;

  if (!globalReference || globalReference.__WDASH_TEST_MODE__ === true) {
    return;
  }

  var noopHistory = function noopAddToDashboardHistory() {
    return undefined;
  };

  function ensureValueArray() {
    if (typeof globalReference.value !== 'undefined' && globalReference.value !== null) {
      return;
    }
    try {
      globalReference.value = [];
    } catch (err) {
      // Swallow assignment failures; Hubitat may still populate the value store later.
    }
  }

  function installNoopHistory() {
    if (!globalReference || typeof globalReference !== 'object') {
      return;
    }
    if (globalReference.__wdashHistoryInstalling) {
      return;
    }

    globalReference.__wdashHistoryInstalling = true;

    var reinstall = function reinstallHistoryGuard() {
      globalReference.__wdashHistorySuppressed = false;
      installNoopHistory();
    };

    var descriptor = {
      configurable: true,
      get: function getHistory() {
        return noopHistory;
      },
      set: function setHistory(next) {
        if (next === noopHistory) return;
        setTimeout(reinstall, 0);
      }
    };

    try {
      Object.defineProperty(globalReference, 'addToDashboardHistory', descriptor);
    } catch (err) {
      try {
        globalReference.addToDashboardHistory = noopHistory;
      } catch (assignErr) {
        // ignore assignment failures
      }
    }

    globalReference.__wdashHistoryInstalling = false;
    globalReference.__wdashHistorySuppressed = true;
    globalReference.__wdashHistoryPatched = true;
  }

  function isDashboardValueErrorMessage(message) {
    if (!message) return false;
    var text = String(message);
    return (
      text.indexOf("Cannot set properties of undefined (setting 'value')") !== -1 ||
      text.indexOf('value is not defined') !== -1 ||
      text.indexOf("can't access property \"value\"") !== -1
    );
  }

  function isDashboardValueErrorSource(filename) {
    if (!filename) return true;
    var source = String(filename);
    if (source.indexOf('app.js') !== -1) return true;
    if (source.indexOf('access_token=') !== -1) return true;
    if (/\/tile-\d+/i.test(source)) return true;
    if (/\btileId=/i.test(source)) return true;
    return false;
  }

  function installErrorGuard() {
    if (typeof globalReference.addEventListener !== 'function') return;
    if (globalReference.__wdashSocketGuard) return;

    var handler = function suppressValueErrors(event) {
      if (!event) return;
      var message = String(event.message || '');
      var filename = event.filename || '';
      var shouldSuppress =
        isDashboardValueErrorMessage(message) && isDashboardValueErrorSource(filename);
      if (!shouldSuppress) return;

      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }

      installNoopHistory();
    };

    globalReference.addEventListener('error', handler, true);
    globalReference.__wdashSocketGuard = true;
  }

  ensureValueArray();
  installNoopHistory();
  installErrorGuard();

  if (!globalReference.__wdashPrelude) {
    globalReference.__wdashPrelude = {};
  }
  globalReference.__wdashPrelude.patchDashboardGlitches = function patchDashboardGlitchesPrelude() {
    ensureValueArray();
    installNoopHistory();
    installErrorGuard();
  };
})();
