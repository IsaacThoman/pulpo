export const darkTheme = {
  isDark: true,
  background: '#000000', elevated: '#1C1C1E', elevated2: '#252527', glass: 'rgba(35,35,37,0.82)',
  text: '#F7F7F8', secondary: '#A1A1A8', tertiary: '#696970', separator: 'rgba(255,255,255,0.10)',
  accent: '#FFFFFF', accentText: '#09090A', blue: '#65A7FF', green: '#32D769', orange: '#FF9F3F', red: '#FF5C5C',
  disabledBackground: '#48484A', disabledText: '#F7F7F8',
  fill: 'rgba(255,255,255,0.075)', fillStrong: 'rgba(255,255,255,0.12)', shadow: '#000000',
} as const;

export const lightTheme = {
  isDark: false,
  background: '#F5F5F7', elevated: '#FFFFFF', elevated2: '#ECECEF', glass: 'rgba(250,250,252,0.86)',
  text: '#111114', secondary: '#68686F', tertiary: '#99999F', separator: 'rgba(0,0,0,0.09)',
  accent: '#111114', accentText: '#FFFFFF', blue: '#075FBE', green: '#0B7735', orange: '#A24B00', red: '#C5221F',
  disabledBackground: '#E2E2E7', disabledText: '#64646D',
  fill: 'rgba(0,0,0,0.045)', fillStrong: 'rgba(0,0,0,0.08)', shadow: '#74747A',
} as const;

// Android uses Material 3 surface roles instead of mirroring the iOS glass palette.
// These baseline roles remain predictable when a device has dynamic color disabled;
// native Compose controls still inherit the user's Material You palette.
export const androidDarkTheme = {
  isDark: true,
  background: '#141218', elevated: '#211F26', elevated2: '#2B2930', glass: '#211F26',
  text: '#E6E1E5', secondary: '#CAC4D0', tertiary: '#938F99', separator: '#49454F',
  accent: '#D0BCFF', accentText: '#381E72', blue: '#D0BCFF', green: '#B8F397', orange: '#FFB77D', red: '#F2B8B5',
  disabledBackground: '#49454F', disabledText: '#938F99',
  fill: '#1D1B20', fillStrong: '#36343B', shadow: '#000000',
} as const;

export const androidLightTheme = {
  isDark: false,
  background: '#FDF8FF', elevated: '#FFFBFE', elevated2: '#F3EDF7', glass: '#F3EDF7',
  text: '#1D1B20', secondary: '#49454F', tertiary: '#79747E', separator: '#CAC4D0',
  accent: '#6750A4', accentText: '#FFFFFF', blue: '#6750A4', green: '#386A20', orange: '#825500', red: '#B3261E',
  disabledBackground: '#E6E0E9', disabledText: '#79747E',
  fill: '#F7F2FA', fillStrong: '#E8DEF8', shadow: '#000000',
} as const;

export const themePalettes = { dark: darkTheme, light: lightTheme } as const;

export type AppTheme = typeof darkTheme | typeof lightTheme | typeof androidDarkTheme | typeof androidLightTheme;
