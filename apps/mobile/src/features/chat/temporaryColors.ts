// Temporary chat is a product state, so its purple identity must not change
// with Android's wallpaper-derived Material palette.
const light = {
  surface: '#f0e7ff',
  composer: '#f7f1ff',
  accent: '#6d28d9',
  control: '#e9d5ff',
  onControl: '#6b21a8',
};
const dark = {
  surface: '#1d122e',
  composer: '#2c1b40',
  accent: '#d8b4fe',
  control: '#4c1d75',
  onControl: '#f3e8ff',
};

export function temporaryChatColors(isDark: boolean) {
  return isDark ? dark : light;
}
