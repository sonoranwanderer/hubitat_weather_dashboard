const { createRenderer } = require('../src/render');

const sampleLayout = {
  columns: [1, 1],
  rows: ['auto', 'auto'],
  gap: '20px',
  cards: [
    { id: 'temperature', row: 1, column: 1, colSpan: 2, minHeight: '180px' },
    { id: 'wind', row: 2, column: 1 },
    { id: 'rain', row: 2, column: 2 }
  ]
};

const sampleData = {
  temperature: {
    title: 'Outdoor Temperature',
    metrics: [
      { label: 'Now', value: '72°F' },
      { label: 'High', value: '79°F' },
      { label: 'Low', value: '61°F' }
    ]
  },
  wind: {
    title: 'Wind',
    metrics: [
      { label: 'Speed', value: '12 mph' },
      { label: 'Gust', value: '22 mph' }
    ]
  },
  rain: {
    title: 'Rainfall',
    metrics: [
      { label: 'Daily', value: '0.23 in' },
      { label: 'Monthly', value: '1.92 in' }
    ]
  }
};

describe('createRenderer', () => {
  it('generates grid variables for a square container', () => {
    const { variables, markup } = createRenderer({
      width: 600,
      height: 600,
      layout: sampleLayout,
      data: sampleData
    });

    expect(variables['--wdash-width']).toBe('600px');
    expect(variables['--wdash-height']).toBe('600px');
    expect(variables['--wdash-grid-template-columns']).toBe('1fr 1fr');
    expect(variables['--wdash-grid-template-rows']).toBe('auto auto');
    expect(markup).toContain('wdash-card--temperature');
    expect(markup).toContain('Outdoor Temperature');
  });

  it('supports portrait containers by maintaining supplied dimensions', () => {
    const { variables } = createRenderer({
      width: 480,
      height: 900,
      layout: {
        ...sampleLayout,
        columns: ['1fr'],
        rows: ['1fr', '1fr', 'auto']
      },
      data: sampleData
    });

    expect(variables['--wdash-width']).toBe('480px');
    expect(variables['--wdash-height']).toBe('900px');
    expect(variables['--wdash-grid-template-columns']).toBe('1fr');
    expect(variables['--wdash-grid-template-rows']).toBe('1fr 1fr auto');
  });

  it('supports landscape containers with percentage tracks', () => {
    const { variables } = createRenderer({
      width: 1280,
      height: 720,
      layout: {
        columns: ['60%', '40%'],
        rows: [1, 1],
        cards: [
          { id: 'temperature', row: 1, column: 1 },
          { id: 'wind', row: 1, column: 2 },
          { id: 'rain', row: 2, column: 1, colSpan: 2 }
        ]
      },
      data: sampleData
    });

    expect(variables['--wdash-width']).toBe('1280px');
    expect(variables['--wdash-height']).toBe('720px');
    expect(variables['--wdash-grid-template-columns']).toBe('60% 40%');
    expect(variables['--wdash-grid-template-rows']).toBe('1fr 1fr');
  });

  it('interprets numeric tracks as percentages when requested', () => {
    const { variables } = createRenderer({
      width: 900,
      height: 600,
      layout: {
        trackUnit: 'percent',
        columns: [70, 30],
        rows: [55, 45],
        cards: [
          { id: 'temperature', row: 1, column: 1 },
          { id: 'wind', row: 1, column: 2 },
          { id: 'rain', row: 2, column: 1, colSpan: 2 }
        ]
      },
      data: sampleData
    });

    expect(variables['--wdash-grid-template-columns']).toBe('70% 30%');
    expect(variables['--wdash-grid-template-rows']).toBe('55% 45%');
  });
});

describe('layout parsing edge cases', () => {
  it('defaults missing spans to one and renders metrics from plain objects', () => {
    const { markup } = createRenderer({
      width: 400,
      height: 400,
      layout: {
        columns: [1],
        rows: [1, 'auto'],
        cards: [
          { id: 'summary', row: 1, column: 1 },
          { id: 'details', row: 2, column: 1 }
        ]
      },
      data: {
        summary: { value: 'OK', label: 'Status' },
        details: {
          heading: 'Conditions',
          description: 'Clear skies'
        }
      }
    });

    expect(markup).toContain('grid-column:1 / span 1');
    expect(markup).toContain('grid-row:1 / span 1');
    expect(markup).toContain('Status');
    expect(markup).toContain('Clear skies');
  });

  it('accepts fractional track shorthands and percentage gaps', () => {
    const { variables } = createRenderer({
      width: 1024,
      height: 768,
      layout: {
        columns: [2, '1fr', '0.5'],
        rows: ['minmax(120px, auto)', 1],
        gap: '5%',
        cards: [
          { id: 'primary', row: 1, column: 1, colSpan: 2 },
          { id: 'secondary', row: 1, column: 3 }
        ]
      },
      data: {}
    });

    expect(variables['--wdash-grid-template-columns']).toBe('2fr 1fr 0.5fr');
    expect(variables['--wdash-grid-template-rows']).toBe('minmax(120px, auto) 1fr');
    expect(variables['--wdash-grid-gap']).toBe('5%');
  });

  it('converts row-based layout overrides into grid templates', () => {
    const payloadLayout = {
      trackUnit: 'percent',
      gap: '12px',
      rows: [
        { height: 40, columns: ['temperature', 'wind'] },
        { height: 60, columns: [{ id: 'rain', colSpan: 2 }] }
      ]
    };

    const { extractLayoutFromPayload } = require('../src/bootstrap/renderer-host');
    const layout = extractLayoutFromPayload({ metadata: { layout: payloadLayout } });

    const { variables, markup } = createRenderer({
      width: 1000,
      height: 800,
      layout,
      data: sampleData
    });

    expect(variables['--wdash-grid-template-columns']).toBe('50% 50%');
    expect(variables['--wdash-grid-template-rows']).toBe('40% 60%');
    expect(variables['--wdash-grid-gap']).toBe('12px');
    expect(markup).toContain('wdash-card--rain');
    expect(markup).toContain('grid-column:1 / span 2');
  });

  it('merges repeated cards across rows and columns into spans', () => {
    const payloadLayout = {
      rows: [
        { columns: ['temperature', 'temperature', 'wind'] },
        { columns: ['temperature', 'temperature', 'wind'] },
        { columns: ['temperature', 'temperature', 'wind'] }
      ]
    };

    const { extractLayoutFromPayload } = require('../src/bootstrap/renderer-host');
    const layout = extractLayoutFromPayload({ metadata: { layout: payloadLayout } });

    const { markup } = createRenderer({
      width: 900,
      height: 900,
      layout,
      data: sampleData
    });

    const tempCard = layout.cards.find(card => card.id === 'temperature');
    const windCard = layout.cards.find(card => card.id === 'wind');

    expect(tempCard.row).toBe(1);
    expect(tempCard.column).toBe(1);
    expect(tempCard.colSpan).toBe(2);
    expect(tempCard.rowSpan).toBe(3);

    expect(windCard.row).toBe(1);
    expect(windCard.column).toBe(3);
    expect(windCard.colSpan).toBe(1);
    expect(windCard.rowSpan).toBe(3);

    expect(markup).toContain('wdash-card--temperature');
    expect(markup).toContain('grid-column:1 / span 2');
    expect(markup).toContain('grid-row:1 / span 3');
    expect(markup).toContain('wdash-card--wind');
    expect(markup).toContain('grid-column:3 / span 1');
  });
});
