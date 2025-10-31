const { createLegacyWeatherDashboardRenderer } = require('../render/index.js');

(function bootstrapWeatherDashboard(global) {
  if (!global) return null;

  const resolveFactoryFromModule = () => {
    if (typeof createLegacyWeatherDashboardRenderer === 'function') {
      return createLegacyWeatherDashboardRenderer;
    }
    if (typeof require !== 'function') return null;
    try {
      const mod = require('../render/index.js');
      return mod && typeof mod.createLegacyWeatherDashboardRenderer === 'function'
        ? mod.createLegacyWeatherDashboardRenderer
        : null;
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
    const renderer = factory({ window: global, document: global.document, globalThis: global });
    global.weatherDashboard = global.weatherDashboard || {};
    global.weatherDashboard.__rendererFactory = factory;
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
