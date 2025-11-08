const {
  createRenderer,
  createLegacyWeatherDashboardRenderer,
  baseStyles
} = require('../render/index.js');

function createGuardLogger(global) {
  if (!global || typeof global !== 'object') {
    return function noopLog() {};
  }

  const consoleRef = global.console || null;
  if (!consoleRef) {
    return function noopLog() {};
  }

  const seen = new Set();

  return function logGuardEvent(event, details) {
    if (!event) return;
    const label = `[WeatherDashboard] ${event}`;
    if (seen.has(label)) return;
    seen.add(label);

    try {
      const logMethod =
        consoleRef.debug || consoleRef.info || consoleRef.log || consoleRef.warn;
      if (typeof logMethod === 'function') {
        logMethod.call(consoleRef, label, details || undefined);
      }
    } catch (err) {
      // ignore logging failures
    }
  };
}

function isDashboardValueErrorMessage(message) {
  if (!message) return false;
  const text = String(message);
  return (
    text.includes("Cannot set properties of undefined (setting 'value')") ||
    text.includes('value is not defined') ||
    text.includes("can't access property \"value\"")
  );
}

function isDashboardValueErrorSource(filename) {
  if (!filename) return true;
  const source = String(filename);
  if (source.indexOf('app.js') !== -1) return true;
  if (source.indexOf('access_token=') !== -1) return true;
  if (/\/tile-\d+/i.test(source)) return true;
  if (/\btileId=/i.test(source)) return true;
  return false;
}

function suppressDashboardHistoryErrors(global) {
  if (!global || typeof global !== 'object') return;
  if (global.__WDASH_TEST_MODE__ === true) return;

  const logGuardEvent = createGuardLogger(global);
  const noopHistory = function noopAddToDashboardHistory() {
    return undefined;
  };

  const ensureDashboardValueShim = reason => {
    if (!global || typeof global !== 'object') return;

    if (global.__wdashValueShimApplied) return;

    const descriptor = Object.getOwnPropertyDescriptor(global, 'value');
    if (descriptor && descriptor.get && !descriptor.set && descriptor.configurable === false) {
      return;
    }

    let applied = false;

    try {
      global.value = global.value;
      applied = true;
    } catch (assignErr) {
      try {
        Object.defineProperty(global, 'value', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: undefined
        });
        applied = true;
      } catch (defineErr) {
        logGuardEvent('Value shim application failed', {
          reason,
          message: defineErr && defineErr.message
        });
      }
    }

    if (applied && typeof global.eval === 'function') {
      try {
        global.eval('var value = undefined;');
      } catch (evalErr) {
        logGuardEvent('Value shim eval failed', {
          reason,
          message: evalErr && evalErr.message
        });
      }
    }

    if (applied) {
      global.__wdashValueShimApplied = true;
      logGuardEvent('Value shim applied', { reason });
    }
  };

  const shouldSuppressError = eventOrMessage => {
    if (!eventOrMessage) return false;
    if (typeof eventOrMessage === 'string') {
      return isDashboardValueErrorMessage(eventOrMessage);
    }
    const message = String(eventOrMessage.message || '');
    const filename = eventOrMessage.filename || eventOrMessage.source || '';
    return isDashboardValueErrorMessage(message) && isDashboardValueErrorSource(filename);
  };

  const installGuardedHistory = reason => {
    if (!global || typeof global !== 'object') return;

    const descriptor = {
      configurable: true,
      enumerable: false,
      get() {
        return noopHistory;
      },
      set(nextValue) {
        if (nextValue === noopHistory) return;
        logGuardEvent('History guard recorded reassignment', {
          assignedType: typeof nextValue,
          reason: reason || 'setter'
        });
        if (typeof global.setTimeout === 'function') {
          global.setTimeout(() => {
            installGuardedHistory('reinstall-after-setter');
          }, 0);
        }
      }
    };

    let applied = false;

    try {
      Object.defineProperty(global, 'addToDashboardHistory', descriptor);
      applied = global.addToDashboardHistory === noopHistory;
    } catch (err) {
      try {
        global.addToDashboardHistory = noopHistory;
        applied = global.addToDashboardHistory === noopHistory;
      } catch (assignErr) {
        logGuardEvent('History guard assignment failed', {
          message: assignErr && assignErr.message,
          code: assignErr && assignErr.code
        });
      }
    }

    if (typeof global.eval === 'function') {
      try {
        const sentinel = '__wdashNoopHistory__';
        const needsCleanup = global[sentinel] !== noopHistory;
        if (needsCleanup) {
          global[sentinel] = noopHistory;
        }
        global.eval(`try { addToDashboardHistory = this.${sentinel}; } catch (err) {}`);
        applied = applied || global.addToDashboardHistory === noopHistory;
        if (needsCleanup) {
          try {
            delete global[sentinel];
          } catch (cleanupErr) {
            global[sentinel] = undefined;
          }
        }
      } catch (evalErr) {
        logGuardEvent('History guard eval reassignment failed', {
          message: evalErr && evalErr.message,
          code: evalErr && evalErr.code
        });
      }
    }

    if (applied) {
      global.__wdashHistorySuppressed = true;
      logGuardEvent('History guard applied', {
        hasSocketGuard: Boolean(global.__wdashSocketGuard),
        hasOnErrorGuard: Boolean(global.__wdashOnErrorGuard),
        reason: reason || 'initial'
      });
    }
  };

  ensureDashboardValueShim('initial');
  installGuardedHistory('initial');

  if (!global.__wdashHistoryInterval && typeof global.setInterval === 'function') {
    global.__wdashHistoryInterval = global.setInterval(() => {
      ensureDashboardValueShim('interval');
      installGuardedHistory('interval');
    }, 1000);
    logGuardEvent('History guard interval registered');
  }

  if (!global.__wdashSocketGuard && typeof global.addEventListener === 'function') {
    global.addEventListener('error', event => {
      if (!event) return;
      if (shouldSuppressError(event)) {
        if (typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        ensureDashboardValueShim('socket-error');
        installGuardedHistory('socket-error');
        logGuardEvent('Suppressed socket error event', {
          message: event.message,
          filename: event.filename
        });
        if (global.console && typeof global.console.warn === 'function') {
          global.console.warn('[WeatherDashboard] Ignored dashboard socket value update error', {
            message: event.message,
            filename: event.filename
          });
        }
      }
    }, true);
    global.__wdashSocketGuard = true;
  }

  if (!global.__wdashOnErrorGuard) {
    const existingOnError = typeof global.onerror === 'function' ? global.onerror : null;
    global.onerror = function weatherDashboardOnError(message, source, lineno, colno, error) {
      if (shouldSuppressError({ message, filename: source, error })) {
        ensureDashboardValueShim('onerror');
        installGuardedHistory('onerror');
        logGuardEvent('Suppressed global onerror event', {
          message,
          source
        });
        return true;
      }
      if (existingOnError) {
        return existingOnError.apply(this, arguments);
      }
      return false;
    };
    global.__wdashOnErrorGuard = true;
    logGuardEvent('Global onerror guard registered');
  }
}

(function bootstrapWeatherDashboard(global) {
  if (!global) return null;

  suppressDashboardHistoryErrors(global);

  const resolveFactoryFromModule = () => {
    if (typeof createRenderer === 'function') {
      return createRenderer;
    }
    if (typeof createLegacyWeatherDashboardRenderer === 'function') {
      return createLegacyWeatherDashboardRenderer;
    }
    if (typeof require !== 'function') return null;
    try {
      const mod = require('../render/index.js');
      if (mod && typeof mod.createRenderer === 'function') {
        return mod.createRenderer;
      }
      if (mod && typeof mod.createLegacyWeatherDashboardRenderer === 'function') {
        return mod.createLegacyWeatherDashboardRenderer;
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  const factory = (
    (global.weatherDashboard && global.weatherDashboard.__rendererFactory) ||
    global.createLegacyWeatherDashboardRenderer ||
    resolveFactoryFromModule()
  );

  if (typeof factory === 'function') {
    const weatherDashboardModule = global.weatherDashboard || {};

    if (factory === createRenderer) {
      const rendererModule = {
        createRenderer: factory,
        baseStyles
      };
      global.weatherDashboard = Object.assign(weatherDashboardModule, rendererModule, {
        __rendererFactory: factory
      });
      if (typeof module !== 'undefined' && module.exports) {
        module.exports = rendererModule;
      }
      return rendererModule;
    }

    const renderer = factory({ window: global, document: global.document, globalThis: global });
    global.weatherDashboard = Object.assign(weatherDashboardModule, {
      __rendererFactory: factory
    });
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = renderer;
    }
    return renderer;
  }

  if (global.console && typeof global.console.warn === 'function') {
    global.console.warn('[WeatherDashboard] Renderer factory not available; legacy bundle required.');
  }

  return null;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
