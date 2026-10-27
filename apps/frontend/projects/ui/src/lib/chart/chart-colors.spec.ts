import { readChartColors } from './chart-colors';

describe('readChartColors', () => {
  it('reads the roles from the custom properties of the host', () => {
    const host = document.createElement('div');
    host.style.setProperty('--mat-sys-primary', 'rgb(1, 2, 3)');
    host.style.setProperty('--smart-status-dry', 'rgb(4, 5, 6)');
    document.body.append(host);
    const colors = readChartColors(host, true);
    host.remove();
    expect(colors.primary).toBe('rgb(1, 2, 3)');
    expect(colors.dry).toBe('rgb(4, 5, 6)');
    expect(colors.dark).toBe(true);
  });

  it('falls back to the text colour for a role the theme does not define', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const colors = readChartColors(host, false);
    host.remove();
    expect(colors.primary).toBe('currentColor');
    expect(colors.card).toBe('currentColor');
    expect(colors.dryContainer).toBe('currentColor');
  });
});
