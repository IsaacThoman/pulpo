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

// Increase Contrast (Settings > Accessibility > Display & Text Size), as iOS does for its own colors:
// secondary text, links and status colors reach 7:1, and separators and tertiary glyphs get stronger.
export const highContrastDarkTheme = {
  ...darkTheme,
  secondary: '#C7C7CC', tertiary: '#A8A8AE', separator: 'rgba(255,255,255,0.24)',
  blue: '#8CC0FF', green: '#5BE38A', orange: '#FFB870', red: '#FFA8A3',
} as const;

export const highContrastLightTheme = {
  ...lightTheme,
  secondary: '#48484E', tertiary: '#5C5C62', separator: 'rgba(0,0,0,0.24)',
  blue: '#0049A3', green: '#065224', orange: '#7A3800', red: '#8A1310',
} as const;

export const themePalettes = { dark: darkTheme, light: lightTheme } as const;
export const highContrastThemePalettes = { dark: highContrastDarkTheme, light: highContrastLightTheme } as const;

export type AppTheme = { [K in keyof typeof darkTheme]: K extends 'isDark' ? boolean : string };
