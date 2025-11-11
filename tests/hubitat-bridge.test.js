const { JSDOM } = require('jsdom');
const { bootstrapHubitatRendererBridge } = require('../src/bootstrap/hubitat-bridge');
const { createRenderer, baseStyles } = require('../src/render');

function createHubitatDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/'
  });
  const { window } = dom;
  const { document } = window;

  class StubObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
  }

  window.MutationObserver = StubObserver;
  window.ResizeObserver = StubObserver;
  window.requestAnimationFrame = callback => {
    callback();
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  if (!window.console) {
    window.console = {};
  }
  window.console.debug = () => {};
  window.console.warn = () => {};
  window.console.error = () => {};
  window.__WDASH_TEST_MODE__ = false;

  const displayTile = document.createElement('div');
  displayTile.setAttribute('id', 'tile-0');
  displayTile.classList.add('tile');
  const displayPrimary = document.createElement('div');
  displayPrimary.classList.add('tile-primary');
  displayPrimary.getBoundingClientRect = () => ({ width: 800, height: 480 });
  displayTile.appendChild(displayPrimary);
  document.body.appendChild(displayTile);

  const dataTileOne = document.createElement('div');
  dataTileOne.setAttribute('id', 'tile-1');
  dataTileOne.classList.add('tile');
  const dataPrimaryOne = document.createElement('div');
  dataPrimaryOne.classList.add('tile-primary');
  dataTileOne.appendChild(dataPrimaryOne);
  document.body.appendChild(dataTileOne);

  const dataTileTwo = document.createElement('div');
  dataTileTwo.setAttribute('id', 'tile-2');
  dataTileTwo.classList.add('tile');
  const dataPrimaryTwo = document.createElement('div');
  dataPrimaryTwo.classList.add('tile-primary');
  dataTileTwo.appendChild(dataPrimaryTwo);
  document.body.appendChild(dataTileTwo);

  Object.defineProperty(document, 'readyState', {
    configurable: true,
    get() {
      return 'complete';
    }
  });

  return {
    dom,
    window,
    document,
    displayPrimary,
    dataPrimaryOne,
    dataPrimaryTwo
  };
}

describe('Hubitat renderer bridge', () => {
  it('renders dashboard markup into the display tile when payload segments are present', () => {
    const env = createHubitatDom();
    const { window, displayPrimary, dataPrimaryOne, dataPrimaryTwo } = env;

    const segmentOne = {
      segmentIndex: 0,
      segmentSize: 2,
      outdoor: {
        temperature: '72°F',
        humidity: '30%'
      },
      metadata: {
        generatedAt: '2024-05-01T12:00:00Z',
        layout: {
          columns: ['1fr'],
          rows: ['auto', 'auto'],
          cards: [
            { id: 'outdoor', row: 1, column: 1 },
            { id: 'indoor', row: 2, column: 1 }
          ],
          baseWidth: 900,
          baseHeight: 600
        }
      }
    };

    const segmentTwo = {
      segmentIndex: 1,
      segmentSize: 2,
      indoor: {
        temperature: '68°F',
        humidity: '45%'
      }
    };

    dataPrimaryOne.textContent = JSON.stringify(segmentOne);
    dataPrimaryTwo.textContent = JSON.stringify(segmentTwo);

    bootstrapHubitatRendererBridge({
      global: window,
      factory: createRenderer,
      baseStyles
    });

    const root = displayPrimary.querySelector('.wdash-root');
    expect(root).not.toBeNull();
    expect(root.querySelector('.wdash-card--outdoor')).not.toBeNull();
    expect(root.textContent).toContain('Outdoor');
    expect(root.style.getPropertyValue('--wdash-width')).toBe('800px');
    expect(root.style.getPropertyValue('--wdash-height')).toBe('480px');
    expect(window.document.getElementById('tile-1').classList.contains('wdash-source-tile')).toBe(true);
    expect(window.document.getElementById('tile-2').classList.contains('wdash-source-tile')).toBe(true);
    expect(window.document.getElementById('tile-0').classList.contains('wdash-source-tile')).toBe(false);
  });
});
